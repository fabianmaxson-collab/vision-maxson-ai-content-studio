import type { EditorialActor } from './repository';
import {
  loadStoryboardResearchClaimSnapshot,
  type StoryboardResearchClaimSnapshot,
} from './storyboard-research-claims';

export const STORYBOARD_SEGMENT_SNAPSHOT_POLICY_VERSION = 'storyboard_script_segments_v1';

export interface StoryboardSourceSegment {
  readonly id: string;
  readonly order: number;
  readonly text: string;
}

export interface StoryboardSegmentSnapshot {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly scriptVersionId: string;
  readonly segments: readonly StoryboardSourceSegment[];
  readonly canonicalJson: string;
  readonly count: number;
  readonly hash: string;
}

export async function createStoryboardSegmentSnapshot(
  workspaceId: string,
  projectId: string,
  scriptVersionId: string,
  rows: readonly StoryboardSourceSegment[],
): Promise<StoryboardSegmentSnapshot> {
  const segments = rows
    .map((row) => ({ id: row.id, order: row.order, text: row.text }))
    .sort(
      (left, right) =>
        left.order - right.order || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
    );
  if (
    segments.length === 0 ||
    segments.some(
      (segment, index) =>
        typeof segment.id !== 'string' ||
        !segment.id ||
        !Number.isSafeInteger(segment.order) ||
        segment.order !== index + 1 ||
        typeof segment.text !== 'string' ||
        !segment.text.trim(),
    ) ||
    new Set(segments.map((segment) => segment.id)).size !== segments.length
  )
    throw new Error('Storyboard source Script segments are invalid.');
  const canonicalJson = JSON.stringify(segments.map(({ id, order, text }) => [id, order, text]));
  const bytes = new TextEncoder().encode(canonicalJson);
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return Object.freeze({
    workspaceId,
    projectId,
    scriptVersionId,
    segments: Object.freeze(segments.map((segment) => Object.freeze(segment))),
    canonicalJson,
    count: segments.length,
    hash,
  });
}

export function storyboardSegmentSnapshotEvidence(snapshot: StoryboardSegmentSnapshot) {
  return {
    policyVersion: STORYBOARD_SEGMENT_SNAPSHOT_POLICY_VERSION,
    scriptVersionId: snapshot.scriptVersionId,
    segmentCount: snapshot.count,
    segmentHash: snapshot.hash,
    orderedSegmentRefs: snapshot.segments.slice(0, 64).map(({ id, order }) => [id, order]),
    refsComplete: snapshot.count <= 64,
  };
}

export interface StoryboardReplacementSnapshot {
  workspaceId: string;
  projectId: string;
  projectVersion: number;
  authoritativeProjectFormat: 'SHORT' | 'LONG_FORM';
  brandId: string;
  brandVersion: number;
  channelId: string;
  channelVersion: number;
  revisionId: string;
  storyboardArtifactId: string;
  storyboardVersionId: string;
  storyboardArtifactRevision: number;
  ideaCandidateId: string;
  ideaCandidateRevision: number;
  ideaVersionId: string;
  ideaArtifactRevision: number;
  ideaHash: string;
  researchVersionId: string;
  researchArtifactRevision: number;
  researchHash: string;
  briefVersionId: string;
  briefArtifactRevision: number;
  briefHash: string;
  scriptVersionId: string;
  scriptArtifactRevision: number;
  scriptHash: string;
  scriptLanguage: string;
  scriptSegmentSnapshot: StoryboardSegmentSnapshot;
  researchClaimSnapshot: StoryboardResearchClaimSnapshot;
  critiqueVersionId: string;
  critiqueArtifactRevision: number;
  critiqueHash: string;
  critiqueApprovalId: string;
  critiqueApprovalComment: string | null;
  researchContentJson: string;
  briefContentJson: string;
  scriptContentJson: string;
  critiqueContentJson: string;
}

