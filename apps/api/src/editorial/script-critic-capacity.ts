import type { ScriptCriticCapacityCommand } from '@vision-maxson/contracts';
import { hasPermission, newId } from '@vision-maxson/domain';
import {
  governedTerminalStagePolicies,
  reserveMicrousd,
} from '@vision-maxson/providers/execution-profile';
import { taskPolicy } from '@vision-maxson/providers/policy';
import type { EditorialActor } from './repository';

type Row = Record<string, unknown>;
type AuditContext = {
  requestId: string;
  environment: string;
  accessIssuer: string;
  accessSubject: string;
};

export const SCRIPT_CRITIC_CAPACITY_OPERATION =
  'editorial.script_critic_capacity_provisioned' as const;
export const SCRIPT_CRITIC_CAPACITY_CEILING_MICROUSD = 403_840;
const RESOURCE_TYPE = 'editorial_execution_envelope';
const PROFILE_KEY = 'phase3_terminal_graph_v1';
const STAGE_KEY = 'SCRIPT_CRITIC';
const PROVIDER_ID = 'provider_openai';
const PROVIDER_KEY = 'openai';
const MODEL_ID = 'model_openai_gpt_5_6_sol_20260903';
const MODEL_KEY = 'gpt-5.6-sol';
const PRICING_ID = 'pricing_model_openai_gpt_5_6_sol_20260903';
const SUCCESSOR_CEILING_MICROUSD = 907_875;

export type ScriptCriticCapacityPolicy = {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly successorBudgetId: string;
  readonly historicalEnvelopeId: string;
};

const DEFAULT_POLICY: ScriptCriticCapacityPolicy = Object.freeze({
  workspaceId: 'workspace_primary',
  projectId: 'project_2135b883-8499-48e9-a4a7-bb04b970d72a',
  successorBudgetId: 'project_execution_budget_e00c938b-5621-4ce4-ae74-eea07d9b5529',
  historicalEnvelopeId: 'execution_envelope_cf4d27f4-2296-4b0d-9ba7-7893bd21dc38',
});

export type ScriptCriticCapacityResult = {
  envelope: {
    id: string;
    projectExecutionBudgetId: string;
    stageKey: typeof STAGE_KEY;
    status: 'ACTIVE';
    version: 1;
    maximumCalls: 1;
    usedCalls: 0;
    monetaryCeilingMicroUsd: number;
  };
  auditEventId: string;
  idempotentReplay: boolean;
};

export class ScriptCriticCapacityError extends Error {
  constructor(
    readonly status: 403 | 404 | 409 | 422,
    message: string,
  ) {
    super(message);
  }
}

const integer = (row: Row, key: string) => Number(row[key]);
const isRecord = (value: unknown): value is Row =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

async function digest(value: unknown) {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return [...new Uint8Array(bytes)].map((part) => part.toString(16).padStart(2, '0')).join('');
}

function canonicalCommandHash(
  workspaceId: string,
  projectId: string,
  command: ScriptCriticCapacityCommand,
) {
  return digest([
    ['workspace', workspaceId],
    ['operationType', SCRIPT_CRITIC_CAPACITY_OPERATION],
    ['project', projectId],
    ['successorBudgetId', command.successorBudgetId],
    ['expectedBudgetVersion', command.expectedBudgetVersion],
    ['expectedBudgetStatus', command.expectedBudgetStatus],
    ['consumedHistoricalEnvelopeId', command.consumedHistoricalEnvelopeId],
    ['reason', command.reason],
  ]);
}

async function deterministicReceiptId(workspaceId: string, projectId: string, key: string) {
  return `audit_${await digest({
    workspaceId,
    operation: SCRIPT_CRITIC_CAPACITY_OPERATION,
    projectId,
    idempotencyKey: key,
  })}`;
}

const committedSql = (budgetAlias: string) =>
  `COALESCE((SELECT sum(CASE r.status
    WHEN 'RECONCILED' THEN COALESCE(r.actual_microusd,r.reserved_microusd)
    WHEN 'CANCELLED' THEN 0
    ELSE r.reserved_microusd END)
    FROM editorial_execution_reservations r
    WHERE r.project_execution_budget_id=${budgetAlias}.id),0)`;

