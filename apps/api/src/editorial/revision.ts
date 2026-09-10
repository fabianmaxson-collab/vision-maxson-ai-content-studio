import type { z } from 'zod';
import type {
  revisionRequestResolutionSchema,
  revisionRequestSchema,
} from '@vision-maxson/contracts';
import type { EditorialActor } from './repository';
import {
  assertEditorialRevisionSchemaReady,
  evaluateEditorialProductionReadiness,
} from './readiness';

type RequestCommand = z.infer<typeof revisionRequestSchema>;
type ResolutionCommand = z.infer<typeof revisionRequestResolutionSchema>;
type Row = Record<string, unknown>;
type AuditContext = {
  requestId: string;
  environment: string;
  accessIssuer?: string;
  accessSubject?: string;
};
const uid = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;
const now = () => new Date().toISOString();
async function digest(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((part) => part.toString(16).padStart(2, '0'))
    .join('');
}

export class EditorialRevisionService {
  constructor(
    private readonly db: D1Database,
    private readonly actor: EditorialActor,
    private readonly context: AuditContext,
  ) {}

  private role() {
    const role = this.actor.roles.find((value) => value !== 'viewer');
    if (!role) throw new Error('revision_request_not_allowed');
    return role;
  }

  private audit(
    id: string,
    action: 'editorial.revision_requested' | 'editorial.revision_request_resolved',
    resourceId: string,
    metadata: Record<string, unknown>,
    at: string,
  ) {
    return this.db
      .prepare(
        `INSERT INTO audit_events(id,workspace_id,actor_type,actor_id,actor_role,access_issuer,access_subject,action,resource_type,resource_id,outcome,request_id,environment,metadata_json,occurred_at,ingested_at)
         VALUES(?,?,'user',?,?,?,?,?,'editorial_revision_request',?,'success',?,?,?,?,?)`,
      )
      .bind(
        id,
        this.actor.workspaceId,
        this.actor.id,
        this.role(),
        this.context.accessIssuer ?? null,
        this.context.accessSubject ?? null,
        action,
        resourceId,
        this.context.requestId,
        this.context.environment,
        JSON.stringify(metadata),
        at,
        at,
      );
  }

