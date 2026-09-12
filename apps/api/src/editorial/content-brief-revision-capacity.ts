import {
  contentBriefRevisionCapacitySchema,
  contentBriefRevisionCapacityResultSchema,
  type ContentBriefRevisionCapacityCommand,
  contentBriefRevisionRecoverySchema,
  contentBriefRevisionRecoveryResultSchema,
  type ContentBriefRevisionRecoveryCommand,
} from '@vision-maxson/contracts';
import { hasPermission, newId } from '@vision-maxson/domain';
export const contentBriefRevisionPolicy = Object.freeze({
  profileKey: 'phase3_content_brief_revision_v1',
  profileVersion: 1,
  stageKey: 'CONTENT_BRIEF',
  monetaryCeilingMicrousd: 201920,
  maximumAttempts: 1,
  timeoutMs: 90000,
  maxOutputTokens: 10000,
  reasoningEffort: 'medium' as const,
});
const policy = contentBriefRevisionPolicy;
import type { EditorialActor } from './repository';

type Row = Record<string, unknown>;
type Context = { requestId: string; environment: string };
export class ContentBriefCapacityError extends Error {
  constructor(
    readonly status: 403 | 404 | 409 | 422 | 500,
    message: string,
  ) {
    super(message);
  }
}
export { contentBriefRevisionSchemaReady } from '../../../../packages/db/src/phase3-schema';
import {
  contentBriefRevisionSchemaReady,
  verifiedContentBriefRevisionSchema,
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
  ideaCandidateId: 'idea_candidate_id',
  ideaArtifactId: 'idea_artifact_id',
  ideaVersionId: 'idea_version_id',
  ideaApprovalId: 'idea_approval_id',
  briefArtifactId: 'brief_artifact_id',
  expectedCurrentBriefVersionId: 'expected_current_brief_version_id',
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
    const result = contentBriefRevisionCapacityResultSchema.parse(
      JSON.parse(String(row.result_json)),
    );
    if (
      Object.entries(correlations).some(
        ([key, column]) => result[key as keyof typeof result] !== row[column],
      )
    )
      throw new Error();
    return result;
  } catch {
    throw new ContentBriefCapacityError(500, 'content_brief_revision_receipt_invalid');
  }
}

const recoveryCorrelations = {
  recoveryId: 'id',
  capacityId: 'content_brief_revision_capacity_id',
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
    const result = contentBriefRevisionRecoveryResultSchema.parse(
      JSON.parse(String(row.result_json)),
    );
    if (
      Object.entries(recoveryCorrelations).some(
        ([k, c]) => result[k as keyof typeof result] !== row[c],
      )
    )
      throw new Error();
    return result;
  } catch {
    throw new ContentBriefCapacityError(500, 'content_brief_revision_recovery_receipt_invalid');
  }
}
// One bound JSON parameter avoids D1's parameter limit as the structural proof grows.
const schemaMatches = `NOT EXISTS(
 SELECT 1 FROM json_each(?) expected
 WHERE NOT EXISTS(SELECT 1 FROM sqlite_master actual
 WHERE actual.type=json_extract(expected.value,'$.type')
 AND actual.name=json_extract(expected.value,'$.name')
 AND actual.sql=json_extract(expected.value,'$.sql')))`;

export class ContentBriefRevisionCapacityService {
  constructor(
    private db: D1Database,
    private actor: EditorialActor,
    private context: Context,
  ) {}
  private async replay(key: string, commandHash: string) {
    const row = await this.db
      .prepare(
        'SELECT * FROM editorial_content_brief_revision_capacities WHERE workspace_id=? AND idempotency_key=?',
      )
      .bind(this.actor.workspaceId, key)
      .first<Row>();
    if (!row) return null;
    if (row.environment !== this.context.environment)
      throw new ContentBriefCapacityError(404, 'content_brief_revision_capacity_not_found');
    if (row.command_hash !== commandHash)
      throw new ContentBriefCapacityError(409, 'content_brief_revision_idempotency_conflict');
    return { ...receiptResult(row), idempotentReplay: true };
  }