function snapshotSql() {
  return `SELECT b.id,b.workspace_id workspaceId,b.project_id projectId,
 b.profile_key profileKey,b.profile_version profileVersion,b.currency,b.status,b.version,
 b.monetary_ceiling_microusd ceiling,
 b.monetary_ceiling_microusd-${committedSql('b')} available,
 (SELECT count(*) FROM editorial_execution_reservations r WHERE r.project_execution_budget_id=b.id) reservationCount,
 (SELECT count(*) FROM editorial_execution_reservations r WHERE r.project_execution_budget_id=b.id AND r.status='AMBIGUOUS') ambiguousCount,
 (SELECT count(*) FROM editorial_execution_envelopes e WHERE e.project_execution_budget_id=b.id) envelopeCount,
 (SELECT count(*) FROM editorial_execution_envelopes e WHERE e.project_execution_budget_id=b.id AND e.stage_key='SCRIPT_CRITIC' AND e.status='ACTIVE') activeCriticCount,
 h.id historicalEnvelopeId,h.project_execution_budget_id historicalBudgetId,
 h.workspace_id historicalWorkspaceId,h.project_id historicalProjectId,
 h.profile_key historicalProfileKey,h.profile_version historicalProfileVersion,
 h.provider_id historicalProviderId,h.provider_model_id historicalModelId,
 h.currency historicalCurrency,h.monetary_ceiling_microusd historicalCeiling,
 h.maximum_calls historicalMaximumCalls,h.status historicalStatus,h.version historicalVersion,
 hb.status historicalBudgetStatus,hb.version historicalBudgetVersion,
 p.key providerKey,p.status providerStatus,
 m.model_key modelKey,m.status modelStatus,m.capabilities_json capabilitiesJson,
 ps.id pricingId,ps.currency pricingCurrency,ps.input_unit_price inputUnitPrice,
 ps.output_unit_price outputUnitPrice,ps.unit_name unitName,
 ps.verification_status verificationStatus,ps.effective_from effectiveFrom,ps.effective_to effectiveTo,
 (SELECT ro.key FROM users u
   JOIN user_roles ur ON ur.workspace_id=u.workspace_id AND ur.user_id=u.id
   JOIN roles ro ON ro.id=ur.role_id
   WHERE u.id=? AND u.workspace_id=b.workspace_id AND u.status='active' AND u.deleted_at IS NULL
     AND ro.key IN ('owner','admin') LIMIT 1) actorRole,
 (SELECT count(*) FROM access_identities ai
   WHERE ai.user_id=? AND ai.workspace_id=b.workspace_id AND ai.issuer=? AND ai.subject=?
     AND ai.deleted_at IS NULL) accessIdentityCount
 FROM editorial_project_execution_budgets b
 JOIN projects project ON project.id=b.project_id AND project.workspace_id=b.workspace_id
   AND project.deleted_at IS NULL
 LEFT JOIN editorial_execution_envelopes h ON h.id=?
 LEFT JOIN editorial_project_execution_budgets hb ON hb.id=h.project_execution_budget_id
 JOIN ai_providers p ON p.id='${PROVIDER_ID}'
 JOIN ai_provider_models m ON m.id='${MODEL_ID}' AND m.provider_id=p.id
 JOIN ai_pricing_snapshots ps ON ps.id='${PRICING_ID}' AND ps.provider_model_id=m.id
 WHERE b.id=? AND b.workspace_id=? AND b.project_id=?`;
}

function capabilitiesValid(value: unknown) {
  if (typeof value !== 'string') return false;
  try {
    const parsed = JSON.parse(value) as unknown;
    return (
      isRecord(parsed) &&
      parsed.qualityTier === 'HIGH' &&
      Array.isArray(parsed.capabilities) &&
      parsed.capabilities.includes('STRUCTURED_OUTPUT') &&
      parsed.capabilities.includes('CRITIQUE')
    );
  } catch {
    return false;
  }
}

function policyValid() {
  const governed = governedTerminalStagePolicies.SCRIPT_CRITIC;
  const task = taskPolicy('SCRIPT_CRITIC');
  return (
    governed.maximumAttempts === 1 &&
    governed.inputTokenCeiling === 32_768 &&
    task.requiredCapabilities.length === 2 &&
    task.requiredCapabilities.includes('STRUCTURED_OUTPUT') &&
    task.requiredCapabilities.includes('CRITIQUE') &&
    task.minimumQualityTier === 'HIGH' &&
    task.reasoningEffort === 'high' &&
    task.maxOutputTokens === 12_000
  );
}

function pricingCeiling(row: Row) {
  return reserveMicrousd(
    {
      currency: typeof row.pricingCurrency === 'string' ? row.pricingCurrency : null,
      unitName: typeof row.unitName === 'string' ? row.unitName : null,
      inputUnitPrice: typeof row.inputUnitPrice === 'number' ? row.inputUnitPrice : null,
      outputUnitPrice: typeof row.outputUnitPrice === 'number' ? row.outputUnitPrice : null,
      verificationStatus: typeof row.verificationStatus === 'string' ? row.verificationStatus : '',
      effectiveFrom: typeof row.effectiveFrom === 'string' ? row.effectiveFrom : '',
      effectiveTo: typeof row.effectiveTo === 'string' ? row.effectiveTo : null,
    },
    governedTerminalStagePolicies.SCRIPT_CRITIC.inputTokenCeiling,
    taskPolicy('SCRIPT_CRITIC').maxOutputTokens,
  );
}