const sourceQuery = `SELECT
 p.version projectVersion,p.format authoritativeProjectFormat,p.content_brand_id brandId,b.version brandVersion,
 p.channel_profile_id channelId,c.version channelVersion,
 rr.id revisionId,sa.id storyboardArtifactId,sv.id storyboardVersionId,sa.version storyboardArtifactRevision,
 ic.id ideaCandidateId,ic.version ideaCandidateRevision,iv.id ideaVersionId,ia.version ideaArtifactRevision,iv.content_hash ideaHash,
 rv.id researchVersionId,ra.version researchArtifactRevision,rv.content_hash researchHash,rv.content_json researchContentJson,
 bv.id briefVersionId,ba.version briefArtifactRevision,bv.content_hash briefHash,bv.content_json briefContentJson,
 pv.id scriptVersionId,pa.version scriptArtifactRevision,pv.content_hash scriptHash,pv.language_code scriptLanguage,pv.content_json scriptContentJson,
 cv.id critiqueVersionId,ca.version critiqueArtifactRevision,cv.content_hash critiqueHash,cv.content_json critiqueContentJson,
 ap.id critiqueApprovalId,ap.comment critiqueApprovalComment
 FROM projects p
 JOIN content_brands b ON b.id=p.content_brand_id AND b.workspace_id=p.workspace_id AND b.deleted_at IS NULL
 JOIN channel_profiles c ON c.id=p.channel_profile_id AND c.workspace_id=p.workspace_id AND c.deleted_at IS NULL
 JOIN editorial_revision_requests rr ON rr.workspace_id=p.workspace_id AND rr.project_id=p.id
 JOIN editorial_artifacts sa ON sa.id=rr.reviewed_artifact_id AND sa.workspace_id=p.workspace_id AND sa.project_id=p.id AND sa.artifact_type='STORYBOARD' AND sa.deleted_at IS NULL
 JOIN editorial_artifact_versions sv ON sv.id=rr.reviewed_artifact_version_id AND sv.artifact_id=sa.id AND sv.workspace_id=p.workspace_id
 JOIN editorial_artifacts ra ON ra.workspace_id=p.workspace_id AND ra.project_id=p.id AND ra.artifact_type='RESEARCH' AND ra.status='approved' AND ra.deleted_at IS NULL
 JOIN editorial_artifact_versions rv ON rv.id=ra.current_version_id AND rv.artifact_id=ra.id AND rv.workspace_id=p.workspace_id
 JOIN idea_candidates ic ON ic.workspace_id=p.workspace_id AND ic.project_id=p.id AND ic.status='SELECTED'
 JOIN editorial_artifacts ia ON ia.id=ic.artifact_id AND ia.workspace_id=p.workspace_id AND ia.project_id=p.id AND ia.artifact_type='IDEA_CANDIDATE' AND ia.status='approved' AND ia.deleted_at IS NULL AND ia.current_version_id=ic.artifact_version_id
 JOIN editorial_artifact_versions iv ON iv.id=ic.artifact_version_id AND iv.artifact_id=ia.id AND iv.workspace_id=p.workspace_id
 JOIN editorial_artifacts ba ON ba.workspace_id=p.workspace_id AND ba.project_id=p.id AND ba.artifact_type='CONTENT_BRIEF' AND ba.status='approved' AND ba.deleted_at IS NULL
 JOIN editorial_artifact_versions bv ON bv.id=ba.current_version_id AND bv.artifact_id=ba.id AND bv.workspace_id=p.workspace_id
 JOIN editorial_artifacts pa ON pa.workspace_id=p.workspace_id AND pa.project_id=p.id AND pa.artifact_type='PRODUCTION_SCRIPT' AND pa.status='approved' AND pa.deleted_at IS NULL
 JOIN editorial_artifact_versions pv ON pv.id=pa.current_version_id AND pv.artifact_id=pa.id AND pv.workspace_id=p.workspace_id
 JOIN editorial_artifacts ca ON ca.workspace_id=p.workspace_id AND ca.project_id=p.id AND ca.artifact_type='SCRIPT_CRITIQUE' AND ca.status='approved' AND ca.deleted_at IS NULL
 JOIN editorial_artifact_versions cv ON cv.id=ca.current_version_id AND cv.artifact_id=ca.id AND cv.workspace_id=p.workspace_id
 JOIN artifact_approvals ap ON ap.artifact_version_id=cv.id AND ap.workspace_id=p.workspace_id AND ap.decision='APPROVED'
 WHERE p.id=? AND p.workspace_id=? AND p.deleted_at IS NULL AND p.archived_at IS NULL
 AND rr.id=? AND rr.status='OPEN' AND rr.target_stage='RESEARCH'
 AND sa.current_version_id=sv.id AND sa.version=rr.reviewed_artifact_revision AND sa.status='active'
 AND sv.source_type='AI_GENERATED' AND rr.target_baseline_version_id<>rv.id
 AND pv.id=? AND pv.language_code=p.primary_language
 AND (SELECT COUNT(*) FROM idea_candidates x WHERE x.workspace_id=p.workspace_id AND x.project_id=p.id AND x.status='SELECTED')=1
 AND NOT EXISTS(SELECT 1 FROM editorial_revision_request_resolutions x WHERE x.revision_request_id=rr.id)
 AND (SELECT COUNT(*) FROM editorial_revision_requests q WHERE q.workspace_id=p.workspace_id AND q.project_id=p.id
   AND NOT EXISTS(SELECT 1 FROM editorial_revision_request_resolutions x WHERE x.revision_request_id=q.id))=1
 AND (SELECT COUNT(*) FROM artifact_approvals x WHERE x.artifact_version_id=sv.id AND x.decision='APPROVED')=0
 AND (SELECT COUNT(*) FROM artifact_approvals x WHERE x.artifact_version_id=cv.id AND x.decision='APPROVED')=1
 AND (SELECT COUNT(*) FROM artifact_approvals x WHERE x.artifact_version_id=cv.id)=1
 AND ap.comment IS NOT NULL AND length(trim(ap.comment))>0
 AND EXISTS(SELECT 1 FROM artifact_approvals x WHERE x.artifact_version_id=rv.id AND x.decision='APPROVED')
 AND EXISTS(SELECT 1 FROM artifact_approvals x WHERE x.artifact_version_id=iv.id AND x.decision='APPROVED')
 AND EXISTS(SELECT 1 FROM artifact_approvals x WHERE x.artifact_version_id=bv.id AND x.decision='APPROVED')
 AND EXISTS(SELECT 1 FROM artifact_approvals x WHERE x.artifact_version_id=pv.id AND x.decision='APPROVED')
 AND EXISTS(SELECT 1 FROM artifact_dependencies d WHERE d.workspace_id=p.workspace_id AND d.source_artifact_version_id=bv.id AND d.dependent_artifact_version_id=pv.id AND d.dependency_type='GENERATED_FROM' AND d.validity_status='CURRENT' AND d.invalidated_at IS NULL AND d.invalidated_by_version_id IS NULL)
 AND EXISTS(SELECT 1 FROM artifact_dependencies d WHERE d.workspace_id=p.workspace_id AND d.source_artifact_version_id=pv.id AND d.dependent_artifact_version_id=cv.id AND d.dependency_type='EVALUATES_SOURCE' AND d.validity_status='CURRENT' AND d.invalidated_at IS NULL AND d.invalidated_by_version_id IS NULL)
 AND EXISTS(SELECT 1 FROM artifact_dependencies d WHERE d.workspace_id=p.workspace_id AND d.source_artifact_version_id=rv.id AND d.dependent_artifact_version_id=iv.id AND d.dependency_type='GENERATED_FROM' AND d.validity_status='CURRENT' AND d.invalidated_at IS NULL AND d.invalidated_by_version_id IS NULL)
 AND EXISTS(SELECT 1 FROM artifact_dependencies d WHERE d.workspace_id=p.workspace_id AND d.source_artifact_version_id=iv.id AND d.dependent_artifact_version_id=bv.id AND d.dependency_type='GENERATED_FROM' AND d.validity_status='CURRENT' AND d.invalidated_at IS NULL AND d.invalidated_by_version_id IS NULL)
 AND EXISTS(SELECT 1 FROM artifact_dependencies d WHERE d.workspace_id=p.workspace_id AND d.source_artifact_version_id=rv.id AND d.dependent_artifact_version_id=bv.id AND d.dependency_type='USES_RESEARCH' AND d.validity_status='CURRENT' AND d.invalidated_at IS NULL AND d.invalidated_by_version_id IS NULL)
 AND EXISTS(SELECT 1 FROM artifact_dependencies d WHERE d.workspace_id=p.workspace_id AND d.source_artifact_version_id<>pv.id AND d.source_artifact_version_id IN (SELECT id FROM editorial_artifact_versions WHERE artifact_id=pa.id) AND d.dependent_artifact_version_id=sv.id AND d.dependency_type='GENERATED_FROM' AND d.validity_status='REAPPROVAL_REQUIRED' AND d.invalidated_at IS NOT NULL)
 AND EXISTS(SELECT 1 FROM artifact_dependencies d WHERE d.workspace_id=p.workspace_id AND d.source_artifact_version_id<>cv.id AND d.source_artifact_version_id IN (SELECT id FROM editorial_artifact_versions WHERE artifact_id=ca.id) AND d.dependent_artifact_version_id=sv.id AND d.dependency_type='INFORMED_BY' AND d.validity_status='REAPPROVAL_REQUIRED' AND d.invalidated_at IS NOT NULL)
 AND NOT EXISTS(SELECT 1 FROM artifact_dependencies d WHERE d.dependent_artifact_version_id IN (rv.id,iv.id,bv.id,pv.id,cv.id) AND (d.workspace_id<>p.workspace_id OR d.validity_status<>'CURRENT' OR d.invalidated_at IS NOT NULL OR d.invalidated_by_version_id IS NOT NULL))`;

