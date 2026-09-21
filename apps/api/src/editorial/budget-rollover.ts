import type { ProjectExecutionBudgetRolloverCommand } from '@vision-maxson/contracts';
import { hasPermission, newId } from '@vision-maxson/domain';
import type { EditorialActor } from './repository';

type Row = Record<string, unknown>;
type AuditContext = {
  requestId: string;
  environment: string;
  accessIssuer: string;
  accessSubject: string;
};

const PROFILE = 'phase3_terminal_graph_v1';
const ORIGINAL_CEILING_MICROUSD = 1_331_520;
const EXPECTED_RECONCILED = 4;
const EXPECTED_RECONCILED_ACTUAL_MICROUSD = 101_725;
const AMBIGUOUS_EXPOSURE_MICROUSD = 321_920;
const CANONICAL_COMMITTED_MICROUSD = 423_645;
const SUCCESSOR_CEILING_MICROUSD = 907_875;
const HISTORICAL_STORYBOARD_ENVELOPE_ID = 'execution_envelope_2a2db2a2-557d-4d5a-b914-ede34b9ab453';
const HISTORICAL_STORYBOARD_RESERVATION_ID =
  'execution_reservation_5bd3685e-b5f5-43ee-9e5d-9f0fc307974a';
const ROLLOVER_OPERATION = 'editorial.execution_budget_rolled_over';
const RESOURCE_TYPE = 'editorial_project_execution_budget';
const AUDIT_OUTCOME = 'success';

const CANONICAL_ENVELOPES = [
  {
    id: 'execution_envelope_0f8fbd95-e7d3-46c3-b71c-2d99a7dbf378',
    stage: 'TOPIC_RESEARCH',
    model: 'model_openai_gpt_5_6_terra_20260903',
    ceiling: 225_920,
  },
  {
    id: HISTORICAL_STORYBOARD_ENVELOPE_ID,
    stage: 'STORYBOARD_PLANNER',
    model: 'model_openai_gpt_5_6_terra_20260903',
    ceiling: 321_920,
  },
  {
    id: 'execution_envelope_7f0dd940-340c-4d7b-a726-faae05101468',
    stage: 'CONTENT_BRIEF',
    model: 'model_openai_gpt_5_6_terra_20260903',
    ceiling: 201_920,
  },
  {
    id: 'execution_envelope_cf4d27f4-2296-4b0d-9ba7-7893bd21dc38',
    stage: 'SCRIPT_CRITIC',
    model: 'model_openai_gpt_5_6_sol_20260903',
    ceiling: 403_840,
  },
  {
    id: 'execution_envelope_e6c09f5e-203e-4ebe-a552-4c6fb728bdac',
    stage: 'IDEA_GENERATION',
    model: 'model_openai_gpt_5_6_terra_20260903',
    ceiling: 177_920,
  },
] as const;

const CANONICAL_RESERVATIONS = [
  {
    id: 'execution_reservation_374dbf0c-b7e0-44a1-964c-b7afe8e04b42',
    envelopeId: 'execution_envelope_e6c09f5e-203e-4ebe-a552-4c6fb728bdac',
    stage: 'IDEA_GENERATION',
    reserved: 177_920,
    actual: 14_408,
    status: 'RECONCILED',
  },
  {
    id: HISTORICAL_STORYBOARD_RESERVATION_ID,
    envelopeId: HISTORICAL_STORYBOARD_ENVELOPE_ID,
    stage: 'STORYBOARD_PLANNER',
    reserved: 321_920,
    actual: null,
    status: 'AMBIGUOUS',
  },
  {
    id: 'execution_reservation_da6950b9-dc52-4761-b4e8-0097cc12747f',
    envelopeId: 'execution_envelope_0f8fbd95-e7d3-46c3-b71c-2d99a7dbf378',
    stage: 'TOPIC_RESEARCH',
    reserved: 225_920,
    actual: 4_146,
    status: 'RECONCILED',
  },
  {
    id: 'execution_reservation_f4136c98-622d-4460-8dea-805b5fc5d38d',
    envelopeId: 'execution_envelope_cf4d27f4-2296-4b0d-9ba7-7893bd21dc38',
    stage: 'SCRIPT_CRITIC',
    reserved: 403_840,
    actual: 69_669,
    status: 'RECONCILED',
  },
  {
    id: 'execution_reservation_f91a5860-99bb-42a2-9a59-b54953110a30',
    envelopeId: 'execution_envelope_7f0dd940-340c-4d7b-a726-faae05101468',
    stage: 'CONTENT_BRIEF',
    reserved: 201_920,
    actual: 13_502,
    status: 'RECONCILED',
  },
] as const;

type CanonicalEnvelope = {
  readonly id: string;
  readonly stage: string;
  readonly model: string;
  readonly ceiling: number;
};
type CanonicalReservation = {
  readonly id: string;
  readonly envelopeId: string;
  readonly stage: string;
  readonly reserved: number;
  readonly actual: number | null;
  readonly status: 'RECONCILED' | 'AMBIGUOUS';
};