function snapshotValid(
  row: Row | null,
  actor: EditorialActor,
  projectId: string,
  command: ScriptCriticCapacityCommand,
  policy: ScriptCriticCapacityPolicy,
) {
  if (!row || !policyValid()) return false;
  const calculatedCeiling = (() => {
    try {
      return pricingCeiling(row);
    } catch {
      return null;
    }
  })();
  if (calculatedCeiling === null) return false;
  return (
    actor.workspaceId === policy.workspaceId &&
    projectId === policy.projectId &&
    command.successorBudgetId === policy.successorBudgetId &&
    command.consumedHistoricalEnvelopeId === policy.historicalEnvelopeId &&
    row.workspaceId === actor.workspaceId &&
    row.projectId === projectId &&
    row.profileKey === PROFILE_KEY &&
    integer(row, 'profileVersion') === 1 &&
    row.currency === 'USD' &&
    row.status === command.expectedBudgetStatus &&
    integer(row, 'version') === command.expectedBudgetVersion &&
    integer(row, 'ceiling') === SUCCESSOR_CEILING_MICROUSD &&
    integer(row, 'available') >= SCRIPT_CRITIC_CAPACITY_CEILING_MICROUSD &&
    integer(row, 'reservationCount') === 0 &&
    integer(row, 'ambiguousCount') === 0 &&
    integer(row, 'envelopeCount') === 0 &&
    integer(row, 'activeCriticCount') === 0 &&
    row.historicalEnvelopeId === command.consumedHistoricalEnvelopeId &&
    row.historicalWorkspaceId === actor.workspaceId &&
    row.historicalProjectId === projectId &&
    row.historicalBudgetId !== command.successorBudgetId &&
    row.historicalProfileKey === PROFILE_KEY &&
    integer(row, 'historicalProfileVersion') === 1 &&
    row.historicalProviderId === PROVIDER_ID &&
    row.historicalModelId === MODEL_ID &&
    row.historicalCurrency === 'USD' &&
    integer(row, 'historicalCeiling') === SCRIPT_CRITIC_CAPACITY_CEILING_MICROUSD &&
    integer(row, 'historicalMaximumCalls') === 1 &&
    row.historicalStatus === 'CONSUMED' &&
    integer(row, 'historicalVersion') === 2 &&
    row.historicalBudgetStatus === 'CONSUMED' &&
    integer(row, 'historicalBudgetVersion') === 2 &&
    row.providerKey === PROVIDER_KEY &&
    row.providerStatus === 'configured' &&
    row.modelKey === MODEL_KEY &&
    row.modelStatus === 'available' &&
    capabilitiesValid(row.capabilitiesJson) &&
    row.pricingId === PRICING_ID &&
    row.pricingCurrency === 'USD' &&
    row.unitName === 'token' &&
    calculatedCeiling === SCRIPT_CRITIC_CAPACITY_CEILING_MICROUSD &&
    typeof row.actorRole === 'string' &&
    actor.roles.includes(row.actorRole as EditorialActor['roles'][number]) &&
    integer(row, 'accessIdentityCount') === 1
  );
}

