import { ProviderError, routeModel, type ModelCandidate } from '@vision-maxson/providers';
import {
  PHASE3_TERMINAL_GOVERNED_PROFILE,
  governedTerminalStages,
  governedTerminalStagePolicies,
  reserveMicrousd,
  type GovernedTerminalStage,
} from '@vision-maxson/providers/execution-profile';
import { taskPolicy } from '@vision-maxson/providers/policy';
import type { EditorialActor } from './repository';

type Row = Record<string, unknown>;
const newId = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;
const now = () => new Date().toISOString();

export interface GovernedTerminalBudgetInput {
  profileKey: typeof PHASE3_TERMINAL_GOVERNED_PROFILE;
  profileVersion: 1;
  monetaryCeilingMicrousd: number;
  stages: Array<{
    stageKey: GovernedTerminalStage;
    providerKey: string;
    modelKey: string;
    monetaryCeilingMicrousd: number;
  }>;
}

export function calculateGovernedReservation(row: Row, stage: GovernedTerminalStage) {
  const policy = taskPolicy(stage);
  try {
    return reserveMicrousd(
      {
        currency: typeof row.currency === 'string' ? row.currency : null,
        unitName: typeof row.unitName === 'string' ? row.unitName : null,
        inputUnitPrice: typeof row.inputPrice === 'number' ? row.inputPrice : null,
        outputUnitPrice: typeof row.outputPrice === 'number' ? row.outputPrice : null,
        verificationStatus:
          typeof row.verificationStatus === 'string' ? row.verificationStatus : '',
        effectiveFrom: typeof row.effectiveFrom === 'string' ? row.effectiveFrom : '',
        effectiveTo: typeof row.effectiveTo === 'string' ? row.effectiveTo : null,
      },
      governedTerminalStagePolicies[stage].inputTokenCeiling,
      policy.maxOutputTokens,
    );
  } catch {
    throw new ProviderError(
      'UNAVAILABLE',
      false,
      'Current compatible verified pricing is required.',
    );
  }
}

