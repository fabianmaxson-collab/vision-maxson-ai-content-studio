import type { GovernedStageCapacityCommand } from '@vision-maxson/contracts';
import { hasPermission, newId } from '@vision-maxson/domain';
import { routeModel, type ModelCandidate } from '@vision-maxson/providers';
import {
  PHASE3_TERMINAL_GOVERNED_PROFILE,
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

const OPERATION = 'editorial.governed_stage_capacity_authorized';
const RESOURCE = 'editorial_execution_envelope';
// New stages require a reviewed reason and policy entry. The service and D1 claim are stage-generic.
const reasons = {
  STORYBOARD_PLANNER: 'OPEN_REVISION_STORYBOARD_REPLACEMENT',
} as const;

export type GovernedStageCapacityResult = {
  envelope: {
    id: string;
    projectExecutionBudgetId: string;
    stageKey: string;
    status: 'ACTIVE';
    version: 1;
    maximumCalls: 1;
    usedCalls: 0;
    monetaryCeilingMicroUsd: number;
    profileKey: typeof PHASE3_TERMINAL_GOVERNED_PROFILE;
    profileVersion: 1;
    createdAt: string;
  };
  auditEventId: string;
  idempotentReplay: boolean;
};

export class GovernedStageCapacityError extends Error {
  constructor(
    readonly status: 403 | 404 | 409 | 422,
    message: string,
  ) {
    super(message);
  }
}

async function digest(value: unknown) {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

// Reconciled cost replaces the reservation; an active envelope contributes only its
// unreserved residual. Both subqueries are scoped to the successor budget, so the
// ambiguous reservation quarantined on the consumed predecessor is never counted twice.
const committed = (budget: string) =>
  `COALESCE((SELECT SUM(CASE r.status WHEN 'RECONCILED' THEN COALESCE(r.actual_microusd,r.reserved_microusd) WHEN 'CANCELLED' THEN 0 ELSE r.reserved_microusd END) FROM editorial_execution_reservations r WHERE r.project_execution_budget_id=${budget}.id),0)`;
const activeResidual = (budget: string) =>
  `COALESCE((SELECT SUM(MAX(0,e.monetary_ceiling_microusd-COALESCE((SELECT SUM(CASE r.status WHEN 'RECONCILED' THEN COALESCE(r.actual_microusd,r.reserved_microusd) WHEN 'CANCELLED' THEN 0 ELSE r.reserved_microusd END) FROM editorial_execution_reservations r WHERE r.envelope_id=e.id),0))) FROM editorial_execution_envelopes e WHERE e.project_execution_budget_id=${budget}.id AND e.status='ACTIVE'),0)`;
export const governedStageCapacityExposureSql = (budget: string) =>
  `(${committed(budget)}+${activeResidual(budget)})`;

export class GovernedStageCapacityService {
  constructor(
    private readonly db: D1Database,
    private readonly actor: EditorialActor,
    private readonly context: AuditContext,
  ) {}

  private async replay(
    receiptId: string,
    projectId: string,
    key: string,
    commandHash: string,
  ): Promise<GovernedStageCapacityResult | null> {
    const receipt = await this.db
      .prepare(
        `SELECT a.actor_id actorId,a.workspace_id workspaceId,a.resource_id resourceId,a.action,a.resource_type resourceType,a.outcome,a.environment,a.metadata_json metadataJson,e.id envelopeId,e.workspace_id envelopeWorkspaceId,e.project_id envelopeProjectId,e.project_execution_budget_id budgetId,e.stage_key stageKey,e.monetary_ceiling_microusd ceiling,e.maximum_calls maximumCalls,e.created_at createdAt FROM audit_events a LEFT JOIN editorial_execution_envelopes e ON e.id=a.resource_id WHERE a.id=?`,
      )
      .bind(receiptId)
      .first<Row>();
    if (!receipt) return null;
    let metadata: Row;
    try {
      metadata = JSON.parse(String(receipt.metadataJson)) as Row;
    } catch {
      throw new GovernedStageCapacityError(409, 'stage_capacity_receipt_invalid');
    }
    if (
      metadata.commandHash !== commandHash ||
      metadata.idempotencyKey !== key ||
      receipt.actorId !== this.actor.id ||
      receipt.workspaceId !== this.actor.workspaceId ||
      receipt.action !== OPERATION ||
      receipt.resourceType !== RESOURCE ||
      receipt.outcome !== 'success' ||
      receipt.environment !== this.context.environment ||
      receipt.envelopeId !== receipt.resourceId ||
      receipt.envelopeId !== metadata.envelopeId ||
      receipt.envelopeWorkspaceId !== this.actor.workspaceId ||
      receipt.envelopeProjectId !== projectId ||
      receipt.budgetId !== metadata.budgetId ||
      receipt.stageKey !== metadata.stageKey ||
      Number(receipt.ceiling) !== metadata.ceiling ||
      Number(receipt.maximumCalls) !== 1 ||
      receipt.createdAt !== metadata.createdAt ||
      metadata.workspaceId !== this.actor.workspaceId ||
      metadata.projectId !== projectId ||
      metadata.auditEventId !== receiptId
    )
      throw new GovernedStageCapacityError(409, 'stage_capacity_idempotency_conflict');
    return {
      envelope: {
        id: String(receipt.envelopeId),
        projectExecutionBudgetId: String(receipt.budgetId),
        stageKey: String(receipt.stageKey),
        status: 'ACTIVE',
        version: 1,
        maximumCalls: 1,
        usedCalls: 0,
        monetaryCeilingMicroUsd: Number(receipt.ceiling),
        profileKey: PHASE3_TERMINAL_GOVERNED_PROFILE,
        profileVersion: 1,
        createdAt: String(receipt.createdAt),
      },
      auditEventId: receiptId,
      idempotentReplay: true,
    };
  }

  async provision(
    projectId: string,
    key: string,
    command: GovernedStageCapacityCommand,
  ): Promise<GovernedStageCapacityResult> {
    if (!hasPermission(this.actor.roles, 'providers:admin'))
      throw new GovernedStageCapacityError(403, 'stage_capacity_forbidden');
    if (!this.context.accessIssuer || !this.context.accessSubject)
      throw new GovernedStageCapacityError(403, 'stage_capacity_identity_invalid');
    if (command.stageKey !== 'STORYBOARD_PLANNER' || command.reason !== reasons.STORYBOARD_PLANNER)
      throw new GovernedStageCapacityError(422, 'stage_capacity_policy_unsupported');
    const commandHash = await digest([
      this.actor.workspaceId,
      this.actor.id,
      projectId,
      command.budgetId,
      command.expectedBudgetVersion,
      command.stageKey,
      command.reason,
    ]);
    const receiptId = `audit_${await digest([this.actor.workspaceId, projectId, OPERATION, key])}`;
    const replay = await this.replay(receiptId, projectId, key, commandHash);
    if (replay) return replay;

    const row = await this.db
      .prepare(
        `SELECT b.id budgetId,b.workspace_id workspaceId,b.project_id projectId,b.version budgetVersion,b.monetary_ceiling_microusd budgetCeiling,${governedStageCapacityExposureSql('b')} exposure,h.id historicalEnvelopeId,p.id providerId,p.key providerKey,p.version providerVersion,m.id modelId,m.model_key modelKey,m.version modelVersion,m.capabilities_json capabilitiesJson,ps.id pricingId,ps.currency,ps.unit_name unitName,ps.input_unit_price inputPrice,ps.output_unit_price outputPrice,ps.verification_status verificationStatus,ps.effective_from effectiveFrom,ps.effective_to effectiveTo FROM editorial_project_execution_budgets b JOIN editorial_execution_envelopes h ON h.id=(SELECT historical.id FROM editorial_execution_envelopes historical JOIN editorial_project_execution_budgets predecessor ON predecessor.id=historical.project_execution_budget_id WHERE historical.workspace_id=b.workspace_id AND historical.project_id=b.project_id AND historical.profile_key=b.profile_key AND historical.profile_version=b.profile_version AND historical.stage_key=? AND historical.status='CONSUMED' AND predecessor.status='CONSUMED' ORDER BY historical.created_at DESC,historical.id DESC LIMIT 1) JOIN ai_providers p ON p.id=h.provider_id AND p.status='configured' JOIN ai_provider_models m ON m.id=h.provider_model_id AND m.provider_id=p.id AND m.status='available' JOIN ai_pricing_snapshots ps ON ps.provider_model_id=m.id AND ps.effective_to IS NULL WHERE b.id=? AND b.workspace_id=? AND b.project_id=? AND b.profile_key=? AND b.profile_version=1 AND b.status='ACTIVE' AND b.currency='USD' AND b.version=? AND EXISTS(SELECT 1 FROM projects project WHERE project.id=b.project_id AND project.workspace_id=b.workspace_id AND project.deleted_at IS NULL AND project.archived_at IS NULL) AND NOT EXISTS(SELECT 1 FROM editorial_execution_envelopes active WHERE active.project_execution_budget_id=b.id AND active.stage_key=? AND active.status='ACTIVE')`,
      )
      .bind(
        command.stageKey,
        command.budgetId,
        this.actor.workspaceId,
        projectId,
        PHASE3_TERMINAL_GOVERNED_PROFILE,
        command.expectedBudgetVersion,
        command.stageKey,
      )
      .first<Row>();
    if (!row) throw new GovernedStageCapacityError(409, 'stage_capacity_snapshot_invalid');
    let config: Row;
    try {
      config = JSON.parse(String(row.capabilitiesJson)) as Row;
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
          preferredProviderKey: String(row.providerKey),
          preferredModelKey: String(row.modelKey),
          requiredCapabilities: taskPolicy(command.stageKey).requiredCapabilities,
          minimumQualityTier: taskPolicy(command.stageKey).minimumQualityTier,
        },
      );
    } catch {
      throw new GovernedStageCapacityError(422, 'stage_capacity_model_policy_invalid');
    }
    const stagePolicy = governedTerminalStagePolicies[command.stageKey];
    if (stagePolicy.maximumAttempts !== 1)
      throw new GovernedStageCapacityError(422, 'stage_capacity_attempt_policy_invalid');
    let ceiling: number;
    try {
      ceiling = reserveMicrousd(
        {
          currency: row.currency as string,
          unitName: row.unitName as string,
          inputUnitPrice: Number(row.inputPrice),
          outputUnitPrice: Number(row.outputPrice),
          verificationStatus: String(row.verificationStatus),
          effectiveFrom: String(row.effectiveFrom),
          effectiveTo: row.effectiveTo as string | null,
        },
        stagePolicy.inputTokenCeiling,
        taskPolicy(command.stageKey).maxOutputTokens,
      );
    } catch {
      throw new GovernedStageCapacityError(422, 'stage_capacity_pricing_invalid');
    }
    if (ceiling > Number(row.budgetCeiling) - Number(row.exposure))
      throw new GovernedStageCapacityError(409, 'stage_capacity_budget_insufficient');

    const envelopeId = newId('execution_envelope');
    const at = new Date().toISOString();
    const role =
      this.actor.roles.find((candidate) => hasPermission([candidate], 'providers:admin')) ?? '';
    const result: GovernedStageCapacityResult = {
      envelope: {
        id: envelopeId,
        projectExecutionBudgetId: command.budgetId,
        stageKey: command.stageKey,
        status: 'ACTIVE',
        version: 1,
        maximumCalls: 1,
        usedCalls: 0,
        monetaryCeilingMicroUsd: ceiling,
        profileKey: PHASE3_TERMINAL_GOVERNED_PROFILE,
        profileVersion: 1,
        createdAt: at,
      },
      auditEventId: receiptId,
      idempotentReplay: false,
    };
    const metadata = JSON.stringify({
      operation: OPERATION,
      workspaceId: this.actor.workspaceId,
      projectId,
      budgetId: command.budgetId,
      budgetVersion: command.expectedBudgetVersion,
      stageKey: command.stageKey,
      reason: command.reason,
      historicalEnvelopeId: row.historicalEnvelopeId,
      providerId: row.providerId,
      modelId: row.modelId,
      pricingId: row.pricingId,
      maximumCalls: 1,
      maximumAttempts: 1,
      sdkMaxRetries: 0,
      fallbackEnabled: false,
      creativeRegenerationEnabled: false,
      ceiling,
      envelopeId,
      auditEventId: receiptId,
      actorId: this.actor.id,
      role,
      environment: this.context.environment,
      requestId: this.context.requestId,
      idempotencyKey: key,
      commandHash,
      availableBefore: Number(row.budgetCeiling) - Number(row.exposure),
      createdAt: at,
    });
    const sourceGuard = `b.id=? AND b.workspace_id=? AND b.project_id=? AND b.profile_key=? AND b.profile_version=1 AND b.status='ACTIVE' AND b.version=? AND b.currency='USD' AND EXISTS(SELECT 1 FROM projects project WHERE project.id=b.project_id AND project.workspace_id=b.workspace_id AND project.deleted_at IS NULL AND project.archived_at IS NULL) AND EXISTS(SELECT 1 FROM users u JOIN user_roles ur ON ur.user_id=u.id AND ur.workspace_id=u.workspace_id JOIN roles role ON role.id=ur.role_id WHERE u.id=? AND u.workspace_id=b.workspace_id AND u.status='active' AND role.key=?) AND NOT EXISTS(SELECT 1 FROM editorial_execution_envelopes active WHERE active.project_execution_budget_id=b.id AND active.stage_key=? AND active.status='ACTIVE') AND ${governedStageCapacityExposureSql('b')}+?<=b.monetary_ceiling_microusd AND EXISTS(SELECT 1 FROM editorial_execution_envelopes h JOIN editorial_project_execution_budgets predecessor ON predecessor.id=h.project_execution_budget_id JOIN ai_providers p ON p.id=h.provider_id JOIN ai_provider_models m ON m.id=h.provider_model_id AND m.provider_id=p.id JOIN ai_pricing_snapshots ps ON ps.id=? AND ps.provider_model_id=m.id WHERE h.id=? AND h.workspace_id=b.workspace_id AND h.project_id=b.project_id AND h.profile_key=b.profile_key AND h.profile_version=b.profile_version AND h.stage_key=? AND h.status='CONSUMED' AND predecessor.status='CONSUMED' AND p.id=? AND p.version=? AND p.status='configured' AND m.id=? AND m.version=? AND m.status='available' AND ps.effective_to IS NULL AND ps.currency='USD' AND ps.unit_name='token' AND ps.verification_status=? AND ps.effective_from=? AND ps.input_unit_price=? AND ps.output_unit_price=?)`;
    const bindings = [
      command.budgetId,
      this.actor.workspaceId,
      projectId,
      PHASE3_TERMINAL_GOVERNED_PROFILE,
      command.expectedBudgetVersion,
      this.actor.id,
      role,
      command.stageKey,
      ceiling,
      row.pricingId,
      row.historicalEnvelopeId,
      command.stageKey,
      row.providerId,
      row.providerVersion,
      row.modelId,
      row.modelVersion,
      row.verificationStatus,
      row.effectiveFrom,
      row.inputPrice,
      row.outputPrice,
    ];
    try {
      await this.db.batch([
        this.db
          .prepare(
            `INSERT INTO editorial_execution_envelopes(id,workspace_id,project_id,profile_key,profile_version,provider_id,provider_model_id,currency,monetary_ceiling_microusd,maximum_calls,status,authorized_by,created_at,updated_at,version,project_execution_budget_id,stage_key) SELECT ?,b.workspace_id,b.project_id,b.profile_key,1,?,?,'USD',?,1,'ACTIVE',?,?,?,1,b.id,? FROM editorial_project_execution_budgets b WHERE ${sourceGuard}`,
          )
          .bind(
            envelopeId,
            row.providerId,
            row.modelId,
            ceiling,
            this.actor.id,
            at,
            at,
            command.stageKey,
            ...bindings,
          ),
        this.db
          .prepare(
            `SELECT CASE WHEN EXISTS(SELECT 1 FROM editorial_execution_envelopes e WHERE e.id=? AND e.project_execution_budget_id=? AND e.workspace_id=? AND e.project_id=? AND e.stage_key=? AND e.status='ACTIVE' AND e.monetary_ceiling_microusd=? AND e.maximum_calls=1) THEN 1 ELSE json('stage_capacity_envelope_guard_failed') END`,
          )
          .bind(
            envelopeId,
            command.budgetId,
            this.actor.workspaceId,
            projectId,
            command.stageKey,
            ceiling,
          ),
        this.db
          .prepare(
            `INSERT INTO audit_events(id,workspace_id,actor_type,actor_id,actor_role,access_issuer,access_subject,action,resource_type,resource_id,outcome,request_id,environment,metadata_json,occurred_at,ingested_at) VALUES(?,?,'user',?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .bind(
            receiptId,
            this.actor.workspaceId,
            this.actor.id,
            role,
            this.context.accessIssuer,
            this.context.accessSubject,
            OPERATION,
            RESOURCE,
            envelopeId,
            'success',
            this.context.requestId,
            this.context.environment,
            metadata,
            at,
            at,
          ),
        this.db
          .prepare(
            `SELECT CASE WHEN EXISTS(SELECT 1 FROM audit_events a JOIN editorial_execution_envelopes e ON e.id=a.resource_id WHERE a.id=? AND a.action=? AND a.resource_type=? AND e.id=? AND e.project_execution_budget_id=? AND e.status='ACTIVE') THEN 1 ELSE json('stage_capacity_audit_guard_failed') END`,
          )
          .bind(receiptId, OPERATION, RESOURCE, envelopeId, command.budgetId),
      ]);
    } catch {
      const concurrent = await this.replay(receiptId, projectId, key, commandHash);
      if (concurrent) return concurrent;
      throw new GovernedStageCapacityError(409, 'stage_capacity_concurrent_conflict');
    }
    return result;
  }
}