function guardSql(expectedEnvelopeCount: 0 | 1) {
  return `b.profile_key='${PROFILE_KEY}' AND b.profile_version=1
 AND b.currency='USD' AND b.status='ACTIVE' AND b.version=1
 AND b.monetary_ceiling_microusd=${SUCCESSOR_CEILING_MICROUSD}
 AND b.monetary_ceiling_microusd-${committedSql('b')}>=${SCRIPT_CRITIC_CAPACITY_CEILING_MICROUSD}
 AND (SELECT count(*) FROM editorial_execution_reservations r WHERE r.project_execution_budget_id=b.id)=0
 AND (SELECT count(*) FROM editorial_execution_reservations r WHERE r.project_execution_budget_id=b.id AND r.status='AMBIGUOUS')=0
 AND (SELECT count(*) FROM editorial_execution_envelopes x WHERE x.project_execution_budget_id=b.id)=${expectedEnvelopeCount}
 AND (SELECT count(*) FROM editorial_execution_envelopes x WHERE x.project_execution_budget_id=b.id AND x.stage_key='SCRIPT_CRITIC' AND x.status='ACTIVE')=${expectedEnvelopeCount}
 AND EXISTS(SELECT 1 FROM projects project WHERE project.id=b.project_id AND project.workspace_id=b.workspace_id AND project.deleted_at IS NULL)
 AND EXISTS(SELECT 1 FROM users u JOIN user_roles ur ON ur.workspace_id=u.workspace_id AND ur.user_id=u.id JOIN roles ro ON ro.id=ur.role_id
   WHERE u.id=? AND u.workspace_id=b.workspace_id AND u.status='active' AND u.deleted_at IS NULL AND ro.key IN ('owner','admin'))
 AND EXISTS(SELECT 1 FROM access_identities ai WHERE ai.user_id=? AND ai.workspace_id=b.workspace_id AND ai.issuer=? AND ai.subject=? AND ai.deleted_at IS NULL)
 AND EXISTS(SELECT 1 FROM editorial_execution_envelopes h
   JOIN editorial_project_execution_budgets hb ON hb.id=h.project_execution_budget_id
   WHERE h.id=? AND h.workspace_id=b.workspace_id AND h.project_id=b.project_id
     AND h.project_execution_budget_id<>b.id AND h.profile_key='${PROFILE_KEY}' AND h.profile_version=1
     AND h.provider_id='${PROVIDER_ID}' AND h.provider_model_id='${MODEL_ID}' AND h.currency='USD'
     AND h.monetary_ceiling_microusd=${SCRIPT_CRITIC_CAPACITY_CEILING_MICROUSD}
     AND h.maximum_calls=1 AND h.stage_key='SCRIPT_CRITIC' AND h.status='CONSUMED' AND h.version=2
     AND hb.workspace_id=b.workspace_id AND hb.project_id=b.project_id AND hb.status='CONSUMED' AND hb.version=2)
 AND EXISTS(SELECT 1 FROM ai_providers p JOIN ai_provider_models m ON m.provider_id=p.id
   JOIN ai_pricing_snapshots ps ON ps.provider_model_id=m.id
   WHERE p.id='${PROVIDER_ID}' AND p.key='${PROVIDER_KEY}' AND p.status='configured'
     AND m.id='${MODEL_ID}' AND m.model_key='${MODEL_KEY}' AND m.status='available'
     AND json_extract(m.capabilities_json,'$.qualityTier')='HIGH'
     AND EXISTS(SELECT 1 FROM json_each(m.capabilities_json,'$.capabilities') WHERE value='STRUCTURED_OUTPUT')
     AND EXISTS(SELECT 1 FROM json_each(m.capabilities_json,'$.capabilities') WHERE value='CRITIQUE')
     AND ps.id='${PRICING_ID}' AND ps.currency='USD' AND ps.unit_name='token'
     AND ps.input_unit_price=0.000004 AND ps.output_unit_price=0.000020
     AND ps.verification_status IN ('owner_approved','externally_verified')
     AND ps.effective_from<=? AND ps.effective_to IS NULL)`;
}

export class ScriptCriticCapacityService {
  constructor(
    private readonly db: D1Database,
    private readonly actor: EditorialActor,
    private readonly context: AuditContext,
    private readonly policy: ScriptCriticCapacityPolicy = DEFAULT_POLICY,
  ) {}

  private snapshot(projectId: string, command: ScriptCriticCapacityCommand) {
    return this.db
      .prepare(snapshotSql())
      .bind(
        this.actor.id,
        this.actor.id,
        this.context.accessIssuer,
        this.context.accessSubject,
        command.consumedHistoricalEnvelopeId,
        command.successorBudgetId,
        this.actor.workspaceId,
        projectId,
      )
      .first<Row>();
  }

