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
  options: { ignoreRevisionRequestId?: string } = {},
): Promise<EditorialProductionReadiness> {
  await assertEditorialRevisionSchemaReady(db);
  const project = await db
    .prepare(
      `SELECT id,primary_language primaryLanguage FROM projects WHERE id=? AND workspace_id=? AND deleted_at IS NULL`,
    )
    .bind(projectId, actor.workspaceId)
    .first<{ id: string; primaryLanguage: string }>();
  if (!project) throw new Error('project_not_found');

  const artifacts = (
    await db
      .prepare(
        `SELECT a.artifact_type artifactType,a.status,a.current_version_id versionId,v.content_json contentJson,v.source_script_version_id sourceScriptVersionId,
           EXISTS(SELECT 1 FROM artifact_approvals ap WHERE ap.workspace_id=a.workspace_id AND ap.artifact_version_id=a.current_version_id AND ap.decision='APPROVED') approved
         FROM editorial_artifacts a JOIN editorial_artifact_versions v ON v.id=a.current_version_id
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
        `SELECT a.artifact_type artifactType,a.status,a.current_version_id versionId,v.content_json contentJson,v.source_script_version_id sourceScriptVersionId,
           EXISTS(SELECT 1 FROM artifact_approvals ap WHERE ap.workspace_id=a.workspace_id AND ap.artifact_version_id=v.id AND ap.decision='APPROVED') approved
         FROM idea_candidates i
         JOIN editorial_artifacts a ON a.id=i.artifact_id
         JOIN editorial_artifact_versions v ON v.id=i.artifact_version_id AND v.artifact_id=a.id
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

  return {
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

export async function assertEditorialProductionReady(
  db: D1Database,
  actor: EditorialActor,
  projectId: string,
  checkpoint: EditorialReadinessCheckpoint,
) {
  const result = await evaluateEditorialProductionReadiness(db, actor, projectId, checkpoint);
  if (!result.ready) throw new Error(`editorial_production_not_ready:${result.blockers.join(',')}`);
  return result;
}