export async function authorizeGovernedTerminalBudget(
  db: D1Database,
  actor: EditorialActor,
  projectId: string,
  input: GovernedTerminalBudgetInput,
) {
  const project = await db
    .prepare('SELECT id FROM projects WHERE id=? AND workspace_id=? AND deleted_at IS NULL')
    .bind(projectId, actor.workspaceId)
    .first();
  if (!project) throw new Error('project_not_found');
  if (
    input.profileKey !== PHASE3_TERMINAL_GOVERNED_PROFILE ||
    input.profileVersion !== 1 ||
    input.stages.length !== governedTerminalStages.length ||
    !governedTerminalStages.every(
      (stage) => input.stages.filter((candidate) => candidate.stageKey === stage).length === 1,
    ) ||
    input.stages.reduce((sum, stage) => sum + stage.monetaryCeilingMicrousd, 0) >
      input.monetaryCeilingMicrousd
  )
    throw new Error('governed_terminal_budget_invalid');

  const existing = await db
    .prepare(
      `SELECT id,monetary_ceiling_microusd monetaryCeilingMicrousd FROM editorial_project_execution_budgets WHERE workspace_id=? AND project_id=? AND profile_key=? AND profile_version=1 AND status='ACTIVE'`,
    )
    .bind(actor.workspaceId, projectId, input.profileKey)
    .first<Row>();
  if (existing) {
    const envelopes = (
      await db
        .prepare(
          `SELECT e.stage_key stageKey,p.key providerKey,m.model_key modelKey,e.monetary_ceiling_microusd monetaryCeilingMicrousd FROM editorial_execution_envelopes e JOIN ai_providers p ON p.id=e.provider_id JOIN ai_provider_models m ON m.id=e.provider_model_id WHERE e.project_execution_budget_id=? AND e.status='ACTIVE' ORDER BY e.stage_key`,
        )
        .bind(existing.id)
        .all<Row>()
    ).results;
    const expected = [...input.stages].sort((a, b) => a.stageKey.localeCompare(b.stageKey));
    const same =
      Number(existing.monetaryCeilingMicrousd) === input.monetaryCeilingMicrousd &&
      envelopes.length === expected.length &&
      envelopes.every(
        (row, index) =>
          row.stageKey === expected[index]!.stageKey &&
          row.providerKey === expected[index]!.providerKey &&
          row.modelKey === expected[index]!.modelKey &&
          Number(row.monetaryCeilingMicrousd) === expected[index]!.monetaryCeilingMicrousd,
      );
    if (!same) throw new Error('active_governed_budget_conflict');
    return { budget: { id: String(existing.id), status: 'ACTIVE' }, idempotent: true };
  }

  const resolved: Array<GovernedTerminalBudgetInput['stages'][number] & Row> = [];
  for (const stage of input.stages) {
    const row = await db
      .prepare(
        `SELECT p.id providerId,p.key providerKey,m.id modelId,m.model_key modelKey,m.capabilities_json capabilitiesJson,m.status,ps.id pricingSnapshotId,ps.currency,ps.unit_name unitName,ps.input_unit_price inputPrice,ps.output_unit_price outputPrice,ps.verification_status verificationStatus,ps.effective_from effectiveFrom,ps.effective_to effectiveTo FROM ai_providers p JOIN ai_provider_models m ON m.provider_id=p.id JOIN ai_pricing_snapshots ps ON ps.provider_model_id=m.id AND ps.effective_to IS NULL WHERE p.key=? AND m.model_key=? AND p.status='configured' AND m.status='available'`,
      )
      .bind(stage.providerKey, stage.modelKey)
      .first<Row>();
    if (!row) throw new Error(`governed_stage_model_unavailable:${stage.stageKey}`);
    const config = JSON.parse(String(row.capabilitiesJson)) as Row;
    routeModel(
      [
        {
          providerKey: String(row.providerKey),
          modelKey: String(row.modelKey),
          status: 'available',
          capabilities: config.capabilities as ModelCandidate['capabilities'],
          qualityTier: config.qualityTier as ModelCandidate['qualityTier'],
          costRank: Number(config.costRank),
        },
      ],
      {
        mode: 'LOCKED',
        preferredProviderKey: stage.providerKey,
        preferredModelKey: stage.modelKey,
        requiredCapabilities: taskPolicy(stage.stageKey).requiredCapabilities,
        minimumQualityTier: taskPolicy(stage.stageKey).minimumQualityTier,
      },
    );
    const requiredReservation = calculateGovernedReservation(row, stage.stageKey);
    if (requiredReservation > stage.monetaryCeilingMicrousd)
      throw new Error('governed_stage_ceiling_insufficient:' + stage.stageKey);
    resolved.push({ ...stage, ...row });
  }

  const budgetId = newId('project_execution_budget');
  const at = now();
  await db.batch([
    db
      .prepare(
        `INSERT INTO editorial_project_execution_budgets(id,workspace_id,project_id,profile_key,profile_version,currency,monetary_ceiling_microusd,status,authorized_by,created_at,updated_at,version) VALUES(?,?,?,?,1,'USD',?,'ACTIVE',?,?,?,1)`,
      )
      .bind(
        budgetId,
        actor.workspaceId,
        projectId,
        input.profileKey,
        input.monetaryCeilingMicrousd,
        actor.id,
        at,
        at,
      ),
    ...resolved.map((stage) =>
      db
        .prepare(
          `INSERT INTO editorial_execution_envelopes(id,workspace_id,project_id,profile_key,profile_version,provider_id,provider_model_id,currency,monetary_ceiling_microusd,maximum_calls,status,authorized_by,created_at,updated_at,version,project_execution_budget_id,stage_key) VALUES(?,?,?,?,1,?,?,'USD',?,1,'ACTIVE',?,?,?,1,?,?)`,
        )
        .bind(
          newId('execution_envelope'),
          actor.workspaceId,
          projectId,
          input.profileKey,
          stage.providerId,
          stage.modelId,
          stage.monetaryCeilingMicrousd,
          actor.id,
          at,
          at,
          budgetId,
          stage.stageKey,
        ),
    ),
  ]);
  return { budget: { id: budgetId, status: 'ACTIVE' }, idempotent: false };
}

export async function loadGovernedTerminalEnvelope(
  db: D1Database,
  actor: EditorialActor,
  projectId: string,
  stage: GovernedTerminalStage,
  selected: { providerKey: string; modelKey: string },
) {
  const envelope = await db
    .prepare(
      `SELECT e.id,e.project_execution_budget_id projectExecutionBudgetId,e.monetary_ceiling_microusd monetaryCeilingMicrousd,e.maximum_calls maximumCalls,e.status FROM editorial_execution_envelopes e JOIN editorial_project_execution_budgets b ON b.id=e.project_execution_budget_id JOIN ai_providers p ON p.id=e.provider_id JOIN ai_provider_models m ON m.id=e.provider_model_id WHERE e.workspace_id=? AND e.project_id=? AND e.stage_key=? AND e.status='ACTIVE' AND e.maximum_calls=1 AND b.status='ACTIVE' AND p.key=? AND m.model_key=?`,
    )
    .bind(actor.workspaceId, projectId, stage, selected.providerKey, selected.modelKey)
    .first<Row>();
  if (!envelope)
    throw new ProviderError('UNAVAILABLE', false, 'An active governed stage envelope is required.');
  return envelope;
}