  async request(versionId: string, idempotencyKey: string, command: RequestCommand) {
    await assertEditorialRevisionSchemaReady(this.db);
    const commandHash = await digest({ versionId, command });
    const replay = await this.db
      .prepare(
        `SELECT id,project_id projectId,reviewed_artifact_id reviewedArtifactId,reviewed_artifact_version_id reviewedArtifactVersionId,target_stage targetStage,reason_code reasonCode,status,audit_event_id auditEventId,command_hash commandHash
         FROM editorial_revision_requests WHERE workspace_id=? AND idempotency_key=?`,
      )
      .bind(this.actor.workspaceId, idempotencyKey)
      .first<Row>();
    if (replay) {
      if (replay.commandHash !== commandHash)
        throw new Error('revision_request_idempotency_conflict');
      return { ...replay, idempotentReplay: true };
    }
    const target = await this.db
      .prepare(
        `SELECT a.id artifactId,a.project_id projectId,a.artifact_type artifactType,a.current_version_id currentVersionId,a.version artifactRevision
         FROM editorial_artifact_versions v JOIN editorial_artifacts a ON a.id=v.artifact_id
         WHERE v.id=? AND v.workspace_id=? AND a.workspace_id=? AND a.deleted_at IS NULL`,
      )
      .bind(versionId, this.actor.workspaceId, this.actor.workspaceId)
      .first<Row>();
    if (!target) throw new Error('artifact_version_not_found');
    if (target.artifactType !== 'STORYBOARD')
      throw new Error('revision_reviewed_artifact_type_unsupported');
    if (target.currentVersionId !== versionId)
      throw new Error('stale_version_cannot_request_revision');
    if (Number(target.artifactRevision) !== command.expectedArtifactRevision)
      throw new Error('revision_request_version_conflict');

    const baseline = await this.db
      .prepare(
        `SELECT a.current_version_id versionId FROM editorial_artifacts a
         WHERE a.workspace_id=? AND a.project_id=? AND a.artifact_type='RESEARCH'
           AND a.deleted_at IS NULL LIMIT 1`,
      )
      .bind(this.actor.workspaceId, target.projectId)
      .first<Row>();
    if (!baseline?.versionId) throw new Error('revision_target_stage_unavailable');

    const requestId = uid('revision_request');
    const auditEventId = uid('audit');
    const at = now();
    const metadata = {
      projectId: target.projectId,
      reviewedArtifactId: target.artifactId,
      reviewedArtifactVersionId: versionId,
      revisionRequestId: requestId,
      targetStage: command.targetStage,
      targetBaselineVersionId: baseline.versionId,
      reasonCode: command.reasonCode,
    };
    try {
      await this.db.batch([
        this.audit(auditEventId, 'editorial.revision_requested', requestId, metadata, at),
        this.db
          .prepare(
            `INSERT INTO editorial_revision_requests(id,workspace_id,project_id,reviewed_artifact_id,reviewed_artifact_version_id,reviewed_artifact_revision,target_stage,target_baseline_version_id,reason_code,comment,status,actor_id,actor_role,idempotency_key,command_hash,audit_event_id,created_at)
             VALUES(?,?,?,?,?,?,?,?,?,?,'OPEN',?,?,?,?,?,?)`,
          )
          .bind(
            requestId,
            this.actor.workspaceId,
            target.projectId,
            target.artifactId,
            versionId,
            command.expectedArtifactRevision,
            command.targetStage,
            baseline.versionId,
            command.reasonCode,
            command.comment,
            this.actor.id,
            this.role(),
            idempotencyKey,
            commandHash,
            auditEventId,
            at,
          ),
      ]);
    } catch (error) {
      const winner = await this.db
        .prepare(
          `SELECT id,project_id projectId,reviewed_artifact_id reviewedArtifactId,reviewed_artifact_version_id reviewedArtifactVersionId,target_stage targetStage,reason_code reasonCode,status,audit_event_id auditEventId,command_hash commandHash
           FROM editorial_revision_requests WHERE workspace_id=? AND idempotency_key=?`,
        )
        .bind(this.actor.workspaceId, idempotencyKey)
        .first<Row>();
      if (winner && winner.commandHash === commandHash)
        return { ...winner, idempotentReplay: true };
      const open = await this.db
        .prepare(
          `SELECT r.id FROM editorial_revision_requests r
           LEFT JOIN editorial_revision_request_resolutions x ON x.revision_request_id=r.id
           WHERE r.workspace_id=? AND r.project_id=? AND r.reviewed_artifact_id=?
             AND r.reviewed_artifact_version_id=? AND x.id IS NULL LIMIT 1`,
        )
        .bind(this.actor.workspaceId, target.projectId, target.artifactId, versionId)
        .first();
      if (open) throw new Error('revision_request_already_open', { cause: error });
      throw error;
    }
    return {
      id: requestId,
      projectId: target.projectId,
      reviewedArtifactId: target.artifactId,
      reviewedArtifactVersionId: versionId,
      targetStage: command.targetStage,
      reasonCode: command.reasonCode,
      status: 'OPEN',
      auditEventId,
      idempotentReplay: false,
    };
  }

