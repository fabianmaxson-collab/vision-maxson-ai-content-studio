import { countWords, invalidationFor, type ArtifactType, type Role } from '@vision-maxson/domain';
import { assertEditorialRevisionSchemaReady } from './readiness';

export interface EditorialActor {
  id: string;
  workspaceId: string;
  roles: Role[];
}
export interface ApprovalAuditContext {
  requestId: string;
  environment: string;
  accessIssuer: string | null;
  accessSubject: string | null;
}
export interface ApprovalSnapshotGuard {
  condition: string;
  values: readonly unknown[];
  reason: string;
}
export interface PreflightApprovalEvaluation {
  readiness: 'READY_FOR_GENERATION' | 'NOT_READY';
  beforeGuards: readonly ApprovalSnapshotGuard[];
  stableGuards: readonly ApprovalSnapshotGuard[];
}
export class ApprovalConflictError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = 'ApprovalConflictError';
    this.code = code;
  }
}
export class ApprovalInternalError extends Error {
  readonly code = 'approval_internal_failure';
  constructor() {
    super('approval_internal_failure');
    this.name = 'ApprovalInternalError';
  }
}
const id = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;
const now = () => new Date().toISOString();
function monotonicDecisionTime(previous: unknown) {
  const candidate = Date.now(),
    previousTime = typeof previous === 'string' ? Date.parse(previous) : NaN;
  return new Date(
    Number.isFinite(previousTime) && candidate <= previousTime ? previousTime + 1 : candidate,
  ).toISOString();
}
async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((part) => part.toString(16).padStart(2, '0'))
    .join('');
}

export class EditorialRepository {
  constructor(
    private readonly db: D1Database,
    private readonly actor: EditorialActor,
    private readonly approvalAuditContext: ApprovalAuditContext = {
      requestId: 'repository',
      environment: 'test',
      accessIssuer: null,
      accessSubject: null,
    },
  ) {}

  async list(projectId: string) {
    return (
      await this.db
        .prepare(
          `SELECT a.id,a.artifact_type AS artifactType,a.status,a.current_version_id AS currentVersionId,v.version_number AS versionNumber,v.language_code AS languageCode,v.source_type AS sourceType,v.content_text AS contentText,v.content_json AS contentJson,v.source_script_version_id AS sourceScriptVersionId,v.created_at AS createdAt,(SELECT ic.id FROM idea_candidates ic WHERE ic.artifact_version_id=v.id LIMIT 1) AS candidateId FROM editorial_artifacts a LEFT JOIN editorial_artifact_versions v ON v.id=a.current_version_id WHERE a.project_id=? AND a.workspace_id=? AND a.deleted_at IS NULL ORDER BY a.created_at,a.id`,
        )
        .bind(projectId, this.actor.workspaceId)
        .all()
    ).results;
  }

