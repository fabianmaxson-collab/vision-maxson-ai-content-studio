import {
  scriptCritiqueSchema,
  chainedScriptCriticCapacitySchema,
  type ChainedScriptCriticCapacityCommand,
} from '@vision-maxson/contracts';
import { hasPermission, newId } from '@vision-maxson/domain';
import {
  reserveMicrousd,
  governedTerminalStagePolicies,
} from '@vision-maxson/providers/execution-profile';
import { taskPolicy } from '@vision-maxson/providers/policy';
import { critiqueLanguageFindings, scriptCritiqueSourcePrimaryLanguage } from './critique-language';
import { SCRIPT_CRITIQUE_LANGUAGE_POLICY_VERSION } from './execution';
import type { EditorialActor } from './repository';
import {
  SCRIPT_CRITIC_CAPACITY_CEILING_MICROUSD,
  SCRIPT_CRITIC_CAPACITY_OPERATION,
  ScriptCriticCapacityError,
  type ScriptCriticCapacityResult,
} from './script-critic-capacity';

type Row = Record<string, unknown>;
type AuditContext = {
  requestId: string;
  environment: string;
  accessIssuer: string;
  accessSubject: string;
};
const PROFILE = 'phase3_terminal_graph_v1';
const PROVIDER = 'provider_openai';
const MODEL = 'model_openai_gpt_5_6_sol_20260903';
const PRICING = 'pricing_model_openai_gpt_5_6_sol_20260903';
const CEILING = SCRIPT_CRITIC_CAPACITY_CEILING_MICROUSD;
const number = (row: Row, name: string) => Number(row[name]);
const record = (value: unknown): value is Row =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const invalid = (message = 'script_critic_chained_capacity_snapshot_invalid'): never => {
  throw new ScriptCriticCapacityError(409, message);
};
async function digest(value: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return [...new Uint8Array(bytes)].map((part) => part.toString(16).padStart(2, '0')).join('');
}
function commandIdentity(
  workspaceId: string,
  projectId: string,
  command: ChainedScriptCriticCapacityCommand,
) {
  return [
    ['workspace', workspaceId],
    ['operationType', SCRIPT_CRITIC_CAPACITY_OPERATION],
    ['project', projectId],
    ['successorBudgetId', command.successorBudgetId],
    ['expectedBudgetVersion', command.expectedBudgetVersion],
    ['expectedBudgetStatus', command.expectedBudgetStatus],
    ['predecessorCapacityEnvelopeId', command.predecessorCapacityEnvelopeId],
    ['rejectedCritiqueVersionId', command.rejectedCritiqueVersionId],
    ['reason', command.reason],
  ];
}
// Reconciled reservations contribute actual cost. An ACTIVE authorization
// contributes only the part of its ceiling not already represented by a reservation.
const committed = (alias: string) =>
  "COALESCE((SELECT SUM(CASE r.status WHEN 'RECONCILED' THEN COALESCE(r.actual_microusd,r.reserved_microusd) WHEN 'CANCELLED' THEN 0 ELSE r.reserved_microusd END) FROM editorial_execution_reservations r WHERE r.project_execution_budget_id=" +
  alias +
  '.id),0)';
const activeResidual = (alias: string) =>
  "COALESCE((SELECT SUM(MAX(0,e.monetary_ceiling_microusd-COALESCE((SELECT SUM(CASE r.status WHEN 'RECONCILED' THEN COALESCE(r.actual_microusd,r.reserved_microusd) WHEN 'CANCELLED' THEN 0 ELSE r.reserved_microusd END) FROM editorial_execution_reservations r WHERE r.envelope_id=e.id),0))) FROM editorial_execution_envelopes e WHERE e.project_execution_budget_id=" +
  alias +
  ".id AND e.status='ACTIVE'),0)";
const exposure = (alias: string) => committed(alias) + '+' + activeResidual(alias);
const budgetWhere =
  "b.id=? AND b.workspace_id=? AND b.project_id=? AND b.profile_key='" +
  PROFILE +
  "' AND b.profile_version=1 AND b.currency='USD' AND b.status='ACTIVE' AND b.version=? AND b.monetary_ceiling_microusd=? " +
  'AND EXISTS(SELECT 1 FROM projects p WHERE p.id=b.project_id AND p.workspace_id=b.workspace_id AND p.deleted_at IS NULL)';
const predecessorWhere =
  'e.id=? AND e.workspace_id=? AND e.project_id=? AND e.project_execution_budget_id=? ' +
  "AND e.profile_key='" +
  PROFILE +
  "' AND e.profile_version=1 AND e.provider_id='" +
  PROVIDER +
  "' AND e.provider_model_id='" +
  MODEL +
  "' AND e.currency='USD' AND e.stage_key='SCRIPT_CRITIC' " +
  'AND e.monetary_ceiling_microusd=' +
  CEILING +
  " AND e.maximum_calls=1 AND (SELECT count(*) FROM editorial_execution_reservations rr WHERE rr.envelope_id=e.id)=1 AND e.status='CONSUMED' AND e.version=2";
const noLater =
  "NOT EXISTS(SELECT 1 FROM editorial_execution_envelopes later WHERE later.project_execution_budget_id=e.project_execution_budget_id AND later.stage_key='SCRIPT_CRITIC' AND later.id<>e.id AND later.created_at>=e.created_at)";
