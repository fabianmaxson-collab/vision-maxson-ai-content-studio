import { z } from 'zod';
import {
  contentBriefSchema,
  contentBriefHumanRevisionSchema,
  contentBriefRevisionCapacityResultSchema,
  type ContentBriefHumanRevisionCommand,
} from '@vision-maxson/contracts';
import { hasPermission, newId } from '@vision-maxson/domain';
import type { EditorialActor } from './repository';

type Row = Record<string, string | number | null>;
type Context = {
  requestId: string;
  environment: string;
  accessIssuer?: string;
  accessSubject?: string;
};
const operation = 'content_brief_human_revision_v1';
const action = 'editorial.content_brief_human_revision_created';
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{2,99}$/u);
const sha = z.string().regex(/^[a-f0-9]{64}$/u);
const resultSchema = z
  .object({
    artifactId: id,
    projectId: id,
    parentVersionId: id,
    versionId: id,
    versionNumber: z.number().int().positive(),
    contentHash: sha,
    auditEventId: id,
    createdArtifactRevision: z.number().int().positive(),
    createdArtifactStatus: z.literal('active'),
    createdApprovalCount: z.literal(0),
    sourceType: z.literal('HUMAN_EDITED'),
    intelligenceRunId: z.null(),
    languageCode: z.literal('de'),
  })
  .strict();
const receiptSchema = z
  .object({
    receiptVersion: z.literal(1),
    operation: z.literal(operation),
    environment: z.string().min(1),
    workspaceId: id,
    actorId: id,
    actorRole: z.enum(['owner', 'admin', 'operator']),
    idempotencyKeyHash: sha,
    commandHash: sha,
    projectId: id,
    revisionRequestId: id,
    capacityId: id,
    researchVersionId: id,
    researchApprovalId: id,
    ideaCandidateId: id,
    ideaVersionId: id,
    ideaApprovalId: id,
    parentVersionId: id,
    parentContentHash: sha,
    expectedArtifactRevision: z.number().int().positive(),
    newVersionId: id,
    newContentHash: sha,
    generatedFromDependencyId: id,
    usesResearchDependencyId: id,
    humanReviewDecision: z.literal('REVISE'),
    result: resultSchema,
  })
  .strict();