export async function loadGovernedRemediationEnvelope(
  db: D1Database,
  actor: EditorialActor,
  projectId: string,
  stage: GovernedTerminalStage,
  selected: { providerKey: string; modelKey: string },
  remediationId: string,
) {
  let envelope = await db
    .prepare(
      `SELECT e.id,e.project_execution_budget_id projectExecutionBudgetId,e.monetary_ceiling_microusd monetaryCeilingMicrousd,e.maximum_calls maximumCalls,e.status
       FROM editorial_execution_remediations r
       JOIN editorial_project_execution_budgets b ON b.id=r.remediation_project_execution_budget_id
       JOIN editorial_execution_envelopes e ON e.id=r.remediation_envelope_id
       JOIN ai_providers p ON p.id=r.provider_id
       JOIN ai_provider_models m ON m.id=r.provider_model_id AND m.provider_id=p.id
       JOIN audit_events a ON a.id=r.audit_event_id
       JOIN editorial_project_execution_budgets ob ON ob.id=r.original_project_execution_budget_id
       JOIN editorial_execution_reservations hr ON hr.id=r.historical_reservation_id
       JOIN intelligence_runs hir ON hir.id=r.historical_run_id
       JOIN audit_events hta ON hta.id=hir.terminal_audit_event_id
       JOIN editorial_execution_envelopes he ON he.id=r.historical_envelope_id
       WHERE r.id=? AND r.workspace_id=? AND r.project_id=? AND r.stage_key=?
         AND r.profile_key='phase3_storyboard_remediation_v1' AND r.profile_version=1
         AND r.reason_category='PROVIDER_OUTPUT_SCHEMA_VALIDATION_AMBIGUOUS'
         AND r.maximum_calls=1 AND r.maximum_attempts=1 AND r.sdk_max_retries=0
         AND r.fallback_enabled=0 AND r.creative_regeneration_enabled=0
         AND r.external_research_enabled=0 AND r.human_approval_required=1
         AND b.workspace_id=r.workspace_id AND b.project_id=r.project_id
         AND b.profile_key=r.profile_key AND b.profile_version=r.profile_version
         AND b.status='ACTIVE' AND b.currency='USD'
         AND b.monetary_ceiling_microusd=r.additional_exposure_microusd
         AND e.workspace_id=r.workspace_id AND e.project_id=r.project_id
         AND e.project_execution_budget_id=b.id AND e.profile_key=r.profile_key
         AND e.profile_version=r.profile_version AND e.stage_key=r.stage_key
         AND e.provider_id=r.provider_id AND e.provider_model_id=r.provider_model_id
         AND e.status='ACTIVE' AND e.maximum_calls=1 AND e.currency='USD'
         AND e.monetary_ceiling_microusd=r.additional_exposure_microusd
         AND (SELECT COUNT(*) FROM editorial_execution_reservations er WHERE er.envelope_id=e.id)<e.maximum_calls
         AND p.key=? AND p.status='configured' AND m.model_key=? AND m.status='available'
         AND a.workspace_id=r.workspace_id
         AND a.action='editorial.remediation_capacity_authorized'
         AND a.resource_type='editorial_execution_remediation' AND a.resource_id=r.id
         AND a.outcome='success'
         AND ob.workspace_id=r.workspace_id AND ob.project_id=r.project_id
         AND ob.status='ACTIVE' AND ob.version=r.expected_original_budget_version
         AND hr.workspace_id=r.workspace_id AND hr.project_id=r.project_id
         AND hr.project_execution_budget_id=ob.id AND hr.intelligence_run_id=hir.id
         AND hr.envelope_id=he.id AND hr.status='AMBIGUOUS' AND hr.actual_microusd IS NULL
         AND hr.dispatched_at IS NOT NULL
         AND hir.workspace_id=r.workspace_id AND hir.project_id=r.project_id
         AND hir.task_type='STORYBOARD_PLANNER' AND hir.status='FAILED_PERMANENT'
         AND hir.error_category='SCHEMA_VALIDATION'
         AND hta.workspace_id=r.workspace_id AND hta.resource_type='intelligence_run'
         AND hta.resource_id=hir.id AND hta.action='intelligence.run_failed' AND hta.outcome='failure'
         AND he.workspace_id=r.workspace_id AND he.project_id=r.project_id
         AND he.project_execution_budget_id=ob.id AND he.stage_key='STORYBOARD_PLANNER'
         AND he.status='CONSUMED' AND he.maximum_calls=1
         AND (SELECT COUNT(*) FROM editorial_execution_reservations her WHERE her.envelope_id=he.id)=1`,
    )
    .bind(
      remediationId,
      actor.workspaceId,
      projectId,
      stage,
      selected.providerKey,
      selected.modelKey,
    )
    .first<Row>();
  const chainedSchema =
    !envelope &&
    (await db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='editorial_chained_execution_remediations'",
      )
      .first());
  if (chainedSchema)
    envelope = await db
      .prepare(
        "SELECT e.id,e.project_execution_budget_id projectExecutionBudgetId,e.monetary_ceiling_microusd monetaryCeilingMicrousd,e.maximum_calls maximumCalls,e.status FROM editorial_chained_execution_remediations r JOIN editorial_execution_remediations parent ON parent.id=r.parent_remediation_id JOIN editorial_project_execution_budgets b ON b.id=r.remediation_project_execution_budget_id JOIN editorial_execution_envelopes e ON e.id=r.remediation_envelope_id JOIN editorial_project_execution_budgets pb ON pb.id=parent.remediation_project_execution_budget_id JOIN editorial_execution_envelopes pe ON pe.id=parent.remediation_envelope_id JOIN editorial_execution_reservations hr ON hr.id=r.historical_reservation_id JOIN intelligence_runs hir ON hir.id=r.historical_run_id JOIN ai_providers p ON p.id=r.provider_id JOIN ai_provider_models m ON m.id=r.provider_model_id AND m.provider_id=p.id JOIN audit_events a ON a.id=r.audit_event_id WHERE r.id=? AND r.workspace_id=? AND r.project_id=? AND r.stage_key=? AND r.remediation_generation=2 AND r.profile_key='phase3_storyboard_chained_remediation_v2' AND r.profile_version=2 AND r.failure_category='SCHEMA_VALIDATION' AND r.diagnostic_category='duplicate_continuity_key' AND r.reason_category='SCHEMA_VALIDATION_DUPLICATE_CONTINUITY_KEY' AND r.maximum_calls=1 AND r.maximum_attempts=1 AND r.sdk_max_retries=0 AND r.fallback_enabled=0 AND r.creative_regeneration_enabled=0 AND r.external_research_enabled=0 AND r.human_approval_required=1 AND parent.workspace_id=r.workspace_id AND parent.project_id=r.project_id AND parent.remediation_project_execution_budget_id=pb.id AND parent.remediation_envelope_id=pe.id AND pb.status='ACTIVE' AND pe.status='CONSUMED' AND pe.maximum_calls=1 AND hr.workspace_id=r.workspace_id AND hr.project_id=r.project_id AND hr.project_execution_budget_id=pb.id AND hr.envelope_id=pe.id AND hr.intelligence_run_id=hir.id AND hr.status='RECONCILED' AND hr.actual_microusd IS NOT NULL AND hr.actual_microusd>=0 AND hr.dispatched_at IS NOT NULL AND hir.workspace_id=r.workspace_id AND hir.project_id=r.project_id AND hir.task_type='STORYBOARD_PLANNER' AND hir.status='FAILED_PERMANENT' AND hir.error_category=r.failure_category AND hir.safe_error_detail=r.diagnostic_category AND b.workspace_id=r.workspace_id AND b.project_id=r.project_id AND b.profile_key=r.profile_key AND b.profile_version=2 AND b.status='ACTIVE' AND b.currency='USD' AND b.monetary_ceiling_microusd=r.additional_exposure_microusd AND e.workspace_id=r.workspace_id AND e.project_id=r.project_id AND e.project_execution_budget_id=b.id AND e.profile_key=r.profile_key AND e.profile_version=2 AND e.stage_key=r.stage_key AND e.provider_id=r.provider_id AND e.provider_model_id=r.provider_model_id AND e.status='ACTIVE' AND e.maximum_calls=1 AND e.currency='USD' AND e.monetary_ceiling_microusd=r.additional_exposure_microusd AND (SELECT COUNT(*) FROM editorial_execution_reservations er WHERE er.envelope_id=e.id)<1 AND p.key=? AND p.status='configured' AND m.model_key=? AND m.status='available' AND a.workspace_id=r.workspace_id AND a.action='editorial.chained_remediation_capacity_authorized' AND a.resource_type='editorial_chained_execution_remediation' AND a.resource_id=r.id AND a.outcome='success'",
      )
      .bind(
        remediationId,
        actor.workspaceId,
        projectId,
        stage,
        selected.providerKey,
        selected.modelKey,
      )
      .first<Row>();
  if (!envelope)
    throw new ProviderError('PERMANENT', false, 'Remediation execution binding is invalid.');
  return envelope;
}