const critiqueWhere =
  "v.id=? AND v.workspace_id=? AND v.source_type='AI_GENERATED' AND v.language_code=? " +
  'AND v.intelligence_run_id=? ' +
  'AND a.id=v.artifact_id AND a.workspace_id=v.workspace_id AND a.project_id=? ' +
  "AND a.artifact_type='SCRIPT_CRITIQUE' AND a.status='active' AND a.current_version_id=v.id AND a.deleted_at IS NULL " +
  'AND NOT EXISTS(SELECT 1 FROM artifact_approvals ap WHERE ap.artifact_version_id=v.id) ' +
  'AND NOT EXISTS(SELECT 1 FROM editorial_artifact_versions newer WHERE newer.artifact_id=a.id AND newer.version_number>v.version_number)';
const sourceWhere =
  "s.id=? AND s.workspace_id=? AND s.language_code=? AND s.source_type='HUMAN_EDITED' AND sa.id=s.artifact_id AND sa.project_id=? " +
  "AND sa.workspace_id=s.workspace_id AND sa.artifact_type='PRODUCTION_SCRIPT' AND sa.status='approved' " +
  'AND sa.current_version_id=s.id AND sa.deleted_at IS NULL ' +
  "AND EXISTS(SELECT 1 FROM artifact_approvals ap WHERE ap.artifact_version_id=s.id AND ap.decision='APPROVED') " +
  'AND EXISTS(SELECT 1 FROM artifact_dependencies d WHERE d.source_artifact_version_id=s.id ' +
  'AND d.dependent_artifact_version_id=v.id AND d.workspace_id=v.workspace_id ' +
  "AND d.dependency_type='EVALUATES_SOURCE' AND d.validity_status='CURRENT' AND d.invalidated_at IS NULL)";
const providerWhere =
  "p.id='" +
  PROVIDER +
  "' AND p.key='openai' AND p.status='configured' " +
  "AND m.id='" +
  MODEL +
  "' AND m.provider_id=p.id AND m.model_key='gpt-5.6-sol' AND m.status='available' " +
  "AND json_extract(m.capabilities_json,'$.qualityTier')='HIGH' " +
  "AND EXISTS(SELECT 1 FROM json_each(m.capabilities_json,'$.capabilities') WHERE value='STRUCTURED_OUTPUT') " +
  "AND EXISTS(SELECT 1 FROM json_each(m.capabilities_json,'$.capabilities') WHERE value='CRITIQUE') " +
  "AND ps.id='" +
  PRICING +
  "' AND ps.provider_model_id=m.id AND ps.currency='USD' AND ps.unit_name='token' " +
  'AND ps.input_unit_price=0.000004 AND ps.output_unit_price=0.000020 ' +
  "AND ps.verification_status IN ('owner_approved','externally_verified') AND ps.effective_from<=? AND ps.effective_to IS NULL";

export class ChainedScriptCriticCapacityService {
  constructor(
    private readonly db: D1Database,
    private readonly actor: EditorialActor,
    private readonly context: AuditContext,
  ) {}

  private receiptId(projectId: string, key: string) {
    return digest({
      workspaceId: this.actor.workspaceId,
      operation: SCRIPT_CRITIC_CAPACITY_OPERATION,
      projectId,
      idempotencyKey: key,
    }).then((hash) => 'audit_' + hash);
  }