type Receipt = z.infer<typeof receiptSchema>;
export class ContentBriefHumanRevisionError extends Error {
  constructor(
    readonly status: 403 | 404 | 409 | 422 | 500,
    message: string,
  ) {
    super(message);
  }
}
const fail = (status: 403 | 404 | 409 | 422 | 500, reason: string): never => {
  throw new ContentBriefHumanRevisionError(status, `content_brief_human_revision_${reason}`);
};
async function hashText(text: string) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)),
  );
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}
// Arrays with a fixed field order make the receipt key and command hashes unambiguous.
const digest = (value: unknown) => hashText(JSON.stringify(value));
const correctedKeys = [
  'objective',
  'narrativeAngle',
  'hook',
  'visualDirection',
  'editorialConstraints',
] as const;
function merge(parent: Row, command: ContentBriefHumanRevisionCommand, researchId: string) {
  let raw: unknown;
  try {
    raw = JSON.parse(String(parent.content_json));
  } catch {
    return fail(422, 'parent_content_invalid');
  }
  const source = contentBriefSchema.strict().safeParse(raw);
  if (!source.success || Object.keys(raw as object).length !== Object.keys(source.data).length)
    return fail(422, 'parent_content_invalid');
  const content = source.data;
  if (
    parent.language_code !== 'de' ||
    content.productionLanguage !== 'de' ||
    content.format !== 'SHORT' ||
    content.targetDurationSeconds !== 60 ||
    JSON.stringify(content.researchVersionIds) !== JSON.stringify([researchId])
  )
    return fail(422, 'parent_content_invalid');
  if (
    correctedKeys.every(
      (key) => JSON.stringify(content[key]) === JSON.stringify(command.changes[key]),
    )
  )
    return fail(422, 'no_op');
  const next = contentBriefSchema.strict().parse({ ...content, ...command.changes });
  for (const key of Object.keys(content) as Array<keyof typeof content>) {
    if (
      !correctedKeys.some((corrected) => corrected === key) &&
      JSON.stringify(content[key]) !== JSON.stringify(next[key])
    )
      return fail(422, 'immutable_content_changed');
  }
  return JSON.stringify(next);
}
// Evidence is selected through the parent's exact consumed run, never by recency.
const originSql = `SELECT c.*, a.metadata_json consumption_json, a.request_id consumption_request_id,
  a.actor_id consumption_actor_id, r.id reservation_id, r.envelope_id execution_envelope_id,
  ir.id run_id, ir.output_artifact_version_id output_version_id, ir.safe_metadata_json run_metadata,
  ir.terminal_audit_event_id terminal_audit_id, ir.actual_cost actual_cost,
  r.actual_microusd actual_microusd, r.reserved_microusd reserved_microusd
 FROM editorial_content_brief_revision_capacities c
 JOIN audit_events a ON a.resource_id=c.id AND a.workspace_id=c.workspace_id
  AND a.action='editorial.content_brief_revision_capacity_consumed' AND a.outcome='success'
  AND a.resource_type='editorial_content_brief_revision_capacity' AND a.environment=c.environment
 JOIN intelligence_runs ir ON ir.id=json_extract(a.metadata_json,'$.runId')
  AND a.id='brief-capacity-consumed-'||ir.id AND ir.workspace_id=c.workspace_id AND ir.project_id=c.project_id
  AND ir.task_type='CONTENT_BRIEF' AND ir.status='SUCCEEDED' AND ir.input_artifact_version_id=c.idea_version_id
  AND ir.provider_id=c.provider_id AND ir.provider_model_id=c.provider_model_id
  AND ir.prompt_version_id=c.prompt_version_id
 JOIN editorial_execution_reservations r ON r.intelligence_run_id=ir.id
  AND r.id=json_extract(a.metadata_json,'$.reservationId') AND r.envelope_id=json_extract(a.metadata_json,'$.executionEnvelopeId')
  AND r.workspace_id=c.workspace_id AND r.project_id=c.project_id AND r.project_execution_budget_id=c.budget_id
  AND r.status='RECONCILED' AND r.dispatched_at IS NOT NULL AND r.reconciled_at IS NOT NULL AND r.actual_microusd IS NOT NULL
 JOIN editorial_execution_envelopes e ON e.id=r.envelope_id AND e.status='CONSUMED'
  AND e.workspace_id=c.workspace_id AND e.project_id=c.project_id AND e.project_execution_budget_id=c.budget_id
  AND e.stage_key='CONTENT_BRIEF' AND e.maximum_calls=1
 WHERE ir.id=(SELECT intelligence_run_id FROM editorial_artifact_versions WHERE id=json_extract(?, '$.parentId'))
  AND ir.output_artifact_version_id=json_extract(?, '$.parentId')`;

