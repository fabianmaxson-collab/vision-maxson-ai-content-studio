import type { GovernedRemediationCapacityCommand } from '@vision-maxson/contracts';
import { newId } from '@vision-maxson/domain';
import type { EditorialActor } from './repository';
type Row = Record<string, unknown>;
type AuditContext = {
  requestId: string;
  environment: string;
  accessIssuer: string;
  accessSubject: string;
};
const PROFILE = 'phase3_storyboard_remediation_v1';
async function digest(v: unknown) {
  const b = new TextEncoder().encode(JSON.stringify(v));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', b))]
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');
}
export class GovernedRemediationService {
  constructor(
    private readonly db: D1Database,
    private readonly actor: EditorialActor,
    private readonly context: AuditContext,
  ) {}
  private async replay(projectId: string, key: string, hash: string) {
    const r = await this.db
      .prepare(
        `SELECT id,command_hash commandHash,remediation_project_execution_budget_id budgetId,remediation_envelope_id envelopeId,audit_event_id auditEventId FROM editorial_execution_remediations WHERE workspace_id=? AND project_id=? AND idempotency_key=?`,
      )
      .bind(this.actor.workspaceId, projectId, key)
      .first<Row>();
    if (!r) return null;
    if (r.commandHash !== hash) throw new Error('remediation_idempotency_conflict');
    return {
      remediationId: String(r.id),
      budgetId: String(r.budgetId),
      envelopeId: String(r.envelopeId),
      auditEventId: String(r.auditEventId),
      idempotent: true,
    };
  }
  async authorize(projectId: string, key: string, c: GovernedRemediationCapacityCommand) {
    if (c.workspaceId !== this.actor.workspaceId) throw new Error('remediation_workspace_mismatch');
    const commandHash = await digest({ projectId, command: c });
    const prior = await this.replay(projectId, key, commandHash);
    if (prior) return prior;
    const e = await this.db
      .prepare(
        `SELECT p.id providerId,m.id modelId FROM editorial_project_execution_budgets ob JOIN editorial_execution_reservations r ON r.id=? JOIN intelligence_runs run ON run.id=? JOIN editorial_execution_envelopes olde ON olde.id=? JOIN ai_providers p ON p.key=? JOIN ai_provider_models m ON m.provider_id=p.id AND m.model_key=? WHERE ob.id=? AND ob.workspace_id=? AND ob.project_id=? AND ob.status=? AND ob.version=? AND r.workspace_id=ob.workspace_id AND r.project_id=ob.project_id AND r.project_execution_budget_id=ob.id AND r.intelligence_run_id=run.id AND r.envelope_id=olde.id AND r.status='AMBIGUOUS' AND r.actual_microusd IS NULL AND r.dispatched_at IS NOT NULL AND run.workspace_id=ob.workspace_id AND run.project_id=ob.project_id AND run.task_type='STORYBOARD_PLANNER' AND run.status='FAILED_PERMANENT' AND run.error_category='SCHEMA_VALIDATION' AND olde.project_execution_budget_id=ob.id AND olde.workspace_id=ob.workspace_id AND olde.project_id=ob.project_id AND olde.stage_key='STORYBOARD_PLANNER' AND olde.status='CONSUMED' AND olde.maximum_calls=1 AND (SELECT COUNT(*) FROM editorial_execution_reservations x WHERE x.envelope_id=olde.id)=1 AND p.status='configured' AND m.status='available'`,
      )
      .bind(
        c.historicalReservationId,
        c.historicalRunId,
        c.historicalEnvelopeId,
        c.providerKey,
        c.modelKey,
        c.originalProjectExecutionBudgetId,
        this.actor.workspaceId,
        projectId,
        c.expectedOriginalBudgetStatus,
        c.expectedOriginalBudgetVersion,
      )
      .first<Row>();
    if (!e) throw new Error('remediation_historical_evidence_invalid');
    if (
      await this.db
        .prepare(
          `SELECT id FROM editorial_execution_remediations WHERE historical_reservation_id=? AND profile_key=? AND profile_version=1`,
        )
        .bind(c.historicalReservationId, PROFILE)
        .first()
    )
      throw new Error('remediation_already_exists');
    const remediationId = newId('execution_remediation'),
      budgetId = newId('project_execution_budget'),
      envelopeId = newId('execution_envelope'),
      auditEventId = newId('audit'),
      at = new Date().toISOString();
    const metadata = JSON.stringify({
      projectId,
      originalBudgetId: c.originalProjectExecutionBudgetId,
      historicalReservationId: c.historicalReservationId,
      historicalRunId: c.historicalRunId,
      historicalEnvelopeId: c.historicalEnvelopeId,
      remediationBudgetId: budgetId,
      remediationEnvelopeId: envelopeId,
      additionalExposureMicrousd: 321920,
      stage: c.remediationStage,
      provider: c.providerKey,
      model: c.modelKey,
      reasonCategory: c.reasonCategory,
      idempotencyKey: key,
    });
    try {
      await this.db.batch([
        this.db
          .prepare(
            `INSERT INTO audit_events(id,workspace_id,actor_type,actor_id,actor_role,access_issuer,access_subject,action,resource_type,resource_id,outcome,request_id,environment,metadata_json,occurred_at,ingested_at) VALUES(?,?,'user',?,?,?,?,?,'editorial.remediation_capacity_authorized','editorial_execution_remediation',?,'success',?,?,?,?,?)`,
          )
          .bind(
            auditEventId,
            this.actor.workspaceId,
            this.actor.id,
            this.actor.roles[0] ?? null,
            this.context.accessIssuer,
            this.context.accessSubject,
            remediationId,
            this.context.requestId,
            this.context.environment,
            metadata,
            at,
            at,
          ),
        this.db
          .prepare(
            `INSERT INTO editorial_project_execution_budgets(id,workspace_id,project_id,profile_key,profile_version,currency,monetary_ceiling_microusd,status,authorized_by,created_at,updated_at,version) VALUES(?,?,?, ?,1,'USD',321920,'ACTIVE',?,?,?,1)`,
          )
          .bind(budgetId, this.actor.workspaceId, projectId, PROFILE, this.actor.id, at, at),
        this.db
          .prepare(
            `INSERT INTO editorial_execution_envelopes(id,workspace_id,project_id,profile_key,profile_version,provider_id,provider_model_id,currency,monetary_ceiling_microusd,maximum_calls,status,authorized_by,created_at,updated_at,version,project_execution_budget_id,stage_key) VALUES(?,?,?, ?,1,?,?,'USD',321920,1,'ACTIVE',?,?,?,1,?,'STORYBOARD_PLANNER')`,
          )
          .bind(
            envelopeId,
            this.actor.workspaceId,
            projectId,
            PROFILE,
            e.providerId,
            e.modelId,
            this.actor.id,
            at,
            at,
            budgetId,
          ),
        this.db
          .prepare(
            `INSERT INTO editorial_execution_remediations(id,workspace_id,project_id,original_project_execution_budget_id,expected_original_budget_version,historical_reservation_id,historical_run_id,historical_envelope_id,remediation_project_execution_budget_id,remediation_envelope_id,profile_key,profile_version,stage_key,provider_id,provider_model_id,additional_exposure_microusd,maximum_calls,maximum_attempts,sdk_max_retries,fallback_enabled,creative_regeneration_enabled,external_research_enabled,human_approval_required,reason_category,idempotency_key,command_hash,audit_event_id,authorized_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,1,'STORYBOARD_PLANNER',?,?,321920,1,1,0,0,0,0,1,?,?,?,?,?,?)`,
          )
          .bind(
            remediationId,
            this.actor.workspaceId,
            projectId,
            c.originalProjectExecutionBudgetId,
            c.expectedOriginalBudgetVersion,
            c.historicalReservationId,
            c.historicalRunId,
            c.historicalEnvelopeId,
            budgetId,
            envelopeId,
            PROFILE,
            e.providerId,
            e.modelId,
            c.reasonCategory,
            key,
            commandHash,
            auditEventId,
            this.actor.id,
            at,
          ),
      ]);
    } catch (error) {
      const concurrent = await this.replay(projectId, key, commandHash);
      if (concurrent) return concurrent;
      throw error;
    }
    return { remediationId, budgetId, envelopeId, auditEventId, idempotent: false };
  }
}
