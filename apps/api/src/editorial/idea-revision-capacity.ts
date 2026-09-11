import {
  ideaRevisionCapacitySchema,
  ideaRevisionCapacityResultSchema,
  type IdeaRevisionCapacityCommand,
  ideaRevisionRecoverySchema,
  ideaRevisionRecoveryResultSchema,
  type IdeaRevisionRecoveryCommand,
} from '@vision-maxson/contracts';
import { hasPermission, newId } from '@vision-maxson/domain';
import { ideaRevisionPolicy as policy } from '@vision-maxson/providers/execution-profile';
import type { EditorialActor } from './repository';

type Row = Record<string, unknown>;
type Context = { requestId: string; environment: string };
export class IdeaCapacityError extends Error {
  constructor(
    readonly status: 403 | 404 | 409 | 422 | 500,
    message: string,
  ) {
    super(message);
  }
}
export { ideaRevisionSchemaReady } from '../../../../packages/db/src/phase3-schema';
import {
  ideaRevisionSchemaReady,
  verifiedIdeaRevisionSchema,
} from '../../../../packages/db/src/phase3-schema';
async function digest(value: unknown) {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return [...new Uint8Array(bytes)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
const correlations = {
  capacityId: 'id',
  projectId: 'project_id',
  revisionRequestId: 'revision_request_id',
  researchArtifactId: 'research_artifact_id',
  researchVersionId: 'research_version_id',
  researchApprovalId: 'research_approval_id',
  budgetId: 'budget_id',
  envelopeId: 'envelope_id',
  auditEventId: 'audit_event_id',
  profileKey: 'profile_key',
  profileVersion: 'profile_version',
  stageKey: 'stage_key',
  monetaryCeilingMicrousd: 'monetary_ceiling_microusd',
  maximumCalls: 'maximum_calls',
} as const;
function receiptResult(row: Row) {
  try {
    const result = ideaRevisionCapacityResultSchema.parse(JSON.parse(String(row.result_json)));
    if (
      Object.entries(correlations).some(
        ([key, column]) => result[key as keyof typeof result] !== row[column],
      )
    )
      throw new Error();
    return result;
  } catch {
    throw new IdeaCapacityError(500, 'idea_revision_receipt_invalid');
  }
}

const recoveryCorrelations = {
  recoveryId: 'id',
  capacityId: 'idea_revision_capacity_id',
  projectId: 'project_id',
  revisionRequestId: 'revision_request_id',
  researchArtifactId: 'research_artifact_id',
  researchVersionId: 'research_version_id',
  researchApprovalId: 'research_approval_id',
  budgetId: 'budget_id',
  originalEnvelopeId: 'original_envelope_id',
  failedReservationId: 'failed_reservation_id',
  failedRunId: 'failed_run_id',
  replacementEnvelopeId: 'replacement_envelope_id',
  originalProjectVersion: 'original_project_version',
  recoveryProjectVersion: 'recovery_project_version',
  auditEventId: 'audit_event_id',
  profileKey: 'profile_key',
  profileVersion: 'profile_version',
  stageKey: 'stage_key',
  monetaryCeilingMicrousd: 'monetary_ceiling_microusd',
  maximumCalls: 'maximum_calls',
} as const;
function recoveryResult(row: Row) {
  try {
    const result = ideaRevisionRecoveryResultSchema.parse(JSON.parse(String(row.result_json)));
    if (
      Object.entries(recoveryCorrelations).some(
        ([k, c]) => result[k as keyof typeof result] !== row[c],
      )
    )
      throw new Error();
    return result;
  } catch {
    throw new IdeaCapacityError(500, 'idea_revision_recovery_receipt_invalid');
  }
}
// One bound JSON parameter avoids D1's parameter limit as the structural proof grows.
const schemaMatches = `NOT EXISTS(
 SELECT 1 FROM json_each(?) expected
 WHERE NOT EXISTS(SELECT 1 FROM sqlite_master actual
 WHERE actual.type=json_extract(expected.value,'$.type')
 AND actual.name=json_extract(expected.value,'$.name')
 AND actual.sql=json_extract(expected.value,'$.sql')))`;

export class IdeaRevisionCapacityService {
  constructor(
    private db: D1Database,
    private actor: EditorialActor,
    private context: Context,
  ) {}
  private async replay(key: string, commandHash: string) {
    const row = await this.db
      .prepare(
        'SELECT * FROM editorial_idea_revision_capacities WHERE workspace_id=? AND idempotency_key=?',
      )
      .bind(this.actor.workspaceId, key)
      .first<Row>();
    if (!row) return null;
    if (row.command_hash !== commandHash)
      throw new IdeaCapacityError(409, 'idea_revision_idempotency_conflict');
    return { ...receiptResult(row), idempotentReplay: true };
  }

  private async recoveryReplay(capacityId: string, key: string, commandHash: string) {
    const row = await this.db
      .prepare(
        'SELECT * FROM editorial_idea_revision_capacity_recoveries WHERE workspace_id=? AND idempotency_key=?',
      )
      .bind(this.actor.workspaceId, key)
      .first<Row>();
    if (!row) return null;
    if (row.environment !== this.context.environment)
      throw new IdeaCapacityError(404, 'idea_revision_capacity_not_found');
    if (row.command_hash !== commandHash || row.idea_revision_capacity_id !== capacityId)
      throw new IdeaCapacityError(409, 'idea_revision_recovery_idempotency_conflict');
    return { ...recoveryResult(row), idempotentReplay: true };
  }
  async recover(capacityId: string, key: string, input: IdeaRevisionRecoveryCommand) {
    const role = this.actor.roles.find((r) => r === 'owner' || r === 'admin');
    if (!hasPermission(this.actor.roles, 'providers:admin') || !role)
      throw new IdeaCapacityError(403, 'idea_revision_not_allowed');
    const parsed = ideaRevisionRecoverySchema.safeParse(input);
    key = key.trim();
    if (
      !parsed.success ||
      !key ||
      key.length > 200 ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{2,99}$/u.test(capacityId)
    )
      throw new IdeaCapacityError(422, 'idea_revision_recovery_command_invalid');
    const proof = await verifiedIdeaRevisionSchema(this.db);
    if (!proof) throw new IdeaCapacityError(422, 'idea_revision_schema_unavailable');
    const member = await this.db
      .prepare(
        `SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id=u.id AND ur.workspace_id=u.workspace_id JOIN roles r ON r.id=ur.role_id WHERE u.id=? AND u.workspace_id=? AND u.status='active' AND u.deleted_at IS NULL AND r.key=?`,
      )
      .bind(this.actor.id, this.actor.workspaceId, role)
      .first();
    if (!member) throw new IdeaCapacityError(403, 'idea_revision_not_allowed');
    const command = parsed.data;
    const commandHash = await digest({ capacityId, command });
    const replay = await this.recoveryReplay(capacityId, key, commandHash);
    if (replay) return replay;
    const c = await this.db
      .prepare(
        'SELECT * FROM editorial_idea_revision_capacities WHERE id=? AND workspace_id=? AND environment=?',
      )
      .bind(capacityId, this.actor.workspaceId, this.context.environment)
      .first<Row>();
    if (!c) throw new IdeaCapacityError(404, 'idea_revision_capacity_not_found');
    receiptResult(c);
    if (
      await this.db
        .prepare(
          'SELECT id FROM editorial_idea_revision_capacity_recoveries WHERE idea_revision_capacity_id=?',
        )
        .bind(capacityId)
        .first()
    )
      throw new IdeaCapacityError(409, 'idea_revision_recovery_exhausted');
    const project = await this.db
      .prepare('SELECT version FROM projects WHERE id=? AND workspace_id=?')
      .bind(c.project_id, this.actor.workspaceId)
      .first<Row>();
    if (project?.version !== command.expectedProjectVersion)
      throw new IdeaCapacityError(409, 'idea_revision_recovery_project_version_stale');
    const failure = await this.db
      .prepare(
        'SELECT * FROM idea_revision_zero_provider_failures WHERE capacity_id=? AND failed_run_id=? AND failed_reservation_id=?',
      )
      .bind(capacityId, command.expectedFailedRunId, command.expectedFailedReservationId)
      .first();
    if (!failure) throw new IdeaCapacityError(409, 'idea_revision_capacity_not_recoverable');
    const eligible = await this.db
      .prepare(
        'SELECT * FROM idea_revision_recovery_eligible WHERE capacity_id=? AND failed_run_id=? AND failed_reservation_id=? AND project_version=?',
      )
      .bind(
        capacityId,
        command.expectedFailedRunId,
        command.expectedFailedReservationId,
        command.expectedProjectVersion,
      )
      .first();
    if (!eligible) throw new IdeaCapacityError(409, 'idea_revision_capacity_not_recoverable');
    const at = new Date().toISOString();
    const result = ideaRevisionRecoveryResultSchema.parse({
      recoveryId: newId('idea_revision_recovery'),
      capacityId,
      projectId: c.project_id,
      revisionRequestId: c.revision_request_id,
      researchArtifactId: c.research_artifact_id,
      researchVersionId: c.research_version_id,
      researchApprovalId: c.research_approval_id,
      budgetId: c.budget_id,
      originalEnvelopeId: c.envelope_id,
      failedReservationId: command.expectedFailedReservationId,
      failedRunId: command.expectedFailedRunId,
      replacementEnvelopeId: newId('execution_envelope'),
      originalProjectVersion: c.expected_project_version,
      recoveryProjectVersion: command.expectedProjectVersion,
      auditEventId: newId('audit'),
      profileKey: c.profile_key,
      profileVersion: c.profile_version,
      stageKey: c.stage_key,
      monetaryCeilingMicrousd: c.monetary_ceiling_microusd,
      maximumCalls: c.maximum_calls,
    });
    const metadata = {
      ...result,
      workspaceId: this.actor.workspaceId,
      actorId: this.actor.id,
      actorRole: role,
      environment: this.context.environment,
      providerId: c.provider_id,
      modelId: c.provider_model_id,
      promptVersionId: c.prompt_version_id,
      pricingSnapshotId: c.pricing_snapshot_id,
    };
    const receipt: Row = Object.fromEntries(
      Object.entries(recoveryCorrelations).map(([k, column]) => [
        column,
        result[k as keyof typeof result],
      ]),
    );
    Object.assign(receipt, {
      workspace_id: this.actor.workspaceId,
      provider_id: c.provider_id,
      provider_model_id: c.provider_model_id,
      prompt_version_id: c.prompt_version_id,
      pricing_snapshot_id: c.pricing_snapshot_id,
      actor_id: this.actor.id,
      actor_role: role,
      environment: this.context.environment,
      idempotency_key: key,
      command_hash: commandHash,
      result_json: JSON.stringify(result),
      created_at: at,
    });
    try {
      await this.db.batch([
        this.db
          .prepare(
            `INSERT INTO editorial_execution_envelopes(id,workspace_id,project_id,profile_key,profile_version,provider_id,provider_model_id,currency,monetary_ceiling_microusd,maximum_calls,status,authorized_by,created_at,updated_at,version,project_execution_budget_id,stage_key) VALUES(?,?,?,?,1,?,?,'USD',177920,1,'ACTIVE',?,?,?,1,?,'IDEA_GENERATION')`,
          )
          .bind(
            result.replacementEnvelopeId,
            this.actor.workspaceId,
            c.project_id,
            c.profile_key,
            c.provider_id,
            c.provider_model_id,
            this.actor.id,
            at,
            at,
            c.budget_id,
          ),
        this.db
          .prepare(
            `INSERT INTO audit_events(id,workspace_id,actor_type,actor_id,actor_role,action,resource_type,resource_id,outcome,request_id,environment,metadata_json,occurred_at,ingested_at) VALUES(?,?,'user',?,?,'editorial.idea_revision_capacity_recovered','editorial_idea_revision_capacity_recovery',?,'success',?,?,?,?,?)`,
          )
          .bind(
            result.auditEventId,
            this.actor.workspaceId,
            this.actor.id,
            role,
            result.recoveryId,
            this.context.requestId,
            this.context.environment,
            JSON.stringify(metadata),
            at,
            at,
          ),
        // NULL violates the PK if the schema changed after its precheck, rolling back all three writes.
        this.db
          .prepare(
            `INSERT INTO editorial_idea_revision_capacity_recoveries(${Object.keys(receipt).join(',')}) VALUES(CASE WHEN ${schemaMatches} THEN ? ELSE NULL END,${Object.keys(
              receipt,
            )
              .slice(1)
              .map(() => '?')
              .join(',')})`,
          )
          .bind(JSON.stringify(proof), ...Object.values(receipt)),
      ]);
    } catch {
      const winner = await this.recoveryReplay(capacityId, key, commandHash);
      if (winner) return winner;
      if (
        await this.db
          .prepare(
            'SELECT id FROM editorial_idea_revision_capacity_recoveries WHERE idea_revision_capacity_id=?',
          )
          .bind(capacityId)
          .first()
      )
        throw new IdeaCapacityError(409, 'idea_revision_recovery_exhausted');
      throw new IdeaCapacityError(409, 'idea_revision_recovery_conflict');
    }
    return { ...result, idempotentReplay: false };
  }

  async authorize(requestId: string, key: string, input: IdeaRevisionCapacityCommand) {
    if (!hasPermission(this.actor.roles, 'providers:admin'))
      throw new IdeaCapacityError(403, 'idea_revision_not_allowed');
    const role = this.actor.roles.find((r) => r === 'owner' || r === 'admin');
    if (!role) throw new IdeaCapacityError(403, 'idea_revision_not_allowed');
    const parsed = ideaRevisionCapacitySchema.safeParse(input);
    key = key.trim();
    if (
      !parsed.success ||
      !key ||
      key.length > 200 ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{2,99}$/u.test(requestId)
    )
      throw new IdeaCapacityError(422, 'idea_revision_command_invalid');
    const proof = await verifiedIdeaRevisionSchema(this.db);
    if (!proof) throw new IdeaCapacityError(422, 'idea_revision_schema_unavailable');
    const member = await this.db
      .prepare(
        `SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id=u.id AND ur.workspace_id=u.workspace_id JOIN roles r ON r.id=ur.role_id WHERE u.id=? AND u.workspace_id=? AND u.status='active' AND u.deleted_at IS NULL AND r.key=?`,
      )
      .bind(this.actor.id, this.actor.workspaceId, role)
      .first();
    if (!member) throw new IdeaCapacityError(403, 'idea_revision_not_allowed');
    const command = parsed.data;
    const commandHash = await digest({ requestId, command });
    const replay = await this.replay(key, commandHash);
    if (replay) return replay;
    const request = await this.db
      .prepare('SELECT id FROM editorial_revision_requests WHERE id=? AND workspace_id=?')
      .bind(requestId, this.actor.workspaceId)
      .first();
    if (!request) throw new IdeaCapacityError(404, 'idea_revision_request_not_found');
    const eligible = await this.db
      .prepare(
        `SELECT * FROM idea_revision_eligible_research WHERE revision_request_id=? AND workspace_id=? AND research_version_id=? AND research_approval_id=? AND research_artifact_revision=? AND project_version=?`,
      )
      .bind(
        requestId,
        this.actor.workspaceId,
        command.expectedResearchVersionId,
        command.expectedResearchApprovalId,
        command.expectedResearchArtifactRevision,
        command.expectedProjectVersion,
      )
      .first<Row>();
    if (!eligible) throw new IdeaCapacityError(409, 'idea_revision_ineligible');
    const config = await this.db
      .prepare('SELECT * FROM idea_revision_eligible_policy')
      .first<Row>();
    if (!config) throw new IdeaCapacityError(422, 'idea_revision_policy_unavailable');
    const result = ideaRevisionCapacityResultSchema.parse({
      capacityId: newId('idea_revision_capacity'),
      projectId: eligible.project_id,
      revisionRequestId: requestId,
      researchArtifactId: eligible.research_artifact_id,
      researchVersionId: command.expectedResearchVersionId,
      researchApprovalId: command.expectedResearchApprovalId,
      budgetId: newId('project_execution_budget'),
      envelopeId: newId('execution_envelope'),
      auditEventId: newId('audit'),
      profileKey: policy.profileKey,
      profileVersion: 1,
      stageKey: policy.stageKey,
      monetaryCeilingMicrousd: policy.monetaryCeilingMicrousd,
      maximumCalls: 1,
    });
    const at = new Date().toISOString();
    const metadata = {
      ...result,
      workspaceId: this.actor.workspaceId,
      actorId: this.actor.id,
      actorRole: role,
      environment: this.context.environment,
      providerId: config.provider_id,
      modelId: config.provider_model_id,
      promptVersionId: config.prompt_version_id,
      pricingSnapshotId: config.pricing_snapshot_id,
    };
    const receipt = {
      id: result.capacityId,
      workspace_id: this.actor.workspaceId,
      project_id: result.projectId,
      revision_request_id: requestId,
      research_artifact_id: result.researchArtifactId,
      research_version_id: result.researchVersionId,
      research_approval_id: result.researchApprovalId,
      expected_research_artifact_revision: command.expectedResearchArtifactRevision,
      expected_project_version: command.expectedProjectVersion,
      budget_id: result.budgetId,
      envelope_id: result.envelopeId,
      stage_key: policy.stageKey,
      profile_key: policy.profileKey,
      profile_version: 1,
      provider_id: config.provider_id,
      provider_model_id: config.provider_model_id,
      prompt_version_id: config.prompt_version_id,
      pricing_snapshot_id: config.pricing_snapshot_id,
      monetary_ceiling_microusd: policy.monetaryCeilingMicrousd,
      maximum_calls: 1,
      actor_id: this.actor.id,
      actor_role: role,
      environment: this.context.environment,
      audit_event_id: result.auditEventId,
      idempotency_key: key,
      command_hash: commandHash,
      result_json: JSON.stringify(result),
      created_at: at,
    };
    try {
      await this.db.batch([
        this.db
          .prepare(
            `INSERT INTO editorial_project_execution_budgets(id,workspace_id,project_id,profile_key,profile_version,currency,monetary_ceiling_microusd,status,authorized_by,created_at,updated_at,version) VALUES(?,?,?,?,1,'USD',177920,'ACTIVE',?,?,?,1)`,
          )
          .bind(
            result.budgetId,
            this.actor.workspaceId,
            result.projectId,
            policy.profileKey,
            this.actor.id,
            at,
            at,
          ),
        this.db
          .prepare(
            `INSERT INTO editorial_execution_envelopes(id,workspace_id,project_id,profile_key,profile_version,provider_id,provider_model_id,currency,monetary_ceiling_microusd,maximum_calls,status,authorized_by,created_at,updated_at,version,project_execution_budget_id,stage_key) VALUES(?,?,?,?,1,?,?,'USD',177920,1,'ACTIVE',?,?,?,1,?,'IDEA_GENERATION')`,
          )
          .bind(
            result.envelopeId,
            this.actor.workspaceId,
            result.projectId,
            policy.profileKey,
            config.provider_id,
            config.provider_model_id,
            this.actor.id,
            at,
            at,
            result.budgetId,
          ),
        this.db
          .prepare(
            `INSERT INTO audit_events(id,workspace_id,actor_type,actor_id,actor_role,action,resource_type,resource_id,outcome,request_id,environment,metadata_json,occurred_at,ingested_at) VALUES(?,?,'user',?,?,'editorial.idea_revision_capacity_authorized','editorial_idea_revision_capacity',?,'success',?,?,?,?,?)`,
          )
          .bind(
            result.auditEventId,
            this.actor.workspaceId,
            this.actor.id,
            role,
            result.capacityId,
            this.context.requestId,
            this.context.environment,
            JSON.stringify(metadata),
            at,
            at,
          ),
        this.db
          .prepare(
            `INSERT INTO editorial_idea_revision_capacities(${Object.keys(receipt).join(',')}) VALUES(CASE WHEN ${schemaMatches} THEN ? ELSE NULL END,${Object.keys(
              receipt,
            )
              .slice(1)
              .map(() => '?')
              .join(',')})`,
          )
          .bind(JSON.stringify(proof), ...Object.values(receipt)),
      ]);
    } catch {
      const winner = await this.replay(key, commandHash);
      if (winner) return winner;
      if (!(await ideaRevisionSchemaReady(this.db)))
        throw new IdeaCapacityError(422, 'idea_revision_schema_unavailable');
      throw new IdeaCapacityError(409, 'idea_revision_authorization_conflict');
    }
    return { ...result, idempotentReplay: false };
  }
}
export async function loadIdeaRevisionCapacity(
  db: D1Database,
  actor: EditorialActor,
  projectId: string,
  capacityId: string,
  researchVersionId: string | null,
) {
  if (!(await ideaRevisionSchemaReady(db)))
    throw new IdeaCapacityError(422, 'idea_revision_schema_unavailable');
  const row = await db
    .prepare(
      `SELECT c.*,e.id envelopeId,binding.recovery_id recoveryId FROM editorial_idea_revision_capacities c
    JOIN idea_revision_execution_bindings binding ON binding.capacity_id=c.id
    JOIN idea_revision_eligible_research x ON x.revision_request_id=c.revision_request_id AND x.workspace_id=c.workspace_id AND x.project_id=c.project_id AND x.research_version_id=c.research_version_id AND x.research_approval_id=c.research_approval_id AND x.research_artifact_revision=c.expected_research_artifact_revision AND x.project_version=binding.project_version
    JOIN idea_revision_eligible_policy pol ON pol.provider_id=c.provider_id AND pol.provider_model_id=c.provider_model_id AND pol.prompt_version_id=c.prompt_version_id AND pol.pricing_snapshot_id=c.pricing_snapshot_id
    JOIN editorial_execution_envelopes e ON e.id=binding.envelope_id AND e.project_execution_budget_id=c.budget_id AND e.profile_key=c.profile_key AND e.status='ACTIVE' AND e.maximum_calls=1 AND e.monetary_ceiling_microusd=c.monetary_ceiling_microusd
    JOIN editorial_project_execution_budgets b ON b.id=c.budget_id AND b.status='ACTIVE' AND b.profile_key=c.profile_key AND b.monetary_ceiling_microusd=c.monetary_ceiling_microusd
    WHERE c.id=? AND c.workspace_id=? AND c.project_id=? AND c.research_version_id=?
    AND (binding.recovery_id IS NULL OR EXISTS(SELECT 1 FROM idea_revision_zero_provider_failures f WHERE f.capacity_id=c.id))
    AND NOT EXISTS(SELECT 1 FROM artifact_approvals invalid WHERE invalid.artifact_version_id=c.research_version_id AND invalid.id<>c.research_approval_id)
    AND NOT EXISTS(SELECT 1 FROM editorial_execution_reservations er WHERE er.envelope_id=e.id)`,
    )
    .bind(capacityId, actor.workspaceId, projectId, researchVersionId)
    .first<Row>();
  if (!row) throw new IdeaCapacityError(409, 'idea_revision_execution_binding_invalid');
  receiptResult(row);
  const recoveryId = row.recoveryId;
  if (recoveryId !== null && typeof recoveryId !== 'string')
    throw new IdeaCapacityError(409, 'idea_revision_execution_binding_invalid');
  if (recoveryId) {
    const recovery = await db
      .prepare('SELECT * FROM editorial_idea_revision_capacity_recoveries WHERE id=?')
      .bind(recoveryId)
      .first<Row>();
    if (!recovery) throw new IdeaCapacityError(409, 'idea_revision_execution_binding_invalid');
    recoveryResult(recovery);
  }
  return {
    ...row,
    id: String(row.envelopeId),
    recoveryId,
    projectExecutionBudgetId: String(row.budget_id),
    prompt_version_id: String(row.prompt_version_id),
    provider_model_id: String(row.provider_model_id),
    pricing_snapshot_id: String(row.pricing_snapshot_id),
  };
}

export type IdeaDispatchOutcome = 'COMMITTED_NO_PROVIDER_CALL' | 'NOT_COMMITTED' | 'AMBIGUOUS';
export class IdeaDispatchError extends IdeaCapacityError {
  constructor(
    readonly dispatchOutcome: IdeaDispatchOutcome,
    readonly rejection: 'ELIGIBILITY_REJECTED' | 'SCHEMA_UNAVAILABLE' | null = null,
  ) {
    super(
      rejection === 'ELIGIBILITY_REJECTED' ? 409 : rejection === 'SCHEMA_UNAVAILABLE' ? 422 : 500,
      rejection === 'ELIGIBILITY_REJECTED'
        ? 'idea_revision_dispatch_ineligible'
        : rejection === 'SCHEMA_UNAVAILABLE'
          ? 'idea_revision_schema_unavailable'
          : dispatchOutcome === 'COMMITTED_NO_PROVIDER_CALL'
            ? 'idea_revision_dispatch_committed_confirmation_lost'
            : dispatchOutcome === 'NOT_COMMITTED'
              ? 'idea_revision_dispatch_not_committed'
              : 'idea_revision_dispatch_ambiguous',
    );
  }
}

// A single correlated read establishes durable state, never resumes dispatch.
// D1 without read-replica sessions uses the primary database for these reads.
async function reconcileIdeaDispatch(
  db: D1Database,
  actor: EditorialActor,
  projectId: string,
  capacityId: string,
  runId: string,
  attemptId: string,
  at: string,
  proof: Awaited<ReturnType<typeof verifiedIdeaRevisionSchema>>,
): Promise<IdeaDispatchError> {
  try {
    const state = await db
      .prepare(
        `
      SELECT r.status reservation_status,r.dispatched_at,ir.status run_status,ir.started_at,
        (SELECT count(*) FROM intelligence_run_attempts a WHERE a.intelligence_run_id=ir.id) attempt_count,
        EXISTS(SELECT 1 FROM intelligence_run_attempts a WHERE a.intelligence_run_id=ir.id
          AND a.id=? AND a.attempt_number=1 AND a.attempt_kind='TECHNICAL'
          AND a.status='RUNNING' AND a.started_at=? AND a.completed_at IS NULL
          AND a.provider_request_id IS NULL) matching_attempt,
        ${schemaMatches} schema_current,
        EXISTS(SELECT 1 FROM idea_revision_eligible_research x
          JOIN idea_revision_eligible_policy pol ON pol.provider_id=c.provider_id
            AND pol.provider_model_id=c.provider_model_id AND pol.prompt_version_id=c.prompt_version_id
            AND pol.pricing_snapshot_id=c.pricing_snapshot_id
          WHERE x.revision_request_id=c.revision_request_id AND x.workspace_id=c.workspace_id
            AND x.project_id=c.project_id AND x.research_version_id=c.research_version_id
            AND x.research_approval_id=c.research_approval_id
            AND x.research_artifact_revision=c.expected_research_artifact_revision
            AND x.project_version=COALESCE(recovery.recovery_project_version,c.expected_project_version)
            AND e.status='CONSUMED' AND b.status='ACTIVE'
            AND (recovery.id IS NULL OR EXISTS(SELECT 1 FROM idea_revision_zero_provider_failures f WHERE f.capacity_id=c.id))
        ) eligible
      FROM editorial_idea_revision_capacities c
      LEFT JOIN editorial_idea_revision_capacity_recoveries recovery ON recovery.idea_revision_capacity_id=c.id
      JOIN editorial_execution_envelopes e ON e.id=COALESCE(recovery.replacement_envelope_id,c.envelope_id)
        AND e.project_execution_budget_id=c.budget_id AND e.workspace_id=c.workspace_id AND e.project_id=c.project_id
      JOIN editorial_project_execution_budgets b ON b.id=c.budget_id AND b.workspace_id=c.workspace_id AND b.project_id=c.project_id
      JOIN editorial_execution_reservations r ON r.envelope_id=e.id AND r.project_execution_budget_id=b.id
        AND r.workspace_id=c.workspace_id AND r.project_id=c.project_id AND r.step_key=c.stage_key
        AND r.pricing_snapshot_id=c.pricing_snapshot_id AND r.reserved_microusd=c.monetary_ceiling_microusd
        AND r.actual_microusd IS NULL AND r.reconciled_at IS NULL
      JOIN intelligence_runs ir ON ir.id=r.intelligence_run_id AND ir.workspace_id=c.workspace_id
        AND ir.project_id=c.project_id AND ir.task_type=c.stage_key AND ir.input_artifact_version_id=c.research_version_id
        AND ir.provider_id=c.provider_id AND ir.provider_model_id=c.provider_model_id
        AND ir.prompt_version_id=c.prompt_version_id AND ir.pricing_snapshot_id=c.pricing_snapshot_id
        AND json_extract(ir.safe_metadata_json,'$.ideaRevisionCapacityId')=c.id
        AND json_extract(ir.safe_metadata_json,'$.ideaRevisionRecoveryId') IS recovery.id
        AND ir.completed_at IS NULL AND ir.output_artifact_version_id IS NULL
      WHERE c.id=? AND c.workspace_id=? AND c.project_id=? AND ir.id=?
        AND (SELECT count(*) FROM editorial_execution_reservations used WHERE used.envelope_id=e.id)=1
    `,
      )
      .bind(
        attemptId,
        at,
        JSON.stringify(proof ?? []),
        capacityId,
        actor.workspaceId,
        projectId,
        runId,
      )
      .first<Row>();
    if (
      state?.reservation_status === 'DISPATCHED' &&
      state.dispatched_at === at &&
      state.run_status === 'RUNNING' &&
      state.started_at === at &&
      state.attempt_count === 1 &&
      state.matching_attempt === 1
    )
      return new IdeaDispatchError('COMMITTED_NO_PROVIDER_CALL');
    if (
      state?.reservation_status === 'RESERVED' &&
      state.dispatched_at === null &&
      state.run_status === 'QUEUED' &&
      state.started_at === null &&
      state.attempt_count === 0
    )
      return new IdeaDispatchError(
        'NOT_COMMITTED',
        !proof || state.schema_current !== 1
          ? 'SCHEMA_UNAVAILABLE'
          : state.eligible === 0
            ? 'ELIGIBILITY_REJECTED'
            : null,
      );
  } catch {
    // Unreadable/incomplete evidence cannot establish non-dispatch or zero cost.
  }
  return new IdeaDispatchError('AMBIGUOUS');
}

// The schema proof is compared again inside the atomic dispatch batch. Business
// eligibility is enforced by the BEFORE UPDATE trigger on the reservation itself.
export async function authorizeIdeaRevisionDispatch(
  db: D1Database,
  actor: EditorialActor,
  projectId: string,
  capacityId: string,
  runId: string,
) {
  let proof: Awaited<ReturnType<typeof verifiedIdeaRevisionSchema>> = null;
  const at = new Date().toISOString();
  const attemptId = newId('attempt');
  try {
    proof = await verifiedIdeaRevisionSchema(db);
    if (!proof) throw new IdeaCapacityError(422, 'idea_revision_schema_unavailable');
    const results = await db.batch([
      db
        .prepare(
          `UPDATE editorial_execution_reservations SET status='DISPATCHED',dispatched_at=?
        WHERE intelligence_run_id=? AND workspace_id=? AND project_id=? AND status='RESERVED'
        AND EXISTS(SELECT 1 FROM editorial_idea_revision_capacities c JOIN idea_revision_execution_bindings binding ON binding.capacity_id=c.id WHERE c.id=? AND binding.envelope_id=editorial_execution_reservations.envelope_id AND c.budget_id=editorial_execution_reservations.project_execution_budget_id)
        AND ${schemaMatches}`,
        )
        .bind(at, runId, actor.workspaceId, projectId, capacityId, JSON.stringify(proof)),
      db
        .prepare(
          `UPDATE intelligence_runs SET status='RUNNING',started_at=COALESCE(started_at,?),updated_at=?,version=version+1
        WHERE id=? AND workspace_id=? AND project_id=? AND status='QUEUED'
        AND EXISTS(SELECT 1 FROM editorial_execution_reservations r WHERE r.intelligence_run_id=intelligence_runs.id AND r.status='DISPATCHED' AND r.dispatched_at=?)`,
        )
        .bind(at, at, runId, actor.workspaceId, projectId, at),
      db
        .prepare(
          `INSERT INTO intelligence_run_attempts(id,intelligence_run_id,attempt_number,attempt_kind,status,safe_metadata_json,started_at)
        SELECT ?,id,1,'TECHNICAL','RUNNING','{}',? FROM intelligence_runs
        WHERE id=? AND workspace_id=? AND project_id=? AND status='RUNNING'
        AND EXISTS(SELECT 1 FROM editorial_execution_reservations r WHERE r.intelligence_run_id=intelligence_runs.id AND r.status='DISPATCHED' AND r.dispatched_at=?)`,
        )
        .bind(attemptId, at, runId, actor.workspaceId, projectId, at),
    ]);
    if (results.length !== 3 || results.some((r) => r.meta.changes !== 1))
      throw new IdeaCapacityError(409, 'idea_revision_dispatch_ineligible');
  } catch {
    // Never retry or call the adapter after a missing batch confirmation.
    throw await reconcileIdeaDispatch(
      db,
      actor,
      projectId,
      capacityId,
      runId,
      attemptId,
      at,
      proof,
    );
  }
}
