import type { GovernedChainedRemediationCapacityCommand } from '@vision-maxson/contracts';
import { newId } from '@vision-maxson/domain';
import type { EditorialActor } from './repository';
import { classifyChainedRemediationDiagnostic } from './chained-remediation-diagnostic';
type Row = Record<string, unknown>;
type AuditContext = {
  requestId: string;
  environment: string;
  accessIssuer: string;
  accessSubject: string;
};
const PROFILE = 'phase3_storyboard_chained_remediation_v2';
async function digest(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((part) => part.toString(16).padStart(2, '0'))
    .join('');
}
export class GovernedChainedRemediationService {
  constructor(
    private readonly db: D1Database,
    private readonly actor: EditorialActor,
    private readonly context: AuditContext,
  ) {}
  private async replay(projectId: string, key: string, hash: string) {
    const row = await this.db
      .prepare(
        'SELECT id,command_hash commandHash,remediation_project_execution_budget_id budgetId,remediation_envelope_id envelopeId,audit_event_id auditEventId FROM editorial_chained_execution_remediations WHERE workspace_id=? AND project_id=? AND idempotency_key=?',
      )
      .bind(this.actor.workspaceId, projectId, key)
      .first<Row>();
    if (!row) return null;
    if (row.commandHash !== hash) throw new Error('chained_remediation_idempotency_conflict');
    return {
      remediationId: String(row.id),
      budgetId: String(row.budgetId),
      envelopeId: String(row.envelopeId),
      auditEventId: String(row.auditEventId),
      generation: 2 as const,
      idempotent: true,
    };
  }
  async authorize(
    projectId: string,
    key: string,
    command: GovernedChainedRemediationCapacityCommand,
  ) {
    if (command.workspaceId !== this.actor.workspaceId)
      throw new Error('chained_remediation_workspace_mismatch');
    const schemaReady = await this.db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='editorial_chained_execution_remediations'",
      )
      .first();
    if (!schemaReady) throw new Error('chained_remediation_schema_unavailable');
    const commandHash = await digest({ projectId, command });
    const prior = await this.replay(projectId, key, commandHash);
    if (prior) return prior;
    const evidence = await this.db
      .prepare(
        "SELECT p.remediation_envelope_id parentEnvelopeId,p.provider_id providerId,p.provider_model_id modelId,r.id reservationId,run.safe_metadata_json runSafeMetadataJson,attempt.safe_metadata_json attemptSafeMetadataJson FROM editorial_execution_remediations p JOIN editorial_project_execution_budgets pb ON pb.id=p.remediation_project_execution_budget_id JOIN editorial_execution_envelopes pe ON pe.id=p.remediation_envelope_id JOIN intelligence_runs run ON run.id=? JOIN editorial_execution_reservations r ON r.intelligence_run_id=run.id JOIN intelligence_run_attempts attempt ON attempt.intelligence_run_id=run.id JOIN ai_providers provider ON provider.id=p.provider_id JOIN ai_provider_models model ON model.id=p.provider_model_id AND model.provider_id=provider.id WHERE p.id=? AND p.workspace_id=? AND p.project_id=? AND p.profile_key='phase3_storyboard_remediation_v1' AND p.profile_version=1 AND p.stage_key='STORYBOARD_PLANNER' AND p.maximum_calls=1 AND pb.workspace_id=p.workspace_id AND pb.project_id=p.project_id AND pb.status='ACTIVE' AND pe.workspace_id=p.workspace_id AND pe.project_id=p.project_id AND pe.project_execution_budget_id=pb.id AND pe.status='CONSUMED' AND pe.maximum_calls=1 AND (SELECT COUNT(*) FROM editorial_execution_reservations used WHERE used.envelope_id=pe.id)=1 AND run.workspace_id=p.workspace_id AND run.project_id=p.project_id AND run.task_type='STORYBOARD_PLANNER' AND run.status='FAILED_PERMANENT' AND run.error_category='SCHEMA_VALIDATION' AND r.workspace_id=p.workspace_id AND r.project_id=p.project_id AND r.project_execution_budget_id=pb.id AND r.envelope_id=pe.id AND r.status='RECONCILED' AND r.actual_microusd IS NOT NULL AND r.actual_microusd>=0 AND r.dispatched_at IS NOT NULL AND attempt.attempt_number=1 AND attempt.status='FAILED_PERMANENT' AND attempt.error_category='SCHEMA_VALIDATION' AND (SELECT COUNT(*) FROM intelligence_run_attempts x WHERE x.intelligence_run_id=run.id)=1 AND NOT EXISTS (SELECT 1 FROM editorial_artifact_versions v JOIN editorial_artifacts a ON a.id=v.artifact_id WHERE v.intelligence_run_id=run.id AND a.artifact_type='STORYBOARD') AND provider.key=? AND provider.status='configured' AND model.model_key=? AND model.status='available'",
      )
      .bind(
        command.historicalRunId,
        command.parentRemediationId,
        this.actor.workspaceId,
        projectId,
        command.providerKey,
        command.modelKey,
      )
      .first<Row>();
    if (
      !evidence ||
      classifyChainedRemediationDiagnostic(
        evidence.runSafeMetadataJson,
        evidence.attemptSafeMetadataJson,
      ) !== 'duplicate_continuity_key'
    )
      throw new Error('chained_remediation_historical_evidence_invalid');
    if (
      await this.db
        .prepare(
          'SELECT id FROM editorial_chained_execution_remediations WHERE parent_remediation_id=? OR historical_run_id=?',
        )
        .bind(command.parentRemediationId, command.historicalRunId)
        .first()
    )
      throw new Error('chained_remediation_already_exists');
    const remediationId = newId('execution_remediation'),
      budgetId = newId('project_execution_budget'),
      envelopeId = newId('execution_envelope'),
      auditEventId = newId('audit'),
      at = new Date().toISOString();
    const metadata = JSON.stringify({
      projectId,
      remediationId,
      parentRemediationId: command.parentRemediationId,
      remediationGeneration: 2,
      historicalRunId: command.historicalRunId,
      historicalReservationId: evidence.reservationId,
      historicalEnvelopeId: evidence.parentEnvelopeId,
      remediationBudgetId: budgetId,
      remediationEnvelopeId: envelopeId,
      provider: command.providerKey,
      model: command.modelKey,
      stage: command.remediationStage,
      profileKey: PROFILE,
      profileVersion: 2,
      failureCategory: 'SCHEMA_VALIDATION',
      diagnosticCategory: 'duplicate_continuity_key',
      reasonCategory: command.reasonCategory,
      authorizedCeilingMicrousd: 321920,
      commandHash,
    });
    try {
      await this.db.batch([
        this.db
          .prepare(
            "INSERT INTO audit_events(id,workspace_id,actor_type,actor_id,actor_role,access_issuer,access_subject,action,resource_type,resource_id,outcome,request_id,environment,metadata_json,occurred_at,ingested_at) VALUES(?,?,'user',?,?,?,?,'editorial.chained_remediation_capacity_authorized','editorial_chained_execution_remediation',?,'success',?,?,?,?,?)",
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
            "INSERT INTO editorial_project_execution_budgets(id,workspace_id,project_id,profile_key,profile_version,currency,monetary_ceiling_microusd,status,authorized_by,created_at,updated_at,version) VALUES(?,?,?, ?,2,'USD',321920,'ACTIVE',?,?,?,1)",
          )
          .bind(budgetId, this.actor.workspaceId, projectId, PROFILE, this.actor.id, at, at),
        this.db
          .prepare(
            "INSERT INTO editorial_execution_envelopes(id,workspace_id,project_id,profile_key,profile_version,provider_id,provider_model_id,currency,monetary_ceiling_microusd,maximum_calls,status,authorized_by,created_at,updated_at,version,project_execution_budget_id,stage_key) VALUES(?,?,?, ?,2,?,?,'USD',321920,1,'ACTIVE',?,?,?,1,?,'STORYBOARD_PLANNER')",
          )
          .bind(
            envelopeId,
            this.actor.workspaceId,
            projectId,
            PROFILE,
            evidence.providerId,
            evidence.modelId,
            this.actor.id,
            at,
            at,
            budgetId,
          ),
        this.db
          .prepare(
            "INSERT INTO editorial_chained_execution_remediations(id,workspace_id,project_id,parent_remediation_id,remediation_generation,historical_reservation_id,historical_run_id,historical_envelope_id,remediation_project_execution_budget_id,remediation_envelope_id,profile_key,profile_version,stage_key,provider_id,provider_model_id,additional_exposure_microusd,maximum_calls,maximum_attempts,sdk_max_retries,fallback_enabled,creative_regeneration_enabled,external_research_enabled,human_approval_required,failure_category,diagnostic_category,reason_category,idempotency_key,command_hash,audit_event_id,authorized_by,created_at) VALUES(?,?,?,?,2,?,?,?,?,?,?,2,'STORYBOARD_PLANNER',?,?,321920,1,1,0,0,0,0,1,'SCHEMA_VALIDATION','duplicate_continuity_key',?,?,?,?,?,?)",
          )
          .bind(
            remediationId,
            this.actor.workspaceId,
            projectId,
            command.parentRemediationId,
            evidence.reservationId,
            command.historicalRunId,
            evidence.parentEnvelopeId,
            budgetId,
            envelopeId,
            PROFILE,
            evidence.providerId,
            evidence.modelId,
            command.reasonCategory,
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
    return {
      remediationId,
      budgetId,
      envelopeId,
      auditEventId,
      generation: 2 as const,
      idempotent: false,
    };
  }
}