  private async replay(
    id: string,
    projectId: string,
    key: string,
    commandHash: string,
  ): Promise<ScriptCriticCapacityResult | null> {
    const row = await this.db
      .prepare(
        'SELECT a.*,e.workspace_id envelopeWorkspace,e.project_id envelopeProject,' +
          'e.project_execution_budget_id budgetId,e.stage_key stageKey,e.profile_key profileKey,' +
          'e.profile_version profileVersion,e.provider_id providerId,e.provider_model_id modelId,' +
          'e.currency envelopeCurrency,e.monetary_ceiling_microusd ceiling,e.maximum_calls maximumCalls,' +
          '(SELECT count(*) FROM editorial_execution_reservations rr WHERE rr.envelope_id=e.id) usedCalls,e.status envelopeStatus,e.version envelopeVersion,' +
          'b.workspace_id receiptBudgetWorkspace,b.project_id receiptBudgetProject,b.monetary_ceiling_microusd receiptBudgetCeiling ' +
          'FROM audit_events a LEFT JOIN editorial_execution_envelopes e ON e.id=a.resource_id ' +
          'LEFT JOIN editorial_project_execution_budgets b ON b.id=e.project_execution_budget_id ' +
          'WHERE a.id=? AND a.workspace_id=?',
      )
      .bind(id, this.actor.workspaceId)
      .first<Row>();
    if (!row) return null;
    let metadata: Row;
    try {
      const parsed: unknown = JSON.parse(String(row.metadata_json));
      if (!record(parsed)) return invalid('script_critic_chained_capacity_receipt_invalid');
      metadata = parsed;
    } catch {
      return invalid('script_critic_chained_capacity_receipt_invalid');
    }
    if (metadata.commandHash !== commandHash)
      return invalid('script_critic_capacity_idempotency_conflict');
    const parsedStored = chainedScriptCriticCapacitySchema.safeParse(metadata.command);
    if (!parsedStored.success) return invalid('script_critic_chained_capacity_receipt_invalid');
    const stored = parsedStored.data;
    const reconstructedHash = await digest(
      commandIdentity(String(metadata.workspace), String(metadata.project), stored),
    );
    const result = metadata.result;
    const envelope = record(result) && record(result.envelope) ? result.envelope : null;
    const actor = await this.db
      .prepare(
        'SELECT (SELECT count(*) FROM users u JOIN user_roles ur ON ur.workspace_id=u.workspace_id AND ur.user_id=u.id ' +
          "JOIN roles role ON role.id=ur.role_id WHERE u.id=? AND u.workspace_id=? AND u.status='active' " +
          'AND u.deleted_at IS NULL AND role.key=?) actorCount,' +
          '(SELECT count(*) FROM access_identities ai WHERE ai.user_id=? AND ai.workspace_id=? ' +
          'AND ai.issuer=? AND ai.subject=? AND ai.deleted_at IS NULL) accessCount',
      )
      .bind(
        this.actor.id,
        this.actor.workspaceId,
        row.actor_role,
        this.actor.id,
        this.actor.workspaceId,
        this.context.accessIssuer,
        this.context.accessSubject,
      )
      .first<Row>();
    if (
      reconstructedHash !== commandHash ||
      row.action !== SCRIPT_CRITIC_CAPACITY_OPERATION ||
      row.resource_type !== 'editorial_execution_envelope' ||
      row.outcome !== 'success' ||
      row.actor_id !== this.actor.id ||
      !this.actor.roles.includes(row.actor_role as EditorialActor['roles'][number]) ||
      row.access_issuer !== this.context.accessIssuer ||
      row.access_subject !== this.context.accessSubject ||
      row.environment !== this.context.environment ||
      metadata.workspace !== this.actor.workspaceId ||
      metadata.project !== projectId ||
      metadata.actor !== this.actor.id ||
      metadata.role !== row.actor_role ||
      metadata.accessIssuer !== row.access_issuer ||
      metadata.accessSubject !== row.access_subject ||
      metadata.environment !== row.environment ||
      metadata.requestId !== row.request_id ||
      metadata.idempotencyKey !== key ||
      metadata.operation !== SCRIPT_CRITIC_CAPACITY_OPERATION ||
      metadata.newEnvelopeId !== row.resource_id ||
      metadata.successorBudgetId !== stored.successorBudgetId ||
      metadata.predecessorCapacityEnvelopeId !== stored.predecessorCapacityEnvelopeId ||
      metadata.rejectedCritiqueVersionId !== stored.rejectedCritiqueVersionId ||
      metadata.reason !== stored.reason ||
      metadata.languagePolicyVersion !== SCRIPT_CRITIQUE_LANGUAGE_POLICY_VERSION ||
      !record(result) ||
      !envelope ||
      result.auditEventId !== id ||
      result.idempotentReplay !== false ||
      envelope.id !== row.resource_id ||
      envelope.projectExecutionBudgetId !== stored.successorBudgetId ||
      envelope.stageKey !== 'SCRIPT_CRITIC' ||
      envelope.status !== 'ACTIVE' ||
      number(envelope, 'version') !== 1 ||
      number(envelope, 'maximumCalls') !== 1 ||
      number(envelope, 'usedCalls') !== 0 ||
      number(envelope, 'monetaryCeilingMicroUsd') !== CEILING ||
      row.envelopeWorkspace !== this.actor.workspaceId ||
      row.envelopeProject !== projectId ||
      row.budgetId !== stored.successorBudgetId ||
      row.receiptBudgetWorkspace !== this.actor.workspaceId ||
      row.receiptBudgetProject !== projectId ||
      number(row, 'receiptBudgetCeiling') !== number(metadata, 'budgetCeilingMicroUsd') ||
      row.stageKey !== 'SCRIPT_CRITIC' ||
      row.profileKey !== PROFILE ||
      number(row, 'profileVersion') !== 1 ||
      row.providerId !== PROVIDER ||
      row.modelId !== MODEL ||
      row.envelopeCurrency !== 'USD' ||
      number(row, 'ceiling') !== CEILING ||
      number(row, 'maximumCalls') !== 1 ||
      !(
        (row.envelopeStatus === 'ACTIVE' &&
          number(row, 'envelopeVersion') === 1 &&
          number(row, 'usedCalls') === 0) ||
        (row.envelopeStatus === 'CONSUMED' &&
          number(row, 'envelopeVersion') === 2 &&
          number(row, 'usedCalls') === 1)
      ) ||
      number(actor ?? {}, 'actorCount') !== 1 ||
      number(actor ?? {}, 'accessCount') !== 1
    )
      return invalid('script_critic_chained_capacity_receipt_invalid');
    const sourceRows = await this.db
      .prepare(
        'SELECT e.id predecessorId,r.id reservationId,r.actual_microusd actualMicroUsd,' +
          'run.id runId,run.input_artifact_version_id scriptVersionId,' +
          'att.id attemptId,v.id critiqueVersionId,v.content_hash contentHash ' +
          'FROM editorial_execution_envelopes e ' +
          'JOIN editorial_execution_reservations r ON r.envelope_id=e.id ' +
          'JOIN intelligence_runs run ON run.id=r.intelligence_run_id ' +
          'JOIN intelligence_run_attempts att ON att.intelligence_run_id=run.id ' +
          'JOIN editorial_artifact_versions v ON v.id=run.output_artifact_version_id ' +
          'WHERE e.id=? AND e.workspace_id=? AND e.project_id=? AND e.project_execution_budget_id=? ' +
          "AND e.stage_key='SCRIPT_CRITIC' AND e.status='CONSUMED' AND r.status='RECONCILED' " +
          "AND r.actual_microusd IS NOT NULL AND run.status='SUCCEEDED' AND att.status='SUCCEEDED' AND v.id=?",
      )
      .bind(
        stored.predecessorCapacityEnvelopeId,
        this.actor.workspaceId,
        projectId,
        stored.successorBudgetId,
        stored.rejectedCritiqueVersionId,
      )
      .all<Row>();
    const source = sourceRows.results[0];
    if (
      sourceRows.results.length !== 1 ||
      !source ||
      source.runId !== metadata.predecessorRunId ||
      source.attemptId !== metadata.predecessorAttemptId ||
      source.reservationId !== metadata.predecessorReservationId ||
      source.critiqueVersionId !== metadata.rejectedCritiqueVersionId ||
      source.contentHash !== metadata.rejectedCritiqueContentHash ||
      source.scriptVersionId !== metadata.sourceScriptVersionId ||
      number(source, 'actualMicroUsd') !== number(metadata, 'predecessorActualMicroUsd') ||
      number(metadata, 'maximumAuthorizationMicroUsd') !== CEILING ||
      !Number.isSafeInteger(number(metadata, 'committedBeforeMicroUsd')) ||
      !Number.isSafeInteger(number(metadata, 'activeResidualBeforeMicroUsd')) ||
      !Array.isArray(metadata.languageFindings) ||
      metadata.languageFindings.length === 0 ||
      metadata.timestamp !== row.occurred_at ||
      row.ingested_at !== row.occurred_at
    )
      return invalid('script_critic_chained_capacity_receipt_invalid');
    return { ...(result as ScriptCriticCapacityResult), idempotentReplay: true };
  }

