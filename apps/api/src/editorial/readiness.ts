import type { EditorialActor } from './repository';

export type EditorialReadinessCheckpoint =
  | 'BEFORE_PRODUCTION_SCRIPT'
  | 'BEFORE_STORYBOARD'
  | 'BEFORE_PREFLIGHT'
  | 'BEFORE_REVISION_RESOLUTION';
export type EditorialReadinessBlocker =
  | 'MISSING_REQUIRED_RESEARCH_EVIDENCE'
  | 'OPEN_REVISION_REQUEST'
  | 'STALE_OR_INVALIDATED_UPSTREAM_DEPENDENCY'
  | 'MISSING_APPROVED_REQUIRED_ARTIFACT'
  | 'MISSING_EXACT_DEPENDENCY_LINKAGE';
export interface EditorialProductionReadiness {
  ready: boolean;
  checkpoint: EditorialReadinessCheckpoint;
  blockers: EditorialReadinessBlocker[];
  warnings: string[];
  evaluatedArtifactVersionIds: string[];
  evaluatedAt: string;
  remediationIdentity?: ResearchRemediationIdentity;
}
type Row = Record<string, unknown>;

const revisionTables = [
  'editorial_revision_requests',
  'editorial_revision_request_resolutions',
] as const;

export async function editorialRevisionSchemaReady(db: D1Database) {
  try {
    const rows = (
      await db
        .prepare(
          `SELECT name FROM sqlite_master
           WHERE type='table' AND name IN ('editorial_revision_requests','editorial_revision_request_resolutions')`,
        )
        .all<{ name: string }>()
    ).results;
    return revisionTables.every((table) => rows.some((row) => row.name === table));
  } catch {
    return false;
  }
}

export async function assertEditorialRevisionSchemaReady(db: D1Database) {
  if (!(await editorialRevisionSchemaReady(db)))
    throw new Error('editorial_revision_schema_unavailable');
}