  private async replay(
    auditEventId: string,
    projectId: string,
    key: string,
    expectedCommandHash: string,
  ): Promise<ScriptCriticCapacityResult | null> {
    const row = await this.db
      .prepare(
        `SELECT a.action,a.resource_type resourceType,a.resource_id resourceId,a.outcome,
          a.actor_id actorId,a.actor_role actorRole,a.access_issuer accessIssuer,
          a.access_subject accessSubject,a.request_id requestId,a.environment,
          a.metadata_json metadataJson,
          e.id envelopeId,e.workspace_id envelopeWorkspace,e.project_id envelopeProject,
          e.project_execution_budget_id budgetId,e.profile_key profileKey,e.profile_version profileVersion,
          e.provider_id providerId,e.provider_model_id modelId,e.currency,e.monetary_ceiling_microusd ceiling,
          e.maximum_calls maximumCalls,e.status envelopeStatus,e.version envelopeVersion,
          b.status budgetStatus,b.version budgetVersion,b.monetary_ceiling_microusd budgetCeiling,
          h.project_execution_budget_id historicalBudgetId,
          h.workspace_id historicalWorkspace,h.project_id historicalProject,
          h.profile_key historicalProfileKey,h.profile_version historicalProfileVersion,
          h.provider_id historicalProviderId,h.provider_model_id historicalModelId,
          h.currency historicalCurrency,h.monetary_ceiling_microusd historicalCeiling,
          h.maximum_calls historicalMaximumCalls,h.stage_key historicalStage,
          h.status historicalStatus,h.version historicalVersion,
          hb.status historicalBudgetStatus,hb.version historicalBudgetVersion,
          p.key providerKey,p.status providerStatus,
          m.model_key modelKey,m.status modelStatus,m.capabilities_json capabilitiesJson,
          ps.currency pricingCurrency,ps.input_unit_price inputUnitPrice,ps.output_unit_price outputUnitPrice,
          ps.unit_name unitName,ps.verification_status verificationStatus,ps.effective_from effectiveFrom,ps.effective_to effectiveTo,
          (SELECT count(*) FROM editorial_execution_reservations r WHERE r.project_execution_budget_id=b.id) reservationCount,
          (SELECT count(*) FROM editorial_execution_envelopes x WHERE x.project_execution_budget_id=b.id) envelopeCount,
          (SELECT count(*) FROM editorial_execution_envelopes x WHERE x.project_execution_budget_id=b.id AND x.stage_key='SCRIPT_CRITIC' AND x.status='ACTIVE') activeCriticCount,
          (SELECT count(*) FROM audit_events x WHERE x.id=a.id AND x.action=a.action) receiptCount,
          (SELECT ro.key FROM users u
            JOIN user_roles ur ON ur.workspace_id=u.workspace_id AND ur.user_id=u.id
            JOIN roles ro ON ro.id=ur.role_id
            WHERE u.id=a.actor_id AND u.workspace_id=a.workspace_id AND u.status='active'
              AND u.deleted_at IS NULL AND ro.key=a.actor_role LIMIT 1) liveActorRole,
          (SELECT count(*) FROM access_identities ai
            WHERE ai.user_id=a.actor_id AND ai.workspace_id=a.workspace_id
              AND ai.issuer=a.access_issuer AND ai.subject=a.access_subject
              AND ai.deleted_at IS NULL) liveAccessIdentityCount,
          (SELECT count(*) FROM projects project
            WHERE project.id=e.project_id AND project.workspace_id=e.workspace_id
              AND project.deleted_at IS NULL) liveProjectCount
        FROM audit_events a
        LEFT JOIN editorial_execution_envelopes e ON e.id=a.resource_id
        LEFT JOIN editorial_project_execution_budgets b ON b.id=e.project_execution_budget_id
        LEFT JOIN editorial_execution_envelopes h ON h.id=?
        LEFT JOIN editorial_project_execution_budgets hb ON hb.id=h.project_execution_budget_id
        LEFT JOIN ai_providers p ON p.id=e.provider_id
        LEFT JOIN ai_provider_models m ON m.id=e.provider_model_id
        LEFT JOIN ai_pricing_snapshots ps ON ps.id='${PRICING_ID}' AND ps.provider_model_id=m.id
        WHERE a.id=? AND a.workspace_id=?`,
      )
      .bind(this.policy.historicalEnvelopeId, auditEventId, this.actor.workspaceId)
      .first<Row>();
    if (!row) return null;
    if (typeof row.metadataJson !== 'string')
      throw new ScriptCriticCapacityError(409, 'script_critic_capacity_receipt_invalid');
    let metadata: Row;
    try {
      const parsed: unknown = JSON.parse(row.metadataJson);
      if (!isRecord(parsed)) throw new Error('invalid');
      metadata = parsed;
    } catch {
      throw new ScriptCriticCapacityError(409, 'script_critic_capacity_receipt_invalid');
    }
    const storedCommand: ScriptCriticCapacityCommand = {
      successorBudgetId: String(metadata.successorBudgetId),
      expectedBudgetVersion: 1,
      expectedBudgetStatus: 'ACTIVE',
      consumedHistoricalEnvelopeId: String(metadata.historicalEnvelopeId),
      reason: 'REPLACEMENT_SCRIPT_CRITIC_CAPACITY',
    };
    const storedHash = await canonicalCommandHash(
      String(metadata.workspace),
      String(metadata.project),
      storedCommand,
    );
    const result = metadata.result;
    const resultRecord = isRecord(result) ? result : null;
    const resultEnvelope =
      resultRecord && isRecord(resultRecord.envelope) ? resultRecord.envelope : null;
    if (metadata.commandHash !== expectedCommandHash)
      throw new ScriptCriticCapacityError(409, 'script_critic_capacity_idempotency_conflict');
    let replayCeiling = -1;
    try {
      replayCeiling = pricingCeiling(row);
    } catch {
      // Invalid pricing is rejected by the common receipt branch.
    }
    if (
      row.action !== SCRIPT_CRITIC_CAPACITY_OPERATION ||
      row.resourceType !== RESOURCE_TYPE ||
      row.outcome !== 'success' ||
      row.actorId !== this.actor.id ||
      !this.actor.roles.includes(row.actorRole as EditorialActor['roles'][number]) ||
      row.liveActorRole !== row.actorRole ||
      integer(row, 'liveAccessIdentityCount') !== 1 ||
      integer(row, 'liveProjectCount') !== 1 ||
      row.accessIssuer !== this.context.accessIssuer ||
      row.accessSubject !== this.context.accessSubject ||
      row.environment !== this.context.environment ||
      metadata.operation !== SCRIPT_CRITIC_CAPACITY_OPERATION ||
      metadata.idempotencyKey !== key ||
      metadata.commandHash !== storedHash ||
      metadata.workspace !== this.actor.workspaceId ||
      metadata.project !== projectId ||
      metadata.actor !== this.actor.id ||
      metadata.role !== row.actorRole ||
      metadata.accessIssuer !== this.context.accessIssuer ||
      metadata.accessSubject !== this.context.accessSubject ||
      metadata.environment !== this.context.environment ||
      metadata.requestId !== row.requestId ||
      metadata.successorBudgetId !== this.policy.successorBudgetId ||
      metadata.historicalEnvelopeId !== this.policy.historicalEnvelopeId ||
      metadata.pricingSnapshotId !== PRICING_ID ||
      metadata.reasoningEffort !== 'high' ||
      integer(metadata, 'maximumAttempts') !== 1 ||
      metadata.fallbackAllowed !== false ||
      metadata.creativeRegeneration !== false ||
      !resultRecord ||
      !resultEnvelope ||
      resultRecord.auditEventId !== auditEventId ||
      resultRecord.idempotentReplay !== false ||
      resultEnvelope.id !== row.resourceId ||
      resultEnvelope.projectExecutionBudgetId !== this.policy.successorBudgetId ||
      resultEnvelope.stageKey !== STAGE_KEY ||
      resultEnvelope.status !== 'ACTIVE' ||
      integer(resultEnvelope, 'version') !== 1 ||
      integer(resultEnvelope, 'maximumCalls') !== 1 ||
      integer(resultEnvelope, 'usedCalls') !== 0 ||
      integer(resultEnvelope, 'monetaryCeilingMicroUsd') !==
        SCRIPT_CRITIC_CAPACITY_CEILING_MICROUSD ||
      row.envelopeId !== row.resourceId ||
      row.envelopeWorkspace !== this.actor.workspaceId ||
      row.envelopeProject !== projectId ||
      row.budgetId !== this.policy.successorBudgetId ||
      row.profileKey !== PROFILE_KEY ||
      integer(row, 'profileVersion') !== 1 ||
      row.providerId !== PROVIDER_ID ||
      row.modelId !== MODEL_ID ||
      row.currency !== 'USD' ||
      integer(row, 'ceiling') !== SCRIPT_CRITIC_CAPACITY_CEILING_MICROUSD ||
      integer(row, 'maximumCalls') !== 1 ||
      row.envelopeStatus !== 'ACTIVE' ||
      integer(row, 'envelopeVersion') !== 1 ||
      row.budgetStatus !== 'ACTIVE' ||
      integer(row, 'budgetVersion') !== 1 ||
      integer(row, 'budgetCeiling') !== SUCCESSOR_CEILING_MICROUSD ||
      row.historicalBudgetId === this.policy.successorBudgetId ||
      row.historicalWorkspace !== this.actor.workspaceId ||
      row.historicalProject !== projectId ||
      row.historicalProfileKey !== PROFILE_KEY ||
      integer(row, 'historicalProfileVersion') !== 1 ||
      row.historicalProviderId !== PROVIDER_ID ||
      row.historicalModelId !== MODEL_ID ||
      row.historicalCurrency !== 'USD' ||
      integer(row, 'historicalCeiling') !== SCRIPT_CRITIC_CAPACITY_CEILING_MICROUSD ||
      integer(row, 'historicalMaximumCalls') !== 1 ||
      row.historicalStage !== STAGE_KEY ||
      row.historicalStatus !== 'CONSUMED' ||
      integer(row, 'historicalVersion') !== 2 ||
      row.historicalBudgetStatus !== 'CONSUMED' ||
      integer(row, 'historicalBudgetVersion') !== 2 ||
      row.providerKey !== PROVIDER_KEY ||
      row.providerStatus !== 'configured' ||
      row.modelKey !== MODEL_KEY ||
      row.modelStatus !== 'available' ||
      !capabilitiesValid(row.capabilitiesJson) ||
      replayCeiling !== SCRIPT_CRITIC_CAPACITY_CEILING_MICROUSD ||
      !policyValid() ||
      integer(row, 'reservationCount') !== 0 ||
      integer(row, 'envelopeCount') !== 1 ||
      integer(row, 'activeCriticCount') !== 1 ||
      integer(row, 'receiptCount') !== 1
    )
      throw new ScriptCriticCapacityError(409, 'script_critic_capacity_receipt_invalid');
    return { ...(result as ScriptCriticCapacityResult), idempotentReplay: true };
  }

