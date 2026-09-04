import { ProviderError } from '@vision-maxson/providers';
import {
  PHASE3_SHORT_DE_REVIEW_ES_PROFILE,
  reserveMicrousd,
  type BoundedExecutionProfile,
  type BoundedProfileStep,
} from '@vision-maxson/providers/execution-profile';
import type { EditorialActor } from './repository';

type Row = Record<string, unknown>;
const newId = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;
const now = () => new Date().toISOString();

export async function authorizePhase3Envelope(
  db: D1Database,
  actor: EditorialActor,
  projectId: string,
  profile: BoundedExecutionProfile,
) {
  const project = await db
    .prepare(
      `SELECT id,format,operating_mode AS operatingMode,primary_language AS primaryLanguage FROM projects WHERE id=? AND workspace_id=? AND deleted_at IS NULL`,
    )
    .bind(projectId, actor.workspaceId)
    .first<Row>();
  if (!project) throw new Error('project_not_found');
  if (
    project.format !== profile.projectFormat ||
    project.operatingMode !== profile.operatingMode ||
    project.primaryLanguage !== profile.productionLanguage
  )
    throw new Error('project_not_eligible_for_execution_profile');
  if (profile.key === PHASE3_SHORT_DE_REVIEW_ES_PROFILE) {
    const brief = await db
      .prepare(
        `SELECT v.content_json AS contentJson FROM editorial_artifacts a JOIN editorial_artifact_versions v ON v.id=a.current_version_id WHERE a.workspace_id=? AND a.project_id=? AND a.artifact_type='CONTENT_BRIEF' AND a.status='approved' AND a.deleted_at IS NULL`,
      )
      .bind(actor.workspaceId, projectId)
      .first<Row>();
    let content: Row | null = null;
    if (typeof brief?.contentJson === 'string')
      try {
        content = JSON.parse(brief.contentJson) as Row;
      } catch {
        content = null;
      }
    if (
      content?.format !== profile.projectFormat ||
      content.productionLanguage !== profile.productionLanguage ||
      content.reviewLanguage !== profile.reviewLanguage
    )
      throw new Error('project_not_eligible_for_execution_profile');
  }
  const model = await db
    .prepare(
      `SELECT p.id AS providerId,m.id AS modelId FROM ai_providers p JOIN ai_provider_models m ON m.provider_id=p.id WHERE p.key=? AND m.model_key=? AND p.status='configured' AND m.status='available'`,
    )
    .bind(profile.providerKey, profile.modelKey)
    .first<Row>();
  if (!model) throw new Error('approved_provider_model_unavailable');
  const existing = await db
    .prepare(
      `SELECT id,status FROM editorial_execution_envelopes WHERE workspace_id=? AND project_id=? AND profile_key=? AND profile_version=? AND status='ACTIVE'`,
    )
    .bind(actor.workspaceId, projectId, profile.key, profile.version)
    .first<Row>();
  if (existing) return { envelope: existing, idempotent: true };
  const id = newId('execution_envelope'),
    at = now();
  await db
    .prepare(
      `INSERT INTO editorial_execution_envelopes(id,workspace_id,project_id,profile_key,profile_version,provider_id,provider_model_id,currency,monetary_ceiling_microusd,maximum_calls,status,authorized_by,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,'USD',?,?,'ACTIVE',?,?,?,1)`,
    )
    .bind(
      id,
      actor.workspaceId,
      projectId,
      profile.key,
      profile.version,
      model.providerId,
      model.modelId,
      profile.monetaryCeilingMicrousd,
      profile.maximumDispatches,
      actor.id,
      at,
      at,
    )
    .run();
  return { envelope: { id, status: 'ACTIVE' }, idempotent: false };
}

export async function loadBoundedEnvelope(
  db: D1Database,
  actor: EditorialActor,
  projectId: string,
  selected: { providerKey: string; modelKey: string },
  profile: BoundedExecutionProfile,
) {
  if (selected.providerKey !== profile.providerKey || selected.modelKey !== profile.modelKey)
    throw new ProviderError(
      'UNAVAILABLE',
      false,
      'Selected model is outside the bounded execution profile.',
    );
  const envelope = await db
    .prepare(
      `SELECT e.id,e.monetary_ceiling_microusd AS monetaryCeilingMicrousd,e.maximum_calls AS maximumCalls,e.status,COALESCE(SUM(r.reserved_microusd),0) AS reservedMicrousd,COUNT(r.id) AS reservationCount FROM editorial_execution_envelopes e LEFT JOIN editorial_execution_reservations r ON r.envelope_id=e.id WHERE e.workspace_id=? AND e.project_id=? AND e.profile_key=? AND e.profile_version=? AND e.provider_id=(SELECT id FROM ai_providers WHERE key=?) AND e.provider_model_id=(SELECT id FROM ai_provider_models WHERE model_key=? AND provider_id=e.provider_id) AND e.status='ACTIVE' GROUP BY e.id`,
    )
    .bind(
      actor.workspaceId,
      projectId,
      profile.key,
      profile.version,
      selected.providerKey,
      selected.modelKey,
    )
    .first<Row>();
  if (!envelope)
    throw new ProviderError('UNAVAILABLE', false, 'An authorized execution envelope is required.');
  return envelope;
}

export function calculateReservation(
  row: Row,
  step: BoundedProfileStep,
  profile: BoundedExecutionProfile,
) {
  const stepPolicy = profile.steps[step];
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
      stepPolicy.inputTokenCeiling,
      stepPolicy.maxOutputTokens,
    );
  } catch {
    throw new ProviderError(
      'UNAVAILABLE',
      false,
      'Current compatible verified pricing is required.',
    );
  }
}

export function reservationStatement(
  db: D1Database,
  args: {
    envelopeId: string;
    workspaceId: string;
    projectId: string;
    runId: string;
    step: BoundedProfileStep;
    pricingSnapshotId: string;
    reservedMicrousd: number;
    at: string;
  },
) {
  return db
    .prepare(
      `INSERT INTO editorial_execution_reservations(id,envelope_id,workspace_id,project_id,intelligence_run_id,step_key,pricing_snapshot_id,reserved_microusd,status,created_at) VALUES(?,?,?,?,?,?,?,?,'RESERVED',?)`,
    )
    .bind(
      newId('execution_reservation'),
      args.envelopeId,
      args.workspaceId,
      args.projectId,
      args.runId,
      args.step,
      args.pricingSnapshotId,
      args.reservedMicrousd,
      args.at,
    );
}
