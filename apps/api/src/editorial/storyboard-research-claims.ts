import { ProviderError } from '@vision-maxson/providers';

export const STORYBOARD_RESEARCH_CLAIMS_POLICY_VERSION = 'storyboard_research_claims_v1';

export interface StoryboardResearchClaim {
  id: string;
  claimText: string;
  evidenceClass: string;
  excerpt: string | null;
  confidence: number | null;
  sourceId: string | null;
  sourceType: string | null;
  sourceTitle: string | null;
  sourceUrl: string | null;
  sourceReference: string | null;
  sourceVerificationStatus: string | null;
}

export interface StoryboardResearchClaimSnapshot {
  workspaceId: string;
  projectId: string;
  researchVersionId: string;
  researchHash: string;
  claims: readonly Readonly<StoryboardResearchClaim>[];
  canonicalJson: string;
  count: number;
  hash: string;
}

const claimColumns = [
  'id',
  'claimText',
  'evidenceClass',
  'excerpt',
  'confidence',
  'sourceId',
  'sourceType',
  'sourceTitle',
  'sourceUrl',
  'sourceReference',
  'sourceVerificationStatus',
] as const satisfies readonly (keyof StoryboardResearchClaim)[];

const claimQuery = `SELECT c.id,c.claim_text claimText,c.evidence_class evidenceClass,
 c.excerpt,c.confidence,c.source_id sourceId,s.source_type sourceType,s.title sourceTitle,
 s.source_url sourceUrl,s.source_reference sourceReference,s.verification_status sourceVerificationStatus
 FROM research_claims c LEFT JOIN research_sources s
   ON s.id=c.source_id AND s.workspace_id=c.workspace_id AND s.research_version_id=c.research_version_id
 WHERE c.workspace_id=? AND c.research_version_id=? ORDER BY c.id`;

export async function createStoryboardResearchClaimSnapshot(
  workspaceId: string,
  projectId: string,
  researchVersionId: string,
  researchHash: string,
  rows: readonly StoryboardResearchClaim[],
): Promise<StoryboardResearchClaimSnapshot> {
  const claims = rows
    .map((row) =>
      Object.freeze(
        Object.fromEntries(
          claimColumns.map((column) => [column, row[column]]),
        ) as unknown as StoryboardResearchClaim,
      ),
    )
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (
    claims.some(
      (claim, index) =>
        !claim.id || !claim.claimText.trim() || (index > 0 && claims[index - 1]!.id === claim.id),
    )
  )
    throw new ProviderError('PERMANENT', false, 'Storyboard Research claim registry is invalid.');
  const canonicalJson = JSON.stringify(
    claims.map((claim) => claimColumns.map((column) => claim[column])),
  );
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(
      JSON.stringify([researchVersionId, researchHash, JSON.parse(canonicalJson)]),
    ),
  );
  const hash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return Object.freeze({
    workspaceId,
    projectId,
    researchVersionId,
    researchHash,
    claims: Object.freeze(claims),
    canonicalJson,
    count: claims.length,
    hash,
  });
}

export async function loadStoryboardResearchClaimSnapshot(
  db: D1Database,
  workspaceId: string,
  projectId: string,
  researchVersionId: string,
): Promise<StoryboardResearchClaimSnapshot> {
  const research = await db
    .prepare(
      `SELECT v.content_hash contentHash FROM editorial_artifacts a
    JOIN editorial_artifact_versions v ON v.id=a.current_version_id AND v.artifact_id=a.id AND v.workspace_id=a.workspace_id
    WHERE a.workspace_id=? AND a.project_id=? AND a.artifact_type='RESEARCH'
      AND a.status='approved' AND a.deleted_at IS NULL AND v.id=?
      AND EXISTS(SELECT 1 FROM artifact_approvals ap WHERE ap.workspace_id=a.workspace_id
        AND ap.artifact_version_id=v.id AND ap.decision='APPROVED')`,
    )
    .bind(workspaceId, projectId, researchVersionId)
    .first<{ contentHash: string }>();
  if (!research)
    throw new ProviderError(
      'PERMANENT',
      false,
      'Storyboard approved Research version is unavailable.',
    );
  const rows = (
    await db.prepare(claimQuery).bind(workspaceId, researchVersionId).all<StoryboardResearchClaim>()
  ).results;
  return createStoryboardResearchClaimSnapshot(
    workspaceId,
    projectId,
    researchVersionId,
    research.contentHash,
    rows,
  );
}