  async provision(
    projectId: string,
    key: string,
    command: ScriptCriticCapacityCommand,
  ): Promise<ScriptCriticCapacityResult> {
    if (!hasPermission(this.actor.roles, 'providers:admin'))
      throw new ScriptCriticCapacityError(403, 'script_critic_capacity_forbidden');
    if (!this.context.accessIssuer || !this.context.accessSubject)
      throw new ScriptCriticCapacityError(403, 'script_critic_capacity_identity_invalid');

    const auditEventId = await deterministicReceiptId(this.actor.workspaceId, projectId, key);
    const expectedCommandHash = await canonicalCommandHash(
      this.actor.workspaceId,
      projectId,
      command,
    );
    const prior = await this.replay(auditEventId, projectId, key, expectedCommandHash);
    if (prior) return prior;

    if (
      this.actor.workspaceId !== this.policy.workspaceId ||
      projectId !== this.policy.projectId ||
      command.successorBudgetId !== this.policy.successorBudgetId ||
      command.consumedHistoricalEnvelopeId !== this.policy.historicalEnvelopeId
    )
      throw new ScriptCriticCapacityError(404, 'script_critic_capacity_source_not_found');
    const before = await this.snapshot(projectId, command);
    if (!before)
      throw new ScriptCriticCapacityError(404, 'script_critic_capacity_source_not_found');
    if (!snapshotValid(before, this.actor, projectId, command, this.policy))
      throw new ScriptCriticCapacityError(409, 'script_critic_capacity_snapshot_invalid');

    const envelopeId = newId('execution_envelope');
    const at = new Date().toISOString();
    const actorRole = String(before.actorRole);
    const result: ScriptCriticCapacityResult = {
      envelope: {
        id: envelopeId,
        projectExecutionBudgetId: command.successorBudgetId,
        stageKey: STAGE_KEY,
        status: 'ACTIVE',
        version: 1,
        maximumCalls: 1,
        usedCalls: 0,
        monetaryCeilingMicroUsd: SCRIPT_CRITIC_CAPACITY_CEILING_MICROUSD,
      },
      auditEventId,
      idempotentReplay: false,
    };
    const metadata = JSON.stringify({
      operation: SCRIPT_CRITIC_CAPACITY_OPERATION,
      workspace: this.actor.workspaceId,
      project: projectId,
      successorBudgetId: command.successorBudgetId,
      successorBudgetVersion: command.expectedBudgetVersion,
      successorBudgetStatus: command.expectedBudgetStatus,
      successorBudgetCeilingMicroUsd: SUCCESSOR_CEILING_MICROUSD,
      availableBudgetBeforeMicroUsd: integer(before, 'available'),
      historicalEnvelopeId: command.consumedHistoricalEnvelopeId,
      historicalEnvelopeVersion: 2,
      historicalEnvelopeStatus: 'CONSUMED',
      newEnvelopeId: envelopeId,
      stageKey: STAGE_KEY,
      profileKey: PROFILE_KEY,
      profileVersion: 1,
      providerId: PROVIDER_ID,
      providerKey: PROVIDER_KEY,
      modelId: MODEL_ID,
      modelKey: MODEL_KEY,
      pricingSnapshotId: PRICING_ID,
      reasoningEffort: taskPolicy('SCRIPT_CRITIC').reasoningEffort,
      maximumCalls: 1,
      maximumAttempts: governedTerminalStagePolicies.SCRIPT_CRITIC.maximumAttempts,
      gatewayAttempts: 1,
      sdkMaxRetries: 0,
      requestRetries: 0,
      fallbackAllowed: false,
      creativeRegeneration: false,
      monetaryCeilingMicroUsd: SCRIPT_CRITIC_CAPACITY_CEILING_MICROUSD,
      currency: 'USD',
      reason: command.reason,
      actor: this.actor.id,
      role: actorRole,
      accessIssuer: this.context.accessIssuer,
      accessSubject: this.context.accessSubject,
      environment: this.context.environment,
      requestId: this.context.requestId,
      idempotencyKey: key,
      commandHash: expectedCommandHash,
      timestamp: at,
      result,
    });

    const insertEnvelopeSql = `INSERT INTO editorial_execution_envelopes(
      id,workspace_id,project_id,profile_key,profile_version,provider_id,provider_model_id,currency,
      monetary_ceiling_microusd,maximum_calls,status,authorized_by,created_at,updated_at,version,
      project_execution_budget_id,stage_key)
      SELECT ?,b.workspace_id,b.project_id,'${PROFILE_KEY}',1,'${PROVIDER_ID}','${MODEL_ID}','USD',
        ${SCRIPT_CRITIC_CAPACITY_CEILING_MICROUSD},1,'ACTIVE',?,?,?,1,b.id,'SCRIPT_CRITIC'
      FROM editorial_project_execution_budgets b
      WHERE b.id=? AND b.workspace_id=? AND b.project_id=? AND ${guardSql(0)}`;
    const auditSql = `INSERT INTO audit_events(
      id,workspace_id,actor_type,actor_id,actor_role,access_issuer,access_subject,action,
      resource_type,resource_id,outcome,request_id,environment,metadata_json,occurred_at,ingested_at)
      SELECT ?,b.workspace_id,'user',?,?,?,?,?,'${RESOURCE_TYPE}',?,'success',?,?,?,?,?
      FROM editorial_project_execution_budgets b
      JOIN editorial_execution_envelopes e ON e.id=? AND e.project_execution_budget_id=b.id
      WHERE b.id=? AND b.workspace_id=? AND b.project_id=? AND ${guardSql(1)}
        AND e.workspace_id=b.workspace_id AND e.project_id=b.project_id
        AND e.profile_key='${PROFILE_KEY}' AND e.profile_version=1
        AND e.provider_id='${PROVIDER_ID}' AND e.provider_model_id='${MODEL_ID}'
        AND e.currency='USD' AND e.monetary_ceiling_microusd=${SCRIPT_CRITIC_CAPACITY_CEILING_MICROUSD}
        AND e.maximum_calls=1 AND e.status='ACTIVE' AND e.version=1 AND e.stage_key='SCRIPT_CRITIC'`;
    const finalGuardSql = `SELECT CASE WHEN
      EXISTS(SELECT 1 FROM editorial_project_execution_budgets b
        WHERE b.id=? AND b.workspace_id=? AND b.project_id=? AND ${guardSql(1)})
      AND EXISTS(SELECT 1 FROM editorial_execution_envelopes e
        WHERE e.id=? AND e.project_execution_budget_id=? AND e.workspace_id=? AND e.project_id=?
          AND e.profile_key='${PROFILE_KEY}' AND e.profile_version=1
          AND e.provider_id='${PROVIDER_ID}' AND e.provider_model_id='${MODEL_ID}'
          AND e.currency='USD' AND e.monetary_ceiling_microusd=${SCRIPT_CRITIC_CAPACITY_CEILING_MICROUSD}
          AND e.maximum_calls=1 AND e.status='ACTIVE' AND e.version=1 AND e.stage_key='SCRIPT_CRITIC')
      AND (SELECT count(*) FROM audit_events a WHERE a.id=? AND a.action='${SCRIPT_CRITIC_CAPACITY_OPERATION}'
        AND a.resource_type='${RESOURCE_TYPE}' AND a.resource_id=? AND a.outcome='success')=1
      THEN 1 ELSE json('script_critic_capacity_final_guard_failed') END`;

    const guardBindings = [
      this.actor.id,
      this.actor.id,
      this.context.accessIssuer,
      this.context.accessSubject,
      command.consumedHistoricalEnvelopeId,
      at,
    ] as const;
    try {
      await this.db.batch([
        this.db
          .prepare(insertEnvelopeSql)
          .bind(
            envelopeId,
            this.actor.id,
            at,
            at,
            command.successorBudgetId,
            this.actor.workspaceId,
            projectId,
            ...guardBindings,
          ),
        this.db
          .prepare(auditSql)
          .bind(
            auditEventId,
            this.actor.id,
            actorRole,
            this.context.accessIssuer,
            this.context.accessSubject,
            SCRIPT_CRITIC_CAPACITY_OPERATION,
            envelopeId,
            this.context.requestId,
            this.context.environment,
            metadata,
            at,
            at,
            envelopeId,
            command.successorBudgetId,
            this.actor.workspaceId,
            projectId,
            ...guardBindings,
          ),
        this.db
          .prepare(finalGuardSql)
          .bind(
            command.successorBudgetId,
            this.actor.workspaceId,
            projectId,
            ...guardBindings,
            envelopeId,
            command.successorBudgetId,
            this.actor.workspaceId,
            projectId,
            auditEventId,
            envelopeId,
          ),
      ]);
    } catch (batchError) {
      try {
        const concurrent = await this.replay(auditEventId, projectId, key, expectedCommandHash);
        if (concurrent) return concurrent;
      } catch (recoveryError) {
        if (recoveryError instanceof ScriptCriticCapacityError) throw recoveryError;
        throw batchError;
      }

      let after: Row | null;
      try {
        after = await this.snapshot(projectId, command);
      } catch {
        throw batchError;
      }
      if (!snapshotValid(after, this.actor, projectId, command, this.policy))
        throw new ScriptCriticCapacityError(409, 'script_critic_capacity_conflict');
      throw batchError;
    }
    return result;
  }
}