const snapshotKeys = [
  'projectVersion',
  'authoritativeProjectFormat',
  'brandId',
  'brandVersion',
  'channelId',
  'channelVersion',
  'revisionId',
  'storyboardArtifactId',
  'storyboardVersionId',
  'storyboardArtifactRevision',
  'ideaCandidateId',
  'ideaCandidateRevision',
  'ideaVersionId',
  'ideaArtifactRevision',
  'ideaHash',
  'researchVersionId',
  'researchArtifactRevision',
  'researchHash',
  'briefVersionId',
  'briefArtifactRevision',
  'briefHash',
  'scriptVersionId',
  'scriptArtifactRevision',
  'scriptHash',
  'scriptLanguage',
  'critiqueVersionId',
  'critiqueArtifactRevision',
  'critiqueHash',
  'critiqueApprovalId',
  'critiqueApprovalComment',
] as const satisfies readonly (keyof StoryboardReplacementSnapshot)[];

export async function loadStoryboardReplacementSnapshot(
  db: D1Database,
  actor: EditorialActor,
  projectId: string,
  revisionId: string,
  scriptVersionId: string | null,
): Promise<StoryboardReplacementSnapshot | null> {
  if (!scriptVersionId) return null;
  const row = await db
    .prepare(sourceQuery)
    .bind(projectId, actor.workspaceId, revisionId, scriptVersionId)
    .first<
      Omit<
        StoryboardReplacementSnapshot,
        'workspaceId' | 'projectId' | 'scriptSegmentSnapshot' | 'researchClaimSnapshot'
      >
    >();
  if (!row) return null;
  const segments = (
    await db
      .prepare(
        'SELECT id,segment_order AS "order",content_text AS text FROM script_segments WHERE workspace_id=? AND script_version_id=? ORDER BY segment_order,id',
      )
      .bind(actor.workspaceId, scriptVersionId)
      .all<StoryboardSourceSegment>()
  ).results;
  const scriptSegmentSnapshot = await createStoryboardSegmentSnapshot(
    actor.workspaceId,
    projectId,
    scriptVersionId,
    segments,
  );
  const researchClaimSnapshot = await loadStoryboardResearchClaimSnapshot(
    db,
    actor.workspaceId,
    projectId,
    row.researchVersionId,
  );
  if (researchClaimSnapshot.researchHash !== row.researchHash) return null;
  return {
    ...row,
    workspaceId: actor.workspaceId,
    projectId,
    scriptSegmentSnapshot,
    researchClaimSnapshot,
  };
}