// Each predicate stays shallow; the same complete graph is checked again inside the batch.
const eligibleSql = `SELECT 1 FROM editorial_content_brief_revision_capacities c, json_each(?) arg
 JOIN projects p ON p.id=c.project_id AND p.workspace_id=c.workspace_id
 JOIN editorial_revision_requests rr ON rr.id=c.revision_request_id AND rr.workspace_id=c.workspace_id AND rr.project_id=c.project_id
 JOIN editorial_artifacts ra ON ra.id=c.research_artifact_id AND ra.workspace_id=c.workspace_id AND ra.project_id=c.project_id
 JOIN editorial_artifact_versions rv ON rv.id=c.research_version_id AND rv.artifact_id=ra.id AND rv.workspace_id=c.workspace_id
 JOIN editorial_artifacts ia ON ia.id=c.idea_artifact_id AND ia.workspace_id=c.workspace_id AND ia.project_id=c.project_id
 JOIN editorial_artifact_versions iv ON iv.id=c.idea_version_id AND iv.artifact_id=ia.id AND iv.workspace_id=c.workspace_id
 JOIN idea_candidates ic ON ic.id=c.idea_candidate_id AND ic.workspace_id=c.workspace_id AND ic.project_id=c.project_id
 JOIN editorial_artifacts ba ON ba.id=c.brief_artifact_id AND ba.workspace_id=c.workspace_id AND ba.project_id=c.project_id
 JOIN editorial_artifact_versions bv ON bv.id=json_extract(arg.value,'$.parentId') AND bv.artifact_id=ba.id AND bv.workspace_id=c.workspace_id
 WHERE (c.id=json_extract(arg.value,'$.capacityId')
   AND c.workspace_id=json_extract(arg.value,'$.workspaceId')
   AND c.environment=json_extract(arg.value,'$.environment')
   AND p.status='ANALYZING'
   AND p.version=c.expected_project_version
   AND p.version=2
   AND p.primary_language='de'
   AND p.format='SHORT')
 AND (p.operating_mode='ASSISTED'
   AND p.deleted_at IS NULL
   AND p.archived_at IS NULL
   AND rr.status='OPEN'
   AND rr.target_stage='RESEARCH'
   AND NOT EXISTS(SELECT 1 FROM editorial_revision_request_resolutions WHERE revision_request_id=rr.id)
   AND ra.current_version_id=rv.id
   AND ra.status='approved')
 AND (ra.artifact_type='RESEARCH'
   AND ra.deleted_at IS NULL
   AND ra.version=c.expected_research_artifact_revision
   AND rv.content_hash=c.research_content_hash
   AND EXISTS(SELECT 1 FROM artifact_approvals WHERE id=c.research_approval_id AND workspace_id=c.workspace_id AND artifact_version_id=rv.id AND decision='APPROVED')
   AND (SELECT count(*) FROM artifact_approvals WHERE artifact_version_id=rv.id)=1
   AND ia.current_version_id=iv.id
   AND ia.status='approved')
 AND (ia.artifact_type='IDEA_CANDIDATE'
   AND ia.deleted_at IS NULL
   AND ia.version=c.expected_idea_artifact_revision
   AND iv.content_hash=c.idea_content_hash
   AND EXISTS(SELECT 1 FROM artifact_approvals WHERE id=c.idea_approval_id AND workspace_id=c.workspace_id AND artifact_version_id=iv.id AND decision='APPROVED')
   AND (SELECT count(*) FROM artifact_approvals WHERE artifact_version_id=iv.id)=1
   AND ic.status='SELECTED'
   AND ic.version=c.expected_idea_candidate_revision)
 AND (ic.artifact_id=ia.id
   AND ic.artifact_version_id=iv.id
   AND (SELECT count(*) FROM idea_candidates WHERE workspace_id=c.workspace_id AND project_id=c.project_id AND status='SELECTED')=1
   AND (SELECT count(*) FROM artifact_dependencies WHERE dependent_artifact_version_id=iv.id AND dependency_type='GENERATED_FROM')=1
   AND EXISTS(SELECT 1 FROM artifact_dependencies WHERE workspace_id=c.workspace_id AND source_artifact_version_id=rv.id AND dependent_artifact_version_id=iv.id AND dependency_type='GENERATED_FROM' AND validity_status='CURRENT' AND invalidated_at IS NULL AND invalidated_by_version_id IS NULL)
   AND ba.deleted_at IS NULL
   AND ba.artifact_type='CONTENT_BRIEF'
   AND ba.status='active')
 AND (ba.current_version_id=json_extract(arg.value,'$.pointerId')
   AND ba.version=json_extract(arg.value,'$.artifactRevision')
   AND bv.version_number=2
   AND bv.parent_version_id=c.expected_current_brief_version_id
   AND c.expected_brief_artifact_revision+1=json_extract(arg.value,'$.expectedArtifactRevision')
   AND bv.content_hash=json_extract(arg.value,'$.parentHash')
   AND bv.content_json=json_extract(arg.value,'$.parentJson')
   AND bv.source_type='AI_GENERATED')
 AND (bv.intelligence_run_id=json_extract(arg.value,'$.runId')
   AND bv.language_code='de'
   AND bv.content_text IS NULL
   AND bv.source_script_version_id IS NULL
   AND NOT EXISTS(SELECT 1 FROM artifact_approvals WHERE artifact_version_id=bv.id)
   AND NOT EXISTS(SELECT 1 FROM editorial_artifact_versions WHERE artifact_id=ba.id AND version_number>bv.version_number AND id<>json_extract(arg.value,'$.newId'))
   AND NOT EXISTS(SELECT 1 FROM artifact_dependencies WHERE source_artifact_version_id=bv.id)
   AND (SELECT count(*) FROM artifact_dependencies WHERE dependent_artifact_version_id=bv.id)=2)
 AND (EXISTS(SELECT 1 FROM artifact_dependencies WHERE workspace_id=c.workspace_id AND source_artifact_version_id=iv.id AND dependent_artifact_version_id=bv.id AND dependency_type='GENERATED_FROM' AND validity_status='CURRENT' AND invalidated_at IS NULL AND invalidated_by_version_id IS NULL)
   AND EXISTS(SELECT 1 FROM artifact_dependencies WHERE workspace_id=c.workspace_id AND source_artifact_version_id=rv.id AND dependent_artifact_version_id=bv.id AND dependency_type='USES_RESEARCH' AND validity_status='CURRENT' AND invalidated_at IS NULL AND invalidated_by_version_id IS NULL)
   AND EXISTS(SELECT 1 FROM users u JOIN user_roles ur ON ur.user_id=u.id AND ur.workspace_id=u.workspace_id JOIN roles ro ON ro.id=ur.role_id
  WHERE u.id=json_extract(arg.value,'$.actorId') AND u.workspace_id=c.workspace_id AND u.status='active' AND u.deleted_at IS NULL AND ro.key=json_extract(arg.value,'$.actorRole')))`;