  private async recoveryReplay(capacityId: string, key: string, commandHash: string) {
    const row = await this.db
      .prepare(
        'SELECT * FROM editorial_content_brief_revision_capacity_recoveries WHERE workspace_id=? AND idempotency_key=?',
      )
      .bind(this.actor.workspaceId, key)
      .first<Row>();
    if (!row) return null;
    if (row.environment !== this.context.environment)
      throw new ContentBriefCapacityError(404, 'content_brief_revision_capacity_not_found');
    if (row.command_hash !== commandHash || row.content_brief_revision_capacity_id !== capacityId)
      throw new ContentBriefCapacityError(
        409,
        'content_brief_revision_recovery_idempotency_conflict',
      );
    return { ...recoveryResult(row), idempotentReplay: true };
  }
  async recover(capacityId: string, key: string, input: ContentBriefRevisionRecoveryCommand) {
    const role = this.actor.roles.find((r) => r === 'owner' || r === 'admin');
    if (!hasPermission(this.actor.roles, 'providers:admin') || !role)
      throw new ContentBriefCapacityError(403, 'content_brief_revision_not_allowed');
    const parsed = contentBriefRevisionRecoverySchema.safeParse(input);
    key = key.trim();
    if (
      !parsed.success ||
      !key ||
      key.length > 200 ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{2,99}$/u.test(capacityId)
    )
      throw new ContentBriefCapacityError(422, 'content_brief_revision_recovery_command_invalid');
    const proof = await verifiedContentBriefRevisionSchema(this.db);
    if (!proof)
      throw new ContentBriefCapacityError(422, 'content_brief_revision_schema_unavailable');
    const member = await this.db
      .prepare(
        `SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id=u.id AND ur.workspace_id=u.workspace_id JOIN roles r ON r.id=ur.role_id WHERE u.id=? AND u.workspace_id=? AND u.status='active' AND u.deleted_at IS NULL AND r.key=?`,
      )
      .bind(this.actor.id, this.actor.workspaceId, role)
      .first();
    if (!member) throw new ContentBriefCapacityError(403, 'content_brief_revision_not_allowed');
    const command = parsed.data;
    const commandHash = await digest({
      operation: 'content_brief_revision_capacity_recover',
      workspaceId: this.actor.workspaceId,
      environment: this.context.environment,
      capacityId,
      command,
    });
    const replay = await this.recoveryReplay(capacityId, key, commandHash);
    if (replay) return replay;
    const c = await this.db
      .prepare(
        'SELECT * FROM editorial_content_brief_revision_capacities WHERE id=? AND workspace_id=? AND environment=?',
      )
      .bind(capacityId, this.actor.workspaceId, this.context.environment)
      .first<Row>();
    if (!c) throw new ContentBriefCapacityError(404, 'content_brief_revision_capacity_not_found');
    receiptResult(c);
    if (
      await this.db
        .prepare(
          'SELECT id FROM editorial_content_brief_revision_capacity_recoveries WHERE content_brief_revision_capacity_id=?',
        )
        .bind(capacityId)
        .first()
    )
      throw new ContentBriefCapacityError(409, 'content_brief_revision_recovery_exhausted');
    const project = await this.db
      .prepare('SELECT version FROM projects WHERE id=? AND workspace_id=?')
      .bind(c.project_id, this.actor.workspaceId)
      .first<Row>();
    if (project?.version !== command.expectedProjectVersion)
      throw new ContentBriefCapacityError(
        409,
        'content_brief_revision_recovery_project_version_stale',
      );
    const failure = await this.db
      .prepare(
        'SELECT * FROM content_brief_revision_zero_provider_failures WHERE capacity_id=? AND failed_run_id=? AND failed_reservation_id=?',
      )
      .bind(capacityId, command.expectedFailedRunId, command.expectedFailedReservationId)
      .first();
    if (!failure)
      throw new ContentBriefCapacityError(409, 'content_brief_revision_capacity_not_recoverable');
    const eligible = await this.db
      .prepare(
        'SELECT * FROM content_brief_revision_recovery_eligible WHERE capacity_id=? AND failed_run_id=? AND failed_reservation_id=? AND project_version=?',
      )
      .bind(
        capacityId,
        command.expectedFailedRunId,
        command.expectedFailedReservationId,
        command.expectedProjectVersion,
      )
      .first();
    if (!eligible)
      throw new ContentBriefCapacityError(409, 'content_brief_revision_capacity_not_recoverable');
    const at = new Date().toISOString();
    const result = contentBriefRevisionRecoveryResultSchema.parse({
      recoveryId: newId('content_brief_revision_recovery'),
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
            `INSERT INTO editorial_execution_envelopes(id,workspace_id,project_id,profile_key,profile_version,provider_id,provider_model_id,currency,monetary_ceiling_microusd,maximum_calls,status,authorized_by,created_at,updated_at,version,project_execution_budget_id,stage_key) VALUES(?,?,?,?,1,?,?,'USD',201920,1,'ACTIVE',?,?,?,1,?,'CONTENT_BRIEF')`,
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
            `INSERT INTO audit_events(id,workspace_id,actor_type,actor_id,actor_role,action,resource_type,resource_id,outcome,request_id,environment,metadata_json,occurred_at,ingested_at) VALUES(?,?,'user',?,?,'editorial.content_brief_revision_capacity_recovered','editorial_content_brief_revision_capacity_recovery',?,'success',?,?,?,?,?)`,
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
            `INSERT INTO editorial_content_brief_revision_capacity_recoveries(${Object.keys(receipt).join(',')}) VALUES(CASE WHEN ${schemaMatches} THEN ? ELSE NULL END,${Object.keys(
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
            'SELECT id FROM editorial_content_brief_revision_capacity_recoveries WHERE content_brief_revision_capacity_id=?',
          )
          .bind(capacityId)
          .first()
      )
        throw new ContentBriefCapacityError(409, 'content_brief_revision_recovery_exhausted');
      throw new ContentBriefCapacityError(409, 'content_brief_revision_recovery_conflict');
    }
    return { ...result, idempotentReplay: false };
  }

  async authorize(requestId: string, key: string, input: ContentBriefRevisionCapacityCommand) {
    if (!hasPermission(this.actor.roles, 'providers:admin'))
      throw new ContentBriefCapacityError(403, 'content_brief_revision_not_allowed');
    const role = this.actor.roles.find((r) => r === 'owner' || r === 'admin');
    if (!role) throw new ContentBriefCapacityError(403, 'content_brief_revision_not_allowed');
    const parsed = contentBriefRevisionCapacitySchema.safeParse(input);
    key = key.trim();
    if (
      !parsed.success ||
      !key ||
      key.length > 200 ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{2,99}$/u.test(requestId)
    )
      throw new ContentBriefCapacityError(422, 'content_brief_revision_command_invalid');
    const proof = await verifiedContentBriefRevisionSchema(this.db);
    if (!proof)
      throw new ContentBriefCapacityError(422, 'content_brief_revision_schema_unavailable');
    const member = await this.db
      .prepare(
        `SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id=u.id AND ur.workspace_id=u.workspace_id JOIN roles r ON r.id=ur.role_id WHERE u.id=? AND u.workspace_id=? AND u.status='active' AND u.deleted_at IS NULL AND r.key=?`,
      )
      .bind(this.actor.id, this.actor.workspaceId, role)
      .first();
    if (!member) throw new ContentBriefCapacityError(403, 'content_brief_revision_not_allowed');
    const command = parsed.data;
    const commandHash = await digest({
      operation: 'content_brief_revision_capacity_authorize',
      workspaceId: this.actor.workspaceId,
      environment: this.context.environment,
      requestId,
      command,
    });
    const replay = await this.replay(key, commandHash);
    if (replay) return replay;
    const request = await this.db
      .prepare('SELECT id FROM editorial_revision_requests WHERE id=? AND workspace_id=?')
      .bind(requestId, this.actor.workspaceId)
      .first();
    if (!request)
      throw new ContentBriefCapacityError(404, 'content_brief_revision_request_not_found');
    const eligible = await this.db
      .prepare(
        `SELECT * FROM content_brief_revision_eligible_inputs WHERE revision_request_id=? AND workspace_id=? AND research_version_id=? AND research_approval_id=? AND research_artifact_revision=? AND project_version=? AND idea_candidate_id=? AND expected_idea_candidate_revision=? AND idea_version_id=? AND idea_approval_id=? AND expected_idea_artifact_revision=?`,
      )
      .bind(
        requestId,
        this.actor.workspaceId,
        command.researchVersionId,
        command.researchApprovalId,
        command.expectedResearchArtifactRevision,
        command.expectedProjectVersion,
        command.ideaCandidateId,
        command.expectedIdeaCandidateRevision,
        command.ideaVersionId,
        command.ideaApprovalId,
        command.expectedIdeaArtifactRevision,
      )
      .first<Row>();
    if (!eligible) throw new ContentBriefCapacityError(409, 'content_brief_revision_ineligible');
    const config = await this.db
      .prepare('SELECT * FROM content_brief_revision_eligible_policy')
      .first<Row>();
    if (!config)
      throw new ContentBriefCapacityError(422, 'content_brief_revision_policy_unavailable');
    const result = contentBriefRevisionCapacityResultSchema.parse({
      capacityId: newId('content_brief_revision_capacity'),
      ideaCandidateId: eligible.idea_candidate_id,
      ideaArtifactId: eligible.idea_artifact_id,
      ideaVersionId: eligible.idea_version_id,
      ideaApprovalId: eligible.idea_approval_id,
      briefArtifactId: eligible.brief_artifact_id,
      expectedCurrentBriefVersionId: eligible.expected_current_brief_version_id,
      projectId: eligible.project_id,
      revisionRequestId: requestId,
      researchArtifactId: eligible.research_artifact_id,
      researchVersionId: command.researchVersionId,
      researchApprovalId: command.researchApprovalId,
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
      research_content_hash: eligible.research_content_hash,
      idea_candidate_id: eligible.idea_candidate_id,
      expected_idea_candidate_revision: eligible.expected_idea_candidate_revision,
      idea_artifact_id: eligible.idea_artifact_id,
      idea_version_id: eligible.idea_version_id,
      idea_approval_id: eligible.idea_approval_id,
      idea_content_hash: eligible.idea_content_hash,
      expected_idea_artifact_revision: eligible.expected_idea_artifact_revision,
      brief_artifact_id: eligible.brief_artifact_id,
      expected_current_brief_version_id: eligible.expected_current_brief_version_id,
      expected_brief_artifact_revision: eligible.expected_brief_artifact_revision,
      binding_json: eligible.binding_json,
      policy_snapshot_json: config.policy_snapshot_json,
      request_id: this.context.requestId,
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
            `INSERT INTO editorial_project_execution_budgets(id,workspace_id,project_id,profile_key,profile_version,currency,monetary_ceiling_microusd,status,authorized_by,created_at,updated_at,version) VALUES(?,?,?,?,1,'USD',201920,'ACTIVE',?,?,?,1)`,
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
            `INSERT INTO editorial_execution_envelopes(id,workspace_id,project_id,profile_key,profile_version,provider_id,provider_model_id,currency,monetary_ceiling_microusd,maximum_calls,status,authorized_by,created_at,updated_at,version,project_execution_budget_id,stage_key) VALUES(?,?,?,?,1,?,?,'USD',201920,1,'ACTIVE',?,?,?,1,?,'CONTENT_BRIEF')`,
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
            `INSERT INTO audit_events(id,workspace_id,actor_type,actor_id,actor_role,action,resource_type,resource_id,outcome,request_id,environment,metadata_json,occurred_at,ingested_at) VALUES(?,?,'user',?,?,'editorial.content_brief_revision_capacity_authorized','editorial_content_brief_revision_capacity',?,'success',?,?,?,?,?)`,
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
            `INSERT INTO editorial_content_brief_revision_capacities(${Object.keys(receipt).join(',')}) VALUES(CASE WHEN ${schemaMatches} THEN ? ELSE NULL END,${Object.keys(
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
      if (!(await contentBriefRevisionSchemaReady(this.db)))
        throw new ContentBriefCapacityError(422, 'content_brief_revision_schema_unavailable');
      throw new ContentBriefCapacityError(409, 'content_brief_revision_authorization_conflict');
    }
    return { ...result, idempotentReplay: false };
  }
}
export async function loadContentBriefRevisionCapacity(
  db: D1Database,
  actor: EditorialActor,
  projectId: string,
  capacityId: string,
  ideaVersionId: string | null,
  environment: string,
) {
  if (!(await contentBriefRevisionSchemaReady(db)))
    throw new ContentBriefCapacityError(422, 'content_brief_revision_schema_unavailable');
  const row = await db
    .prepare(
      `SELECT c.*,e.id envelopeId,binding.recovery_id recoveryId FROM editorial_content_brief_revision_capacities c
    JOIN content_brief_revision_execution_bindings binding ON binding.capacity_id=c.id
    JOIN content_brief_revision_eligible_inputs x ON x.revision_request_id=c.revision_request_id AND x.workspace_id=c.workspace_id AND x.project_id=c.project_id AND x.research_version_id=c.research_version_id AND x.research_approval_id=c.research_approval_id AND x.research_artifact_revision=c.expected_research_artifact_revision AND x.binding_json=c.binding_json AND x.project_version=binding.project_version
    JOIN content_brief_revision_eligible_policy pol ON pol.provider_id=c.provider_id AND pol.provider_model_id=c.provider_model_id AND pol.prompt_version_id=c.prompt_version_id AND pol.pricing_snapshot_id=c.pricing_snapshot_id AND pol.policy_snapshot_json=c.policy_snapshot_json
    JOIN editorial_execution_envelopes e ON e.id=binding.envelope_id AND e.project_execution_budget_id=c.budget_id AND e.profile_key=c.profile_key AND e.status='ACTIVE' AND e.maximum_calls=1 AND e.monetary_ceiling_microusd=c.monetary_ceiling_microusd
    JOIN editorial_project_execution_budgets b ON b.id=c.budget_id AND b.status='ACTIVE' AND b.profile_key=c.profile_key AND b.monetary_ceiling_microusd=c.monetary_ceiling_microusd
    WHERE c.id=? AND c.workspace_id=? AND c.project_id=? AND c.idea_version_id=? AND c.environment=?
    AND (binding.recovery_id IS NULL OR EXISTS(SELECT 1 FROM content_brief_revision_zero_provider_failures f WHERE f.capacity_id=c.id))
    AND NOT EXISTS(SELECT 1 FROM artifact_approvals invalid WHERE invalid.artifact_version_id=c.research_version_id AND invalid.id<>c.research_approval_id)
    AND NOT EXISTS(SELECT 1 FROM editorial_execution_reservations er WHERE er.envelope_id=e.id)`,
    )
    .bind(capacityId, actor.workspaceId, projectId, ideaVersionId, environment)
    .first<Row>();
  if (!row)
    throw new ContentBriefCapacityError(409, 'content_brief_revision_execution_binding_invalid');
  receiptResult(row);
  const recoveryId = row.recoveryId;
  if (recoveryId !== null && typeof recoveryId !== 'string')
    throw new ContentBriefCapacityError(409, 'content_brief_revision_execution_binding_invalid');
  if (recoveryId) {
    const recovery = await db
      .prepare('SELECT * FROM editorial_content_brief_revision_capacity_recoveries WHERE id=?')
      .bind(recoveryId)
      .first<Row>();
    if (!recovery)
      throw new ContentBriefCapacityError(409, 'content_brief_revision_execution_binding_invalid');
    recoveryResult(recovery);
  }
  return {
    ...row,
    stageKey: 'CONTENT_BRIEF' as const,
    id: String(row.envelopeId),
    recoveryId,
    projectExecutionBudgetId: String(row.budget_id),
    prompt_version_id: String(row.prompt_version_id),
    provider_model_id: String(row.provider_model_id),
    pricing_snapshot_id: String(row.pricing_snapshot_id),
  };
}

// This classification proves ownership and absence of dispatch, not current editorial eligibility.
// Eligibility is revalidated by the existing dispatch guards before any adapter invocation.
export async function loadContentBriefPreDispatchClaim(
  db: D1Database,
  actor: EditorialActor,
  projectId: string,
  capacityId: string,
  ideaVersionId: string | null,
  environment: string,
  runId: string,
  idempotencyKey: string,
  commandHash: string,
) {
  if (!(await contentBriefRevisionSchemaReady(db)))
    throw new ContentBriefCapacityError(422, 'content_brief_revision_schema_unavailable');
  const statement = contentBriefPreDispatchClaimStatement(
    db,
    actor,
    projectId,
    capacityId,
    ideaVersionId,
    environment,
    runId,
    idempotencyKey,
    commandHash,
  );
  const row = await statement.first<Row>();
  if (!row) throw new ContentBriefCapacityError(409, 'content_brief_revision_claim_not_resumable');
  receiptResult(row);
  if (row.recoveryId) {
    const recovery = await db
      .prepare('SELECT * FROM editorial_content_brief_revision_capacity_recoveries WHERE id=?')
      .bind(row.recoveryId)
      .first<Row>();
    if (!recovery)
      throw new ContentBriefCapacityError(409, 'content_brief_revision_claim_not_resumable');
    recoveryResult(recovery);
  }
  return {
    classification: 'CLAIMED_NOT_DISPATCHED' as const,
    runId: String(row.claimedRunId),
    reservationId: String(row.claimedReservationId),
    capacity: {
      ...row,
      stageKey: 'CONTENT_BRIEF' as const,
      id: String(row.envelopeId),
      recoveryId: row.recoveryId as string | null,
      projectExecutionBudgetId: String(row.budget_id),
      prompt_version_id: String(row.prompt_version_id),
      provider_model_id: String(row.provider_model_id),
      pricing_snapshot_id: String(row.pricing_snapshot_id),
    },
  };
}

const preDispatchClaimQuery = `SELECT c.*,e.id envelopeId,binding.recovery_id recoveryId,ir.id claimedRunId,r.id claimedReservationId
    FROM editorial_content_brief_revision_capacities c
    JOIN content_brief_revision_execution_bindings binding ON binding.capacity_id=c.id
    JOIN editorial_project_execution_budgets b ON b.id=c.budget_id AND b.workspace_id=c.workspace_id
      AND b.project_id=c.project_id AND b.profile_key=c.profile_key AND b.profile_version=c.profile_version
      AND b.currency='USD' AND b.monetary_ceiling_microusd=c.monetary_ceiling_microusd
    JOIN editorial_execution_envelopes e ON e.id=binding.envelope_id AND e.project_execution_budget_id=b.id
      AND e.workspace_id=c.workspace_id AND e.project_id=c.project_id AND e.profile_key=c.profile_key
      AND e.profile_version=c.profile_version AND e.stage_key=c.stage_key AND e.provider_id=c.provider_id
      AND e.provider_model_id=c.provider_model_id AND e.currency='USD' AND e.maximum_calls=1
      AND e.monetary_ceiling_microusd=c.monetary_ceiling_microusd AND e.status='CONSUMED' AND e.version=2
    JOIN editorial_execution_reservations r ON r.envelope_id=e.id AND r.project_execution_budget_id=b.id
      AND r.workspace_id=c.workspace_id AND r.project_id=c.project_id AND r.step_key=c.stage_key
      AND r.pricing_snapshot_id=c.pricing_snapshot_id AND r.reserved_microusd=c.monetary_ceiling_microusd
      AND r.status='RESERVED' AND r.dispatched_at IS NULL AND r.actual_microusd IS NULL AND r.reconciled_at IS NULL
    JOIN intelligence_runs ir ON ir.id=r.intelligence_run_id AND ir.workspace_id=c.workspace_id
      AND ir.project_id=c.project_id AND ir.task_type=c.stage_key AND ir.input_artifact_version_id=c.idea_version_id
      AND ir.provider_id=c.provider_id AND ir.provider_model_id=c.provider_model_id
      AND ir.prompt_version_id=c.prompt_version_id AND ir.pricing_snapshot_id=c.pricing_snapshot_id
      AND ir.status='QUEUED' AND ir.started_at IS NULL AND ir.completed_at IS NULL
      AND ir.output_artifact_version_id IS NULL AND ir.terminal_audit_event_id IS NULL
      AND ir.input_units IS NULL AND ir.output_units IS NULL AND ir.actual_cost IS NULL
      AND ir.error_category IS NULL AND ir.safe_error_detail IS NULL AND ir.creative_regeneration_number=0
      AND json_extract(ir.safe_metadata_json,'$.commandHash')=?
      AND json_extract(ir.safe_metadata_json,'$.contentBriefRevisionCapacityId')=c.id
      AND json_extract(ir.safe_metadata_json,'$.contentBriefRevisionRecoveryId') IS binding.recovery_id
      AND (SELECT count(*) FROM json_each(ir.safe_metadata_json))=CASE WHEN binding.recovery_id IS NULL THEN 2 ELSE 3 END
    WHERE c.id=? AND c.workspace_id=? AND c.project_id=? AND c.idea_version_id=? AND c.environment=?
      AND c.stage_key='CONTENT_BRIEF' AND c.profile_key='phase3_content_brief_revision_v1' AND c.profile_version=1
      AND c.monetary_ceiling_microusd=201920 AND c.maximum_calls=1
      AND ir.id=? AND ir.idempotency_key=? AND ir.initiated_by=?
      AND NOT EXISTS(SELECT 1 FROM intelligence_run_attempts a WHERE a.intelligence_run_id=ir.id)
      AND NOT EXISTS(SELECT 1 FROM editorial_artifact_versions v WHERE v.intelligence_run_id=ir.id)
      AND NOT EXISTS(SELECT 1 FROM audit_events a WHERE a.resource_id=ir.id OR a.id='brief-capacity-consumed-'||ir.id)
      AND (SELECT count(*) FROM editorial_execution_reservations used WHERE used.envelope_id=e.id)=1
      AND (SELECT count(*) FROM intelligence_runs other WHERE other.workspace_id=c.workspace_id
        AND json_extract(other.safe_metadata_json,'$.contentBriefRevisionCapacityId')=c.id
        AND json_extract(other.safe_metadata_json,'$.contentBriefRevisionRecoveryId') IS binding.recovery_id)=1`;

type BriefExecutionIdentity = {
  idempotencyKey: string;
  commandHash: string;
  ideaVersionId: string | null;
  environment: string;
};

export function contentBriefPreDispatchClaimStatement(
  db: D1Database,
  actor: EditorialActor,
  projectId: string,
  capacityId: string,
  ideaVersionId: string | null,
  environment: string,
  runId: string,
  idempotencyKey: string,
  commandHash: string,
  guard = false,
) {
  return db
    .prepare(
      guard
        ? `SELECT CASE WHEN EXISTS(${preDispatchClaimQuery}) THEN 1 ELSE json('content_brief_revision_claim_changed') END`
        : preDispatchClaimQuery,
    )
    .bind(
      commandHash,
      capacityId,
      actor.workspaceId,
      projectId,
      ideaVersionId,
      environment,
      runId,
      idempotencyKey,
      actor.id,
    );
}

// Another request owns (or has completed) the durable dispatch. Never terminalize its Run.
export class ContentBriefDispatchObserved extends Error {}

export async function inspectContentBriefPreDispatchFailure(
  db: D1Database,
  actor: EditorialActor,
  projectId: string,
  capacityId: string,
  runId: string,
  identity: BriefExecutionIdentity,
) {
  const proof = await verifiedContentBriefRevisionSchema(db);
  return reconcileContentBriefDispatch(
    db,
    actor,
    projectId,
    capacityId,
    runId,
    'not-a-dispatch-attempt',
    '',
    proof,
    identity,
  );
}

export type ContentBriefDispatchOutcome =
  'COMMITTED_NO_PROVIDER_CALL' | 'NOT_COMMITTED' | 'AMBIGUOUS';
export class ContentBriefDispatchError extends ContentBriefCapacityError {
  constructor(
    readonly dispatchOutcome: ContentBriefDispatchOutcome,
    readonly rejection: 'ELIGIBILITY_REJECTED' | 'SCHEMA_UNAVAILABLE' | null = null,
  ) {
    super(
      rejection === 'ELIGIBILITY_REJECTED' ? 409 : rejection === 'SCHEMA_UNAVAILABLE' ? 422 : 500,
      rejection === 'ELIGIBILITY_REJECTED'
        ? 'content_brief_revision_dispatch_ineligible'
        : rejection === 'SCHEMA_UNAVAILABLE'
          ? 'content_brief_revision_schema_unavailable'
          : dispatchOutcome === 'COMMITTED_NO_PROVIDER_CALL'
            ? 'content_brief_revision_dispatch_committed_confirmation_lost'
            : dispatchOutcome === 'NOT_COMMITTED'
              ? 'content_brief_revision_dispatch_not_committed'
              : 'content_brief_revision_dispatch_ambiguous',
    );
  }
}

// A single correlated read establishes durable state, never resumes dispatch.
// D1 without read-replica sessions uses the primary database for these reads.
async function reconcileContentBriefDispatch(
  db: D1Database,
  actor: EditorialActor,
  projectId: string,
  capacityId: string,
  runId: string,
  attemptId: string,
  at: string,
  proof: Awaited<ReturnType<typeof verifiedContentBriefRevisionSchema>>,
  identity: BriefExecutionIdentity,
): Promise<ContentBriefDispatchError> {
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
        EXISTS(SELECT 1 FROM content_brief_revision_eligible_inputs x
          JOIN content_brief_revision_eligible_policy pol ON pol.provider_id=c.provider_id
            AND pol.provider_model_id=c.provider_model_id AND pol.prompt_version_id=c.prompt_version_id
            AND pol.pricing_snapshot_id=c.pricing_snapshot_id AND pol.policy_snapshot_json=c.policy_snapshot_json
          WHERE x.revision_request_id=c.revision_request_id AND x.workspace_id=c.workspace_id
            AND x.project_id=c.project_id AND x.research_version_id=c.research_version_id
            AND x.research_approval_id=c.research_approval_id
            AND x.research_artifact_revision=c.expected_research_artifact_revision AND x.binding_json=c.binding_json
            AND x.project_version=COALESCE(recovery.recovery_project_version,c.expected_project_version)
            AND e.status='CONSUMED' AND b.status='ACTIVE'
            AND (recovery.id IS NULL OR EXISTS(SELECT 1 FROM content_brief_revision_zero_provider_failures f WHERE f.capacity_id=c.id))
        ) eligible
      FROM editorial_content_brief_revision_capacities c
      LEFT JOIN editorial_content_brief_revision_capacity_recoveries recovery ON recovery.content_brief_revision_capacity_id=c.id
      JOIN editorial_execution_envelopes e ON e.id=COALESCE(recovery.replacement_envelope_id,c.envelope_id)
        AND e.project_execution_budget_id=c.budget_id AND e.workspace_id=c.workspace_id AND e.project_id=c.project_id
      JOIN editorial_project_execution_budgets b ON b.id=c.budget_id AND b.workspace_id=c.workspace_id AND b.project_id=c.project_id
      JOIN editorial_execution_reservations r ON r.envelope_id=e.id AND r.project_execution_budget_id=b.id
        AND r.workspace_id=c.workspace_id AND r.project_id=c.project_id AND r.step_key=c.stage_key
        AND r.pricing_snapshot_id=c.pricing_snapshot_id AND r.reserved_microusd=c.monetary_ceiling_microusd
        AND r.actual_microusd IS NULL AND r.reconciled_at IS NULL
      JOIN intelligence_runs ir ON ir.id=r.intelligence_run_id AND ir.workspace_id=c.workspace_id
        AND ir.project_id=c.project_id AND ir.task_type=c.stage_key AND ir.input_artifact_version_id=c.idea_version_id
        AND ir.provider_id=c.provider_id AND ir.provider_model_id=c.provider_model_id
        AND ir.prompt_version_id=c.prompt_version_id AND ir.pricing_snapshot_id=c.pricing_snapshot_id
        AND json_extract(ir.safe_metadata_json,'$.contentBriefRevisionCapacityId')=c.id
        AND json_extract(ir.safe_metadata_json,'$.contentBriefRevisionRecoveryId') IS recovery.id
        AND ir.completed_at IS NULL AND ir.output_artifact_version_id IS NULL
      WHERE c.id=? AND c.workspace_id=? AND c.project_id=? AND ir.id=?
        AND ir.idempotency_key=? AND json_extract(ir.safe_metadata_json,'$.commandHash')=? AND c.environment=?
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
        identity.idempotencyKey,
        identity.commandHash,
        identity.environment,
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
      return new ContentBriefDispatchError('COMMITTED_NO_PROVIDER_CALL');
    if (
      state?.reservation_status === 'RESERVED' &&
      state.dispatched_at === null &&
      state.run_status === 'QUEUED' &&
      state.started_at === null &&
      state.attempt_count === 0
    )
      return new ContentBriefDispatchError(
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
  return new ContentBriefDispatchError('AMBIGUOUS');
}

// The schema proof is compared again inside the atomic dispatch batch. Business
// eligibility is enforced by the BEFORE UPDATE trigger on the reservation itself.
export async function authorizeContentBriefRevisionDispatch(
  db: D1Database,
  actor: EditorialActor,
  projectId: string,
  capacityId: string,
  runId: string,
  requestId: string,
  identity: BriefExecutionIdentity,
) {
  let proof: Awaited<ReturnType<typeof verifiedContentBriefRevisionSchema>> = null;
  const at = new Date().toISOString();
  const attemptId = newId('attempt');
  try {
    proof = await verifiedContentBriefRevisionSchema(db);
    if (!proof)
      throw new ContentBriefCapacityError(422, 'content_brief_revision_schema_unavailable');
    const results = await db.batch([
      db
        .prepare(
          `UPDATE editorial_execution_reservations SET status='DISPATCHED',dispatched_at=?
        WHERE intelligence_run_id=? AND workspace_id=? AND project_id=? AND status='RESERVED'
        AND EXISTS(SELECT 1 FROM editorial_content_brief_revision_capacities c JOIN content_brief_revision_execution_bindings binding ON binding.capacity_id=c.id WHERE c.id=? AND binding.envelope_id=editorial_execution_reservations.envelope_id AND c.budget_id=editorial_execution_reservations.project_execution_budget_id)
        AND ${schemaMatches} AND EXISTS(${preDispatchClaimQuery})`,
        )
        .bind(
          at,
          runId,
          actor.workspaceId,
          projectId,
          capacityId,
          JSON.stringify(proof),
          identity.commandHash,
          capacityId,
          actor.workspaceId,
          projectId,
          identity.ideaVersionId,
          identity.environment,
          runId,
          identity.idempotencyKey,
          actor.id,
        ),
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
      db
        .prepare(
          `INSERT INTO audit_events(id,workspace_id,actor_type,actor_id,actor_role,action,resource_type,resource_id,outcome,request_id,environment,metadata_json,occurred_at,ingested_at)
        SELECT ?,c.workspace_id,'user',?,?,'editorial.content_brief_revision_capacity_consumed','editorial_content_brief_revision_capacity',c.id,'success',?,c.environment,
        json_set(c.result_json,'$.runId',ir.id,'$.executionEnvelopeId',r.envelope_id,'$.reservationId',r.id,'$.executionActorId',?,'$.executionRequestId',?),?,?
        FROM editorial_content_brief_revision_capacities c JOIN content_brief_revision_execution_bindings b ON b.capacity_id=c.id JOIN editorial_execution_reservations r ON r.envelope_id=b.envelope_id JOIN intelligence_runs ir ON ir.id=r.intelligence_run_id
        WHERE c.id=? AND ir.id=? AND r.status='DISPATCHED' AND r.dispatched_at=? AND EXISTS(SELECT 1 FROM intelligence_run_attempts a WHERE a.id=? AND a.intelligence_run_id=ir.id)`,
        )
        .bind(
          'brief-capacity-consumed-' + runId,
          actor.id,
          actor.roles[0] ?? null,
          requestId,
          actor.id,
          requestId,
          at,
          at,
          capacityId,
          runId,
          at,
          attemptId,
        ),
    ]);
    if (results.length !== 4 || results.some((r) => r.meta.changes !== 1))
      throw new ContentBriefCapacityError(409, 'content_brief_revision_dispatch_ineligible');
  } catch {
    // A competing same-key caller may have won the CAS. It alone owns its attempt and terminal writes.
    let observed: Row | null;
    try {
      observed = await db
        .prepare(
          `SELECT ir.status,r.status reservation_status,
      EXISTS(SELECT 1 FROM intelligence_run_attempts a WHERE a.intelligence_run_id=ir.id AND a.id=?) own_attempt,
      EXISTS(SELECT 1 FROM intelligence_run_attempts a WHERE a.intelligence_run_id=ir.id) any_attempt
      FROM editorial_content_brief_revision_capacities c
      JOIN content_brief_revision_execution_bindings b ON b.capacity_id=c.id
      JOIN editorial_execution_reservations r ON r.envelope_id=b.envelope_id AND r.project_execution_budget_id=c.budget_id
        AND r.workspace_id=c.workspace_id AND r.project_id=c.project_id
      JOIN intelligence_runs ir ON ir.id=r.intelligence_run_id AND ir.workspace_id=c.workspace_id AND ir.project_id=c.project_id
      WHERE c.id=? AND c.workspace_id=? AND c.project_id=? AND ir.id=?`,
        )
        .bind(attemptId, capacityId, actor.workspaceId, projectId, runId)
        .first<Row>();
    } catch {
      throw new ContentBriefDispatchObserved();
    }
    if (!observed) throw new ContentBriefDispatchObserved();
    if (
      observed &&
      observed.own_attempt === 0 &&
      (observed.status !== 'QUEUED' ||
        observed.reservation_status === 'DISPATCHED' ||
        observed.any_attempt === 1)
    )
      throw new ContentBriefDispatchObserved();
    // Never retry or call the adapter after a missing batch confirmation.
    const reconciled = await reconcileContentBriefDispatch(
      db,
      actor,
      projectId,
      capacityId,
      runId,
      attemptId,
      at,
      proof,
      identity,
    );
    // Unknown ownership must never authorize terminal writes against another caller's Run.
    if (reconciled.dispatchOutcome === 'AMBIGUOUS') throw new ContentBriefDispatchObserved();
    throw reconciled;
  }
}

export async function contentBriefPublicationGuard(
  db: D1Database,
  capacityId: string,
  runId: string,
) {
  const proof = await verifiedContentBriefRevisionSchema(db);
  if (!proof) throw new ContentBriefCapacityError(422, 'content_brief_revision_schema_unavailable');
  return db
    .prepare(
      `UPDATE intelligence_runs SET id=CASE WHEN ${schemaMatches} AND EXISTS(
 SELECT 1 FROM editorial_content_brief_revision_capacities c JOIN content_brief_revision_execution_bindings b ON b.capacity_id=c.id
 JOIN content_brief_revision_eligible_inputs x ON x.revision_request_id=c.revision_request_id AND x.workspace_id=c.workspace_id AND x.project_id=c.project_id AND x.research_version_id=c.research_version_id AND x.research_approval_id=c.research_approval_id AND x.research_artifact_revision=c.expected_research_artifact_revision AND x.binding_json=c.binding_json AND x.project_version=b.project_version
 JOIN content_brief_revision_eligible_policy p ON p.provider_id=c.provider_id AND p.provider_model_id=c.provider_model_id AND p.prompt_version_id=c.prompt_version_id AND p.pricing_snapshot_id=c.pricing_snapshot_id AND p.policy_snapshot_json=c.policy_snapshot_json
 JOIN editorial_execution_reservations r ON r.envelope_id=b.envelope_id AND r.intelligence_run_id=intelligence_runs.id AND r.status='DISPATCHED'
 WHERE c.id=? AND intelligence_runs.task_type='CONTENT_BRIEF' AND intelligence_runs.input_artifact_version_id=c.idea_version_id
 ) THEN id ELSE NULL END WHERE id=?`,
    )
    .bind(JSON.stringify(proof), capacityId, runId);
}

export async function contentBriefClaimGuard(
  db: D1Database,
  actor: EditorialActor,
  projectId: string,
  capacityId: string,
  ideaVersionId: string | null,
  environment: string,
) {
  await loadContentBriefRevisionCapacity(
    db,
    actor,
    projectId,
    capacityId,
    ideaVersionId,
    environment,
  );
  const proof = await verifiedContentBriefRevisionSchema(db);
  if (!proof) throw new ContentBriefCapacityError(422, 'content_brief_revision_schema_unavailable');
  return db
    .prepare(
      `SELECT CASE WHEN ${schemaMatches} AND EXISTS(
 SELECT 1 FROM editorial_content_brief_revision_capacities c JOIN content_brief_revision_execution_bindings b ON b.capacity_id=c.id
 JOIN content_brief_revision_eligible_inputs x ON x.revision_request_id=c.revision_request_id AND x.workspace_id=c.workspace_id AND x.project_id=c.project_id AND x.research_version_id=c.research_version_id AND x.research_approval_id=c.research_approval_id AND x.research_artifact_revision=c.expected_research_artifact_revision AND x.binding_json=c.binding_json AND x.project_version=b.project_version
 JOIN content_brief_revision_eligible_policy p ON p.provider_id=c.provider_id AND p.provider_model_id=c.provider_model_id AND p.prompt_version_id=c.prompt_version_id AND p.pricing_snapshot_id=c.pricing_snapshot_id AND p.policy_snapshot_json=c.policy_snapshot_json
 JOIN editorial_execution_envelopes e ON e.id=b.envelope_id AND e.status='ACTIVE'
 JOIN editorial_project_execution_budgets budget ON budget.id=c.budget_id AND budget.status='ACTIVE'
 WHERE c.id=? AND c.workspace_id=? AND c.project_id=? AND c.idea_version_id=? AND c.environment=?
 AND NOT EXISTS(SELECT 1 FROM editorial_execution_reservations r WHERE r.envelope_id=e.id)
 ) THEN 1 ELSE json('content_brief_revision_claim_rejected') END`,
    )
    .bind(
      JSON.stringify(proof),
      capacityId,
      actor.workspaceId,
      projectId,
      ideaVersionId,
      environment,
    );
}