export function storyboardResearchClaimEvidence(snapshot: StoryboardResearchClaimSnapshot) {
  return {
    policyVersion: STORYBOARD_RESEARCH_CLAIMS_POLICY_VERSION,
    researchVersionId: snapshot.researchVersionId,
    claimCount: snapshot.count,
    claimRegistryHash: snapshot.hash,
  };
}

export function validateStoryboardFactualClaims(
  output: {
    scenes: readonly {
      factualClaims: readonly { status: string; researchClaimIds: readonly string[] }[];
    }[];
  },
  snapshot: StoryboardResearchClaimSnapshot,
): string[] {
  const eligible = new Set(
    snapshot.claims
      .filter(
        (claim) =>
          claim.evidenceClass === 'OBSERVED' &&
          claim.sourceId !== null &&
          ['owner_approved', 'externally_verified'].includes(claim.sourceVerificationStatus ?? ''),
      )
      .map((claim) => claim.id),
  );
  const used = new Set<string>();
  for (const scene of output.scenes)
    for (const claim of scene.factualClaims) {
      if (claim.status !== 'SUPPORTED_BY_APPROVED_RESEARCH') {
        if (claim.researchClaimIds.length)
          throw new ProviderError(
            'SCHEMA_VALIDATION',
            false,
            'Unsupported Storyboard claim cannot cite approved Research.',
          );
        continue;
      }
      if (
        !claim.researchClaimIds.length ||
        new Set(claim.researchClaimIds).size !== claim.researchClaimIds.length ||
        claim.researchClaimIds.some((id) => !eligible.has(id))
      )
        throw new ProviderError(
          'SCHEMA_VALIDATION',
          false,
          'Storyboard factual claim does not cite exact approved Research claims.',
        );
      claim.researchClaimIds.forEach((id) => used.add(id));
    }
  return [...used].sort();
}

// Execute in the same D1 batch as claim and publication writes. The internal JSON
// contains the exact sorted registry; changed, inserted or deleted rows fail closed.
export function storyboardResearchClaimGuard(
  db: D1Database,
  snapshot: StoryboardResearchClaimSnapshot,
) {
  const fields = [
    'c.id',
    'c.claim_text',
    'c.evidence_class',
    'c.excerpt',
    'c.confidence',
    'c.source_id',
    's.source_type',
    's.title',
    's.source_url',
    's.source_reference',
    's.verification_status',
  ];
  const comparison = fields
    .map((field, index) => `${field} IS json_extract(e.value,'$[${index}]')`)
    .join(' AND ');
  return db
    .prepare(
      `SELECT CASE WHEN EXISTS(
    SELECT 1 FROM editorial_artifacts a JOIN editorial_artifact_versions v
      ON v.id=a.current_version_id AND v.artifact_id=a.id AND v.workspace_id=a.workspace_id
    WHERE a.workspace_id=? AND a.project_id=? AND a.artifact_type='RESEARCH'
      AND a.status='approved' AND a.deleted_at IS NULL AND v.id=? AND v.content_hash=?
      AND EXISTS(SELECT 1 FROM artifact_approvals ap WHERE ap.workspace_id=a.workspace_id
        AND ap.artifact_version_id=v.id AND ap.decision='APPROVED')
      AND (SELECT COUNT(*) FROM research_claims c WHERE c.workspace_id=a.workspace_id AND c.research_version_id=v.id)=?
      AND NOT EXISTS(SELECT 1 FROM research_claims c LEFT JOIN research_sources s
        ON s.id=c.source_id AND s.workspace_id=c.workspace_id AND s.research_version_id=c.research_version_id
        WHERE c.workspace_id=a.workspace_id AND c.research_version_id=v.id
          AND NOT EXISTS(SELECT 1 FROM json_each(?) e WHERE ${comparison}))
  ) THEN 1 ELSE json('storyboard_research_claims_drift') END`,
    )
    .bind(
      snapshot.workspaceId,
      snapshot.projectId,
      snapshot.researchVersionId,
      snapshot.researchHash,
      snapshot.count,
      snapshot.canonicalJson,
    );
}