  async createVersion(input: {
    projectId: string;
    artifactId?: string;
    artifactType: ArtifactType;
    parentVersionId: string | null;
    languageCode: string;
    contentText: string | null;
    content: Record<string, unknown> | null;
    sourceType: 'HUMAN_EDITED' | 'IMPORTED';
    sourceScriptVersionId: string | null;
    expectedArtifactVersion?: number;
  }) {
    const project = await this.db
      .prepare(`SELECT id FROM projects WHERE id=? AND workspace_id=? AND deleted_at IS NULL`)
      .bind(input.projectId, this.actor.workspaceId)
      .first();
    if (!project) throw new Error('project_not_found');
    const artifactId = input.artifactId ?? id('artifact');
    const existing = input.artifactId
      ? await this.db
          .prepare(
            `SELECT id,current_version_id AS currentVersionId,version FROM editorial_artifacts WHERE id=? AND project_id=? AND workspace_id=? AND deleted_at IS NULL`,
          )
          .bind(input.artifactId, input.projectId, this.actor.workspaceId)
          .first<{ id: string; currentVersionId: string | null; version: number }>()
      : null;
    if (input.artifactId && !existing) throw new Error('artifact_not_found');
    if (
      existing &&
      input.expectedArtifactVersion !== undefined &&
      existing.version !== input.expectedArtifactVersion
    )
      throw new Error('version_conflict');
    if (existing && existing.currentVersionId !== (input.parentVersionId ?? null))
      throw new Error('parent_version_not_current');
    const versionNumber = existing
      ? ((
          await this.db
            .prepare(
              `SELECT COALESCE(MAX(version_number),0)+1 AS next FROM editorial_artifact_versions WHERE artifact_id=?`,
            )
            .bind(artifactId)
            .first<{ next: number }>()
        )?.next ?? 1)
      : 1;
    const versionId = id('artifact_version');
    const contentJson = input.content === null ? null : JSON.stringify(input.content);
    const hash = await sha256(
      JSON.stringify({
        languageCode: input.languageCode,
        contentText: input.contentText,
        content: input.content,
        sourceScriptVersionId: input.sourceScriptVersionId,
      }),
    );
    const at = now();
    const statements: D1PreparedStatement[] = [];
    if (!existing)
      statements.push(
        this.db
          .prepare(
            `INSERT INTO editorial_artifacts(id,workspace_id,project_id,artifact_type,status,created_at,updated_at,version,created_by,updated_by) VALUES(?,?,?,?,'draft',?,?,1,?,?)`,
          )
          .bind(
            artifactId,
            this.actor.workspaceId,
            input.projectId,
            input.artifactType,
            at,
            at,
            this.actor.id,
            this.actor.id,
          ),
      );
    statements.push(
      this.db
        .prepare(
          `INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,parent_version_id,language_code,content_text,content_json,source_type,content_hash,word_count,source_script_version_id,created_at,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          versionId,
          this.actor.workspaceId,
          artifactId,
          versionNumber,
          input.parentVersionId,
          input.languageCode,
          input.contentText,
          contentJson,
          input.sourceType,
          hash,
          input.contentText === null ? null : countWords(input.contentText),
          input.sourceScriptVersionId,
          at,
          this.actor.id,
        ),
    );
    statements.push(
      this.db
        .prepare(
          `UPDATE editorial_artifacts SET current_version_id=?,status='active',updated_at=?,updated_by=?,version=version+1 WHERE id=? AND workspace_id=?`,
        )
        .bind(versionId, at, this.actor.id, artifactId, this.actor.workspaceId),
    );
    if (existing?.currentVersionId) {
      const dependents = await this.db
        .prepare(
          `SELECT d.id,a.artifact_type AS artifactType FROM artifact_dependencies d JOIN editorial_artifact_versions v ON v.id=d.dependent_artifact_version_id JOIN editorial_artifacts a ON a.id=v.artifact_id WHERE d.source_artifact_version_id=? AND d.workspace_id=? AND d.validity_status='CURRENT'`,
        )
        .bind(existing.currentVersionId, this.actor.workspaceId)
        .all<{ id: string; artifactType: ArtifactType }>();
      for (const dependent of dependents.results) {
        statements.push(
          this.db
            .prepare(
              `UPDATE artifact_dependencies SET validity_status=?,invalidated_at=?,invalidated_by_version_id=?,updated_at=?,version=version+1 WHERE id=? AND workspace_id=?`,
            )
            .bind(
              invalidationFor(dependent.artifactType),
              at,
              versionId,
              at,
              dependent.id,
              this.actor.workspaceId,
            ),
        );
        if (dependent.artifactType === 'PREFLIGHT')
          statements.push(
            this.db
              .prepare(
                `UPDATE preflight_assessments SET generation_readiness='NOT_READY' WHERE artifact_version_id=(SELECT dependent_artifact_version_id FROM artifact_dependencies WHERE id=?) AND workspace_id=?`,
              )
              .bind(dependent.id, this.actor.workspaceId),
          );
      }
    }
    await this.db.batch(statements);
    return { artifactId, versionId, versionNumber, contentHash: hash };
  }

  async approve(
    versionId: string,
    decision: 'APPROVED' | 'REJECTED',
    comment: string | null,
    preflightEvaluation: PreflightApprovalEvaluation | null = null,
  ) {
    await assertEditorialRevisionSchemaReady(this.db);
    const version = await this.db
      .prepare(
        `SELECT v.id,v.artifact_id AS artifactId,a.project_id AS projectId,a.current_version_id AS currentVersionId,a.status AS artifactStatus,a.version AS artifactRevision FROM editorial_artifact_versions v JOIN editorial_artifacts a ON a.id=v.artifact_id AND a.workspace_id=v.workspace_id WHERE v.id=? AND v.workspace_id=? AND a.deleted_at IS NULL`,
      )
      .bind(versionId, this.actor.workspaceId)
      .first<{
        id: string;
        artifactId: string;
        projectId: string;
        currentVersionId: string | null;
        artifactStatus: string;
        artifactRevision: number;
      }>();
    if (!version) throw new Error('artifact_version_not_found');
    if (version.currentVersionId !== versionId) throw new Error('stale_version_cannot_be_approved');
    const nextStatus = decision === 'APPROVED' ? 'approved' : 'rejected';
    if (decision === 'APPROVED') {
      const openRevision = await this.db
        .prepare(
          `SELECT r.id FROM editorial_revision_requests r LEFT JOIN editorial_revision_request_resolutions x ON x.revision_request_id=r.id WHERE r.workspace_id=? AND r.reviewed_artifact_version_id=? AND x.id IS NULL LIMIT 1`,
        )
        .bind(this.actor.workspaceId, versionId)
        .first();
      if (openRevision) throw new Error('open_revision_request_blocks_approval');
    }
    const role = this.actor.roles.find(
      (value): value is Exclude<Role, 'viewer'> =>
        value === 'owner' || value === 'admin' || value === 'operator',
    );
    if (!role) throw new Error('approval_not_allowed');

    const membershipSql = `SELECT count(*) AS count FROM users u JOIN user_roles ur ON ur.user_id=u.id AND ur.workspace_id=u.workspace_id JOIN roles r ON r.id=ur.role_id WHERE u.id=? AND u.workspace_id=? AND u.status='active' AND u.deleted_at IS NULL AND r.key=? AND (? IS NULL OR EXISTS(SELECT 1 FROM access_identities ai WHERE ai.user_id=u.id AND ai.workspace_id=u.workspace_id AND ai.issuer=? AND ai.subject=? AND ai.deleted_at IS NULL))`;
    const membershipValues = [
      this.actor.id,
      this.actor.workspaceId,
      role,
      this.approvalAuditContext.accessIssuer,
      this.approvalAuditContext.accessIssuer,
      this.approvalAuditContext.accessSubject,
    ];
    const membership = await this.db
      .prepare(membershipSql)
      .bind(...membershipValues)
      .first<{ count: number }>();
    if (Number(membership?.count) !== 1) throw new Error('approval_not_allowed');

    const approvalCount = await this.db
      .prepare(
        `SELECT count(*) AS count,coalesce(sum(CASE WHEN actor_id=? AND decision=? THEN 1 ELSE 0 END),0) AS actorDecisionCount,max(decided_at) AS latestDecidedAt FROM artifact_approvals WHERE workspace_id=? AND artifact_version_id=?`,
      )
      .bind(this.actor.id, decision, this.actor.workspaceId, versionId)
      .first<{ count: number; actorDecisionCount: number; latestDecidedAt: string | null }>();
    if (Number(approvalCount?.actorDecisionCount) !== 0) throw new Error('approval_conflict');
    const auditCount = await this.db
      .prepare(
        `SELECT count(*) AS count FROM audit_events WHERE workspace_id=? AND action='artifact.approval_recorded' AND resource_type='editorial_artifact_version' AND resource_id=?`,
      )
      .bind(this.actor.workspaceId, versionId)
      .first<{ count: number }>();
    const versionCount = await this.db
      .prepare(
        `SELECT count(*) AS count FROM editorial_artifact_versions WHERE workspace_id=? AND artifact_id=?`,
      )
      .bind(this.actor.workspaceId, version.artifactId)
      .first<{ count: number }>();
    const resolutionCount = await this.db
      .prepare(
        `SELECT count(*) AS count FROM editorial_revision_request_resolutions x JOIN editorial_revision_requests r ON r.id=x.revision_request_id AND r.workspace_id=x.workspace_id WHERE x.workspace_id=? AND r.project_id=?`,
      )
      .bind(this.actor.workspaceId, version.projectId)
      .first<{ count: number }>();
    const preflightCount = await this.db
      .prepare(
        `SELECT count(*) AS count FROM preflight_assessments WHERE workspace_id=? AND artifact_version_id=?`,
      )
      .bind(this.actor.workspaceId, versionId)
      .first<{ count: number }>();

    const approvalId = id('approval'),
      auditEventId = id('audit'),
      at = monotonicDecisionTime(approvalCount?.latestDecidedAt),
      expectedApprovalCount = Number(approvalCount?.count),
      expectedAuditCount = Number(auditCount?.count),
      expectedVersionCount = Number(versionCount?.count),
      expectedResolutionCount = Number(resolutionCount?.count),
      expectedPreflightCount = Number(preflightCount?.count),
      expectedReadiness = preflightEvaluation?.readiness ?? 'NOT_READY',
      auditMetadata = JSON.stringify({
        approvalId,
        artifactId: version.artifactId,
        decision,
        previousStatus: version.artifactStatus,
        newStatus: nextStatus,
        fromVersion: version.artifactRevision,
        toVersion: version.artifactRevision + 1,
      });
    const basePreconditions: ApprovalSnapshotGuard[] = [
      {
        condition: `(${membershipSql})=1`,
        values: membershipValues,
        reason: 'approval_membership_changed',
      },
      {
        condition: `EXISTS(SELECT 1 FROM editorial_artifact_versions v JOIN editorial_artifacts a ON a.id=v.artifact_id AND a.workspace_id=v.workspace_id WHERE v.id=? AND v.workspace_id=? AND v.artifact_id=? AND a.project_id=? AND a.current_version_id=? AND a.status=? AND a.version=? AND a.deleted_at IS NULL)`,
        values: [
          versionId,
          this.actor.workspaceId,
          version.artifactId,
          version.projectId,
          versionId,
          version.artifactStatus,
          version.artifactRevision,
        ],
        reason: 'stale_version_cannot_be_approved',
      },
      {
        condition: `(SELECT count(*) FROM artifact_approvals WHERE workspace_id=? AND artifact_version_id=?)=? AND NOT EXISTS(SELECT 1 FROM artifact_approvals WHERE workspace_id=? AND artifact_version_id=? AND actor_id=? AND decision=?)`,
        values: [
          this.actor.workspaceId,
          versionId,
          expectedApprovalCount,
          this.actor.workspaceId,
          versionId,
          this.actor.id,
          decision,
        ],
        reason: 'approval_conflict',
      },
      {
        condition: `(SELECT count(*) FROM audit_events WHERE workspace_id=? AND action='artifact.approval_recorded' AND resource_type='editorial_artifact_version' AND resource_id=?)=?`,
        values: [this.actor.workspaceId, versionId, expectedAuditCount],
        reason: 'approval_audit_conflict',
      },
      {
        condition: `(SELECT count(*) FROM editorial_artifact_versions WHERE workspace_id=? AND artifact_id=?)=?`,
        values: [this.actor.workspaceId, version.artifactId, expectedVersionCount],
        reason: 'approval_version_set_changed',
      },
      {
        condition: `(SELECT count(*) FROM editorial_revision_request_resolutions x JOIN editorial_revision_requests r ON r.id=x.revision_request_id AND r.workspace_id=x.workspace_id WHERE x.workspace_id=? AND r.project_id=?)=?`,
        values: [this.actor.workspaceId, version.projectId, expectedResolutionCount],
        reason: 'approval_revision_state_changed',
      },
    ];
    if (decision === 'APPROVED')
      basePreconditions.push({
        condition: `NOT EXISTS(SELECT 1 FROM editorial_revision_requests r LEFT JOIN editorial_revision_request_resolutions x ON x.revision_request_id=r.id WHERE r.workspace_id=? AND r.reviewed_artifact_version_id=? AND x.id IS NULL)`,
        values: [this.actor.workspaceId, versionId],
        reason: 'open_revision_request_blocks_approval',
      });
    const preconditions = [
      ...basePreconditions,
      ...(preflightEvaluation?.beforeGuards ?? []),
      ...(preflightEvaluation?.stableGuards ?? []),
    ];
    const guard = (spec: ApprovalSnapshotGuard) =>
      this.db
        .prepare(`SELECT CASE WHEN ${spec.condition} THEN 1 ELSE json('approval_guard_failed') END`)
        .bind(...spec.values);
    const statements: D1PreparedStatement[] = preconditions.map(guard);
    statements.push(
      this.db
        .prepare(
          `INSERT INTO artifact_approvals(id,workspace_id,artifact_version_id,decision,actor_id,actor_role,comment,decided_at) VALUES(?,?,?,?,?,?,?,?)`,
        )
        .bind(
          approvalId,
          this.actor.workspaceId,
          versionId,
          decision,
          this.actor.id,
          role,
          comment,
          at,
        ),
      guard({ condition: `changes()=1`, values: [], reason: 'approval_insert_unconfirmed' }),
      this.db
        .prepare(
          `UPDATE editorial_artifacts SET status=?,updated_at=?,updated_by=?,version=version+1 WHERE id=? AND workspace_id=? AND project_id=? AND current_version_id=? AND status=? AND version=? AND deleted_at IS NULL`,
        )
        .bind(
          nextStatus,
          at,
          this.actor.id,
          version.artifactId,
          this.actor.workspaceId,
          version.projectId,
          versionId,
          version.artifactStatus,
          version.artifactRevision,
        ),
      guard({
        condition: `changes()=1`,
        values: [],
        reason: 'approval_artifact_update_unconfirmed',
      }),
      this.db
        .prepare(
          `UPDATE preflight_assessments SET generation_readiness=? WHERE artifact_version_id=? AND workspace_id=?`,
        )
        .bind(expectedReadiness, versionId, this.actor.workspaceId),
      this.db
        .prepare(
          `INSERT INTO audit_events(id,workspace_id,actor_type,actor_id,actor_role,access_issuer,access_subject,action,resource_type,resource_id,outcome,request_id,environment,metadata_json,occurred_at,ingested_at) VALUES(?,?,'user',?,?,?,?,'artifact.approval_recorded','editorial_artifact_version',?,'success',?,?,?,?,?)`,
        )
        .bind(
          auditEventId,
          this.actor.workspaceId,
          this.actor.id,
          role,
          this.approvalAuditContext.accessIssuer,
          this.approvalAuditContext.accessSubject,
          versionId,
          this.approvalAuditContext.requestId,
          this.approvalAuditContext.environment,
          auditMetadata,
          at,
          at,
        ),
      guard({
        condition: `(${membershipSql})=1`,
        values: membershipValues,
        reason: 'approval_membership_changed',
      }),
      guard({
        condition: `EXISTS(SELECT 1 FROM editorial_artifact_versions v JOIN editorial_artifacts a ON a.id=v.artifact_id AND a.workspace_id=v.workspace_id WHERE v.id=? AND v.workspace_id=? AND v.artifact_id=? AND a.project_id=? AND a.current_version_id=? AND a.status=? AND a.version=? AND a.deleted_at IS NULL)`,
        values: [
          versionId,
          this.actor.workspaceId,
          version.artifactId,
          version.projectId,
          versionId,
          nextStatus,
          version.artifactRevision + 1,
        ],
        reason: 'approval_artifact_update_unconfirmed',
      }),
      guard({
        condition: `(SELECT count(*) FROM editorial_artifact_versions WHERE workspace_id=? AND artifact_id=?)=?`,
        values: [this.actor.workspaceId, version.artifactId, expectedVersionCount],
        reason: 'approval_version_set_changed',
      }),
      guard({
        condition: `(SELECT count(*) FROM artifact_approvals WHERE workspace_id=? AND artifact_version_id=?)=? AND EXISTS(SELECT 1 FROM artifact_approvals WHERE id=? AND workspace_id=? AND artifact_version_id=? AND decision=? AND actor_id=? AND actor_role=? AND decided_at=?)`,
        values: [
          this.actor.workspaceId,
          versionId,
          expectedApprovalCount + 1,
          approvalId,
          this.actor.workspaceId,
          versionId,
          decision,
          this.actor.id,
          role,
          at,
        ],
        reason: 'approval_persistence_unconfirmed',
      }),
      guard({
        condition: `(SELECT count(*) FROM audit_events WHERE workspace_id=? AND action='artifact.approval_recorded' AND resource_type='editorial_artifact_version' AND resource_id=?)=? AND EXISTS(SELECT 1 FROM audit_events WHERE id=? AND workspace_id=? AND actor_type='user' AND actor_id=? AND actor_role=? AND action='artifact.approval_recorded' AND resource_type='editorial_artifact_version' AND resource_id=? AND outcome='success' AND request_id=? AND environment=? AND metadata_json=?)`,
        values: [
          this.actor.workspaceId,
          versionId,
          expectedAuditCount + 1,
          auditEventId,
          this.actor.workspaceId,
          this.actor.id,
          role,
          versionId,
          this.approvalAuditContext.requestId,
          this.approvalAuditContext.environment,
          auditMetadata,
        ],
        reason: 'approval_audit_unconfirmed',
      }),
      guard({
        condition: `(SELECT count(*) FROM editorial_revision_request_resolutions x JOIN editorial_revision_requests r ON r.id=x.revision_request_id AND r.workspace_id=x.workspace_id WHERE x.workspace_id=? AND r.project_id=?)=?`,
        values: [this.actor.workspaceId, version.projectId, expectedResolutionCount],
        reason: 'approval_revision_state_changed',
      }),
      ...(preflightEvaluation?.stableGuards ?? []).map(guard),
      guard({
        condition: `(SELECT count(*) FROM preflight_assessments WHERE workspace_id=? AND artifact_version_id=?)=? AND NOT EXISTS(SELECT 1 FROM preflight_assessments WHERE workspace_id=? AND artifact_version_id=? AND generation_readiness<>?)`,
        values: [
          this.actor.workspaceId,
          versionId,
          expectedPreflightCount,
          this.actor.workspaceId,
          versionId,
          expectedReadiness,
        ],
        reason: 'approval_preflight_state_unconfirmed',
      }),
    );
    if (decision === 'APPROVED')
      statements.push(
        guard({
          condition: `NOT EXISTS(SELECT 1 FROM editorial_revision_requests r LEFT JOIN editorial_revision_request_resolutions x ON x.revision_request_id=r.id WHERE r.workspace_id=? AND r.reviewed_artifact_version_id=? AND x.id IS NULL)`,
          values: [this.actor.workspaceId, versionId],
          reason: 'open_revision_request_blocks_approval',
        }),
      );
    try {
      await this.db.batch(statements);
    } catch {
      try {
        const ownWrite = await this.db
          .prepare(
            `SELECT EXISTS(SELECT 1 FROM artifact_approvals WHERE id=?) OR EXISTS(SELECT 1 FROM audit_events WHERE id=?) AS persisted`,
          )
          .bind(approvalId, auditEventId)
          .first<{ persisted: number }>();
        if (Number(ownWrite?.persisted) === 1) throw new ApprovalInternalError();
        for (const spec of preconditions) {
          const state = await this.db
            .prepare(`SELECT CASE WHEN ${spec.condition} THEN 1 ELSE 0 END AS valid`)
            .bind(...spec.values)
            .first<{ valid: number }>();
          if (Number(state?.valid) !== 1) throw new ApprovalConflictError(spec.reason);
        }
      } catch (error) {
        if (error instanceof ApprovalConflictError || error instanceof ApprovalInternalError)
          throw error;
        throw new ApprovalInternalError();
      }
      throw new ApprovalInternalError();
    }
    return { approvalId, versionId, decision, auditEventId };
  }
  async projectCostSummary(projectId: string) {
    const row = await this.db
      .prepare(
        `SELECT COUNT(*) AS runCount,SUM(actual_cost) AS knownSubtotal,SUM(CASE WHEN actual_cost IS NULL THEN 1 ELSE 0 END) AS unknownCount,MIN(currency) AS minCurrency,MAX(currency) AS maxCurrency FROM intelligence_runs WHERE project_id=? AND workspace_id=? AND status='SUCCEEDED'`,
      )
      .bind(projectId, this.actor.workspaceId)
      .first<{
        runCount: number;
        knownSubtotal: number | null;
        unknownCount: number;
        minCurrency: string | null;
        maxCurrency: string | null;
      }>();
    const complete = Boolean(
      row &&
      row.runCount > 0 &&
      row.unknownCount === 0 &&
      row.minCurrency === row.maxCurrency &&
      row.minCurrency,
    );
    return {
      runCount: row?.runCount ?? 0,
      knownSubtotal: row?.knownSubtotal ?? null,
      unknownCount: row?.unknownCount ?? 0,
      currency: complete ? row!.minCurrency : null,
      projectEnvelopeWith15Percent:
        complete && row && row.knownSubtotal !== null ? row.knownSubtotal * 1.15 : null,
      complete,
    };
  }
  async providerCatalog() {
    const providers = await this.db
      .prepare(
        `SELECT id,key,display_name AS displayName,status FROM ai_providers WHERE status!='disabled' ORDER BY display_name`,
      )
      .all();
    return {
      configured: providers.results.some((item) => item.status === 'configured'),
      items: providers.results,
    };
  }
}