export async function evaluateEditorialProductionReadiness(
  db: D1Database,
  actor: EditorialActor,
  projectId: string,
  checkpoint: EditorialReadinessCheckpoint,
  options: { ignoreRevisionRequestId?: string; inputArtifactVersionId?: string | null } = {},
): Promise<EditorialProductionReadiness> {
  await assertEditorialRevisionSchemaReady(db);
  const project = await db
    .prepare(
      `SELECT id,version,primary_language primaryLanguage FROM projects WHERE id=? AND workspace_id=? AND deleted_at IS NULL`,
    )
    .bind(projectId, actor.workspaceId)
    .first<{ id: string; version: number; primaryLanguage: string }>();
  if (!project) throw new Error('project_not_found');

  const artifacts = (
    await db
      .prepare(
        `SELECT a.id artifactId,a.version artifactRevision,v.content_hash contentHash,a.artifact_type artifactType,a.status,a.current_version_id versionId,v.content_json contentJson,v.source_script_version_id sourceScriptVersionId,
           EXISTS(SELECT 1 FROM artifact_approvals ap WHERE ap.workspace_id=a.workspace_id AND ap.artifact_version_id=a.current_version_id AND ap.decision='APPROVED') approved
         FROM editorial_artifacts a JOIN editorial_artifact_versions v ON v.id=a.current_version_id AND v.artifact_id=a.id AND v.workspace_id=a.workspace_id
         WHERE a.workspace_id=? AND a.project_id=? AND a.deleted_at IS NULL
           AND a.artifact_type<>'IDEA_CANDIDATE'`,
      )
      .bind(actor.workspaceId, projectId)
      .all<Row>()
  ).results;
  const byType = (type: string) => artifacts.find((row) => row.artifactType === type);
  const approved = (row: Row | undefined) =>
    row?.status === 'approved' && Number(row.approved) === 1;
  const blockers = new Set<EditorialReadinessBlocker>();
  const evaluated = new Set<string>();
  for (const artifact of artifacts)
    if (typeof artifact.versionId === 'string') evaluated.add(artifact.versionId);

  const requireApproved = (row: Row | undefined) => {
    if (!approved(row) || typeof row?.versionId !== 'string') {
      blockers.add('MISSING_APPROVED_REQUIRED_ARTIFACT');
      return false;
    }
    return true;
  };
  const requireDependency = async (
    source: Row | undefined,
    dependent: Row | undefined,
    dependencyType: string,
  ) => {
    if (typeof source?.versionId !== 'string' || typeof dependent?.versionId !== 'string') {
      blockers.add('MISSING_EXACT_DEPENDENCY_LINKAGE');
      return;
    }
    const dependency = await db
      .prepare(
        `SELECT validity_status validityStatus,invalidated_at invalidatedAt,invalidated_by_version_id invalidatedByVersionId
         FROM artifact_dependencies
         WHERE workspace_id=? AND source_artifact_version_id=? AND dependent_artifact_version_id=?
           AND dependency_type=? LIMIT 1`,
      )
      .bind(actor.workspaceId, source.versionId, dependent.versionId, dependencyType)
      .first<Row>();
    if (!dependency) blockers.add('MISSING_EXACT_DEPENDENCY_LINKAGE');
    else if (
      dependency.validityStatus !== 'CURRENT' ||
      dependency.invalidatedAt !== null ||
      dependency.invalidatedByVersionId !== null
    )
      blockers.add('STALE_OR_INVALIDATED_UPSTREAM_DEPENDENCY');
  };

  const openRevision = await db
    .prepare(
      `SELECT r.id FROM editorial_revision_requests r
       LEFT JOIN editorial_revision_request_resolutions x ON x.revision_request_id=r.id
       WHERE r.workspace_id=? AND r.project_id=? AND x.id IS NULL
         AND (? IS NULL OR r.id<>?) LIMIT 1`,
    )
    .bind(
      actor.workspaceId,
      projectId,
      options.ignoreRevisionRequestId ?? null,
      options.ignoreRevisionRequestId ?? null,
    )
    .first<{ id: string; primaryLanguage: string }>();
  if (openRevision) blockers.add('OPEN_REVISION_REQUEST');

  const research = byType('RESEARCH');
  const selectedIdeas = (
    await db
      .prepare(
        `SELECT i.id candidateId,i.version candidateRevision,a.id artifactId,a.version artifactRevision,v.content_hash contentHash,a.artifact_type artifactType,a.status,a.current_version_id versionId,v.content_json contentJson,v.source_script_version_id sourceScriptVersionId,
           EXISTS(SELECT 1 FROM artifact_approvals ap WHERE ap.workspace_id=a.workspace_id AND ap.artifact_version_id=v.id AND ap.decision='APPROVED') approved
         FROM idea_candidates i
         JOIN editorial_artifacts a ON a.id=i.artifact_id
         JOIN editorial_artifact_versions v ON v.id=i.artifact_version_id AND v.artifact_id=a.id AND v.workspace_id=i.workspace_id
         WHERE i.workspace_id=? AND i.project_id=? AND i.status='SELECTED'
           AND a.workspace_id=i.workspace_id AND a.project_id=i.project_id
           AND a.artifact_type='IDEA_CANDIDATE' AND a.current_version_id=i.artifact_version_id
           AND a.deleted_at IS NULL`,
      )
      .bind(actor.workspaceId, projectId)
      .all<Row>()
  ).results;
  const idea = selectedIdeas.length === 1 ? selectedIdeas[0] : undefined;
  if (selectedIdeas.length !== 1) blockers.add('MISSING_APPROVED_REQUIRED_ARTIFACT');
  if (typeof idea?.versionId === 'string') evaluated.add(idea.versionId);
  const brief = byType('CONTENT_BRIEF');
  if (!requireApproved(research) || typeof research?.versionId !== 'string') {
    blockers.add('MISSING_REQUIRED_RESEARCH_EVIDENCE');
  } else {
    const evidence = await db
      .prepare(
        `SELECT COUNT(DISTINCT c.id) totalClaims,
           COUNT(DISTINCT CASE WHEN s.verification_status IN ('owner_approved','externally_verified') THEN c.id END) verifiedClaims,
           COUNT(DISTINCT CASE WHEN s.verification_status IN ('owner_approved','externally_verified') THEN s.id END) verifiedSources
         FROM research_claims c
         LEFT JOIN research_sources s ON s.id=c.source_id AND s.research_version_id=c.research_version_id
         WHERE c.workspace_id=? AND c.research_version_id=?`,
      )
      .bind(actor.workspaceId, research.versionId)
      .first<{ totalClaims: number; verifiedClaims: number; verifiedSources: number }>();
    const totalClaims = Number(evidence?.totalClaims ?? 0);
    if (
      totalClaims === 0 ||
      Number(evidence?.verifiedSources ?? 0) === 0 ||
      Number(evidence?.verifiedClaims ?? 0) !== totalClaims
    )
      blockers.add('MISSING_REQUIRED_RESEARCH_EVIDENCE');
  }

  let briefContent: Row = {};
  if (requireApproved(brief)) {
    try {
      const parsed: unknown = JSON.parse(
        typeof brief?.contentJson === 'string' ? brief.contentJson : '{}',
      );
      if (typeof parsed === 'object' && parsed !== null) briefContent = parsed as Row;
    } catch {
      // Malformed persisted evidence cannot establish exact lineage.
    }
    if (
      !research ||
      !Array.isArray(briefContent.researchVersionIds) ||
      !briefContent.researchVersionIds.includes(research.versionId)
    )
      blockers.add('MISSING_EXACT_DEPENDENCY_LINKAGE');
  }
  requireApproved(idea);

  await requireDependency(research, idea, 'GENERATED_FROM');
  await requireDependency(idea, brief, 'GENERATED_FROM');
  await requireDependency(research, brief, 'USES_RESEARCH');

  const requiresScript = checkpoint !== 'BEFORE_PRODUCTION_SCRIPT';
  const requiresStoryboard =
    checkpoint === 'BEFORE_PREFLIGHT' || checkpoint === 'BEFORE_REVISION_RESOLUTION';
  const script = byType('PRODUCTION_SCRIPT');
  const critique = byType('SCRIPT_CRITIQUE');
  if (requiresScript) {
    requireApproved(script);
    requireApproved(critique);
    await requireDependency(brief, script, 'GENERATED_FROM');
    await requireDependency(script, critique, 'EVALUATES_SOURCE');
  }

  if (requiresStoryboard) {
    const productionLanguage =
      typeof briefContent.productionLanguage === 'string'
        ? briefContent.productionLanguage
        : project.primaryLanguage;
    const reviewLanguage =
      typeof briefContent.reviewLanguage === 'string'
        ? briefContent.reviewLanguage
        : productionLanguage;
    if (reviewLanguage !== productionLanguage) {
      const translation = byType('REVIEW_TRANSLATION');
      requireApproved(translation);
      if (translation?.sourceScriptVersionId !== script?.versionId)
        blockers.add('MISSING_EXACT_DEPENDENCY_LINKAGE');
      await requireDependency(script, translation, 'GENERATED_FROM');
    }
    const storyboard = byType('STORYBOARD');
    requireApproved(storyboard);
    await requireDependency(script, storyboard, 'GENERATED_FROM');
    await requireDependency(critique, storyboard, 'INFORMED_BY');
  }

  // Preliminary reads can only deny eligibility. This single authoritative read proves
  // the exact captured identities NOW, and its predicate is reused by the atomic claim.
  let remediationIdentity: ResearchRemediationIdentity | undefined;
  if (
    checkpoint === 'BEFORE_PRODUCTION_SCRIPT' &&
    !options.ignoreRevisionRequestId &&
    openRevision &&
    blockers.size === 1 &&
    blockers.has('OPEN_REVISION_REQUEST') &&
    (options.inputArtifactVersionId === undefined ||
      options.inputArtifactVersionId === brief?.versionId) &&
    research &&
    idea &&
    brief
  ) {
    const identity: ResearchRemediationIdentity = {
      workspaceId: actor.workspaceId,
      projectId,
      projectVersion: project.version,
      requestId: openRevision.id,
      researchArtifactId: String(research.artifactId),
      researchVersionId: String(research.versionId),
      researchRevision: Number(research.artifactRevision),
      researchHash: String(research.contentHash),
      ideaArtifactId: String(idea.artifactId),
      ideaVersionId: String(idea.versionId),
      ideaRevision: Number(idea.artifactRevision),
      ideaHash: String(idea.contentHash),
      candidateId: String(idea.candidateId),
      candidateRevision: Number(idea.candidateRevision),
      briefArtifactId: String(brief.artifactId),
      briefVersionId: String(brief.versionId),
      briefRevision: Number(brief.artifactRevision),
      briefHash: String(brief.contentHash),
    };
    if (await remediationStatement(db, identity, false).first()) {
      blockers.delete('OPEN_REVISION_REQUEST');
      remediationIdentity = identity;
    }
  }

  return {
    ...(remediationIdentity ? { remediationIdentity } : {}),
    ready: blockers.size === 0,
    checkpoint,
    blockers: [...blockers].sort(),
    warnings: [
      'FUTURE_SCHEMA_WORK: explicit central/critical claim designation is required before semantic centrality can be evaluated.',
    ],
    evaluatedArtifactVersionIds: [...evaluated].sort(),
    evaluatedAt: new Date().toISOString(),
  };
}