  async resolve(requestId: string, idempotencyKey: string, command: ResolutionCommand) {
    await assertEditorialRevisionSchemaReady(this.db);
    const commandHash = await digest({ requestId, command });
    const replay = this.db
      .prepare(
        `SELECT id,revision_request_id revisionRequestId,status,resolution_artifact_version_id resolutionArtifactVersionId,audit_event_id auditEventId,command_hash commandHash
         FROM editorial_revision_request_resolutions WHERE workspace_id=? AND idempotency_key=?`,
      )
      .bind(this.actor.workspaceId, idempotencyKey);
    const prior = await replay.first<Row>();
    if (prior) {
      if (prior.commandHash !== commandHash)
        throw new Error('revision_resolution_idempotency_conflict');
      return { ...prior, idempotentReplay: true };
    }

    const request = await this.db
      .prepare(
        `SELECT r.*,x.id resolutionId FROM editorial_revision_requests r
         LEFT JOIN editorial_revision_request_resolutions x ON x.revision_request_id=r.id
         WHERE r.id=? AND r.workspace_id=?`,
      )
      .bind(requestId, this.actor.workspaceId)
      .first<Row>();
    if (!request) throw new Error('revision_request_not_found');
    if (request.resolutionId) throw new Error('revision_request_already_resolved');
    if (request.target_stage !== 'RESEARCH') throw new Error('revision_target_stage_unsupported');

    const research = await this.db
      .prepare(
        `SELECT a.current_version_id versionId,a.status,
           EXISTS(SELECT 1 FROM artifact_approvals ap WHERE ap.workspace_id=a.workspace_id AND ap.artifact_version_id=a.current_version_id AND ap.decision='APPROVED') approved
         FROM editorial_artifacts a
         WHERE a.workspace_id=? AND a.project_id=? AND a.artifact_type='RESEARCH' AND a.deleted_at IS NULL`,
      )
      .bind(this.actor.workspaceId, request.project_id)
      .first<Row>();
    if (
      !research ||
      research.status !== 'approved' ||
      Number(research.approved) !== 1 ||
      research.versionId === request.target_baseline_version_id
    )
      throw new Error('revision_request_target_not_superseded');

    const storyboard = this.db
      .prepare(
        `SELECT a.current_version_id versionId,a.status,
           EXISTS(SELECT 1 FROM artifact_approvals ap WHERE ap.workspace_id=a.workspace_id AND ap.artifact_version_id=a.current_version_id AND ap.decision='APPROVED') approved
         FROM editorial_artifacts a
         WHERE a.workspace_id=? AND a.project_id=? AND a.artifact_type='STORYBOARD' AND a.deleted_at IS NULL`,
      )
      .bind(this.actor.workspaceId, request.project_id);
    const replacement = await storyboard.first<Row>();
    if (
      !replacement ||
      replacement.status !== 'approved' ||
      Number(replacement.approved) !== 1 ||
      replacement.versionId !== command.resolutionArtifactVersionId ||
      replacement.versionId === request.reviewed_artifact_version_id
    )
      throw new Error('revision_request_resolution_storyboard_invalid');

    const readiness = await evaluateEditorialProductionReadiness(
      this.db,
      this.actor,
      String(request.project_id),
      'BEFORE_REVISION_RESOLUTION',
      { ignoreRevisionRequestId: requestId },
    );
    if (!readiness.ready)
      throw new Error(`revision_request_not_resolved:${readiness.blockers.join(',')}`);

    const resolutionId = uid('revision_resolution');
    const auditEventId = uid('audit');
    const at = now();
    const evidence = {
      targetStage: 'RESEARCH',
      targetVersionId: research.versionId,
      storyboardVersionId: replacement.versionId,
      evaluatedArtifactVersionIds: readiness.evaluatedArtifactVersionIds,
    };
    try {
      await this.db.batch([
        this.audit(
          auditEventId,
          'editorial.revision_request_resolved',
          requestId,
          { revisionRequestId: requestId, projectId: request.project_id, ...evidence },
          at,
        ),
        this.db
          .prepare(
            `INSERT INTO editorial_revision_request_resolutions(id,workspace_id,project_id,revision_request_id,status,resolution_artifact_version_id,resolution_evidence_json,resolved_by,idempotency_key,command_hash,audit_event_id,resolved_at)
             VALUES(?,?,?,?,'RESOLVED',?,?,?,?,?,?,?)`,
          )
          .bind(
            resolutionId,
            this.actor.workspaceId,
            request.project_id,
            requestId,
            command.resolutionArtifactVersionId,
            JSON.stringify(evidence),
            this.actor.id,
            idempotencyKey,
            commandHash,
            auditEventId,
            at,
          ),
      ]);
    } catch (error) {
      const winner = await this.db
        .prepare(
          `SELECT id,revision_request_id revisionRequestId,status,resolution_artifact_version_id resolutionArtifactVersionId,audit_event_id auditEventId,command_hash commandHash
           FROM editorial_revision_request_resolutions WHERE workspace_id=? AND idempotency_key=?`,
        )
        .bind(this.actor.workspaceId, idempotencyKey)
        .first<Row>();
      if (winner && winner.commandHash === commandHash)
        return { ...winner, idempotentReplay: true };
      throw error;
    }
    return {
      id: resolutionId,
      revisionRequestId: requestId,
      status: 'RESOLVED',
      resolutionArtifactVersionId: command.resolutionArtifactVersionId,
      auditEventId,
      idempotentReplay: false,
    };
  }
}
