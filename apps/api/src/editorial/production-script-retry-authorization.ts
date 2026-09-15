import { productionScriptRetryAuthorizationResultSchema } from '@vision-maxson/contracts';
import { hasPermission, newId } from '@vision-maxson/domain';
import type { EditorialActor } from './repository';
import {
  assertEditorialProductionReady,
  researchRemediationClaimGuard,
  type ResearchRemediationIdentity,
} from './readiness';
import {
  productionScriptRetrySchemaReady,
  productionScriptRetrySchemaPredicate,
} from '../../../../packages/db/src/phase3-schema';

type Row = Record<string, unknown>;
type Context = {
  requestId: string;
  environment: string;
  accessIssuer?: string | undefined;
  accessSubject?: string | undefined;
};
export const PRODUCTION_SCRIPT_RETRY_PROFILE = 'phase3_production_script_retry_v1';
export const PRODUCTION_SCRIPT_RETRY_CEILING = 2970;

export class ProductionScriptRetryError extends Error {
  constructor(
    readonly status: 403 | 404 | 409 | 422 | 500,
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
  return [...new Uint8Array(bytes)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

function resultFrom(row: Row) {
  try {
    const result = productionScriptRetryAuthorizationResultSchema.parse(
      JSON.parse(String(row.result_json)),
    );
    if (
      result.capacityId !== row.id ||
      result.attestationId !== row.legacy_attestation_id ||
      result.projectId !== row.project_id ||
      result.revisionRequestId !== row.revision_request_id ||
      result.failedRunId !== row.failed_run_id ||
      result.briefVersionId !== row.brief_version_id ||
      result.budgetId !== row.budget_id ||
      result.envelopeId !== row.envelope_id ||
      result.auditEventId !== row.audit_event_id
    )
      throw new Error();
    return result;
  } catch {
    throw new ProductionScriptRetryError(500, 'production_script_retry_receipt_invalid');
  }
}

const eligibilitySql = `SELECT * FROM production_script_legacy_incident_live
 WHERE workspace_id=? AND project_id=? AND revision_request_id=? AND brief_version_id=?`;

export class ProductionScriptRetryAuthorizationService {
  constructor(
    private readonly db: D1Database,
    private readonly actor: EditorialActor,
    private readonly context: Context,
  ) {}

  private async replay(key: string, commandHash: string, projectId: string) {
    const row = await this.db
      .prepare(
        'SELECT * FROM editorial_production_script_retry_capacities WHERE workspace_id=? AND idempotency_key=?',
      )
      .bind(this.actor.workspaceId, key)
      .first<Row>();
    if (!row) return null;
    if (row.project_id !== projectId || row.command_hash !== commandHash)
      throw new ProductionScriptRetryError(409, 'production_script_retry_idempotency_conflict');
    return { ...resultFrom(row), idempotentReplay: true };
  }

  async authorize(projectId: string, key: string): Promise<never> {
    if (!projectId || !key.trim())
      throw new ProductionScriptRetryError(422, 'production_script_retry_command_invalid');
    if (!hasPermission(this.actor.roles, 'providers:admin') || !this.actor.roles.includes('owner'))
      throw new ProductionScriptRetryError(403, 'production_script_retry_not_allowed');
    if (!(await productionScriptRetrySchemaReady(this.db)))
      throw new ProductionScriptRetryError(422, 'production_script_retry_schema_unavailable');
    throw new ProductionScriptRetryError(422, 'structured_remediation_evidence_unavailable');
  }
  async attestLegacy(projectId: string, key: string) {
    key = key.trim();
    if (!key || key.length > 200)
      throw new ProductionScriptRetryError(422, 'production_script_retry_command_invalid');
    if (!hasPermission(this.actor.roles, 'providers:admin') || !this.actor.roles.includes('owner'))
      throw new ProductionScriptRetryError(403, 'production_script_retry_not_allowed');
    if (!(await productionScriptRetrySchemaReady(this.db)))
      throw new ProductionScriptRetryError(422, 'production_script_retry_schema_unavailable');
    if (
      this.context.environment !== 'staging' ||
      this.actor.workspaceId !== 'workspace_primary' ||
      projectId !== 'project_2135b883-8499-48e9-a4a7-bb04b970d72a'
    )
      throw new ProductionScriptRetryError(404, 'project_not_found');
    const commandHash = await digest({
      operation: 'legacy_remediation_attest_v1',
      projectId,
      workspaceId: this.actor.workspaceId,
      environment: this.context.environment,
    });
    const replay = await this.replay(key, commandHash, projectId);
    if (replay) return replay;
    const project = await this.db
      .prepare('SELECT id FROM projects WHERE id=? AND workspace_id=? AND deleted_at IS NULL')
      .bind(projectId, this.actor.workspaceId)
      .first();
    if (!project) throw new ProductionScriptRetryError(404, 'project_not_found');
    const readiness = await assertEditorialProductionReady(
      this.db,
      this.actor,
      projectId,
      'BEFORE_PRODUCTION_SCRIPT',
    ).catch(() => null);
    if (!readiness?.remediationIdentity)
      throw new ProductionScriptRetryError(409, 'production_script_retry_ineligible');
    const identity = readiness.remediationIdentity;
    const failures = (
      await this.db
        .prepare(eligibilitySql)
        .bind(this.actor.workspaceId, projectId, identity.requestId, identity.briefVersionId)
        .all<Row>()
    ).results;
    if (failures.length !== 1)
      throw new ProductionScriptRetryError(409, 'production_script_retry_ineligible');
    const failure = failures[0]!;
    if (key === failure.failed_execution_idempotency_key)
      throw new ProductionScriptRetryError(409, 'historical_execution_key_forbidden');
    const attestationId = newId('legacy_remediation_attestation');
    const evidenceBundleHash = await digest(JSON.parse(String(failure.evidence_json)));
    const declaration = {
      observedState: 'PROVIDER_COMPLETED_NO_DURABLE_SCRIPT_SUCCESSOR' as const,
      evidenceGap: 'PERSISTENCE_STAGE_CAUSE_NOT_DURABLY_RECORDED' as const,
      exceptionClass: 'LEGACY_PRODUCTION_SCRIPT_REMEDIATION_V1' as const,
      authorizationBasis: 'LEGACY_OWNER_ATTESTED_EXCEPTION' as const,
    };
    const policy = await this.db
      .prepare('SELECT * FROM production_script_retry_eligible_policy')
      .first<Row>();
    if (!policy)
      throw new ProductionScriptRetryError(422, 'production_script_retry_policy_unavailable');
    const result = productionScriptRetryAuthorizationResultSchema.parse({
      capacityId: newId('production_script_retry_capacity'),
      attestationId,
      evidenceBundleHash,
      ...declaration,
      projectId,
      revisionRequestId: identity.requestId,
      failedRunId: failure.failed_run_id,
      failedAttemptId: failure.failed_attempt_id,
      failedReservationId: failure.failed_reservation_id,
      failedEnvelopeId: failure.failed_envelope_id,
      briefArtifactId: identity.briefArtifactId,
      briefVersionId: identity.briefVersionId,
      scriptArtifactId: failure.script_artifact_id,
      expectedCurrentScriptVersionId: failure.script_version_id,
      budgetId: newId('project_execution_budget'),
      envelopeId: newId('execution_envelope'),
      auditEventId: newId('audit'),
      profileKey: PRODUCTION_SCRIPT_RETRY_PROFILE,
      profileVersion: 1,
      boundedProfileKey: 'phase3_short_de_review_es_v1',
      boundedProfileVersion: 1,
      stageKey: 'SCRIPT_WRITER_SHORT',
      monetaryCeilingMicrousd: PRODUCTION_SCRIPT_RETRY_CEILING,
      maximumCalls: 1,
    });
    const at = new Date().toISOString();
    const metadata = {
      ...result,
      historicalCauseAutomaticallyProven: false,
      ownerApprovedSingleLegacyException: true,
      incidentCode: 'canonical_script_legacy_v1',
      providerRequestId: failure.provider_request_id,
      terminalAuditId: failure.terminal_audit_id,
      historicalActualMicrousd: 715,
      briefContentHash: identity.briefHash,
      workspaceId: this.actor.workspaceId,
      actorId: this.actor.id,
      actorRole: 'owner',
      environment: this.context.environment,
      providerId: policy.provider_id,
      modelId: policy.provider_model_id,
      promptVersionId: policy.prompt_version_id,
      pricingSnapshotId: policy.pricing_snapshot_id,
      failedExecutionIdempotencyKey: failure.failed_execution_idempotency_key,
    };
    const receipt: Row = {
      id: result.capacityId,
      legacy_attestation_id: attestationId,
      workspace_id: this.actor.workspaceId,
      project_id: projectId,
      revision_request_id: identity.requestId,
      expected_project_version: identity.projectVersion,
      required_project_status: 'ANALYZING',
      failed_run_id: failure.failed_run_id,
      failed_attempt_id: failure.failed_attempt_id,
      failed_reservation_id: failure.failed_reservation_id,
      failed_envelope_id: failure.failed_envelope_id,
      failed_execution_idempotency_key: failure.failed_execution_idempotency_key,
      failed_actual_microusd: failure.failed_actual_microusd,
      brief_artifact_id: identity.briefArtifactId,
      brief_version_id: identity.briefVersionId,
      brief_approval_id: failure.brief_approval_id,
      brief_content_hash: identity.briefHash,
      expected_brief_artifact_revision: identity.briefRevision,
      script_artifact_id: failure.script_artifact_id,
      expected_current_script_version_id: failure.script_version_id,
      expected_script_artifact_revision: failure.script_artifact_revision,
      expected_script_content_hash: failure.script_content_hash,
      budget_id: result.budgetId,
      envelope_id: result.envelopeId,
      economic_profile_key: PRODUCTION_SCRIPT_RETRY_PROFILE,
      economic_profile_version: 1,
      bounded_profile_key: 'phase3_short_de_review_es_v1',
      bounded_profile_version: 1,
      stage_key: 'SCRIPT_WRITER_SHORT',
      monetary_ceiling_microusd: PRODUCTION_SCRIPT_RETRY_CEILING,
      maximum_calls: 1,
      maximum_attempts: 1,
      sdk_max_retries: 0,
      fallback_enabled: 0,
      creative_regeneration_enabled: 0,
      external_tools_enabled: 0,
      external_research_enabled: 0,
      human_approval_required: 1,
      provider_id: policy.provider_id,
      provider_model_id: policy.provider_model_id,
      prompt_version_id: policy.prompt_version_id,
      pricing_snapshot_id: policy.pricing_snapshot_id,
      policy_snapshot_json: policy.policy_snapshot_json,
      request_id: this.context.requestId,
      actor_id: this.actor.id,
      actor_role: 'owner',
      environment: this.context.environment,
      audit_event_id: result.auditEventId,
      idempotency_key: key,
      command_hash: commandHash,
      result_json: JSON.stringify(result),
      created_at: at,
    };
    const attestation: Row = {
      ...receipt,
      id: attestationId,
      incident_code: 'canonical_script_legacy_v1',
      observed_state: declaration.observedState,
      evidence_gap: declaration.evidenceGap,
      exception_class: declaration.exceptionClass,
      authorization_basis: declaration.authorizationBasis,
      rationale_code: 'OWNER_APPROVED_SINGLE_HISTORICAL_EXCEPTION',
      schema_capability_version: 16,
      provider_request_id: failure.provider_request_id,
      input_tokens: 1184,
      output_tokens: 398,
      cached_tokens: 0,
      reasoning_tokens: 0,
      terminal_audit_id: failure.terminal_audit_id,
      evidence_json: failure.evidence_json,
      evidence_bundle_hash: evidenceBundleHash,
    };
    delete attestation.legacy_attestation_id;
    try {
      await this.db.batch([
        researchRemediationClaimGuard(this.db, identity),
        this.db
          .prepare(
            `INSERT INTO editorial_project_execution_budgets(id,workspace_id,project_id,profile_key,profile_version,currency,monetary_ceiling_microusd,status,authorized_by,created_at,updated_at,version) VALUES(?,?,?, ?,1,'USD',2970,'ACTIVE',?,?,?,1)`,
          )
          .bind(
            result.budgetId,
            this.actor.workspaceId,
            projectId,
            PRODUCTION_SCRIPT_RETRY_PROFILE,
            this.actor.id,
            at,
            at,
          ),
        this.db
          .prepare(
            `INSERT INTO editorial_execution_envelopes(id,workspace_id,project_id,profile_key,profile_version,provider_id,provider_model_id,currency,monetary_ceiling_microusd,maximum_calls,status,authorized_by,created_at,updated_at,version,project_execution_budget_id,stage_key) VALUES(?,?,?, ?,1,?,?,'USD',2970,1,'ACTIVE',?,?,?,1,?,'SCRIPT_WRITER_SHORT')`,
          )
          .bind(
            result.envelopeId,
            this.actor.workspaceId,
            projectId,
            PRODUCTION_SCRIPT_RETRY_PROFILE,
            policy.provider_id,
            policy.provider_model_id,
            this.actor.id,
            at,
            at,
            result.budgetId,
          ),
        this.db
          .prepare(
            `INSERT INTO audit_events(id,workspace_id,actor_type,actor_id,actor_role,access_issuer,access_subject,action,resource_type,resource_id,outcome,request_id,environment,metadata_json,occurred_at,ingested_at) VALUES(?,?,'user',?,'owner',?,?,'editorial.legacy_remediation_attested','editorial_legacy_remediation_attestation',?,'success',?,?,?,?,?)`,
          )
          .bind(
            result.auditEventId,
            this.actor.workspaceId,
            this.actor.id,
            this.context.accessIssuer ?? null,
            this.context.accessSubject ?? null,
            attestationId,
            this.context.requestId,
            this.context.environment,
            JSON.stringify(metadata),
            at,
            at,
          ),
        this.db
          .prepare(
            `INSERT INTO editorial_legacy_remediation_attestations(${Object.keys(attestation).join(',')}) VALUES(${Object.keys(
              attestation,
            )
              .map(() => '?')
              .join(',')})`,
          )
          .bind(...Object.values(attestation)),
        this.db
          .prepare(
            `INSERT INTO editorial_production_script_retry_capacities(${Object.keys(receipt).join(',')}) VALUES(${Object.keys(
              receipt,
            )
              .map(() => '?')
              .join(',')})`,
          )
          .bind(...Object.values(receipt)),
        this.db
          .prepare(
            `SELECT CASE WHEN (${productionScriptRetrySchemaPredicate}) AND EXISTS(SELECT 1 FROM editorial_production_script_retry_capacities c JOIN editorial_legacy_remediation_attestations a ON a.id=c.legacy_attestation_id WHERE c.id=? AND a.id=? AND a.evidence_bundle_hash=?) THEN 1 ELSE json('legacy_attestation_incomplete') END`,
          )
          .bind(result.capacityId, attestationId, evidenceBundleHash),
      ]);
    } catch {
      const winner = await this.replay(key, commandHash, projectId);
      if (winner) return winner;
      if (!(await productionScriptRetrySchemaReady(this.db)))
        throw new ProductionScriptRetryError(422, 'production_script_retry_schema_unavailable');
      throw new ProductionScriptRetryError(409, 'production_script_retry_authorization_conflict');
    }
    return { ...result, idempotentReplay: false };
  }
}

export async function productionScriptRetryRequired(
  db: D1Database,
  actor: EditorialActor,
  projectId: string,
  identity: Pick<ResearchRemediationIdentity, 'briefVersionId'>,
) {
  const schemaReady = await productionScriptRetrySchemaReady(db);
  const row = await db
    .prepare(
      `SELECT 1 ok FROM intelligence_runs ir
       JOIN intelligence_run_attempts ia ON ia.intelligence_run_id=ir.id AND ia.provider_request_id IS NOT NULL
       JOIN editorial_execution_reservations r ON r.intelligence_run_id=ir.id AND r.status='RECONCILED' AND r.dispatched_at IS NOT NULL
       WHERE ir.workspace_id=? AND ir.project_id=? AND ir.task_type='SCRIPT_WRITER_SHORT'
       AND ir.input_artifact_version_id=? AND ir.status='FAILED_PERMANENT' AND ir.output_artifact_version_id IS NULL
       AND (SELECT count(*) FROM intelligence_run_attempts x WHERE x.intelligence_run_id=ir.id)=1 LIMIT 1`,
    )
    .bind(actor.workspaceId, projectId, identity.briefVersionId)
    .first();
  if (row && !schemaReady)
    throw new ProductionScriptRetryError(422, 'production_script_retry_schema_unavailable');
  return Boolean(row);
}

export async function loadProductionScriptRetryAuthorization(
  db: D1Database,
  actor: EditorialActor,
  projectId: string,
  capacityId: string,
  identity: ResearchRemediationIdentity,
  executionIdempotencyKey: string,
  environment: string,
) {
  if (!(await productionScriptRetrySchemaReady(db)))
    throw new ProductionScriptRetryError(422, 'production_script_retry_schema_unavailable');
  const row = await db
    .prepare(
      `SELECT c.*,e.id envelopeId,e.project_execution_budget_id projectExecutionBudgetId,e.status envelopeStatus
       FROM editorial_production_script_retry_capacities c
       JOIN production_script_retry_execution_eligible x ON x.capacity_id=c.id AND x.workspace_id=c.workspace_id AND x.project_id=c.project_id
        AND x.revision_request_id=c.revision_request_id AND x.failed_run_id=c.failed_run_id AND x.failed_attempt_id=c.failed_attempt_id
        AND x.failed_reservation_id=c.failed_reservation_id AND x.brief_version_id=c.brief_version_id
        AND x.expected_current_script_version_id=c.expected_current_script_version_id
       JOIN production_script_retry_eligible_policy pol ON pol.provider_id=c.provider_id AND pol.provider_model_id=c.provider_model_id
        AND pol.prompt_version_id=c.prompt_version_id AND pol.pricing_snapshot_id=c.pricing_snapshot_id AND pol.policy_snapshot_json=c.policy_snapshot_json
       JOIN editorial_project_execution_budgets b ON b.id=c.budget_id AND b.workspace_id=c.workspace_id AND b.project_id=c.project_id
        AND b.profile_key=c.economic_profile_key AND b.status='ACTIVE' AND b.monetary_ceiling_microusd=2970
       JOIN editorial_execution_envelopes e ON e.id=c.envelope_id AND e.project_execution_budget_id=b.id AND e.workspace_id=c.workspace_id
        AND e.project_id=c.project_id AND e.profile_key=c.economic_profile_key AND e.status='ACTIVE' AND e.maximum_calls=1
        AND e.stage_key='SCRIPT_WRITER_SHORT' AND e.monetary_ceiling_microusd=2970
       WHERE c.id=? AND c.workspace_id=? AND c.project_id=? AND c.revision_request_id=? AND c.brief_version_id=?
        AND c.environment=? AND c.failed_execution_idempotency_key<>? AND c.idempotency_key<>? AND c.actor_id=?
        AND NOT EXISTS(SELECT 1 FROM editorial_execution_reservations used WHERE used.envelope_id=e.id)`,
    )
    .bind(
      capacityId,
      actor.workspaceId,
      projectId,
      identity.requestId,
      identity.briefVersionId,
      environment,
      executionIdempotencyKey,
      executionIdempotencyKey,
      actor.id,
    )
    .first<Row>();
  if (!row)
    throw new ProductionScriptRetryError(409, 'production_script_retry_execution_binding_invalid');
  resultFrom(row);
  return { ...row, capacityId: row.id, id: row.envelopeId };
}

export function productionScriptRetryClaimGuard(
  db: D1Database,
  capacityId: string,
  actor: EditorialActor,
  projectId: string,
  executionPolicyJson: string,
) {
  return db
    .prepare(
      `SELECT CASE WHEN (${productionScriptRetrySchemaPredicate}) AND EXISTS(SELECT 1 FROM editorial_production_script_retry_capacities c
       JOIN production_script_retry_execution_eligible eligible ON eligible.capacity_id=c.id
       JOIN editorial_project_execution_budgets b ON b.id=c.budget_id AND b.status='ACTIVE'
       JOIN editorial_execution_envelopes e ON e.id=c.envelope_id AND e.project_execution_budget_id=b.id AND e.status='ACTIVE'
       WHERE c.id=? AND c.workspace_id=? AND c.project_id=? AND c.stage_key='SCRIPT_WRITER_SHORT'
       AND json_extract(c.policy_snapshot_json,'$.execution')=json(?)
       AND EXISTS(SELECT 1 FROM users u JOIN user_roles ur ON ur.user_id=u.id AND ur.workspace_id=c.workspace_id JOIN roles ro ON ro.id=ur.role_id WHERE u.id=c.actor_id AND u.workspace_id=c.workspace_id AND u.status='active' AND u.deleted_at IS NULL AND ro.key='owner')
       AND NOT EXISTS(SELECT 1 FROM editorial_execution_reservations r WHERE r.envelope_id=e.id))
       THEN 1 ELSE json('production_script_retry_claim_changed') END`,
    )
    .bind(capacityId, actor.workspaceId, projectId, executionPolicyJson);
}

export function productionScriptRetryClaimAudit(
  db: D1Database,
  actor: EditorialActor,
  context: Context,
  capacityId: string,
  runId: string,
  reservationId: string,
  at: string,
) {
  return db
    .prepare(
      `INSERT INTO audit_events(id,workspace_id,actor_type,actor_id,actor_role,access_issuer,access_subject,action,resource_type,resource_id,outcome,request_id,environment,metadata_json,occurred_at,ingested_at)
       SELECT ?,c.workspace_id,'user',?,'owner',?,?,'editorial.legacy_remediation_claimed','editorial_production_script_retry_capacity',c.id,'success',?,?,json_object('capacityId',c.id,'failedRunId',c.failed_run_id,'runId',?,'reservationId',?,'revisionRequestId',c.revision_request_id,'briefVersionId',c.brief_version_id,'budgetId',c.budget_id,'envelopeId',c.envelope_id,'monetaryCeilingMicrousd',2970),?,?
       FROM editorial_production_script_retry_capacities c WHERE c.id=? AND c.workspace_id=?`,
    )
    .bind(
      newId('audit'),
      actor.id,
      context.accessIssuer ?? null,
      context.accessSubject ?? null,
      context.requestId,
      context.environment,
      runId,
      reservationId,
      at,
      at,
      capacityId,
      actor.workspaceId,
    );
}

export async function authorizeProductionScriptRetryDispatch(
  db: D1Database,
  actor: EditorialActor,
  context: Context,
  capacityId: string,
  runId: string,
  attempt: number,
  executionPolicyJson: string,
) {
  const at = new Date().toISOString();
  const attemptId = newId('attempt');
  await db.batch([
    db
      .prepare(
        `UPDATE editorial_execution_reservations SET status='DISPATCHED',dispatched_at=? WHERE intelligence_run_id=? AND workspace_id=? AND status='RESERVED' AND EXISTS(SELECT 1 FROM editorial_production_script_retry_capacities c WHERE c.id=? AND c.envelope_id=editorial_execution_reservations.envelope_id AND c.budget_id=editorial_execution_reservations.project_execution_budget_id)`,
      )
      .bind(at, runId, actor.workspaceId, capacityId),
    db
      .prepare(
        `UPDATE intelligence_runs SET status='RUNNING',started_at=COALESCE(started_at,?),updated_at=?,version=version+1 WHERE id=? AND workspace_id=? AND status='QUEUED'`,
      )
      .bind(at, at, runId, actor.workspaceId),
    db
      .prepare(
        `INSERT INTO intelligence_run_attempts(id,intelligence_run_id,attempt_number,attempt_kind,status,safe_metadata_json,started_at) SELECT ?,id,?,'TECHNICAL','RUNNING',json_object('productionScriptRetryAuthorizationId',?),? FROM intelligence_runs WHERE id=? AND workspace_id=? AND status='RUNNING' AND NOT EXISTS(SELECT 1 FROM intelligence_run_attempts x WHERE x.intelligence_run_id=intelligence_runs.id)`,
      )
      .bind(attemptId, attempt, capacityId, at, runId, actor.workspaceId),
    db
      .prepare(
        `INSERT INTO audit_events(id,workspace_id,actor_type,actor_id,actor_role,access_issuer,access_subject,action,resource_type,resource_id,outcome,request_id,environment,metadata_json,occurred_at,ingested_at) SELECT ?,c.workspace_id,'user',?,'owner',?,?,'editorial.legacy_remediation_dispatch_authorized','editorial_production_script_retry_capacity',c.id,'success',?,?,json_object('capacityId',c.id,'failedRunId',c.failed_run_id,'runId',?,'attemptId',?,'revisionRequestId',c.revision_request_id,'briefVersionId',c.brief_version_id,'budgetId',c.budget_id,'envelopeId',c.envelope_id,'monetaryCeilingMicrousd',2970),?,? FROM editorial_production_script_retry_capacities c WHERE c.id=? AND c.workspace_id=? AND EXISTS(SELECT 1 FROM intelligence_run_attempts x WHERE x.id=? AND x.intelligence_run_id=?)`,
      )
      .bind(
        newId('audit'),
        actor.id,
        context.accessIssuer ?? null,
        context.accessSubject ?? null,
        context.requestId,
        context.environment,
        runId,
        attemptId,
        at,
        at,
        capacityId,
        actor.workspaceId,
        attemptId,
        runId,
      ),
    db
      .prepare(
        `SELECT CASE WHEN (${productionScriptRetrySchemaPredicate}) AND EXISTS(SELECT 1 FROM intelligence_runs ir
         JOIN editorial_execution_reservations r ON r.intelligence_run_id=ir.id
         JOIN intelligence_run_attempts a ON a.intelligence_run_id=ir.id
         JOIN editorial_production_script_retry_capacities c ON c.id=? AND c.workspace_id=ir.workspace_id AND c.project_id=ir.project_id
          AND c.envelope_id=r.envelope_id AND c.budget_id=r.project_execution_budget_id AND c.brief_version_id=ir.input_artifact_version_id
         JOIN production_script_retry_execution_eligible eligible ON eligible.capacity_id=c.id AND eligible.failed_run_id=c.failed_run_id
          AND eligible.brief_version_id=c.brief_version_id AND eligible.expected_current_script_version_id=c.expected_current_script_version_id
         WHERE ir.id=? AND ir.status='RUNNING' AND r.status='DISPATCHED' AND a.id=? AND a.status='RUNNING'
          AND json_extract(c.policy_snapshot_json,'$.execution')=json(?)
          AND EXISTS(SELECT 1 FROM editorial_legacy_remediation_claims claim JOIN editorial_execution_envelopes env ON env.id=c.envelope_id JOIN editorial_project_execution_budgets budget ON budget.id=c.budget_id
            WHERE claim.capacity_id=c.id AND claim.attestation_id=c.legacy_attestation_id AND claim.run_id=ir.id AND claim.reservation_id=r.id AND env.status='CONSUMED' AND budget.status='ACTIVE')
          AND ir.initiated_by=c.actor_id AND EXISTS(SELECT 1 FROM users u JOIN user_roles ur ON ur.user_id=u.id AND ur.workspace_id=c.workspace_id JOIN roles ro ON ro.id=ur.role_id WHERE u.id=c.actor_id AND u.workspace_id=c.workspace_id AND u.status='active' AND u.deleted_at IS NULL AND ro.key='owner')
          AND ir.task_type=c.stage_key AND ir.provider_id=c.provider_id AND ir.provider_model_id=c.provider_model_id
          AND ir.prompt_version_id=c.prompt_version_id AND ir.pricing_snapshot_id=c.pricing_snapshot_id
          AND r.reserved_microusd=c.monetary_ceiling_microusd
          AND (SELECT count(*) FROM intelligence_run_attempts x WHERE x.intelligence_run_id=ir.id)=1)
         THEN 1 ELSE json('production_script_retry_dispatch_changed') END`,
      )
      .bind(capacityId, runId, attemptId, executionPolicyJson),
  ]);
}

export function legacyRemediationClaimStatement(
  db: D1Database,
  capacityId: string,
  runId: string,
  reservationId: string,
  at: string,
) {
  return db
    .prepare(
      `INSERT INTO editorial_legacy_remediation_claims(id,attestation_id,capacity_id,run_id,reservation_id,audit_id,claimed_at)
 SELECT ?,c.legacy_attestation_id,c.id,?,?,a.id,? FROM editorial_production_script_retry_capacities c JOIN audit_events a ON a.resource_id=c.id AND a.action='editorial.legacy_remediation_claimed'
 WHERE c.id=? AND json_extract(a.metadata_json,'$.runId')=? AND json_extract(a.metadata_json,'$.reservationId')=?`,
    )
    .bind(
      newId('legacy_remediation_claim'),
      runId,
      reservationId,
      at,
      capacityId,
      runId,
      reservationId,
    );
}