// Internal identity captured by server-side discovery, never accepted from an API command.
export interface ResearchRemediationIdentity {
  workspaceId: string;
  projectId: string;
  projectVersion: number;
  requestId: string;
  researchArtifactId: string;
  researchVersionId: string;
  researchRevision: number;
  researchHash: string;
  ideaArtifactId: string;
  ideaVersionId: string;
  ideaRevision: number;
  ideaHash: string;
  candidateId: string;
  candidateRevision: number;
  briefArtifactId: string;
  briefVersionId: string;
  briefRevision: number;
  briefHash: string;
}
const remediationIdentityKeys = [
  'workspaceId',
  'projectId',
  'projectVersion',
  'requestId',
  'researchArtifactId',
  'researchVersionId',
  'researchRevision',
  'researchHash',
  'ideaArtifactId',
  'ideaVersionId',
  'ideaRevision',
  'ideaHash',
  'candidateId',
  'candidateRevision',
  'briefArtifactId',
  'briefVersionId',
  'briefRevision',
  'briefHash',
] as const satisfies readonly (keyof ResearchRemediationIdentity)[];

const remediationQuery = `WITH e AS (SELECT ${remediationIdentityKeys.map((key) => `? AS ${key}`).join(',')})
 SELECT r.id FROM e
 JOIN projects p ON p.id=e.projectId AND p.workspace_id=e.workspaceId AND p.version=e.projectVersion AND p.deleted_at IS NULL
 JOIN editorial_revision_requests r ON r.id=e.requestId AND r.workspace_id=e.workspaceId AND r.project_id=e.projectId
 JOIN editorial_artifact_versions baseline ON baseline.id=r.target_baseline_version_id AND baseline.workspace_id=e.workspaceId AND baseline.artifact_id=e.researchArtifactId
 JOIN editorial_artifact_versions reviewed ON reviewed.id=r.reviewed_artifact_version_id AND reviewed.workspace_id=e.workspaceId AND reviewed.artifact_id=r.reviewed_artifact_id
 JOIN editorial_artifacts sa ON sa.id=reviewed.artifact_id AND sa.workspace_id=e.workspaceId AND sa.project_id=e.projectId AND sa.artifact_type='STORYBOARD' AND sa.deleted_at IS NULL
 JOIN editorial_artifacts ra ON ra.id=e.researchArtifactId AND ra.workspace_id=e.workspaceId AND ra.project_id=e.projectId AND ra.artifact_type='RESEARCH' AND ra.current_version_id=e.researchVersionId AND ra.version=e.researchRevision AND ra.status='approved' AND ra.deleted_at IS NULL
 JOIN editorial_artifact_versions rv ON rv.id=e.researchVersionId AND rv.artifact_id=ra.id AND rv.workspace_id=e.workspaceId AND rv.content_hash=e.researchHash
 JOIN editorial_artifacts ia ON ia.id=e.ideaArtifactId AND ia.workspace_id=e.workspaceId AND ia.project_id=e.projectId AND ia.artifact_type='IDEA_CANDIDATE' AND ia.current_version_id=e.ideaVersionId AND ia.version=e.ideaRevision AND ia.status='approved' AND ia.deleted_at IS NULL
 JOIN editorial_artifact_versions iv ON iv.id=e.ideaVersionId AND iv.artifact_id=ia.id AND iv.workspace_id=e.workspaceId AND iv.content_hash=e.ideaHash
 JOIN idea_candidates i ON i.id=e.candidateId AND i.workspace_id=e.workspaceId AND i.project_id=e.projectId AND i.artifact_id=ia.id AND i.artifact_version_id=iv.id AND i.version=e.candidateRevision AND i.status='SELECTED'
 JOIN editorial_artifacts ba ON ba.id=e.briefArtifactId AND ba.workspace_id=e.workspaceId AND ba.project_id=e.projectId AND ba.artifact_type='CONTENT_BRIEF' AND ba.current_version_id=e.briefVersionId AND ba.version=e.briefRevision AND ba.status='approved' AND ba.deleted_at IS NULL
 JOIN editorial_artifact_versions bv ON bv.id=e.briefVersionId AND bv.artifact_id=ba.id AND bv.workspace_id=e.workspaceId AND bv.content_hash=e.briefHash
 WHERE r.status='OPEN' AND r.target_stage='RESEARCH' AND baseline.id<>rv.id
 AND NOT EXISTS(SELECT 1 FROM editorial_revision_request_resolutions x WHERE x.revision_request_id=r.id)
 AND (SELECT COUNT(*) FROM editorial_revision_requests q WHERE q.workspace_id=e.workspaceId AND q.project_id=e.projectId AND NOT EXISTS(SELECT 1 FROM editorial_revision_request_resolutions x WHERE x.revision_request_id=q.id))=1
 AND (SELECT COUNT(*) FROM editorial_artifacts a WHERE a.workspace_id=e.workspaceId AND a.project_id=e.projectId AND a.artifact_type='RESEARCH' AND a.deleted_at IS NULL)=1
 AND (SELECT COUNT(*) FROM editorial_artifacts a WHERE a.workspace_id=e.workspaceId AND a.project_id=e.projectId AND a.artifact_type='CONTENT_BRIEF' AND a.deleted_at IS NULL)=1
 AND (SELECT COUNT(*) FROM idea_candidates c WHERE c.workspace_id=e.workspaceId AND c.project_id=e.projectId AND c.status='SELECTED')=1
 AND EXISTS(SELECT 1 FROM artifact_approvals ap WHERE ap.workspace_id=e.workspaceId AND ap.artifact_version_id=rv.id AND ap.decision='APPROVED')
 AND EXISTS(SELECT 1 FROM artifact_approvals ap WHERE ap.workspace_id=e.workspaceId AND ap.artifact_version_id=iv.id AND ap.decision='APPROVED')
 AND EXISTS(SELECT 1 FROM artifact_approvals ap WHERE ap.workspace_id=e.workspaceId AND ap.artifact_version_id=bv.id AND ap.decision='APPROVED')
 AND CASE WHEN json_valid(bv.content_json) THEN json_type(bv.content_json,'$.researchVersionIds')='array' AND json_array_length(bv.content_json,'$.researchVersionIds')=1 AND json_extract(bv.content_json,'$.researchVersionIds[0]')=rv.id ELSE 0 END
 AND EXISTS(SELECT 1 FROM research_claims c WHERE c.workspace_id=e.workspaceId AND c.research_version_id=rv.id)
 AND NOT EXISTS(SELECT 1 FROM research_claims c WHERE c.research_version_id=rv.id AND (c.workspace_id<>e.workspaceId OR NOT EXISTS(SELECT 1 FROM research_sources s WHERE s.id=c.source_id AND s.workspace_id=e.workspaceId AND s.research_version_id=rv.id AND s.verification_status IN ('owner_approved','externally_verified'))))
 AND EXISTS(SELECT 1 FROM artifact_dependencies d WHERE d.workspace_id=e.workspaceId AND d.source_artifact_version_id=rv.id AND d.dependent_artifact_version_id=iv.id AND d.dependency_type='GENERATED_FROM' AND d.validity_status='CURRENT' AND d.invalidated_at IS NULL AND d.invalidated_by_version_id IS NULL)
 AND EXISTS(SELECT 1 FROM artifact_dependencies d WHERE d.workspace_id=e.workspaceId AND d.source_artifact_version_id=iv.id AND d.dependent_artifact_version_id=bv.id AND d.dependency_type='GENERATED_FROM' AND d.validity_status='CURRENT' AND d.invalidated_at IS NULL AND d.invalidated_by_version_id IS NULL)
 AND EXISTS(SELECT 1 FROM artifact_dependencies d WHERE d.workspace_id=e.workspaceId AND d.source_artifact_version_id=rv.id AND d.dependent_artifact_version_id=bv.id AND d.dependency_type='USES_RESEARCH' AND d.validity_status='CURRENT' AND d.invalidated_at IS NULL AND d.invalidated_by_version_id IS NULL)
 AND NOT EXISTS(SELECT 1 FROM artifact_dependencies d WHERE d.dependent_artifact_version_id IN (rv.id,iv.id,bv.id) AND (d.workspace_id<>e.workspaceId OR d.validity_status<>'CURRENT' OR d.invalidated_at IS NOT NULL OR d.invalidated_by_version_id IS NOT NULL))
 AND (SELECT COUNT(*) FROM artifact_dependencies d WHERE d.dependent_artifact_version_id=iv.id AND d.dependency_type='GENERATED_FROM')=1
 AND (SELECT COUNT(*) FROM artifact_dependencies d WHERE d.dependent_artifact_version_id=bv.id AND d.dependency_type='GENERATED_FROM')=1
 AND (SELECT COUNT(*) FROM artifact_dependencies d WHERE d.dependent_artifact_version_id=bv.id AND d.dependency_type='USES_RESEARCH')=1`;

function remediationStatement(
  db: D1Database,
  identity: ResearchRemediationIdentity,
  claim: boolean,
) {
  return db
    .prepare(
      claim
        ? `SELECT CASE WHEN EXISTS(${remediationQuery}) THEN 1 ELSE json('research_remediation_claim_changed') END`
        : remediationQuery,
    )
    .bind(...remediationIdentityKeys.map((key) => identity[key]));
}

// Must execute in the SAME D1 batch as the Run/reservation claim. A failed guard
// aborts the transaction; eligibility is not a durable authorization until commit.
export function researchRemediationClaimGuard(
  db: D1Database,
  identity: ResearchRemediationIdentity,
) {
  return remediationStatement(db, identity, true);
}

export async function assertEditorialProductionReady(
  db: D1Database,
  actor: EditorialActor,
  projectId: string,
  checkpoint: EditorialReadinessCheckpoint,
  inputArtifactVersionId?: string | null,
) {
  const result = await evaluateEditorialProductionReadiness(db, actor, projectId, checkpoint, {
    ...(inputArtifactVersionId !== undefined ? { inputArtifactVersionId } : {}),
  });
  if (!result.ready) throw new Error(`editorial_production_not_ready:${result.blockers.join(',')}`);
  return result;
}