// The expected JSON is internal snapshot material, not user input. This guard compares
// every current row to that exact ordered corpus within the claim/publish D1 batches.
export function storyboardSegmentGuard(db: D1Database, snapshot: StoryboardSegmentSnapshot) {
  return db
    .prepare(
      `WITH expected AS (
        SELECT json_extract(value,'$[0]') segmentId,
          json_extract(value,'$[1]') segmentOrder,
          json_extract(value,'$[2]') segmentText FROM json_each(?)
      )
      SELECT CASE WHEN EXISTS(
        SELECT 1 FROM editorial_artifact_versions v
        JOIN editorial_artifacts a ON a.id=v.artifact_id AND a.current_version_id=v.id
        WHERE v.id=? AND v.workspace_id=? AND a.workspace_id=? AND a.project_id=?
          AND a.artifact_type='PRODUCTION_SCRIPT' AND a.status='approved' AND a.deleted_at IS NULL
          AND (SELECT COUNT(*) FROM script_segments s WHERE s.workspace_id=? AND s.script_version_id=v.id)=?
          AND NOT EXISTS(
            SELECT 1 FROM script_segments s WHERE s.workspace_id=? AND s.script_version_id=v.id
              AND NOT EXISTS(
                SELECT 1 FROM expected e WHERE e.segmentId IS s.id
                  AND e.segmentOrder IS s.segment_order AND e.segmentText IS s.content_text
              )
          )
      ) THEN 1 ELSE json('storyboard_script_segments_drift') END`,
    )
    .bind(
      snapshot.canonicalJson,
      snapshot.scriptVersionId,
      snapshot.workspaceId,
      snapshot.workspaceId,
      snapshot.projectId,
      snapshot.workspaceId,
      snapshot.count,
      snapshot.workspaceId,
    );
}