export class ContentBriefHumanRevisionService {
  constructor(
    private db: D1Database,
    private actor: EditorialActor,
    private context: Context,
  ) {}
  private async rows(sql: string, ...bindings: unknown[]) {
    return (
      await this.db
        .prepare(sql)
        .bind(...bindings)
        .all<Row>()
    ).results;
  }
  private async membership() {
    const rows = await this.rows(
      `SELECT r.key FROM users u JOIN user_roles ur ON ur.user_id=u.id AND ur.workspace_id=u.workspace_id JOIN roles r ON r.id=ur.role_id WHERE u.id=? AND u.workspace_id=? AND u.status='active' AND u.deleted_at IS NULL`,
      this.actor.id,
      this.actor.workspaceId,
    );
    const role = (['owner', 'admin', 'operator'] as const).find(
      (role) => rows.some((row) => row.key === role) && this.actor.roles.includes(role),
    );
    if (!role || !hasPermission(this.actor.roles, 'editorial:write'))
      return fail(403, 'not_allowed');
    return role;
  }
  private async origin(parentId: string) {
    const arg = JSON.stringify({ parentId });
    const rows = await this.rows(originSql, arg, arg);
    if (rows.length !== 1) return fail(409, 'origin_evidence_invalid');
    const c = rows[0]!;
    try {
      const capacity = contentBriefRevisionCapacityResultSchema.parse(
        JSON.parse(String(c.result_json)),
      );
      const consumed = JSON.parse(String(c.consumption_json)) as Record<string, unknown>;
      if (
        capacity.capacityId !== c.id ||
        capacity.briefArtifactId !== c.brief_artifact_id ||
        capacity.researchVersionId !== c.research_version_id ||
        capacity.researchApprovalId !== c.research_approval_id ||
        capacity.ideaCandidateId !== c.idea_candidate_id ||
        capacity.ideaVersionId !== c.idea_version_id ||
        capacity.ideaApprovalId !== c.idea_approval_id ||
        capacity.projectId !== c.project_id ||
        capacity.revisionRequestId !== c.revision_request_id ||
        capacity.expectedCurrentBriefVersionId !== c.expected_current_brief_version_id ||
        Object.entries(capacity).some(([key, value]) => consumed[key] !== value) ||
        consumed.executionActorId !== c.consumption_actor_id ||
        consumed.executionRequestId !== c.consumption_request_id
      )
        return fail(409, 'origin_evidence_invalid');
    } catch {
      return fail(409, 'origin_evidence_invalid');
    }
    return c;
  }
  private async replay(
    auditId: string,
    keyHash: string,
    commandHash: string,
    parentId: string,
    command: ContentBriefHumanRevisionCommand,
  ) {
    const row = await this.db
      .prepare('SELECT * FROM audit_events WHERE id=?')
      .bind(auditId)
      .first<Row>();
    if (!row) return null;
    let receipt: Receipt;
    try {
      receipt = receiptSchema.parse(JSON.parse(String(row.metadata_json)));
    } catch {
      return fail(500, 'receipt_invalid');
    }
    if (
      receipt.commandHash !== commandHash ||
      receipt.actorId !== this.actor.id ||
      receipt.workspaceId !== this.actor.workspaceId ||
      receipt.environment !== this.context.environment
    )
      return fail(409, 'idempotency_conflict');
    const result = receipt.result;
    const parent = await this.db
      .prepare('SELECT * FROM editorial_artifact_versions WHERE id=? AND workspace_id=?')
      .bind(parentId, this.actor.workspaceId)
      .first<Row>();
    const v = await this.db
      .prepare('SELECT * FROM editorial_artifact_versions WHERE id=? AND workspace_id=?')
      .bind(result.versionId, this.actor.workspaceId)
      .first<Row>();
    const c = await this.origin(parentId);
    if (!parent || !v) return fail(500, 'receipt_invalid');
    const json = merge(parent, command, String(c.research_version_id));
    const hash = await hashText(json);
    const deps = await this.rows(
      'SELECT id,workspace_id,source_artifact_version_id,dependency_type FROM artifact_dependencies WHERE dependent_artifact_version_id=? ORDER BY dependency_type',
      v.id,
    );
    if (
      row.workspace_id !== this.actor.workspaceId ||
      row.actor_type !== 'user' ||
      row.actor_id !== receipt.actorId ||
      row.actor_role !== receipt.actorRole ||
      row.environment !== receipt.environment ||
      row.action !== action ||
      row.outcome !== 'success' ||
      row.resource_type !== 'editorial_artifact_version' ||
      row.resource_id !== v.id ||
      row.before_hash !== parent.content_hash ||
      row.after_hash !== hash ||
      !row.request_id ||
      !row.occurred_at ||
      !row.ingested_at ||
      receipt.idempotencyKeyHash !== keyHash ||
      receipt.parentVersionId !== parentId ||
      receipt.parentContentHash !== parent.content_hash ||
      receipt.expectedArtifactRevision !== command.expectedArtifactRevision ||
      receipt.capacityId !== c.id ||
      receipt.projectId !== c.project_id ||
      receipt.revisionRequestId !== c.revision_request_id ||
      receipt.researchVersionId !== c.research_version_id ||
      receipt.researchApprovalId !== c.research_approval_id ||
      receipt.ideaCandidateId !== c.idea_candidate_id ||
      receipt.ideaVersionId !== c.idea_version_id ||
      receipt.ideaApprovalId !== c.idea_approval_id ||
      receipt.newVersionId !== v.id ||
      receipt.newContentHash !== hash ||
      result.auditEventId !== auditId ||
      result.parentVersionId !== parentId ||
      result.artifactId !== parent.artifact_id ||
      result.projectId !== c.project_id ||
      result.versionNumber !== Number(parent.version_number) + 1 ||
      result.createdArtifactRevision !== command.expectedArtifactRevision + 1 ||
      result.contentHash !== hash ||
      v.artifact_id !== parent.artifact_id ||
      v.parent_version_id !== parentId ||
      v.version_number !== result.versionNumber ||
      v.source_type !== 'HUMAN_EDITED' ||
      v.intelligence_run_id !== null ||
      v.language_code !== 'de' ||
      v.content_hash !== hash ||
      v.content_json !== json ||
      v.content_text !== null ||
      v.source_script_version_id !== null ||
      v.created_by !== receipt.actorId ||
      JSON.stringify(deps) !==
        JSON.stringify([
          {
            id: receipt.generatedFromDependencyId,
            workspace_id: this.actor.workspaceId,
            source_artifact_version_id: c.idea_version_id,
            dependency_type: 'GENERATED_FROM',
          },
          {
            id: receipt.usesResearchDependencyId,
            workspace_id: this.actor.workspaceId,
            source_artifact_version_id: c.research_version_id,
            dependency_type: 'USES_RESEARCH',
          },
        ])
    )
      return fail(500, 'receipt_invalid');
    return { ...result, idempotentReplay: true };
  }
  async create(parentId: string, key: string, input: ContentBriefHumanRevisionCommand) {
    const parsed = contentBriefHumanRevisionSchema.safeParse(input);
    key = key.trim();
    if (!parsed.success || !id.safeParse(parentId).success || !key || key.length > 200)
      return fail(422, 'command_invalid');
    const command = parsed.data;
    const role = await this.membership();
    const keyHash = await digest([
      operation,
      this.context.environment,
      this.actor.workspaceId,
      key,
    ]);
    const auditId = `audit_cbhr_${keyHash}`;
    const commandHash = await digest([
      operation,
      this.context.environment,
      this.actor.workspaceId,
      this.actor.id,
      parentId,
      command.expectedArtifactRevision,
      correctedKeys.map((key) => command.changes[key]),
    ]);
    const replay = await this.replay(auditId, keyHash, commandHash, parentId, command);
    if (replay) return replay;
    const parent = await this.db
      .prepare(
        `SELECT v.* FROM editorial_artifact_versions v JOIN editorial_artifacts a ON a.id=v.artifact_id AND a.workspace_id=v.workspace_id WHERE v.id=? AND v.workspace_id=? AND a.deleted_at IS NULL`,
      )
      .bind(parentId, this.actor.workspaceId)
      .first<Row>();
    if (!parent) return fail(404, 'parent_not_found');
    const artifact = await this.db
      .prepare('SELECT artifact_type FROM editorial_artifacts WHERE id=?')
      .bind(parent.artifact_id)
      .first<Row>();
    if (artifact?.artifact_type !== 'CONTENT_BRIEF') return fail(422, 'artifact_type_unsupported');
    const c = await this.origin(parentId);
    if (c.workspace_id !== this.actor.workspaceId || c.environment !== this.context.environment)
      return fail(404, 'parent_not_found');
    if ((await hashText(String(parent.content_json))) !== parent.content_hash)
      return fail(409, 'parent_hash_mismatch');
    const json = merge(parent, command, String(c.research_version_id));
    const hash = await hashText(json),
      versionId = newId('artifact_version'),
      at = new Date().toISOString();
    const result = resultSchema.parse({
      artifactId: parent.artifact_id,
      projectId: c.project_id,
      parentVersionId: parentId,
      versionId,
      versionNumber: Number(parent.version_number) + 1,
      contentHash: hash,
      auditEventId: auditId,
      createdArtifactRevision: command.expectedArtifactRevision + 1,
      createdArtifactStatus: 'active',
      createdApprovalCount: 0,
      sourceType: 'HUMAN_EDITED',
      intelligenceRunId: null,
      languageCode: 'de',
    });
    const receipt = receiptSchema.parse({
      receiptVersion: 1,
      operation,
      environment: this.context.environment,
      workspaceId: this.actor.workspaceId,
      actorId: this.actor.id,
      actorRole: role,
      idempotencyKeyHash: keyHash,
      commandHash,
      projectId: c.project_id,
      revisionRequestId: c.revision_request_id,
      capacityId: c.id,
      researchVersionId: c.research_version_id,
      researchApprovalId: c.research_approval_id,
      ideaCandidateId: c.idea_candidate_id,
      ideaVersionId: c.idea_version_id,
      ideaApprovalId: c.idea_approval_id,
      parentVersionId: parentId,
      parentContentHash: parent.content_hash,
      expectedArtifactRevision: command.expectedArtifactRevision,
      newVersionId: versionId,
      newContentHash: hash,
      generatedFromDependencyId: newId('dependency'),
      usesResearchDependencyId: newId('dependency'),
      humanReviewDecision: 'REVISE',
      result,
    });
    const args = {
      parentId,
      capacityId: c.id,
      workspaceId: this.actor.workspaceId,
      environment: this.context.environment,
      actorId: this.actor.id,
      actorRole: role,
      pointerId: parentId,
      artifactRevision: command.expectedArtifactRevision,
      expectedArtifactRevision: command.expectedArtifactRevision,
      parentHash: parent.content_hash,
      parentJson: parent.content_json,
      runId: c.run_id,
      newId: versionId,
    };
    const initial = JSON.stringify([args]);
    if (!(await this.db.prepare(eligibleSql).bind(initial).first())) {
      const concurrentReplay = await this.replay(auditId, keyHash, commandHash, parentId, command);
      if (concurrentReplay) return concurrentReplay;
      return fail(409, 'graph_conflict');
    }
    // Freeze every originating evidence value observed before dispatch. No adoption of a later snapshot.
    const columns = Object.keys(c);
    if (columns.some((column) => !/^[a-z_]+$/u.test(column)))
      return fail(500, 'origin_evidence_invalid');
    const originGuard = `EXISTS(SELECT 1 FROM (${originSql}) frozen WHERE json_array(${columns.map((column) => `frozen.${column}`).join(',')})=?)`;
    const originArgs = [
      JSON.stringify({ parentId }),
      JSON.stringify({ parentId }),
      JSON.stringify(columns.map((column) => c[column])),
    ];
    const guard = `EXISTS(${eligibleSql}) AND ${originGuard}`;
    const auditJson = JSON.stringify(receipt);
    const dependency = (dependencyId: string, sourceId: string, type: string) =>
      this.db
        .prepare(
          `INSERT INTO artifact_dependencies(id,workspace_id,source_artifact_version_id,dependent_artifact_version_id,dependency_type,validity_status,created_at,updated_at,version) VALUES(?,?,?,?,?,'CURRENT',?,?,1)`,
        )
        .bind(dependencyId, this.actor.workspaceId, sourceId, versionId, type, at, at);
    const auditColumns =
      'id,workspace_id,actor_type,actor_id,actor_role,access_issuer,access_subject,action,resource_type,resource_id,outcome,request_id,environment,metadata_json,before_hash,after_hash,occurred_at,ingested_at';
    const auditValues = [
      auditId,
      this.actor.workspaceId,
      'user',
      this.actor.id,
      role,
      this.context.accessIssuer ?? null,
      this.context.accessSubject ?? null,
      action,
      'editorial_artifact_version',
      versionId,
      'success',
      this.context.requestId,
      this.context.environment,
      auditJson,
      parent.content_hash,
      hash,
      at,
      at,
    ];
    const finalArgs = JSON.stringify([
      { ...args, pointerId: versionId, artifactRevision: result.createdArtifactRevision },
    ]);
    const finalGuard = `${guard}
      AND EXISTS(SELECT 1 FROM editorial_artifact_versions WHERE id=? AND workspace_id=? AND artifact_id=? AND parent_version_id=? AND version_number=? AND source_type='HUMAN_EDITED' AND intelligence_run_id IS NULL AND language_code='de' AND content_text IS NULL AND source_script_version_id IS NULL AND content_json=? AND content_hash=? AND created_by=? AND created_at=?)
      AND NOT EXISTS(SELECT 1 FROM artifact_approvals WHERE artifact_version_id=?)
      AND (SELECT count(*) FROM artifact_dependencies WHERE dependent_artifact_version_id=?)=2
      AND EXISTS(SELECT 1 FROM artifact_dependencies WHERE id=? AND workspace_id=? AND source_artifact_version_id=? AND dependent_artifact_version_id=? AND dependency_type='GENERATED_FROM' AND validity_status='CURRENT' AND invalidated_at IS NULL AND invalidated_by_version_id IS NULL AND version=1)
      AND EXISTS(SELECT 1 FROM artifact_dependencies WHERE id=? AND workspace_id=? AND source_artifact_version_id=? AND dependent_artifact_version_id=? AND dependency_type='USES_RESEARCH' AND validity_status='CURRENT' AND invalidated_at IS NULL AND invalidated_by_version_id IS NULL AND version=1)
      AND EXISTS(SELECT 1 FROM audit_events WHERE ${auditColumns
        .split(',')
        .map((column) => `${column} IS ?`)
        .join(' AND ')})`;
    const statements = [
      this.db
        .prepare(
          `INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,parent_version_id,language_code,content_json,source_type,intelligence_run_id,content_hash,created_at,created_by) SELECT ?,?,?,?,?,'de',?,'HUMAN_EDITED',NULL,?,?,? WHERE ${guard}`,
        )
        .bind(
          versionId,
          this.actor.workspaceId,
          parent.artifact_id,
          result.versionNumber,
          parentId,
          json,
          hash,
          at,
          this.actor.id,
          initial,
          ...originArgs,
        ),
      dependency(receipt.generatedFromDependencyId, String(c.idea_version_id), 'GENERATED_FROM'),
      dependency(receipt.usesResearchDependencyId, String(c.research_version_id), 'USES_RESEARCH'),
      this.db
        .prepare(
          `UPDATE editorial_artifacts SET current_version_id=?,version=version+1,updated_at=?,updated_by=? WHERE id=? AND workspace_id=? AND current_version_id=? AND version=? AND status='active' AND ${guard}`,
        )
        .bind(
          versionId,
          at,
          this.actor.id,
          parent.artifact_id,
          this.actor.workspaceId,
          parentId,
          command.expectedArtifactRevision,
          initial,
          ...originArgs,
        ),
      this.db
        .prepare(
          `INSERT INTO audit_events(${auditColumns}) VALUES(${auditValues.map(() => '?').join(',')})`,
        )
        .bind(...auditValues),
      // On success this inserts zero rows. Any missed write/CAS/receipt forces NOT NULL failure and rolls back the whole batch.
      this.db
        .prepare(
          `INSERT INTO audit_events(id,workspace_id,actor_type,action,resource_type,outcome,request_id,environment,occurred_at,ingested_at) SELECT NULL,?,'user',?,'editorial_artifact_version','failure',?,?,?,? WHERE NOT (${finalGuard})`,
        )
        .bind(
          this.actor.workspaceId,
          action,
          this.context.requestId,
          this.context.environment,
          at,
          at,
          finalArgs,
          ...originArgs,
          versionId,
          this.actor.workspaceId,
          parent.artifact_id,
          parentId,
          result.versionNumber,
          json,
          hash,
          this.actor.id,
          at,
          versionId,
          versionId,
          receipt.generatedFromDependencyId,
          this.actor.workspaceId,
          c.idea_version_id,
          versionId,
          receipt.usesResearchDependencyId,
          this.actor.workspaceId,
          c.research_version_id,
          versionId,
          ...auditValues,
        ),
    ];
    try {
      await this.db.batch(statements);
    } catch {
      const recovered = await this.replay(auditId, keyHash, commandHash, parentId, command);
      if (recovered) return recovered;
      // Read-only classification after a conflict or uncertain commit; never repeat the batch.
      if (!(await this.db.prepare(eligibleSql).bind(initial).first()))
        return fail(409, 'graph_conflict');
      return fail(500, 'persistence_unconfirmed');
    }
    return { ...result, idempotentReplay: false };
  }
}