export type ProjectBudgetRolloverPolicy = {
  readonly envelopes: readonly CanonicalEnvelope[];
  readonly reservations: readonly CanonicalReservation[];
};

const DEFAULT_POLICY: ProjectBudgetRolloverPolicy = {
  envelopes: CANONICAL_ENVELOPES,
  reservations: CANONICAL_RESERVATIONS,
};

function sqlText(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function exactEnvelopePredicate(alias: string, policy: ProjectBudgetRolloverPolicy) {
  return `(${policy.envelopes
    .map(
      (envelope) =>
        `(${alias}.id=${sqlText(envelope.id)} AND ${alias}.stage_key=${sqlText(envelope.stage)} ` +
        `AND ${alias}.profile_key=${sqlText(PROFILE)} AND ${alias}.profile_version=1 ` +
        `AND ${alias}.provider_id='provider_openai' AND ${alias}.provider_model_id=${sqlText(envelope.model)} ` +
        `AND ${alias}.currency='USD' AND ${alias}.monetary_ceiling_microusd=${envelope.ceiling} ` +
        `AND ${alias}.maximum_calls=1 AND ${alias}.status='CONSUMED' AND ${alias}.version=2)`,
    )
    .join(' OR ')})`;
}

function exactReservationPredicate(alias: string, policy: ProjectBudgetRolloverPolicy) {
  return `(${policy.reservations
    .map((reservation) => {
      const actual =
        reservation.actual === null
          ? `${alias}.actual_microusd IS NULL`
          : `${alias}.actual_microusd=${reservation.actual}`;
      return (
        `(${alias}.id=${sqlText(reservation.id)} AND ${alias}.envelope_id=${sqlText(reservation.envelopeId)} ` +
        `AND ${alias}.step_key=${sqlText(reservation.stage)} AND ${alias}.status=${sqlText(reservation.status)} ` +
        `AND ${alias}.reserved_microusd=${reservation.reserved} AND ${actual} ` +
        `AND ${alias}.dispatched_at IS NOT NULL AND ${alias}.reconciled_at IS NOT NULL)`
      );
    })
    .join(' OR ')})`;
}

function replayReservationPredicate(alias: string, policy: ProjectBudgetRolloverPolicy) {
  return `(${policy.reservations
    .map((reservation) => {
      const state =
        reservation.status === 'AMBIGUOUS'
          ? `((${alias}.status='AMBIGUOUS' AND ${alias}.actual_microusd IS NULL) OR ` +
            `(${alias}.status='RECONCILED' AND ${alias}.actual_microusd IS NOT NULL ` +
            `AND ${alias}.actual_microusd>=0 AND ${alias}.actual_microusd<=${alias}.reserved_microusd))`
          : `${alias}.status=${sqlText(reservation.status)} AND ${alias}.actual_microusd=${reservation.actual}`;
      return (
        `(${alias}.id=${sqlText(reservation.id)} AND ${alias}.envelope_id=${sqlText(reservation.envelopeId)} ` +
        `AND ${alias}.step_key=${sqlText(reservation.stage)} AND ${alias}.reserved_microusd=${reservation.reserved} ` +
        `AND ${state} AND ${alias}.dispatched_at IS NOT NULL AND ${alias}.reconciled_at IS NOT NULL)`
      );
    })
    .join(' OR ')})`;
}

export type ProjectBudgetRolloverResult = {
  oldBudget: {
    id: string;
    previousStatus: 'ACTIVE';
    status: 'CONSUMED';
    previousVersion: 1;
    version: 2;
  };
  successorBudget: {
    id: string;
    status: 'ACTIVE';
    version: 1;
    monetaryCeilingMicroUsd: number;
  };
  canonicalCommittedMicroUsd: number;
  ambiguousExposureMicroUsd: number;
  auditEventId: string;
  idempotentReplay: boolean;
};

export class ProjectBudgetRolloverError extends Error {
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
  return [...new Uint8Array(bytes)].map((part) => part.toString(16).padStart(2, '0')).join('');
}

function rolloverCommandHash(fields: {
  workspace: unknown;
  project: unknown;
  oldBudgetId: unknown;
  expectedOldBudgetVersion: unknown;
  expectedOldBudgetStatus: unknown;
  expectedAmbiguousReservationId: unknown;
  reason: unknown;
}) {
  return digest([
    ['workspace', fields.workspace],
    ['operationType', ROLLOVER_OPERATION],
    ['project', fields.project],
    ['oldBudgetId', fields.oldBudgetId],
    ['expectedOldBudgetVersion', fields.expectedOldBudgetVersion],
    ['expectedOldBudgetStatus', fields.expectedOldBudgetStatus],
    ['expectedAmbiguousReservationId', fields.expectedAmbiguousReservationId],
    ['reason', fields.reason],
  ]);
}

async function deterministicReceiptId(workspaceId: string, projectId: string, key: string) {
  const namespaceHash = await digest({
    workspaceId,
    operation: ROLLOVER_OPERATION,
    projectId,
    idempotencyKey: key,
  });
  return `audit_${namespaceHash}`;
}

function integer(row: Row, key: string) {
  return Number(row[key]);
}

function isRecord(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function ambiguousReservation(policy: ProjectBudgetRolloverPolicy) {
  return policy.reservations.find((reservation) => reservation.status === 'AMBIGUOUS');
}

function snapshotValid(
  row: Row | null,
  ambiguousReservationId: string,
  policy: ProjectBudgetRolloverPolicy,
) {
  const expectedAmbiguous = ambiguousReservation(policy);
  return (
    row !== null &&
    expectedAmbiguous !== undefined &&
    ambiguousReservationId === expectedAmbiguous.id &&
    row.profileKey === PROFILE &&
    integer(row, 'profileVersion') === 1 &&
    row.currency === 'USD' &&
    row.status === 'ACTIVE' &&
    integer(row, 'version') === 1 &&
    integer(row, 'ceiling') === ORIGINAL_CEILING_MICROUSD &&
    integer(row, 'reservationCount') === policy.reservations.length &&
    integer(row, 'exactReservationCount') === policy.reservations.length &&
    integer(row, 'unexpectedReservationCount') === 0 &&
    integer(row, 'reconciledCount') === EXPECTED_RECONCILED &&
    integer(row, 'reconciledNullActualCount') === 0 &&
    integer(row, 'reconciledInvalidActualCount') === 0 &&
    integer(row, 'nonReconciledNullReservedCount') === 0 &&
    integer(row, 'reconciledActual') === EXPECTED_RECONCILED_ACTUAL_MICROUSD &&
    integer(row, 'ambiguousCount') === 1 &&
    integer(row, 'ambiguousExposure') === AMBIGUOUS_EXPOSURE_MICROUSD &&
    integer(row, 'canonicalCommitted') === CANONICAL_COMMITTED_MICROUSD &&
    row.ambiguousReservationId === expectedAmbiguous.id &&
    integer(row, 'envelopeCount') === policy.envelopes.length &&
    integer(row, 'exactEnvelopeCount') === policy.envelopes.length &&
    integer(row, 'unexpectedEnvelopeCount') === 0 &&
    integer(row, 'successorCeiling') === SUCCESSOR_CEILING_MICROUSD
  );
}

function snapshotSql(policy: ProjectBudgetRolloverPolicy) {
  const exactReservations = exactReservationPredicate('r', policy);
  const exactEnvelopes = exactEnvelopePredicate('e', policy);
  return `SELECT b.id,b.profile_key profileKey,b.profile_version profileVersion,
 b.currency,b.status,b.version,b.monetary_ceiling_microusd ceiling,
 (SELECT count(*) FROM editorial_execution_reservations r WHERE r.project_execution_budget_id=b.id) reservationCount,
 (SELECT count(*) FROM editorial_execution_reservations r WHERE r.project_execution_budget_id=b.id AND ${exactReservations}) exactReservationCount,
 (SELECT count(*) FROM editorial_execution_reservations r WHERE r.project_execution_budget_id=b.id AND NOT ${exactReservations}) unexpectedReservationCount,
 (SELECT count(*) FROM editorial_execution_reservations r WHERE r.project_execution_budget_id=b.id AND r.status='RECONCILED') reconciledCount,
 (SELECT count(*) FROM editorial_execution_reservations r WHERE r.project_execution_budget_id=b.id AND r.status='RECONCILED' AND r.actual_microusd IS NULL) reconciledNullActualCount,
 (SELECT count(*) FROM editorial_execution_reservations r WHERE r.project_execution_budget_id=b.id AND r.status='RECONCILED' AND (r.actual_microusd<0 OR r.actual_microusd>r.reserved_microusd)) reconciledInvalidActualCount,
 (SELECT count(*) FROM editorial_execution_reservations r WHERE r.project_execution_budget_id=b.id AND r.status IN ('AMBIGUOUS','RESERVED','DISPATCHED') AND r.reserved_microusd IS NULL) nonReconciledNullReservedCount,
 (SELECT sum(r.actual_microusd) FROM editorial_execution_reservations r WHERE r.project_execution_budget_id=b.id AND r.status='RECONCILED') reconciledActual,
 (SELECT count(*) FROM editorial_execution_reservations r WHERE r.project_execution_budget_id=b.id AND r.status='AMBIGUOUS') ambiguousCount,
 (SELECT sum(r.reserved_microusd) FROM editorial_execution_reservations r WHERE r.project_execution_budget_id=b.id AND r.status='AMBIGUOUS') ambiguousExposure,
 (SELECT sum(CASE r.status WHEN 'RECONCILED' THEN r.actual_microusd WHEN 'CANCELLED' THEN 0 ELSE r.reserved_microusd END) FROM editorial_execution_reservations r WHERE r.project_execution_budget_id=b.id) canonicalCommitted,
 (SELECT r.id FROM editorial_execution_reservations r WHERE r.project_execution_budget_id=b.id AND r.status='AMBIGUOUS' LIMIT 1) ambiguousReservationId,
 (SELECT count(*) FROM editorial_execution_envelopes e WHERE e.project_execution_budget_id=b.id) envelopeCount,
 (SELECT count(*) FROM editorial_execution_envelopes e WHERE e.project_execution_budget_id=b.id AND ${exactEnvelopes}) exactEnvelopeCount,
 (SELECT count(*) FROM editorial_execution_envelopes e WHERE e.project_execution_budget_id=b.id AND NOT ${exactEnvelopes}) unexpectedEnvelopeCount,
 b.monetary_ceiling_microusd-(SELECT sum(CASE r.status WHEN 'RECONCILED' THEN r.actual_microusd WHEN 'CANCELLED' THEN 0 ELSE r.reserved_microusd END) FROM editorial_execution_reservations r WHERE r.project_execution_budget_id=b.id) successorCeiling
 FROM editorial_project_execution_budgets b
 JOIN projects p ON p.id=b.project_id AND p.workspace_id=b.workspace_id AND p.deleted_at IS NULL
 JOIN users u ON u.id=? AND u.workspace_id=b.workspace_id AND u.status='active' AND u.deleted_at IS NULL
 WHERE b.id=? AND b.workspace_id=? AND b.project_id=?`;
}

function guardedSourcePredicate(alias: string, policy: ProjectBudgetRolloverPolicy) {
  const exactEnvelopes = exactEnvelopePredicate('e', policy);
  const exactReservations = exactReservationPredicate('r', policy);
  return `${alias}.profile_key='${PROFILE}' AND ${alias}.profile_version=1 AND ${alias}.currency='USD'
 AND ${alias}.monetary_ceiling_microusd=1331520
 AND EXISTS(SELECT 1 FROM projects p WHERE p.id=${alias}.project_id AND p.workspace_id=${alias}.workspace_id AND p.deleted_at IS NULL)
 AND EXISTS(SELECT 1 FROM users u WHERE u.id=? AND u.workspace_id=${alias}.workspace_id AND u.status='active' AND u.deleted_at IS NULL)
 AND (SELECT count(*) FROM editorial_execution_envelopes e WHERE e.project_execution_budget_id=${alias}.id)=${policy.envelopes.length}
 AND (SELECT count(*) FROM editorial_execution_envelopes e WHERE e.project_execution_budget_id=${alias}.id AND ${exactEnvelopes})=${policy.envelopes.length}
 AND NOT EXISTS(SELECT 1 FROM editorial_execution_envelopes e WHERE e.project_execution_budget_id=${alias}.id AND NOT ${exactEnvelopes})
 AND (SELECT count(*) FROM editorial_execution_reservations r WHERE r.project_execution_budget_id=${alias}.id)=${policy.reservations.length}
 AND (SELECT count(*) FROM editorial_execution_reservations r WHERE r.project_execution_budget_id=${alias}.id AND ${exactReservations})=${policy.reservations.length}
 AND NOT EXISTS(SELECT 1 FROM editorial_execution_reservations r WHERE r.project_execution_budget_id=${alias}.id AND NOT ${exactReservations})
 AND (SELECT count(*) FROM editorial_execution_reservations r WHERE r.project_execution_budget_id=${alias}.id AND r.status='RECONCILED')=4
 AND NOT EXISTS(SELECT 1 FROM editorial_execution_reservations r WHERE r.project_execution_budget_id=${alias}.id AND r.status='RECONCILED' AND r.actual_microusd IS NULL)
 AND NOT EXISTS(SELECT 1 FROM editorial_execution_reservations r WHERE r.project_execution_budget_id=${alias}.id AND r.status='RECONCILED' AND (r.actual_microusd<0 OR r.actual_microusd>r.reserved_microusd))
 AND NOT EXISTS(SELECT 1 FROM editorial_execution_reservations r WHERE r.project_execution_budget_id=${alias}.id AND r.status IN ('AMBIGUOUS','RESERVED','DISPATCHED') AND r.reserved_microusd IS NULL)
 AND (SELECT sum(r.actual_microusd) FROM editorial_execution_reservations r WHERE r.project_execution_budget_id=${alias}.id AND r.status='RECONCILED')=101725
 AND (SELECT count(*) FROM editorial_execution_reservations r WHERE r.project_execution_budget_id=${alias}.id AND r.status='AMBIGUOUS')=1
 AND (SELECT sum(r.reserved_microusd) FROM editorial_execution_reservations r WHERE r.project_execution_budget_id=${alias}.id AND r.status='AMBIGUOUS')=321920
 AND (SELECT sum(CASE r.status WHEN 'RECONCILED' THEN r.actual_microusd WHEN 'CANCELLED' THEN 0 ELSE r.reserved_microusd END) FROM editorial_execution_reservations r WHERE r.project_execution_budget_id=${alias}.id)=423645`;
}

export class ProjectBudgetRolloverService {
  constructor(
    private readonly db: D1Database,
    private readonly actor: EditorialActor,
    private readonly context: AuditContext,
    private readonly policy: ProjectBudgetRolloverPolicy = DEFAULT_POLICY,
  ) {}

  private async replay(auditEventId: string, projectId: string, key: string, commandHash: string) {
    const expectedAmbiguous = ambiguousReservation(this.policy);
    if (!expectedAmbiguous)
      throw new ProjectBudgetRolloverError(409, 'execution_budget_rollover_receipt_invalid');
    const replayReservations = replayReservationPredicate('historical', this.policy);
    const replayEnvelopes = exactEnvelopePredicate('historicalEnvelope', this.policy);
    const row = await this.db
      .prepare(
        `SELECT a.id,a.workspace_id workspaceId,a.actor_type actorType,a.actor_id actorId,
          a.actor_role actorRole,a.access_issuer accessIssuer,a.access_subject accessSubject,
          a.action,a.resource_type resourceType,a.resource_id resourceId,a.outcome,
          a.request_id requestId,a.environment,a.occurred_at occurredAt,a.ingested_at ingestedAt,
          a.metadata_json metadataJson,
          old.id actualOldBudgetId,old.workspace_id oldWorkspaceId,old.project_id oldProjectId,
          old.profile_key oldProfileKey,old.profile_version oldProfileVersion,old.currency oldCurrency,
          old.status oldStatus,old.version oldVersion,old.monetary_ceiling_microusd oldCeiling,
          successor.id actualSuccessorBudgetId,successor.workspace_id successorWorkspaceId,
          successor.project_id successorProjectId,successor.profile_key successorProfileKey,
          successor.profile_version successorProfileVersion,successor.currency successorCurrency,
          successor.authorized_by successorAuthorizedBy,successor.status successorStatus,
          successor.version successorVersion,successor.monetary_ceiling_microusd successorCeiling,
          (SELECT count(*) FROM editorial_execution_envelopes child WHERE child.project_execution_budget_id=successor.id) successorEnvelopeCount,
          (SELECT count(*) FROM editorial_execution_reservations child WHERE child.project_execution_budget_id=successor.id) successorReservationCount,
          (SELECT count(*) FROM editorial_execution_envelopes historicalEnvelope WHERE historicalEnvelope.project_execution_budget_id=old.id) historicalEnvelopeCount,
          (SELECT count(*) FROM editorial_execution_envelopes historicalEnvelope WHERE historicalEnvelope.project_execution_budget_id=old.id AND ${replayEnvelopes}) validHistoricalEnvelopeCount,
          (SELECT count(*) FROM editorial_execution_reservations historical WHERE historical.project_execution_budget_id=old.id) historicalReservationCount,
          (SELECT count(*) FROM editorial_execution_reservations historical WHERE historical.project_execution_budget_id=old.id AND ${replayReservations}) validHistoricalReservationCount,
          (SELECT count(*) FROM editorial_project_execution_budgets activeBudget WHERE activeBudget.workspace_id=a.workspace_id AND activeBudget.project_id=json_extract(a.metadata_json,'$.project') AND activeBudget.profile_key='${PROFILE}' AND activeBudget.profile_version=1 AND activeBudget.status='ACTIVE') activeBudgetCount,
          (SELECT count(*) FROM audit_events receipt WHERE receipt.workspace_id=a.workspace_id AND receipt.action='${ROLLOVER_OPERATION}' AND json_extract(receipt.metadata_json,'$.project')=json_extract(a.metadata_json,'$.project') AND json_extract(receipt.metadata_json,'$.idempotencyKey')=json_extract(a.metadata_json,'$.idempotencyKey')) matchingReceiptCount
         FROM audit_events a
         LEFT JOIN editorial_project_execution_budgets old
           ON old.id=json_extract(a.metadata_json,'$.oldBudgetId')
          AND old.workspace_id=a.workspace_id
         LEFT JOIN editorial_project_execution_budgets successor
           ON successor.id=json_extract(a.metadata_json,'$.successorBudgetId')
          AND successor.workspace_id=a.workspace_id
         WHERE a.id=? LIMIT 1`,
      )
      .bind(auditEventId)
      .first<Row>();
    if (!row) return null;
    let metadata: Row;
    try {
      metadata = JSON.parse(String(row.metadataJson)) as Row;
    } catch {
      throw new ProjectBudgetRolloverError(409, 'execution_budget_rollover_receipt_invalid');
    }
    if (!isRecord(metadata))
      throw new ProjectBudgetRolloverError(409, 'execution_budget_rollover_receipt_invalid');
    const result = metadata.result;
    const persistedAmbiguousIds: unknown = metadata.ambiguousReservationIds;
    const oldResult = isRecord(result) ? result.oldBudget : null;
    const successorResult = isRecord(result) ? result.successorBudget : null;
    const role = this.actor.roles[0] ?? null;
    if (
      row.id !== auditEventId ||
      row.workspaceId !== this.actor.workspaceId ||
      row.actorType !== 'user' ||
      row.actorId !== this.actor.id ||
      row.actorRole !== role ||
      row.accessIssuer !== this.context.accessIssuer ||
      row.accessSubject !== this.context.accessSubject ||
      row.action !== ROLLOVER_OPERATION ||
      row.resourceType !== RESOURCE_TYPE ||
      row.outcome !== AUDIT_OUTCOME ||
      row.environment !== this.context.environment ||
      typeof row.requestId !== 'string' ||
      row.requestId.length === 0 ||
      row.requestId !== metadata.requestId ||
      row.occurredAt !== metadata.timestamp ||
      row.ingestedAt !== metadata.timestamp ||
      metadata.workspace !== this.actor.workspaceId ||
      metadata.project !== projectId ||
      metadata.actor !== this.actor.id ||
      metadata.role !== role ||
      metadata.environment !== this.context.environment ||
      metadata.operation !== ROLLOVER_OPERATION ||
      metadata.idempotencyKey !== key ||
      metadata.reason !== 'HISTORICAL_AMBIGUITY_QUARANTINE' ||
      metadata.oldBudgetVersionBefore !== 1 ||
      metadata.oldBudgetVersionAfter !== 2 ||
      metadata.oldStatus !== 'ACTIVE' ||
      metadata.oldNewStatus !== 'CONSUMED' ||
      metadata.successorVersion !== 1 ||
      metadata.successorStatus !== 'ACTIVE' ||
      metadata.originalCeilingMicroUsd !== ORIGINAL_CEILING_MICROUSD ||
      metadata.canonicalCommittedMicroUsd !== CANONICAL_COMMITTED_MICROUSD ||
      metadata.ambiguousExposureMicroUsd !== AMBIGUOUS_EXPOSURE_MICROUSD ||
      metadata.successorCeilingMicroUsd !== SUCCESSOR_CEILING_MICROUSD ||
      !Array.isArray(persistedAmbiguousIds) ||
      persistedAmbiguousIds.length !== 1 ||
      persistedAmbiguousIds[0] !== expectedAmbiguous.id ||
      typeof metadata.oldBudgetId !== 'string' ||
      typeof metadata.successorBudgetId !== 'string' ||
      typeof metadata.commandHash !== 'string' ||
      !isRecord(result) ||
      !isRecord(oldResult) ||
      !isRecord(successorResult)
    )
      throw new ProjectBudgetRolloverError(409, 'execution_budget_rollover_receipt_invalid');

    const persistedCommandHash = await rolloverCommandHash({
      workspace: metadata.workspace,
      project: metadata.project,
      oldBudgetId: metadata.oldBudgetId,
      expectedOldBudgetVersion: metadata.oldBudgetVersionBefore,
      expectedOldBudgetStatus: metadata.oldStatus,
      expectedAmbiguousReservationId: (persistedAmbiguousIds as unknown[])[0],
      reason: metadata.reason,
    });
    if (metadata.commandHash !== persistedCommandHash)
      throw new ProjectBudgetRolloverError(409, 'execution_budget_rollover_receipt_invalid');
    if (metadata.commandHash !== commandHash)
      throw new ProjectBudgetRolloverError(409, 'execution_budget_rollover_idempotency_conflict');
    if (
      result.auditEventId !== auditEventId ||
      oldResult.id !== metadata.oldBudgetId ||
      oldResult.previousStatus !== metadata.oldStatus ||
      oldResult.status !== metadata.oldNewStatus ||
      oldResult.previousVersion !== metadata.oldBudgetVersionBefore ||
      oldResult.version !== metadata.oldBudgetVersionAfter ||
      successorResult.id !== metadata.successorBudgetId ||
      successorResult.status !== metadata.successorStatus ||
      successorResult.version !== metadata.successorVersion ||
      successorResult.monetaryCeilingMicroUsd !== metadata.successorCeilingMicroUsd ||
      result.canonicalCommittedMicroUsd !== CANONICAL_COMMITTED_MICROUSD ||
      result.canonicalCommittedMicroUsd !== metadata.canonicalCommittedMicroUsd ||
      result.ambiguousExposureMicroUsd !== AMBIGUOUS_EXPOSURE_MICROUSD ||
      result.ambiguousExposureMicroUsd !== metadata.ambiguousExposureMicroUsd ||
      result.idempotentReplay !== false ||
      row.resourceId !== successorResult.id ||
      row.actualOldBudgetId !== oldResult.id ||
      row.oldWorkspaceId !== this.actor.workspaceId ||
      row.oldProjectId !== projectId ||
      row.oldProfileKey !== PROFILE ||
      integer(row, 'oldProfileVersion') !== 1 ||
      row.oldCurrency !== 'USD' ||
      row.oldStatus !== 'CONSUMED' ||
      integer(row, 'oldVersion') !== 2 ||
      integer(row, 'oldCeiling') !== ORIGINAL_CEILING_MICROUSD ||
      row.actualSuccessorBudgetId !== successorResult.id ||
      row.successorWorkspaceId !== this.actor.workspaceId ||
      row.successorProjectId !== projectId ||
      row.successorProfileKey !== PROFILE ||
      integer(row, 'successorProfileVersion') !== 1 ||
      row.successorCurrency !== 'USD' ||
      row.successorAuthorizedBy !== this.actor.id ||
      row.successorStatus !== 'ACTIVE' ||
      integer(row, 'successorVersion') !== 1 ||
      integer(row, 'successorCeiling') !== SUCCESSOR_CEILING_MICROUSD ||
      integer(row, 'successorEnvelopeCount') !== 0 ||
      integer(row, 'successorReservationCount') !== 0 ||
      integer(row, 'historicalEnvelopeCount') !== this.policy.envelopes.length ||
      integer(row, 'validHistoricalEnvelopeCount') !== this.policy.envelopes.length ||
      integer(row, 'historicalReservationCount') !== this.policy.reservations.length ||
      integer(row, 'validHistoricalReservationCount') !== this.policy.reservations.length ||
      integer(row, 'activeBudgetCount') !== 1 ||
      integer(row, 'matchingReceiptCount') !== 1
    )
      throw new ProjectBudgetRolloverError(409, 'execution_budget_rollover_receipt_invalid');
    return { ...(result as ProjectBudgetRolloverResult), idempotentReplay: true };
  }

  private async snapshot(projectId: string, command: ProjectExecutionBudgetRolloverCommand) {
    return this.db
      .prepare(snapshotSql(this.policy))
      .bind(this.actor.id, command.oldBudgetId, this.actor.workspaceId, projectId)
      .first<Row>();
  }

  async rollover(
    projectId: string,
    key: string,
    command: ProjectExecutionBudgetRolloverCommand,
  ): Promise<ProjectBudgetRolloverResult> {
    if (!hasPermission(this.actor.roles, 'providers:admin'))
      throw new ProjectBudgetRolloverError(403, 'execution_budget_rollover_forbidden');
    if (!this.context.accessIssuer || !this.context.accessSubject)
      throw new ProjectBudgetRolloverError(403, 'execution_budget_rollover_identity_invalid');
    const auditEventId = await deterministicReceiptId(this.actor.workspaceId, projectId, key);
    const commandHash = await rolloverCommandHash({
      workspace: this.actor.workspaceId,
      project: projectId,
      oldBudgetId: command.oldBudgetId,
      expectedOldBudgetVersion: command.expectedOldBudgetVersion,
      expectedOldBudgetStatus: command.expectedOldBudgetStatus,
      expectedAmbiguousReservationId: command.expectedAmbiguousReservationId,
      reason: command.reason,
    });
    const prior = await this.replay(auditEventId, projectId, key, commandHash);
    if (prior) return prior;
    const snapshot = await this.snapshot(projectId, command);
    if (!snapshot)
      throw new ProjectBudgetRolloverError(404, 'execution_budget_rollover_source_not_found');
    const expectedAmbiguous = ambiguousReservation(this.policy);
    if (
      expectedAmbiguous &&
      command.expectedAmbiguousReservationId !== expectedAmbiguous.id &&
      snapshotValid(snapshot, expectedAmbiguous.id, this.policy)
    )
      throw new ProjectBudgetRolloverError(409, 'execution_budget_rollover_idempotency_conflict');
    if (snapshot.status !== 'ACTIVE' || integer(snapshot, 'version') !== 1)
      throw new ProjectBudgetRolloverError(409, 'execution_budget_rollover_conflict');
    if (!snapshotValid(snapshot, command.expectedAmbiguousReservationId, this.policy))
      throw new ProjectBudgetRolloverError(409, 'execution_budget_rollover_snapshot_invalid');

    const successorBudgetId = newId('project_execution_budget');
    const at = new Date().toISOString();
    const result: ProjectBudgetRolloverResult = {
      oldBudget: {
        id: command.oldBudgetId,
        previousStatus: 'ACTIVE',
        status: 'CONSUMED',
        previousVersion: 1,
        version: 2,
      },
      successorBudget: {
        id: successorBudgetId,
        status: 'ACTIVE',
        version: 1,
        monetaryCeilingMicroUsd: SUCCESSOR_CEILING_MICROUSD,
      },
      canonicalCommittedMicroUsd: CANONICAL_COMMITTED_MICROUSD,
      ambiguousExposureMicroUsd: AMBIGUOUS_EXPOSURE_MICROUSD,
      auditEventId,
      idempotentReplay: false,
    };
    const metadata = JSON.stringify({
      oldBudgetId: command.oldBudgetId,
      oldBudgetVersionBefore: 1,
      oldBudgetVersionAfter: 2,
      oldStatus: 'ACTIVE',
      oldNewStatus: 'CONSUMED',
      successorBudgetId,
      successorVersion: 1,
      successorStatus: 'ACTIVE',
      originalCeilingMicroUsd: ORIGINAL_CEILING_MICROUSD,
      canonicalCommittedMicroUsd: CANONICAL_COMMITTED_MICROUSD,
      ambiguousExposureMicroUsd: AMBIGUOUS_EXPOSURE_MICROUSD,
      successorCeilingMicroUsd: SUCCESSOR_CEILING_MICROUSD,
      ambiguousReservationIds: [command.expectedAmbiguousReservationId],
      reason: command.reason,
      actor: this.actor.id,
      role: this.actor.roles[0] ?? null,
      workspace: this.actor.workspaceId,
      project: projectId,
      environment: this.context.environment,
      requestId: this.context.requestId,
      timestamp: at,
      idempotencyKey: key,
      operation: ROLLOVER_OPERATION,
      commandHash,
      result,
    });

    const guardedSource = guardedSourcePredicate('b', this.policy);
    const guardedOldSource = guardedSourcePredicate('old', this.policy);
    const updateSql = `UPDATE editorial_project_execution_budgets AS b
      SET status='CONSUMED',version=2,updated_at=?
      WHERE b.id=? AND b.workspace_id=? AND b.project_id=? AND b.status='ACTIVE' AND b.version=1
        AND ${guardedSource}`;
    const insertSql = `INSERT INTO editorial_project_execution_budgets(id,workspace_id,project_id,profile_key,profile_version,currency,monetary_ceiling_microusd,status,authorized_by,created_at,updated_at,version)
      SELECT ?,b.workspace_id,b.project_id,b.profile_key,b.profile_version,b.currency,
        b.monetary_ceiling_microusd-COALESCE((SELECT sum(CASE r.status WHEN 'RECONCILED' THEN r.actual_microusd WHEN 'CANCELLED' THEN 0 ELSE r.reserved_microusd END) FROM editorial_execution_reservations r WHERE r.project_execution_budget_id=b.id),0),
        'ACTIVE',?,?,?,1
      FROM editorial_project_execution_budgets b
      WHERE b.id=? AND b.workspace_id=? AND b.project_id=? AND b.status='CONSUMED' AND b.version=2 AND b.updated_at=?
        AND ${guardedSource}
        AND b.monetary_ceiling_microusd-COALESCE((SELECT sum(CASE r.status WHEN 'RECONCILED' THEN r.actual_microusd WHEN 'CANCELLED' THEN 0 ELSE r.reserved_microusd END) FROM editorial_execution_reservations r WHERE r.project_execution_budget_id=b.id),0)>0`;
    const auditSql = `INSERT INTO audit_events(id,workspace_id,actor_type,actor_id,actor_role,access_issuer,access_subject,action,resource_type,resource_id,outcome,request_id,environment,metadata_json,occurred_at,ingested_at)
      VALUES(?,?,'user',?,?,?,?,
        (SELECT ? FROM editorial_project_execution_budgets s JOIN editorial_project_execution_budgets old ON old.id=?
         WHERE s.id=? AND s.workspace_id=? AND s.project_id=? AND s.profile_key='${PROFILE}' AND s.profile_version=1
           AND s.currency='USD' AND s.status='ACTIVE' AND s.version=1 AND s.monetary_ceiling_microusd=907875
           AND old.workspace_id=s.workspace_id AND old.project_id=s.project_id AND old.profile_key=s.profile_key
           AND old.profile_version=s.profile_version AND old.currency=s.currency AND old.status='CONSUMED'
           AND old.version=2 AND old.monetary_ceiling_microusd=1331520 AND old.updated_at=?
           AND s.created_at=? AND s.updated_at=?
           AND (SELECT count(*) FROM editorial_project_execution_budgets x WHERE x.workspace_id=s.workspace_id AND x.project_id=s.project_id AND x.profile_key=s.profile_key AND x.profile_version=s.profile_version AND x.status='ACTIVE')=1
           AND NOT EXISTS(SELECT 1 FROM editorial_execution_envelopes e WHERE e.project_execution_budget_id=s.id)
           AND NOT EXISTS(SELECT 1 FROM editorial_execution_reservations r WHERE r.project_execution_budget_id=s.id)
            AND ${guardedOldSource}),
        'editorial_project_execution_budget',?,'success',?,?,?,?,?)`;
    try {
      await this.db.batch([
        this.db
          .prepare(updateSql)
          .bind(at, command.oldBudgetId, this.actor.workspaceId, projectId, this.actor.id),
        this.db
          .prepare(insertSql)
          .bind(
            successorBudgetId,
            this.actor.id,
            at,
            at,
            command.oldBudgetId,
            this.actor.workspaceId,
            projectId,
            at,
            this.actor.id,
          ),
        this.db
          .prepare(auditSql)
          .bind(
            auditEventId,
            this.actor.workspaceId,
            this.actor.id,
            this.actor.roles[0] ?? null,
            this.context.accessIssuer,
            this.context.accessSubject,
            ROLLOVER_OPERATION,
            command.oldBudgetId,
            successorBudgetId,
            this.actor.workspaceId,
            projectId,
            at,
            at,
            at,
            this.actor.id,
            successorBudgetId,
            this.context.requestId,
            this.context.environment,
            metadata,
            at,
            at,
          ),
      ]);
    } catch (error) {
      const concurrent = await this.replay(auditEventId, projectId, key, commandHash);
      if (concurrent) return concurrent;
      const current = await this.snapshot(projectId, command);
      if (!snapshotValid(current, command.expectedAmbiguousReservationId, this.policy))
        throw new ProjectBudgetRolloverError(409, 'execution_budget_rollover_conflict');
      throw error;
    }
    return result;
  }
}