// This statement runs inside the same D1 batch that inserts the output version.
// SQLite's invalid JSON raises an error and rolls the complete batch back.
export function storyboardReplacementGuard(
  db: D1Database,
  snapshot: StoryboardReplacementSnapshot,
) {
  const predicate = snapshotKeys.map((key) => `fresh.${key} IS ?`).join(' AND ');
  return db
    .prepare(
      `WITH fresh AS (${sourceQuery})
    SELECT CASE WHEN EXISTS(SELECT 1 FROM fresh WHERE ${predicate})
      THEN 1 ELSE json('storyboard_replacement_source_drift') END`,
    )
    .bind(
      snapshot.projectId,
      snapshot.workspaceId,
      snapshot.revisionId,
      snapshot.scriptVersionId,
      ...snapshotKeys.map((key) => snapshot[key]),
    );
}

// Recheck persisted format in claim and terminal batches, including ordinary Storyboards.
export function storyboardProjectFormatGuard(
  db: D1Database,
  workspaceId: string,
  projectId: string,
  format: 'SHORT' | 'LONG_FORM',
) {
  return db
    .prepare(
      `SELECT CASE WHEN EXISTS(
        SELECT 1 FROM projects WHERE id=? AND workspace_id=? AND format=?
          AND deleted_at IS NULL AND archived_at IS NULL
      ) THEN 1 ELSE json('storyboard_project_format_drift') END`,
    )
    .bind(projectId, workspaceId, format);
}

export interface StoryboardExecutionPolicySnapshot {
  promptVersionId: string;
  providerId: string;
  providerVersion: number;
  modelId: string;
  modelVersion: number;
  pricingSnapshotId: string;
  inputPrice: number;
  outputPrice: number;
  verificationStatus: string;
}

export function storyboardExecutionPolicyGuard(
  db: D1Database,
  snapshot: StoryboardExecutionPolicySnapshot,
) {
  return db
    .prepare(
      `SELECT CASE WHEN EXISTS(
        SELECT 1 FROM prompt_versions pv
        JOIN ai_providers p ON p.id=? AND p.status='configured' AND p.version=?
        JOIN ai_provider_models m ON m.id=? AND m.provider_id=p.id AND m.status='available' AND m.version=?
        JOIN ai_pricing_snapshots ps ON ps.id=? AND ps.provider_model_id=m.id
          AND ps.effective_to IS NULL AND ps.input_unit_price IS ? AND ps.output_unit_price IS ?
          AND ps.verification_status IS ?
          AND NOT EXISTS(SELECT 1 FROM ai_pricing_snapshots newer WHERE newer.provider_model_id=m.id AND newer.effective_to IS NULL AND newer.id<>ps.id AND newer.effective_from>=ps.effective_from)
        WHERE pv.id=? AND pv.status='active'
      ) THEN 1 ELSE json('storyboard_replacement_policy_drift') END`,
    )
    .bind(
      snapshot.providerId,
      snapshot.providerVersion,
      snapshot.modelId,
      snapshot.modelVersion,
      snapshot.pricingSnapshotId,
      snapshot.inputPrice,
      snapshot.outputPrice,
      snapshot.verificationStatus,
      snapshot.promptVersionId,
    );
}