  async provision(
    projectId: string,
    key: string,
    command: ChainedScriptCriticCapacityCommand,
  ): Promise<ScriptCriticCapacityResult> {
    if (!hasPermission(this.actor.roles, 'providers:admin'))
      throw new ScriptCriticCapacityError(403, 'script_critic_capacity_forbidden');
    if (!this.context.accessIssuer || !this.context.accessSubject)
      throw new ScriptCriticCapacityError(403, 'script_critic_capacity_identity_invalid');
    const receiptId = await this.receiptId(projectId, key);
    const commandHash = await digest(commandIdentity(this.actor.workspaceId, projectId, command));
    const previous = await this.replay(receiptId, projectId, key, commandHash);
    if (previous) return previous;
    if (
      command.reason !== 'LANGUAGE_CONTRACT_FAILURE' ||
      SCRIPT_CRITIQUE_LANGUAGE_POLICY_VERSION !== 'script_critic_source_language_v2'
    )
      return invalid();

    const budget = await this.db
      .prepare(
        'SELECT b.id,b.workspace_id workspaceId,b.project_id projectId,b.status,b.version,b.currency,' +
          'b.profile_key profileKey,b.profile_version profileVersion,b.monetary_ceiling_microusd ceiling,' +
          committed('b') +
          ' committed,' +
          activeResidual('b') +
          ' activeResidual,' +
          "(SELECT count(*) FROM editorial_execution_reservations r WHERE r.project_execution_budget_id=b.id AND r.status IN ('AMBIGUOUS','RESERVED','DISPATCHED')) unresolvedCount," +
          "(SELECT count(*) FROM editorial_execution_envelopes e WHERE e.project_execution_budget_id=b.id AND e.stage_key='SCRIPT_CRITIC' AND e.status='ACTIVE') activeCriticCount " +
          'FROM editorial_project_execution_budgets b JOIN projects p ON p.id=b.project_id AND p.workspace_id=b.workspace_id ' +
          'WHERE b.id=? AND b.workspace_id=? AND b.project_id=? AND p.deleted_at IS NULL',
      )
      .bind(command.successorBudgetId, this.actor.workspaceId, projectId)
      .first<Row>();
    if (!budget)
      throw new ScriptCriticCapacityError(404, 'script_critic_capacity_source_not_found');
    if (
      budget.status !== command.expectedBudgetStatus ||
      number(budget, 'version') !== command.expectedBudgetVersion ||
      budget.currency !== 'USD' ||
      budget.profileKey !== PROFILE ||
      number(budget, 'profileVersion') !== 1 ||
      !Number.isSafeInteger(number(budget, 'ceiling')) ||
      number(budget, 'ceiling') < CEILING ||
      number(budget, 'unresolvedCount') !== 0 ||
      number(budget, 'activeCriticCount') !== 0 ||
      !Number.isSafeInteger(number(budget, 'committed')) ||
      !Number.isSafeInteger(number(budget, 'activeResidual')) ||
      number(budget, 'committed') + number(budget, 'activeResidual') + CEILING >
        number(budget, 'ceiling')
    )
      return invalid();

    const predecessor = await this.db
      .prepare(
        'SELECT e.id,e.workspace_id workspaceId,e.project_id projectId,e.project_execution_budget_id budgetId,' +
          'e.profile_key profileKey,e.profile_version profileVersion,e.provider_id providerId,' +
          'e.provider_model_id modelId,e.currency,e.stage_key stageKey,e.status,e.version,' +
          'e.monetary_ceiling_microusd ceiling,e.maximum_calls maximumCalls,' +
          '(SELECT count(*) FROM editorial_execution_reservations rr WHERE rr.envelope_id=e.id) usedCalls,' +
          'e.created_at createdAt,r.id reservationId,r.status reservationStatus,' +
          'r.reserved_microusd reserved,r.actual_microusd actual,r.pricing_snapshot_id pricingId,' +
          'r.project_execution_budget_id reservationBudgetId,r.workspace_id reservationWorkspace,' +
          'r.project_id reservationProject,run.id runId,run.status runStatus,run.task_type taskType,' +
          'run.input_artifact_version_id inputVersionId,run.output_artifact_version_id outputVersionId,' +
          'run.workspace_id runWorkspace,run.project_id runProject,run.provider_id runProvider,' +
          'run.provider_model_id runModel,att.id attemptId,att.status attemptStatus,' +
          '(SELECT count(*) FROM editorial_execution_reservations x WHERE x.envelope_id=e.id) reservationCount,' +
          '(SELECT count(*) FROM intelligence_run_attempts x WHERE x.intelligence_run_id=run.id) attemptCount,' +
          "(SELECT count(*) FROM audit_events x WHERE x.resource_id=e.id AND x.action=? AND x.resource_type='editorial_execution_envelope' AND x.outcome='success' AND json_extract(x.metadata_json,'$.newEnvelopeId')=e.id) capacityAuditCount," +
          '(SELECT count(*) FROM editorial_execution_envelopes later WHERE later.project_execution_budget_id=e.project_execution_budget_id ' +
          "AND later.stage_key='SCRIPT_CRITIC' AND later.id<>e.id AND later.created_at>=e.created_at) laterCount " +
          'FROM editorial_execution_envelopes e LEFT JOIN editorial_execution_reservations r ON r.envelope_id=e.id ' +
          'LEFT JOIN intelligence_runs run ON run.id=r.intelligence_run_id ' +
          'LEFT JOIN intelligence_run_attempts att ON att.intelligence_run_id=run.id ' +
          'WHERE e.id=?',
      )
      .bind(SCRIPT_CRITIC_CAPACITY_OPERATION, command.predecessorCapacityEnvelopeId)
      .first<Row>();
    if (!predecessor)
      throw new ScriptCriticCapacityError(404, 'script_critic_capacity_source_not_found');
    if (
      predecessor.workspaceId !== this.actor.workspaceId ||
      predecessor.projectId !== projectId ||
      predecessor.budgetId !== command.successorBudgetId ||
      predecessor.profileKey !== PROFILE ||
      number(predecessor, 'profileVersion') !== 1 ||
      predecessor.providerId !== PROVIDER ||
      predecessor.modelId !== MODEL ||
      predecessor.currency !== 'USD' ||
      predecessor.stageKey !== 'SCRIPT_CRITIC' ||
      predecessor.status !== 'CONSUMED' ||
      number(predecessor, 'version') !== 2 ||
      number(predecessor, 'ceiling') !== CEILING ||
      number(predecessor, 'maximumCalls') !== 1 ||
      number(predecessor, 'usedCalls') !== 1 ||
      number(predecessor, 'reservationCount') !== 1 ||
      number(predecessor, 'attemptCount') !== 1 ||
      number(predecessor, 'capacityAuditCount') !== 1 ||
      number(predecessor, 'laterCount') !== 0 ||
      predecessor.reservationStatus !== 'RECONCILED' ||
      !Number.isSafeInteger(number(predecessor, 'actual')) ||
      number(predecessor, 'actual') < 0 ||
      predecessor.pricingId !== PRICING ||
      predecessor.reservationBudgetId !== command.successorBudgetId ||
      predecessor.reservationWorkspace !== this.actor.workspaceId ||
      predecessor.reservationProject !== projectId ||
      predecessor.runStatus !== 'SUCCEEDED' ||
      predecessor.taskType !== 'SCRIPT_CRITIC' ||
      predecessor.runWorkspace !== this.actor.workspaceId ||
      predecessor.runProject !== projectId ||
      predecessor.runProvider !== PROVIDER ||
      predecessor.runModel !== MODEL ||
      predecessor.attemptStatus !== 'SUCCEEDED' ||
      predecessor.outputVersionId !== command.rejectedCritiqueVersionId
    )
      return invalid();

    const critique = await this.db
      .prepare(
        'SELECT v.id,v.artifact_id artifactId,v.version_number versionNumber,v.language_code languageCode,' +
          'v.source_type sourceType,v.intelligence_run_id runId,v.content_hash contentHash,' +
          'v.content_json contentJson,v.source_script_version_id sourceScriptVersionId,' +
          'a.current_version_id currentVersionId,a.status artifactStatus,a.project_id projectId,' +
          'a.workspace_id workspaceId,a.artifact_type artifactType,' +
          's.id scriptVersionId,s.language_code scriptLanguage,sa.status scriptStatus,' +
          'sa.current_version_id currentScriptVersionId,sa.project_id scriptProjectId,' +
          '(SELECT count(*) FROM artifact_approvals ap WHERE ap.artifact_version_id=v.id) approvalCount,' +
          "(SELECT count(*) FROM artifact_approvals ap WHERE ap.artifact_version_id=s.id AND ap.decision='APPROVED') scriptApprovalCount," +
          '(SELECT count(*) FROM artifact_dependencies d WHERE d.source_artifact_version_id=s.id ' +
          "AND d.dependent_artifact_version_id=v.id AND d.dependency_type='EVALUATES_SOURCE' " +
          "AND d.validity_status='CURRENT' AND d.invalidated_at IS NULL) dependencyCount," +
          '(SELECT count(*) FROM editorial_artifact_versions newer WHERE newer.artifact_id=a.id AND newer.version_number>v.version_number) newerCount ' +
          'FROM editorial_artifact_versions v JOIN editorial_artifacts a ON a.id=v.artifact_id ' +
          'JOIN editorial_artifact_versions s ON s.id=? ' +
          'JOIN editorial_artifacts sa ON sa.id=s.artifact_id ' +
          'WHERE v.id=? AND v.workspace_id=?',
      )
      .bind(predecessor.inputVersionId, command.rejectedCritiqueVersionId, this.actor.workspaceId)
      .first<Row>();
    if (!critique)
      throw new ScriptCriticCapacityError(404, 'script_critic_capacity_source_not_found');
    if (
      critique.projectId !== projectId ||
      critique.workspaceId !== this.actor.workspaceId ||
      critique.artifactType !== 'SCRIPT_CRITIQUE' ||
      critique.artifactStatus !== 'active' ||
      critique.currentVersionId !== command.rejectedCritiqueVersionId ||
      critique.sourceType !== 'AI_GENERATED' ||
      critique.languageCode !== critique.scriptLanguage ||
      critique.runId !== predecessor.runId ||
      (critique.sourceScriptVersionId !== null &&
        critique.sourceScriptVersionId !== predecessor.inputVersionId) ||
      critique.scriptVersionId !== predecessor.inputVersionId ||
      critique.scriptStatus !== 'approved' ||
      critique.currentScriptVersionId !== predecessor.inputVersionId ||
      critique.scriptProjectId !== projectId ||
      number(critique, 'approvalCount') !== 0 ||
      number(critique, 'scriptApprovalCount') < 1 ||
      number(critique, 'dependencyCount') !== 1 ||
      number(critique, 'newerCount') !== 0
    )
      return invalid();

    let languageFindings: ReturnType<typeof critiqueLanguageFindings>;
    try {
      scriptCritiqueSourcePrimaryLanguage(String(critique.scriptLanguage));
      const parsed = scriptCritiqueSchema.parse(JSON.parse(String(critique.contentJson)));
      if (
        parsed.sourceScriptVersionId !== predecessor.inputVersionId ||
        parsed.languageCode !== critique.scriptLanguage
      )
        return invalid();
      languageFindings = critiqueLanguageFindings(parsed, String(critique.scriptLanguage));
    } catch {
      return invalid();
    }
    if (!languageFindings.some((finding) => finding.reason !== 'aggregate_language_unknown'))
      return invalid();

    const provider = await this.db
      .prepare(
        'SELECT p.status providerStatus,m.status modelStatus,m.model_key modelKey,' +
          'm.capabilities_json capabilitiesJson,ps.currency pricingCurrency,ps.unit_name unitName,' +
          'ps.input_unit_price inputPrice,ps.output_unit_price outputPrice,' +
          'ps.verification_status verificationStatus,ps.effective_from effectiveFrom,ps.effective_to effectiveTo ' +
          'FROM ai_providers p JOIN ai_provider_models m ON m.provider_id=p.id ' +
          'JOIN ai_pricing_snapshots ps ON ps.provider_model_id=m.id WHERE p.id=? AND m.id=? AND ps.id=?',
      )
      .bind(PROVIDER, MODEL, PRICING)
      .first<Row>();
    if (
      !provider ||
      provider.providerStatus !== 'configured' ||
      provider.modelStatus !== 'available' ||
      provider.modelKey !== 'gpt-5.6-sol' ||
      provider.pricingCurrency !== 'USD' ||
      provider.unitName !== 'token' ||
      provider.inputPrice !== 0.000004 ||
      provider.outputPrice !== 0.00002 ||
      !['owner_approved', 'externally_verified'].includes(String(provider.verificationStatus)) ||
      String(provider.effectiveFrom) > new Date().toISOString() ||
      provider.effectiveTo !== null
    )
      return invalid();
    let capabilities: unknown;
    try {
      capabilities = JSON.parse(String(provider.capabilitiesJson));
    } catch {
      return invalid();
    }
    if (
      !record(capabilities) ||
      capabilities.qualityTier !== 'HIGH' ||
      !Array.isArray(capabilities.capabilities) ||
      !capabilities.capabilities.includes('STRUCTURED_OUTPUT') ||
      !capabilities.capabilities.includes('CRITIQUE')
    )
      return invalid();
    const stage = governedTerminalStagePolicies.SCRIPT_CRITIC;
    const task = taskPolicy('SCRIPT_CRITIC');
    const pricing = reserveMicrousd(
      {
        currency: 'USD',
        unitName: 'token',
        inputUnitPrice: 0.000004,
        outputUnitPrice: 0.00002,
        verificationStatus: String(provider.verificationStatus),
        effectiveFrom: String(provider.effectiveFrom),
        effectiveTo: null,
      },
      stage.inputTokenCeiling,
      task.maxOutputTokens,
    );
    if (
      pricing !== CEILING ||
      stage.maximumAttempts !== 1 ||
      task.minimumQualityTier !== 'HIGH' ||
      task.reasoningEffort !== 'high' ||
      !task.requiredCapabilities.includes('STRUCTURED_OUTPUT') ||
      !task.requiredCapabilities.includes('CRITIQUE')
    )
      return invalid();
    const actor = await this.db
      .prepare(
        'SELECT role.key role FROM users u JOIN user_roles ur ON ur.user_id=u.id AND ur.workspace_id=u.workspace_id ' +
          'JOIN roles role ON role.id=ur.role_id JOIN access_identities ai ON ai.user_id=u.id AND ai.workspace_id=u.workspace_id ' +
          "WHERE u.id=? AND u.workspace_id=? AND u.status='active' AND u.deleted_at IS NULL " +
          "AND role.key IN ('owner','admin') AND ai.issuer=? AND ai.subject=? AND ai.deleted_at IS NULL LIMIT 1",
      )
      .bind(
        this.actor.id,
        this.actor.workspaceId,
        this.context.accessIssuer,
        this.context.accessSubject,
      )
      .first<Row>();
    if (!actor || !this.actor.roles.includes(actor.role as EditorialActor['roles'][number]))
      throw new ScriptCriticCapacityError(403, 'script_critic_capacity_identity_invalid');

    const at = new Date().toISOString();
    const envelopeId = newId('execution_envelope');
    const result: ScriptCriticCapacityResult = {
      envelope: {
        id: envelopeId,
        projectExecutionBudgetId: command.successorBudgetId,
        stageKey: 'SCRIPT_CRITIC',
        status: 'ACTIVE',
        version: 1,
        maximumCalls: 1,
        usedCalls: 0,
        monetaryCeilingMicroUsd: CEILING,
      },
      auditEventId: receiptId,
      idempotentReplay: false,
    };
    const metadata = JSON.stringify({
      operation: SCRIPT_CRITIC_CAPACITY_OPERATION,
      command,
      commandHash,
      workspace: this.actor.workspaceId,
      project: projectId,
      successorBudgetId: command.successorBudgetId,
      predecessorCapacityEnvelopeId: command.predecessorCapacityEnvelopeId,
      predecessorRunId: predecessor.runId,
      predecessorAttemptId: predecessor.attemptId,
      predecessorReservationId: predecessor.reservationId,
      predecessorActualMicroUsd: number(predecessor, 'actual'),
      rejectedCritiqueVersionId: command.rejectedCritiqueVersionId,
      rejectedCritiqueContentHash: critique.contentHash,
      sourceScriptVersionId: predecessor.inputVersionId,
      reason: command.reason,
      languagePolicyVersion: SCRIPT_CRITIQUE_LANGUAGE_POLICY_VERSION,
      languageFindings,
      committedBeforeMicroUsd: number(budget, 'committed'),
      activeResidualBeforeMicroUsd: number(budget, 'activeResidual'),
      budgetCeilingMicroUsd: number(budget, 'ceiling'),
      maximumAuthorizationMicroUsd: CEILING,
      newEnvelopeId: envelopeId,
      actor: this.actor.id,
      role: actor.role,
      accessIssuer: this.context.accessIssuer,
      accessSubject: this.context.accessSubject,
      environment: this.context.environment,
      requestId: this.context.requestId,
      idempotencyKey: key,
      timestamp: at,
      result,
    });

    const budgetGuard =
      'SELECT CASE WHEN EXISTS(SELECT 1 FROM editorial_project_execution_budgets b WHERE ' +
      budgetWhere +
      ' AND ' +
      exposure('b') +
      '+?<=b.monetary_ceiling_microusd ' +
      'AND NOT EXISTS(SELECT 1 FROM editorial_execution_reservations r WHERE r.project_execution_budget_id=b.id ' +
      "AND r.status IN ('AMBIGUOUS','RESERVED','DISPATCHED')) " +
      'AND NOT EXISTS(SELECT 1 FROM editorial_execution_envelopes e WHERE e.project_execution_budget_id=b.id ' +
      "AND e.stage_key='SCRIPT_CRITIC' AND e.status='ACTIVE')) THEN 1 ELSE json('chained_budget_guard_failed') END";
    const predecessorGuard =
      'SELECT CASE WHEN EXISTS(SELECT 1 FROM editorial_execution_envelopes e ' +
      'JOIN editorial_execution_reservations r ON r.envelope_id=e.id ' +
      'JOIN intelligence_runs run ON run.id=r.intelligence_run_id ' +
      'JOIN intelligence_run_attempts att ON att.intelligence_run_id=run.id ' +
      'WHERE ' +
      predecessorWhere +
      ' AND ' +
      noLater +
      ' AND r.project_execution_budget_id=e.project_execution_budget_id AND r.workspace_id=e.workspace_id ' +
      "AND r.project_id=e.project_id AND r.status='RECONCILED' AND r.actual_microusd=? " +
      "AND r.pricing_snapshot_id='" +
      PRICING +
      "' AND r.id=? AND run.id=? AND run.workspace_id=e.workspace_id " +
      "AND run.project_id=e.project_id AND run.task_type='SCRIPT_CRITIC' AND run.status='SUCCEEDED' " +
      'AND run.input_artifact_version_id=? AND run.output_artifact_version_id=? ' +
      "AND run.provider_id='" +
      PROVIDER +
      "' AND run.provider_model_id='" +
      MODEL +
      "' " +
      "AND att.id=? AND att.status='SUCCEEDED' " +
      'AND (SELECT count(*) FROM editorial_execution_reservations rr WHERE rr.envelope_id=e.id)=1 ' +
      'AND (SELECT count(*) FROM intelligence_run_attempts aa WHERE aa.intelligence_run_id=run.id)=1 ' +
      "AND (SELECT count(*) FROM audit_events au WHERE au.resource_id=e.id AND au.action=? AND au.resource_type='editorial_execution_envelope' AND au.outcome='success' AND json_extract(au.metadata_json,'$.newEnvelopeId')=e.id)=1) " +
      "THEN 1 ELSE json('chained_predecessor_guard_failed') END";
    const critiqueGuard =
      'SELECT CASE WHEN EXISTS(SELECT 1 FROM editorial_artifact_versions v ' +
      'JOIN editorial_artifacts a ON a.id=v.artifact_id ' +
      'JOIN editorial_artifact_versions s ON s.id=? ' +
      'JOIN editorial_artifacts sa ON sa.id=s.artifact_id WHERE ' +
      critiqueWhere +
      ' AND ' +
      sourceWhere +
      ' AND v.content_hash=? ' +
      'AND (SELECT count(*) FROM artifact_dependencies d WHERE d.source_artifact_version_id=s.id ' +
      "AND d.dependent_artifact_version_id=v.id AND d.dependency_type='EVALUATES_SOURCE' " +
      "AND d.validity_status='CURRENT' AND d.invalidated_at IS NULL)=1) " +
      "THEN 1 ELSE json('chained_critique_guard_failed') END";
    const providerGuard =
      'SELECT CASE WHEN EXISTS(SELECT 1 FROM ai_providers p ' +
      'JOIN ai_provider_models m ON m.provider_id=p.id ' +
      'JOIN ai_pricing_snapshots ps ON ps.provider_model_id=m.id WHERE ' +
      providerWhere +
      ") THEN 1 ELSE json('chained_provider_guard_failed') END";
    const actorGuard =
      'SELECT CASE WHEN EXISTS(SELECT 1 FROM users u ' +
      'JOIN user_roles ur ON ur.user_id=u.id AND ur.workspace_id=u.workspace_id ' +
      'JOIN roles role ON role.id=ur.role_id JOIN access_identities ai ON ai.user_id=u.id ' +
      "AND ai.workspace_id=u.workspace_id WHERE u.id=? AND u.workspace_id=? AND u.status='active' " +
      'AND u.deleted_at IS NULL AND role.key=? AND ai.issuer=? AND ai.subject=? ' +
      "AND ai.deleted_at IS NULL) THEN 1 ELSE json('chained_actor_guard_failed') END";
    const insertEnvelope =
      'INSERT INTO editorial_execution_envelopes(id,workspace_id,project_id,profile_key,profile_version,' +
      'provider_id,provider_model_id,currency,monetary_ceiling_microusd,maximum_calls,status,' +
      'authorized_by,created_at,updated_at,version,project_execution_budget_id,stage_key) ' +
      "VALUES(?,?,?,'" +
      PROFILE +
      "',1,'" +
      PROVIDER +
      "','" +
      MODEL +
      "','USD'," +
      CEILING +
      ",1,'ACTIVE',?,?,?,1,?,'SCRIPT_CRITIC')";
    const insertAudit =
      'INSERT INTO audit_events(id,workspace_id,actor_type,actor_id,actor_role,access_issuer,' +
      'access_subject,action,resource_type,resource_id,outcome,request_id,environment,' +
      "metadata_json,occurred_at,ingested_at) VALUES(?,?,'user',?,?,?,?,?," +
      "'editorial_execution_envelope',?,'success',?,?,?,?,?)";
    const finalGuard =
      'SELECT CASE WHEN (SELECT count(*) FROM editorial_execution_envelopes e ' +
      'WHERE e.id=? AND e.workspace_id=? AND e.project_id=? AND e.project_execution_budget_id=? ' +
      "AND e.status='ACTIVE' AND e.stage_key='SCRIPT_CRITIC')=1 " +
      'AND (SELECT count(*) FROM audit_events a WHERE a.id=? AND a.resource_id=? ' +
      'AND a.action=? AND a.workspace_id=? AND a.metadata_json=?)=1 ' +
      'AND EXISTS(SELECT 1 FROM editorial_project_execution_budgets b WHERE ' +
      budgetWhere +
      ' AND ' +
      exposure('b') +
      '<=b.monetary_ceiling_microusd) ' +
      "THEN 1 ELSE json('chained_final_guard_failed') END";
    try {
      await this.db.batch([
        this.db
          .prepare(budgetGuard)
          .bind(
            command.successorBudgetId,
            this.actor.workspaceId,
            projectId,
            command.expectedBudgetVersion,
            number(budget, 'ceiling'),
            CEILING,
          ),
        this.db
          .prepare(predecessorGuard)
          .bind(
            command.predecessorCapacityEnvelopeId,
            this.actor.workspaceId,
            projectId,
            command.successorBudgetId,
            number(predecessor, 'actual'),
            predecessor.reservationId,
            predecessor.runId,
            predecessor.inputVersionId,
            command.rejectedCritiqueVersionId,
            predecessor.attemptId,
            SCRIPT_CRITIC_CAPACITY_OPERATION,
          ),
        this.db
          .prepare(critiqueGuard)
          .bind(
            predecessor.inputVersionId,
            command.rejectedCritiqueVersionId,
            this.actor.workspaceId,
            critique.scriptLanguage,
            predecessor.runId,
            projectId,
            predecessor.inputVersionId,
            this.actor.workspaceId,
            critique.scriptLanguage,
            projectId,
            critique.contentHash,
          ),
        this.db.prepare(providerGuard).bind(at),
        this.db
          .prepare(actorGuard)
          .bind(
            this.actor.id,
            this.actor.workspaceId,
            actor.role,
            this.context.accessIssuer,
            this.context.accessSubject,
          ),
        this.db
          .prepare(insertEnvelope)
          .bind(
            envelopeId,
            this.actor.workspaceId,
            projectId,
            this.actor.id,
            at,
            at,
            command.successorBudgetId,
          ),
        this.db
          .prepare(insertAudit)
          .bind(
            receiptId,
            this.actor.workspaceId,
            this.actor.id,
            actor.role,
            this.context.accessIssuer,
            this.context.accessSubject,
            SCRIPT_CRITIC_CAPACITY_OPERATION,
            envelopeId,
            this.context.requestId,
            this.context.environment,
            metadata,
            at,
            at,
          ),
        this.db
          .prepare(finalGuard)
          .bind(
            envelopeId,
            this.actor.workspaceId,
            projectId,
            command.successorBudgetId,
            receiptId,
            envelopeId,
            SCRIPT_CRITIC_CAPACITY_OPERATION,
            this.actor.workspaceId,
            metadata,
            command.successorBudgetId,
            this.actor.workspaceId,
            projectId,
            command.expectedBudgetVersion,
            number(budget, 'ceiling'),
          ),
      ]);
    } catch {
      const winner = await this.replay(receiptId, projectId, key, commandHash);
      if (winner) return winner;
      return invalid('script_critic_chained_capacity_conflict');
    }
    return result;
  }
}
