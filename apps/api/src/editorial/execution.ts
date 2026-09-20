import {
  loadContentBriefRevisionCapacity,
  loadContentBriefPreDispatchClaim,
  contentBriefPreDispatchClaimStatement,
  inspectContentBriefPreDispatchFailure,
  ContentBriefDispatchObserved,
  authorizeContentBriefRevisionDispatch,
  ContentBriefCapacityError,
  ContentBriefDispatchError,
  contentBriefPublicationGuard,
  contentBriefClaimGuard,
  contentBriefRevisionPolicy,
} from './content-brief-revision-capacity';
import { calculateUsageMicrousd } from '@vision-maxson/domain';
import {
  loadIdeaRevisionCapacity,
  authorizeIdeaRevisionDispatch,
  IdeaCapacityError,
  IdeaDispatchError,
} from './idea-revision-capacity';
import { ideaRevisionPolicy } from '@vision-maxson/providers/execution-profile';
import {
  contentBriefSchema,
  ideaGenerationOutputSchema,
  productionScriptOutputSchema,
  researchOutputSchema,
  reviewTranslationOutputSchema,
  requiredScriptCritiqueDimensions,
  scriptCritiqueSchema,
  storyboardOutputSchema,
  storyboardOutputV1Schema,
  storyboardOutputV2Schema,
  intelligenceTaskSchema,
} from '@vision-maxson/contracts';
import {
  AIExecutionGateway,
  ProviderError,
  ProviderNotConfiguredError,
  routeModel,
  type ModelCandidate,
  type ProviderExecutionResult,
  type RoutingMode,
} from '@vision-maxson/providers';
import { OpenAIResponsesAdapter } from '@vision-maxson/providers/openai';
import { taskPolicy } from '@vision-maxson/providers/policy';
import {
  PHASE3_SHORT_DE_REVIEW_ES_PROFILE,
  boundedProfileForProject,
  conservativeInputTokenUpperBound,
  isBoundedProfileStep,
  isProjectEligibleForBoundedProfile,
  governedTerminalStagePolicies,
  isGovernedTerminalStage,
  type BoundedExecutionProfile,
} from '@vision-maxson/providers/execution-profile';
import { calculateReservation, loadBoundedEnvelope, reservationStatement } from './budget';
import {
  calculateGovernedReservation,
  loadGovernedRemediationEnvelope,
  loadGovernedTerminalEnvelope,
} from './governed-budget';
import { z } from 'zod';
import {
  invalidationFor,
  terminalInvalidationPlan,
  terminalStageSourceContracts,
  type ArtifactType,
} from '@vision-maxson/domain';
import type { EditorialActor } from './repository';
import { assertEditorialProductionReady, researchRemediationClaimGuard } from './readiness';
import {
  authorizeProductionScriptRetryDispatch,
  loadProductionScriptRetryAuthorization,
  productionScriptRetryClaimAudit,
  legacyRemediationClaimStatement,
  productionScriptRetryClaimGuard,
  productionScriptRetryRequired,
  ProductionScriptRetryError,
  PRODUCTION_SCRIPT_RETRY_CEILING,
} from './production-script-retry-authorization';

type Task = z.infer<typeof intelligenceTaskSchema>;
type ExecutionConfig = {
  openAIEnabled: boolean;
  openAIApiKey?: string;
  openAIBaseUrl: string;
  requestId?: string;
  environment?: string;
  accessIssuer?: string;
  accessSubject?: string;
};
type Command = {
  mode: RoutingMode;
  preferredProviderKey?: string;
  preferredModelKey?: string;
  inputArtifactVersionId: string | null;
  creativeRegeneration: boolean;
  remediationId?: string;
  ideaRevisionCapacityId?: string;
  contentBriefRevisionCapacityId?: string;
  productionScriptRetryAuthorizationId?: string;
};
type Row = Record<string, unknown>;
type BriefClaim = Awaited<ReturnType<typeof loadContentBriefPreDispatchClaim>>;
type LineageEdge = {
  sourceVersionId: string;
  dependencyType: 'GENERATED_FROM' | 'USES_RESEARCH' | 'EVALUATES_SOURCE' | 'INFORMED_BY';
};
type ScriptSourceBriefSnapshot = {
  workspaceId: string;
  projectId: string;
  artifactId: string;
  artifactRevision: number;
  versionId: string;
  contentHash: string;
  approvalId: string;
};
export type TranslationSourceSegment = {
  id: string;
  order: number;
  contentHash: string;
  text: string;
};
export type TranslationSourceSnapshot = {
  workspaceId: string;
  projectId: string;
  artifactId: string;
  artifactRevision: number;
  artifactStatus: 'approved';
  currentVersionId: string;
  versionId: string;
  versionNumber: number;
  contentHash: string;
  languageCode: string;
  sourceType: 'HUMAN_EDITED';
  approvalId: string;
  positiveApprovalCount: 1;
  segments: TranslationSourceSegment[];
};

export function translationSourceSnapshotEvidence(snapshot: TranslationSourceSnapshot) {
  return {
    workspaceId: snapshot.workspaceId,
    projectId: snapshot.projectId,
    artifactId: snapshot.artifactId,
    artifactRevision: snapshot.artifactRevision,
    artifactStatus: snapshot.artifactStatus,
    currentVersionId: snapshot.currentVersionId,
    versionId: snapshot.versionId,
    versionNumber: snapshot.versionNumber,
    contentHash: snapshot.contentHash,
    languageCode: snapshot.languageCode,
    sourceType: snapshot.sourceType,
    approvalId: snapshot.approvalId,
    positiveApprovalCount: snapshot.positiveApprovalCount,
    segments: snapshot.segments.map(({ id, order, contentHash }) => ({ id, order, contentHash })),
  };
}

export function translationSourceGuardStatement(
  db: D1Database,
  snapshot: TranslationSourceSnapshot,
) {
  return db
    .prepare(
      `SELECT CASE WHEN EXISTS(
        SELECT 1 FROM editorial_artifacts a
        JOIN editorial_artifact_versions v ON v.id=? AND v.artifact_id=a.id AND v.workspace_id=a.workspace_id
        JOIN artifact_approvals ap ON ap.id=? AND ap.workspace_id=a.workspace_id AND ap.artifact_version_id=v.id AND ap.decision='APPROVED'
        WHERE a.id=? AND a.workspace_id=? AND a.project_id=? AND a.artifact_type='PRODUCTION_SCRIPT'
          AND a.current_version_id=? AND a.version=? AND a.status=? AND a.deleted_at IS NULL
          AND v.version_number=? AND v.content_hash=? AND v.language_code=? AND v.source_type=?
          AND (SELECT COUNT(*) FROM artifact_approvals approvals WHERE approvals.workspace_id=a.workspace_id AND approvals.artifact_version_id=v.id AND approvals.decision='APPROVED')=?
          AND COALESCE((SELECT json_group_array(json_object('id',ordered.id,'order',ordered.segmentOrder,'contentHash',ordered.contentHash,'text',ordered.contentText)) FROM (SELECT s.id,s.segment_order AS segmentOrder,s.content_hash AS contentHash,s.content_text AS contentText FROM script_segments s WHERE s.workspace_id=a.workspace_id AND s.script_version_id=v.id ORDER BY s.segment_order) ordered),'[]')=?
      ) THEN 1 ELSE json('translation_source_authorization_changed') END`,
    )
    .bind(
      snapshot.versionId,
      snapshot.approvalId,
      snapshot.artifactId,
      snapshot.workspaceId,
      snapshot.projectId,
      snapshot.currentVersionId,
      snapshot.artifactRevision,
      snapshot.artifactStatus,
      snapshot.versionNumber,
      snapshot.contentHash,
      snapshot.languageCode,
      snapshot.sourceType,
      snapshot.positiveApprovalCount,
      JSON.stringify(snapshot.segments),
    );
}

export type CritiqueSourceSegment = TranslationSourceSegment;
export type CritiqueArtifactSnapshot = {
  artifactId: string;
  artifactRevision: number;
  artifactStatus: 'approved';
  currentVersionId: string;
  versionId: string;
  versionNumber: number;
  contentHash: string;
  languageCode: string;
  sourceType: string;
  approvalId: string;
  positiveApprovalCount: 1;
  contentText: string | null;
  contentJson: string | null;
};
export type CritiqueSourceSnapshot = {
  workspaceId: string;
  projectId: string;
  script: CritiqueArtifactSnapshot & {
    sourceType: 'HUMAN_EDITED';
    segments: CritiqueSourceSegment[];
  };
  brief: CritiqueArtifactSnapshot;
  research: CritiqueArtifactSnapshot;
};

const critiqueArtifactEvidence = (snapshot: CritiqueArtifactSnapshot) => ({
  artifactId: snapshot.artifactId,
  artifactRevision: snapshot.artifactRevision,
  artifactStatus: snapshot.artifactStatus,
  currentVersionId: snapshot.currentVersionId,
  versionId: snapshot.versionId,
  versionNumber: snapshot.versionNumber,
  contentHash: snapshot.contentHash,
  languageCode: snapshot.languageCode,
  sourceType: snapshot.sourceType,
  approvalId: snapshot.approvalId,
  positiveApprovalCount: snapshot.positiveApprovalCount,
});

export function critiqueSourceSnapshotEvidence(snapshot: CritiqueSourceSnapshot) {
  return {
    workspaceId: snapshot.workspaceId,
    projectId: snapshot.projectId,
    script: {
      ...critiqueArtifactEvidence(snapshot.script),
      segments: snapshot.script.segments.map(({ id, order, contentHash }) => ({
        id,
        order,
        contentHash,
      })),
    },
    brief: critiqueArtifactEvidence(snapshot.brief),
    research: critiqueArtifactEvidence(snapshot.research),
    translationInputRole: 'HUMAN_SUPERVISION_ONLY',
  };
}

const critiqueSnapshotArtifactPredicate = (artifactType: ArtifactType) => `EXISTS(
  SELECT 1 FROM editorial_artifacts a
  JOIN editorial_artifact_versions v ON v.id=? AND v.artifact_id=a.id AND v.workspace_id=a.workspace_id
  JOIN artifact_approvals ap ON ap.id=? AND ap.workspace_id=a.workspace_id AND ap.artifact_version_id=v.id AND ap.decision='APPROVED'
  WHERE a.id=? AND a.workspace_id=? AND a.project_id=? AND a.artifact_type='${artifactType}'
    AND a.current_version_id=? AND a.version=? AND a.status=? AND a.deleted_at IS NULL
    AND v.version_number=? AND v.content_hash=? AND v.language_code=? AND v.source_type=?
    AND (SELECT COUNT(*) FROM artifact_approvals approvals WHERE approvals.workspace_id=a.workspace_id AND approvals.artifact_version_id=v.id AND approvals.decision='APPROVED')=?
)`;

const critiqueSnapshotBindings = (
  snapshot: CritiqueArtifactSnapshot,
  workspaceId: string,
  projectId: string,
) =>
  [
    snapshot.versionId,
    snapshot.approvalId,
    snapshot.artifactId,
    workspaceId,
    projectId,
    snapshot.currentVersionId,
    snapshot.artifactRevision,
    snapshot.artifactStatus,
    snapshot.versionNumber,
    snapshot.contentHash,
    snapshot.languageCode,
    snapshot.sourceType,
    snapshot.positiveApprovalCount,
  ] as const;

export function critiqueSourceGuardStatement(db: D1Database, snapshot: CritiqueSourceSnapshot) {
  return db
    .prepare(
      `SELECT CASE WHEN
        ${critiqueSnapshotArtifactPredicate('PRODUCTION_SCRIPT')}
        AND COALESCE((SELECT json_group_array(json_object('id',ordered.id,'order',ordered.segmentOrder,'contentHash',ordered.contentHash,'text',ordered.contentText)) FROM (SELECT s.id,s.segment_order AS segmentOrder,s.content_hash AS contentHash,s.content_text AS contentText FROM script_segments s WHERE s.workspace_id=? AND s.script_version_id=? ORDER BY s.segment_order) ordered),'[]')=?
        AND ${critiqueSnapshotArtifactPredicate('CONTENT_BRIEF')}
        AND ${critiqueSnapshotArtifactPredicate('RESEARCH')}
        AND (SELECT CASE WHEN COUNT(*)=1 AND MIN(d.source_artifact_version_id)=? THEN 1 ELSE 0 END FROM artifact_dependencies d WHERE d.workspace_id=? AND d.dependent_artifact_version_id=? AND d.dependency_type='GENERATED_FROM' AND d.validity_status='CURRENT' AND d.invalidated_at IS NULL AND d.invalidated_by_version_id IS NULL)=1
        AND (SELECT CASE WHEN COUNT(*)=1 AND MIN(d.source_artifact_version_id)=? THEN 1 ELSE 0 END FROM artifact_dependencies d WHERE d.workspace_id=? AND d.dependent_artifact_version_id=? AND d.dependency_type='USES_RESEARCH' AND d.validity_status='CURRENT' AND d.invalidated_at IS NULL AND d.invalidated_by_version_id IS NULL)=1
        THEN 1 ELSE json('critique_source_authorization_changed') END`,
    )
    .bind(
      ...critiqueSnapshotBindings(snapshot.script, snapshot.workspaceId, snapshot.projectId),
      snapshot.workspaceId,
      snapshot.script.versionId,
      JSON.stringify(snapshot.script.segments),
      ...critiqueSnapshotBindings(snapshot.brief, snapshot.workspaceId, snapshot.projectId),
      ...critiqueSnapshotBindings(snapshot.research, snapshot.workspaceId, snapshot.projectId),
      snapshot.brief.versionId,
      snapshot.workspaceId,
      snapshot.script.versionId,
      snapshot.research.versionId,
      snapshot.workspaceId,
      snapshot.brief.versionId,
    );
}

export function scriptCritiqueProviderContext(project: Row) {
  const snapshot = project.critiqueSource as CritiqueSourceSnapshot | null | undefined;
  if (!snapshot)
    throw new ProviderError('PERMANENT', false, 'The exact Critique source snapshot is required.');
  return {
    project: {
      id: project.id,
      format: project.format,
      primaryLanguage: project.primaryLanguage,
      operatingMode: project.operatingMode,
      editorialConstraints: project.editorialStrategyJson,
    },
    sourceScript: {
      ...critiqueArtifactEvidence(snapshot.script),
      contentText: snapshot.script.contentText,
      contentJson: snapshot.script.contentJson,
      segments: snapshot.script.segments,
    },
    approvedBrief: {
      ...critiqueArtifactEvidence(snapshot.brief),
      contentText: snapshot.brief.contentText,
      contentJson: snapshot.brief.contentJson,
    },
    approvedResearch: {
      ...critiqueArtifactEvidence(snapshot.research),
      contentText: snapshot.research.contentText,
      contentJson: snapshot.research.contentJson,
    },
    requiredDimensions: [...requiredScriptCritiqueDimensions],
    translationInputRole: 'HUMAN_SUPERVISION_ONLY',
  };
}

export const scriptCritiquePolicyInstructions = `Evaluate every required dimension supplied in requiredDimensions exactly once in dimensionsEvaluated.
Use only sourceScript, approvedBrief, approvedResearch and the explicit project constraints in context_json.
Do not use prior Critiques, Storyboards, Translations, Ideas, stale artifacts, or external research.
Return sourceScriptVersionId and languageCode for the exact supplied source Script.
Provide at least one non-empty strength. Issues may be empty only when no issue exists after evaluating every required dimension.
For each issue use a required dimension, a severity, evidence type, confidence, a non-empty recommendation, and segmentOrders for segment-specific findings; use null only for genuinely global findings.
Return only the strict structured output required by the supplied JSON schema.`;
export const reviewTranslationPolicyInstructions = `Translate every source segment exactly once into natural Spanish.
Preserve the source segment boundaries and order; do not merge, split, omit, or add segments.
Do not summarize, add facts, omit facts, invent explanations, or change editorial intent.
Preserve names, dates, acronyms, Ariane terminology, technical meaning, and editorial tone.
Output Spanish only inside each translated segment text.
Do not modify or replace the German source.
Return only the structured output required by the supplied JSON schema.`;
const promptKey: Record<Task, string> = {
  TOPIC_RESEARCH: 'topic_research',
  IDEA_GENERATION: 'idea_generation',
  CONTENT_BRIEF: 'content_brief',
  SCRIPT_WRITER_SHORT: 'script_writer_short',
  SCRIPT_WRITER_LONG: 'script_writer_long',
  SCRIPT_CRITIC: 'script_critic',
  REVIEW_TRANSLATION_ES: 'review_translation_es',
  STORYBOARD_PLANNER: 'storyboard_planner',
  PREFLIGHT_ANALYSIS: 'preflight_analysis',
};
const outputSchema: Record<Task, z.ZodType> = {
  TOPIC_RESEARCH: researchOutputSchema,
  IDEA_GENERATION: ideaGenerationOutputSchema,
  CONTENT_BRIEF: contentBriefSchema,
  SCRIPT_WRITER_SHORT: productionScriptOutputSchema,
  SCRIPT_WRITER_LONG: productionScriptOutputSchema,
  SCRIPT_CRITIC: scriptCritiqueSchema,
  REVIEW_TRANSLATION_ES: reviewTranslationOutputSchema,
  STORYBOARD_PLANNER: storyboardOutputSchema,
  PREFLIGHT_ANALYSIS: z.object({ checks: z.array(z.unknown()), recommendation: z.string() }),
};
const artifactType: Record<Task, ArtifactType> = {
  TOPIC_RESEARCH: 'RESEARCH',
  IDEA_GENERATION: 'IDEA_CANDIDATE',
  CONTENT_BRIEF: 'CONTENT_BRIEF',
  SCRIPT_WRITER_SHORT: 'PRODUCTION_SCRIPT',
  SCRIPT_WRITER_LONG: 'PRODUCTION_SCRIPT',
  SCRIPT_CRITIC: 'SCRIPT_CRITIQUE',
  REVIEW_TRANSLATION_ES: 'REVIEW_TRANSLATION',
  STORYBOARD_PLANNER: 'STORYBOARD',
  PREFLIGHT_ANALYSIS: 'PREFLIGHT',
};
const newId = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;
const now = () => new Date().toISOString();
async function digest(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((part) => part.toString(16).padStart(2, '0'))
    .join('');
}
function parseCapabilities(value: unknown) {
  const parsed = typeof value === 'string' ? (JSON.parse(value) as Row) : (value as Row);
  return parsed;
}
function renderPrompt(template: string, context: Row) {
  const variables = [...template.matchAll(/\{\{([a-z_]+)\}\}/gu)].map((match) => match[1]);
  if (variables.some((variable) => variable !== 'context_json'))
    throw new ProviderError('PERMANENT', false, 'Prompt contains an unsupported variable.');
  return template.replaceAll('{{context_json}}', () => JSON.stringify(context));
}
const boundedExecutionProfileContext = (profile: BoundedExecutionProfile) => ({
  key: profile.key,
  productionLanguage: profile.productionLanguage,
  reviewLanguage: profile.reviewLanguage,
  externalResearchAllowed: false,
  specializedVerificationAllowed: false,
  humanReviewRequired: true,
  reviewTranslationIsReviewOnly: true,
});

export function scriptWriterShortProviderContext(
  project: Row,
  profile: BoundedExecutionProfile,
  inputBriefVersionId: string | null,
) {
  const brief = (project.approvedArtifacts as Row[] | undefined)?.find(
    (item) => item.artifactType === 'CONTENT_BRIEF' && item.versionId === inputBriefVersionId,
  );
  if (
    !inputBriefVersionId ||
    typeof project.id !== 'string' ||
    !brief ||
    brief.languageCode !== profile.productionLanguage ||
    project.format !== 'SHORT' ||
    project.primaryLanguage !== profile.productionLanguage ||
    typeof brief.contentJson !== 'string'
  )
    throw new ProviderError(
      'PERMANENT',
      false,
      'The exact current approved bounded Content Brief is required for script generation.',
    );
  let approvedBrief: z.infer<typeof contentBriefSchema>;
  try {
    const parsed = contentBriefSchema.safeParse(JSON.parse(brief.contentJson));
    if (!parsed.success)
      throw new ProviderError(
        'PERMANENT',
        false,
        'The exact current approved bounded Content Brief is invalid.',
      );
    approvedBrief = parsed.data;
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError(
      'PERMANENT',
      false,
      'The exact current approved bounded Content Brief is invalid.',
    );
  }
  if (
    approvedBrief.format !== 'SHORT' ||
    approvedBrief.productionLanguage !== profile.productionLanguage ||
    approvedBrief.reviewLanguage !== profile.reviewLanguage
  )
    throw new ProviderError(
      'PERMANENT',
      false,
      'The exact current approved bounded Content Brief is incompatible with the execution profile.',
    );
  return {
    task: 'SCRIPT_WRITER_SHORT' as const,
    projectId: project.id,
    productionLanguage: profile.productionLanguage,
    inputBriefVersionId,
    approvedBrief,
    executionProfile: boundedExecutionProfileContext(profile),
  };
}

export function providerBoundRequestMaterial<
  TInput extends Row,
  TOutputSchema extends Record<string, unknown>,
>(template: string, context: Row, input: TInput, outputSchema: TOutputSchema) {
  const instructions = renderPrompt(template, context);
  return {
    instructions,
    input,
    outputSchema,
    conservativeInputUnits: conservativeInputTokenUpperBound({ instructions, input, outputSchema }),
  };
}

export function reviewTranslationProviderContext(project: Row, profile: BoundedExecutionProfile) {
  const source = project.exactSource as TranslationSourceSnapshot | null;
  if (
    !source ||
    typeof source.versionId !== 'string' ||
    source.languageCode !== profile.productionLanguage ||
    source.sourceType !== 'HUMAN_EDITED' ||
    !Array.isArray(source.segments) ||
    source.segments.length === 0 ||
    source.segments.some(
      (segment, index) =>
        segment.order !== index + 1 || typeof segment.text !== 'string' || !segment.text.trim(),
    )
  )
    throw new ProviderError(
      'PERMANENT',
      false,
      'The exact ordered production-language source segments are required for review translation.',
    );
  return {
    task: 'REVIEW_TRANSLATION_ES' as const,
    sourceScriptVersionId: source.versionId,
    sourceLanguage: profile.productionLanguage,
    targetLanguage: profile.reviewLanguage,
    sourceSegments: source.segments.map((segment) => ({
      order: segment.order,
      text: segment.text,
    })),
  };
}

const normalizeTranslationTerm = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('de')
    .replace(/[‐‑‒–—]/gu, '-')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();

const translationTokens = (value: string) =>
  normalizeTranslationTerm(value).split(' ').filter(Boolean);
const germanFunctionWords = new Set([
  'aber',
  'als',
  'am',
  'auf',
  'aus',
  'bei',
  'das',
  'dem',
  'den',
  'der',
  'des',
  'die',
  'durch',
  'eine',
  'einem',
  'einen',
  'einer',
  'eines',
  'für',
  'im',
  'in',
  'mit',
  'nach',
  'und',
  'von',
  'während',
  'zu',
  'zum',
  'zur',
]);
const spanishFunctionWords = new Set([
  'al',
  'con',
  'de',
  'del',
  'durante',
  'el',
  'en',
  'la',
  'las',
  'los',
  'para',
  'por',
  'que',
  'se',
  'su',
  'un',
  'una',
  'y',
]);

function multisetOverlap(source: string[], target: string[]) {
  const available = new Map<string, number>();
  for (const token of target) available.set(token, (available.get(token) ?? 0) + 1);
  let overlap = 0;
  for (const token of source) {
    const count = available.get(token) ?? 0;
    if (count > 0) {
      overlap += 1;
      available.set(token, count - 1);
    }
  }
  return source.length === 0 ? 0 : overlap / source.length;
}

function characterNgramSimilarity(left: string, right: string, size = 3) {
  const grams = (value: string) => {
    const compact = normalizeTranslationTerm(value);
    const result = new Map<string, number>();
    for (let index = 0; index <= compact.length - size; index += 1) {
      const gram = compact.slice(index, index + size);
      result.set(gram, (result.get(gram) ?? 0) + 1);
    }
    return result;
  };
  const a = grams(left);
  const b = grams(right);
  const aCount = [...a.values()].reduce((total, count) => total + count, 0);
  const bCount = [...b.values()].reduce((total, count) => total + count, 0);
  if (!aCount || !bCount) return 0;
  let intersection = 0;
  for (const [gram, count] of a) intersection += Math.min(count, b.get(gram) ?? 0);
  return (2 * intersection) / (aCount + bCount);
}

function translationLooksMostlyLikeSource(source: string, target: string) {
  const sourceTokens = translationTokens(source);
  const targetTokens = translationTokens(target);
  const retained = multisetOverlap(sourceTokens, targetTokens);
  const germanResidue = targetTokens.filter((token) => germanFunctionWords.has(token)).length;
  const spanishSignals = targetTokens.filter((token) => spanishFunctionWords.has(token)).length;
  return (
    retained >= 0.72 ||
    characterNgramSimilarity(source, target) >= 0.8 ||
    (retained >= 0.55 && germanResidue >= 2 && spanishSignals < 2)
  );
}

const translationTermRules = [
  { source: /\bariane\s*5\b/u, target: /\bariane\s*5\b/u, label: 'Ariane 5' },
  {
    source: /\b4 juni 1996\b/u,
    target: /\b4(?: de)? junio(?: de)? 1996\b/u,
    label: '4 June 1996',
  },
  { source: /\bh0\b/u, target: /\bh0\b/u, label: 'H0' },
  { source: /\bvulcain\b/u, target: /\bvulcain\b/u, label: 'Vulcain' },
  { source: /\bsri\b/u, target: /\bsri\b/u, label: 'SRI' },
  { source: /\b64\s*bit\b/u, target: /\b64(?:\s*bit| bits?)\b/u, label: '64-bit' },
  { source: /\b16\s*bit\b/u, target: /\b16(?:\s*bit| bits?)\b/u, label: '16-bit' },
  { source: /\bflight 501\b/u, target: /\b(?:flight|vuelo) 501\b/u, label: 'Flight 501' },
  { source: /\bgerard le lann\b/u, target: /\bgerard le lann\b/u, label: 'Gérard Le Lann' },
] as const;

export function validateReviewTranslationOutput(
  output: z.infer<typeof reviewTranslationOutputSchema>,
  source: TranslationSourceSnapshot,
) {
  if (output.sourceScriptVersionId !== source.versionId || output.languageCode !== 'es')
    throw new ProviderError('SCHEMA_VALIDATION', false, 'Spanish review provenance is invalid.');
  if (
    output.segments.length !== source.segments.length ||
    output.segments.some((segment, index) => segment.order !== source.segments[index]?.order)
  )
    throw new ProviderError(
      'SCHEMA_VALIDATION',
      false,
      'Spanish review segments do not match the exact source segment structure.',
    );
  const normalizedPairs: Array<{ source: string; target: string }> = [];
  for (const [index, translated] of output.segments.entries()) {
    const sourceSegment = source.segments[index]!;
    const normalizedSource = normalizeTranslationTerm(sourceSegment.text);
    const normalizedTarget = normalizeTranslationTerm(translated.text);
    const sourceTokens = translationTokens(sourceSegment.text);
    const targetTokens = translationTokens(translated.text);
    if (
      !normalizedTarget ||
      normalizedTarget === normalizedSource ||
      translationLooksMostlyLikeSource(sourceSegment.text, translated.text)
    )
      throw new ProviderError(
        'SCHEMA_VALIDATION',
        false,
        'Spanish review segment content is missing or leaves the German source untranslated.',
      );
    const minimumTokenRatio = sourceTokens.length >= 8 ? 0.75 : 0.5;
    if (
      normalizedTarget.length < Math.max(12, Math.floor(normalizedSource.length * 0.68)) ||
      targetTokens.length < Math.max(3, Math.ceil(sourceTokens.length * minimumTokenRatio))
    )
      throw new ProviderError(
        'SCHEMA_VALIDATION',
        false,
        'Spanish review output is an obvious segment summary.',
      );
    for (const rule of translationTermRules)
      if (rule.source.test(normalizedSource) && !rule.target.test(normalizedTarget))
        throw new ProviderError(
          'SCHEMA_VALIDATION',
          false,
          `Spanish review output omitted required source term: ${rule.label}.`,
        );
    normalizedPairs.push({ source: normalizedSource, target: normalizedTarget });
  }
  for (let left = 0; left < normalizedPairs.length; left += 1)
    for (let right = left + 1; right < normalizedPairs.length; right += 1) {
      const sourceSimilarity = characterNgramSimilarity(
        normalizedPairs[left]!.source,
        normalizedPairs[right]!.source,
      );
      const targetSimilarity = characterNgramSimilarity(
        normalizedPairs[left]!.target,
        normalizedPairs[right]!.target,
      );
      if (sourceSimilarity < 0.65 && targetSimilarity >= 0.84)
        throw new ProviderError(
          'SCHEMA_VALIDATION',
          false,
          'Spanish review output repeats generic content across distinct source segments.',
        );
    }
}

function validateSemantics(
  task: Task,
  output: unknown,
  project: Row,
  inputVersionId: string | null,
) {
  if (
    (task === 'SCRIPT_WRITER_SHORT' || task === 'SCRIPT_WRITER_LONG') &&
    (output as { languageCode: string }).languageCode !== project.primaryLanguage
  )
    throw new ProviderError(
      'SCHEMA_VALIDATION',
      false,
      'Production script language does not match the project.',
    );
  if (task === 'REVIEW_TRANSLATION_ES') {
    const source = project.exactSource as TranslationSourceSnapshot | null;
    if (!source || source.versionId !== inputVersionId)
      throw new ProviderError('SCHEMA_VALIDATION', false, 'Spanish review provenance is invalid.');
    validateReviewTranslationOutput(
      output as z.infer<typeof reviewTranslationOutputSchema>,
      source,
    );
  }
  if (task === 'CONTENT_BRIEF') {
    const researchIds = (project.lineage as LineageEdge[])
      .filter((edge) => edge.dependencyType === 'USES_RESEARCH')
      .map((edge) => edge.sourceVersionId);
    const outputResearchIds = (output as { researchVersionIds: string[] }).researchVersionIds;
    if (
      researchIds.length !== 1 ||
      outputResearchIds.length !== 1 ||
      outputResearchIds[0] !== researchIds[0]
    )
      throw new ProviderError(
        'SCHEMA_VALIDATION',
        false,
        'Content Brief Research provenance is invalid.',
      );
  }
  if (task === 'SCRIPT_CRITIC') {
    const critique = output as z.infer<typeof scriptCritiqueSchema>;
    const source = project.critiqueSource as CritiqueSourceSnapshot | null | undefined;
    if (
      !source ||
      critique.sourceScriptVersionId !== inputVersionId ||
      critique.sourceScriptVersionId !== source.script.versionId ||
      critique.languageCode !== source.script.languageCode
    )
      throw new ProviderError('SCHEMA_VALIDATION', false, 'Script Critique provenance is invalid.');
    const maximumSegmentOrder = source.script.segments.length;
    if (
      critique.issues.some(
        (issue) =>
          issue.segmentOrders !== null &&
          (new Set(issue.segmentOrders).size !== issue.segmentOrders.length ||
            issue.segmentOrders.some((order) => order > maximumSegmentOrder)),
      )
    )
      throw new ProviderError(
        'SCHEMA_VALIDATION',
        false,
        'Script Critique segment references are invalid.',
      );
  }
  const ordered =
    task === 'SCRIPT_WRITER_SHORT' || task === 'SCRIPT_WRITER_LONG'
      ? (output as { segments: { order: number }[] }).segments
      : task === 'STORYBOARD_PLANNER'
        ? (output as { scenes: { order: number }[] }).scenes
        : null;
  if (ordered && ordered.some((item, index) => item.order !== index + 1))
    throw new ProviderError(
      'SCHEMA_VALIDATION',
      false,
      'Output order must be contiguous and start at one.',
    );
}
function safeError(error: unknown) {
  return error instanceof ProviderError
    ? error
    : new ProviderError(
        'PERMANENT',
        false,
        error instanceof IdeaCapacityError || error instanceof ContentBriefCapacityError
          ? error.message
          : 'AI execution failed.',
      );
}

const VALIDATION_ISSUE_LIMIT = 8;
const VALIDATION_PATH_DEPTH_LIMIT = 6;
const VALIDATION_PATH_SEGMENT_LIMIT = 48;
const stableCustomIssueCategories: Readonly<Record<string, string>> = Object.freeze({
  'On-screen text timing is inverted': 'on_screen_text_timing_inverted',
  'Supported claims require approved Research IDs': 'supported_claim_missing_research_ids',
  'Open claims cannot imply verified evidence': 'open_claim_has_research_ids',
  'Scene script links must be unique': 'duplicate_scene_script_segment',
  'Caption links must belong to the scene': 'caption_segment_outside_scene',
  'SHORT Storyboards require 9:16': 'short_storyboard_aspect_ratio',
  'SHORT scenes require 9:16': 'short_scene_aspect_ratio',
  'Scene order must be contiguous': 'scene_order_not_contiguous',
  'Continuity keys must be unique': 'duplicate_continuity_key',
  'Continuity references must resolve': 'unresolved_continuity_reference',
});

export function sanitizeValidationIssues(
  issues: ReadonlyArray<{ code: string; path?: readonly PropertyKey[]; message?: string }>,
  schemaVersion: string,
) {
  const captured = issues.slice(0, VALIDATION_ISSUE_LIMIT).map((issue) => ({
    code: issue.code.slice(0, 64),
    path: (issue.path ?? [])
      .slice(0, VALIDATION_PATH_DEPTH_LIMIT)
      .map((part) =>
        typeof part === 'number'
          ? part
          : typeof part === 'string'
            ? part.slice(0, VALIDATION_PATH_SEGMENT_LIMIT)
            : 'unknown',
      ),
    pathTruncated: (issue.path?.length ?? 0) > VALIDATION_PATH_DEPTH_LIMIT,
    category:
      issue.code === 'custom' && issue.message
        ? (stableCustomIssueCategories[issue.message] ?? 'custom_contract_rule')
        : `schema_${issue.code.slice(0, 48)}`,
    message: 'Value does not satisfy the active output contract.',
  }));
  return {
    validationLayer: 'application_schema',
    schemaVersion: schemaVersion.slice(0, 100),
    totalIssueCount: issues.length,
    capturedIssueCount: captured.length,
    truncated: issues.length > captured.length,
    issues: captured,
  };
}

export class EditorialExecutionService {
  constructor(
    private readonly db: D1Database,
    private readonly actor: EditorialActor,
    private readonly config: ExecutionConfig,
  ) {}

  async execute(
    projectId: string,
    task: Task,
    command: Command,
    idempotencyKey: string,
  ): Promise<{ run: Row; idempotentReplay: boolean }> {
    if (task === 'PREFLIGHT_ANALYSIS')
      throw new ProviderError(
        'PERMANENT',
        false,
        'Preflight is deterministic and cannot use a provider.',
      );
    const commandHash = await digest({ projectId, task, command });
    const existing = await this.db
      .prepare(
        `SELECT id,status,output_artifact_version_id AS outputArtifactVersionId,error_category AS errorCategory,safe_metadata_json AS safeMetadataJson FROM intelligence_runs WHERE workspace_id=? AND idempotency_key=?`,
      )
      .bind(this.actor.workspaceId, idempotencyKey)
      .first<Row>();
    let claimed: BriefClaim | null = null;
    if (existing) {
      const metadata =
        typeof existing.safeMetadataJson === 'string'
          ? (JSON.parse(existing.safeMetadataJson) as Row)
          : {};
      if (metadata.commandHash !== commandHash)
        throw new ProviderError(
          'PERMANENT',
          false,
          'Idempotency key is already bound to a different command.',
        );
      if (
        task === 'CONTENT_BRIEF' &&
        command.contentBriefRevisionCapacityId &&
        existing.status === 'QUEUED'
      ) {
        claimed = await loadContentBriefPreDispatchClaim(
          this.db,
          this.actor,
          projectId,
          command.contentBriefRevisionCapacityId,
          command.inputArtifactVersionId,
          this.config.environment ?? 'runtime',
          String(existing.id),
          idempotencyKey,
          commandHash,
        );
      } else return { run: existing, idempotentReplay: true };
    }
    const progress = { dispatchPipelineEntered: false };
    try {
      return await this.executeClaimedOrNew(
        projectId,
        task,
        command,
        idempotencyKey,
        commandHash,
        claimed,
        progress,
      );
    } catch (error) {
      if (claimed && !progress.dispatchPipelineEntered)
        return this.failBriefPreparation(
          projectId,
          command,
          idempotencyKey,
          commandHash,
          claimed,
          error,
        );
      throw error;
    }
  }

  private async executeClaimedOrNew(
    projectId: string,
    task: Task,
    command: Command,
    idempotencyKey: string,
    commandHash: string,
    claimed: BriefClaim | null,
    progress: { dispatchPipelineEntered: boolean },
  ) {
    if (!(await this.terminalSchemaReady()))
      throw new ProviderError(
        'UNAVAILABLE',
        false,
        'Terminal pipeline schema capability is unavailable.',
      );
    if (
      command.ideaRevisionCapacityId &&
      (task !== 'IDEA_GENERATION' ||
        command.remediationId ||
        command.mode !== 'LOCKED' ||
        command.preferredProviderKey !== 'openai' ||
        command.preferredModelKey !== 'gpt-5.6-terra' ||
        command.creativeRegeneration)
    )
      throw new ProviderError('PERMANENT', false, 'Invalid Idea revision execution policy.');
    if (
      command.contentBriefRevisionCapacityId &&
      (task !== 'CONTENT_BRIEF' ||
        command.ideaRevisionCapacityId ||
        command.remediationId ||
        command.mode !== 'LOCKED' ||
        command.preferredProviderKey !== 'openai' ||
        command.preferredModelKey !== 'gpt-5.6-terra' ||
        command.creativeRegeneration ||
        !command.inputArtifactVersionId)
    )
      throw new ProviderError(
        'PERMANENT',
        false,
        'Invalid Content Brief revision execution policy.',
      );
    if (
      command.productionScriptRetryAuthorizationId &&
      (task !== 'SCRIPT_WRITER_SHORT' ||
        command.ideaRevisionCapacityId ||
        command.contentBriefRevisionCapacityId ||
        command.remediationId ||
        command.mode !== 'LOCKED' ||
        command.preferredProviderKey !== 'openai' ||
        command.preferredModelKey !== 'gpt-5.6-luna' ||
        command.creativeRegeneration ||
        !command.inputArtifactVersionId)
    )
      throw new ProductionScriptRetryError(422, 'production_script_retry_execution_policy_invalid');
    const briefCapacity =
      claimed?.capacity ??
      (command.contentBriefRevisionCapacityId
        ? await loadContentBriefRevisionCapacity(
            this.db,
            this.actor,
            projectId,
            command.contentBriefRevisionCapacityId,
            command.inputArtifactVersionId,
            this.config.environment ?? 'runtime',
          )
        : null);
    const revisionCapacity =
      briefCapacity ??
      (command.ideaRevisionCapacityId
        ? await loadIdeaRevisionCapacity(
            this.db,
            this.actor,
            projectId,
            command.ideaRevisionCapacityId,
            command.inputArtifactVersionId,
          )
        : null);
    if (command.remediationId && task !== 'STORYBOARD_PLANNER')
      throw new ProviderError(
        'PERMANENT',
        false,
        'Remediation execution is only supported for Storyboard.',
      );
    let remediationClaimGuard: D1PreparedStatement | undefined;
    let scriptRetryAuthorization: Row | null = null;
    if (task === 'SCRIPT_WRITER_SHORT' || task === 'SCRIPT_WRITER_LONG') {
      const readiness = await assertEditorialProductionReady(
        this.db,
        this.actor,
        projectId,
        'BEFORE_PRODUCTION_SCRIPT',
        command.inputArtifactVersionId ?? null,
      );
      if (readiness.remediationIdentity) {
        remediationClaimGuard = researchRemediationClaimGuard(
          this.db,
          readiness.remediationIdentity,
        );
        const retryRequired = await productionScriptRetryRequired(
          this.db,
          this.actor,
          projectId,
          readiness.remediationIdentity,
        );
        if (retryRequired && !command.productionScriptRetryAuthorizationId)
          throw new ProductionScriptRetryError(
            409,
            'production_script_retry_authorization_required',
          );
        if (!retryRequired && command.productionScriptRetryAuthorizationId)
          throw new ProductionScriptRetryError(409, 'production_script_retry_not_applicable');
        if (command.productionScriptRetryAuthorizationId)
          scriptRetryAuthorization = await loadProductionScriptRetryAuthorization(
            this.db,
            this.actor,
            projectId,
            command.productionScriptRetryAuthorizationId,
            readiness.remediationIdentity,
            idempotencyKey,
            this.config.environment ?? 'runtime',
          );
      } else if (command.productionScriptRetryAuthorizationId) {
        throw new ProductionScriptRetryError(409, 'production_script_retry_not_applicable');
      }
    } else if (command.productionScriptRetryAuthorizationId) {
      throw new ProductionScriptRetryError(409, 'production_script_retry_not_applicable');
    }
    if (task === 'STORYBOARD_PLANNER')
      await assertEditorialProductionReady(this.db, this.actor, projectId, 'BEFORE_STORYBOARD');
    if (!this.config.openAIEnabled || !this.config.openAIApiKey)
      throw new ProviderNotConfiguredError();
    const project = await this.projectContext(
      projectId,
      task,
      command.inputArtifactVersionId,
      command.ideaRevisionCapacityId !== undefined,
    );
    const scriptSourceBrief =
      task === 'SCRIPT_WRITER_SHORT' || task === 'SCRIPT_WRITER_LONG'
        ? (project.scriptSourceBrief as ScriptSourceBriefSnapshot | undefined)
        : undefined;
    const translationSource =
      task === 'REVIEW_TRANSLATION_ES'
        ? (project.exactSource as TranslationSourceSnapshot | undefined)
        : undefined;
    const critiqueSource =
      task === 'SCRIPT_CRITIC'
        ? (project.critiqueSource as CritiqueSourceSnapshot | undefined)
        : undefined;
    if (
      task === 'SCRIPT_CRITIC' &&
      (!critiqueSource || command.inputArtifactVersionId !== critiqueSource.script.versionId)
    )
      throw new ProviderError(
        'PERMANENT',
        false,
        'The exact authoritative Critique source snapshot is required.',
      );
    if (
      (task === 'SCRIPT_WRITER_SHORT' || task === 'SCRIPT_WRITER_LONG') &&
      (!scriptSourceBrief || command.inputArtifactVersionId !== scriptSourceBrief.versionId)
    )
      throw new ProviderError(
        'PERMANENT',
        false,
        'The exact authoritative current approved Content Brief input is required.',
      );
    if (task === 'SCRIPT_WRITER_SHORT' && project.format !== 'SHORT')
      throw new ProviderError(
        'PERMANENT',
        false,
        'The short-script route requires a SHORT project.',
      );
    const prompt = await this.db
      .prepare(
        `SELECT pv.id,pv.template_text AS templateText,pv.input_schema_version AS inputSchemaVersion,pv.output_schema_version AS outputSchemaVersion,pd.key FROM prompt_versions pv JOIN prompt_definitions pd ON pd.id=pv.prompt_definition_id WHERE pd.key=? AND (? IS NULL OR pv.id=?) AND pd.status='active' AND pv.status='active' ORDER BY pv.version_number DESC LIMIT 1`,
      )
      .bind(
        promptKey[task],
        revisionCapacity?.prompt_version_id ?? null,
        revisionCapacity?.prompt_version_id ?? null,
      )
      .first<{
        id: string;
        templateText: string;
        inputSchemaVersion: string;
        outputSchemaVersion: string;
        key: string;
      }>();
    if (!prompt)
      throw new ProviderError('PERMANENT', false, 'Active prompt version is unavailable.');
    if (revisionCapacity && !prompt.templateText.includes('{{context_json}}')) {
      if (briefCapacity)
        throw new ContentBriefCapacityError(422, 'content_brief_revision_context_unavailable');
      throw new IdeaCapacityError(422, 'idea_revision_context_unavailable');
    }
    if (task === 'CONTENT_BRIEF' && !prompt.templateText.includes('{{context_json}}'))
      throw new ProviderError('PERMANENT', false, 'brief_context_unavailable');
    const selectedOutputSchema =
      task !== 'STORYBOARD_PLANNER'
        ? outputSchema[task]
        : prompt.outputSchemaVersion === 'storyboard-output-v2'
          ? storyboardOutputV2Schema
          : prompt.outputSchemaVersion === 'storyboard-output-v1'
            ? storyboardOutputV1Schema
            : null;
    if (!selectedOutputSchema)
      throw new ProviderError('PERMANENT', false, 'Unsupported Storyboard output schema version.');
    const modelRows = await this.db
      .prepare(
        `SELECT p.id AS providerId,p.key AS providerKey,m.id AS modelId,m.model_key AS modelKey,m.capabilities_json AS capabilitiesJson,m.status,ps.id AS pricingSnapshotId,ps.input_unit_price AS inputPrice,ps.output_unit_price AS outputPrice,ps.currency,ps.unit_name AS unitName,ps.verification_status AS verificationStatus,ps.effective_from AS effectiveFrom,ps.effective_to AS effectiveTo FROM ai_providers p JOIN ai_provider_models m ON m.provider_id=p.id LEFT JOIN ai_pricing_snapshots ps ON ps.provider_model_id=m.id AND ps.effective_to IS NULL WHERE p.status='configured' AND m.status='available'`,
      )
      .all<Row>();
    if (scriptRetryAuthorization)
      modelRows.results = modelRows.results.filter(
        (row) =>
          row.modelId === scriptRetryAuthorization.provider_model_id &&
          row.pricingSnapshotId === scriptRetryAuthorization.pricing_snapshot_id,
      );
    if (revisionCapacity)
      modelRows.results = modelRows.results.filter(
        (row) =>
          row.modelId === revisionCapacity.provider_model_id &&
          row.pricingSnapshotId === revisionCapacity.pricing_snapshot_id,
      );
    const candidates = modelRows.results.map((row) => {
      const cfg = parseCapabilities(row.capabilitiesJson);
      return {
        providerKey: String(row.providerKey),
        modelKey: String(row.modelKey),
        status: row.status as 'available',
        capabilities: cfg.capabilities as ModelCandidate['capabilities'],
        qualityTier: cfg.qualityTier as ModelCandidate['qualityTier'],
        costRank: Number(cfg.costRank),
      } satisfies ModelCandidate;
    });
    const boundedProfile = isBoundedProfileStep(task)
      ? boundedProfileForProject({
          format: project.format,
          operatingMode: project.operatingMode,
          primaryLanguage: project.primaryLanguage,
          reviewLanguage: project.reviewLocale,
        })
      : undefined;
    const economyEligible =
      boundedProfile !== undefined &&
      isBoundedProfileStep(task) &&
      this.isProfileProjectEligible(project, task, boundedProfile);
    const policy = taskPolicy(task, { economyEligible });
    const selected = routeModel(candidates, {
      mode: command.mode,
      requiredCapabilities: policy.requiredCapabilities,
      minimumQualityTier: policy.minimumQualityTier,
      ...(command.preferredProviderKey
        ? { preferredProviderKey: command.preferredProviderKey }
        : {}),
      ...(command.preferredModelKey ? { preferredModelKey: command.preferredModelKey } : {}),
    });
    const selectedRow = modelRows.results.find(
      (row) => row.providerKey === selected.providerKey && row.modelKey === selected.modelKey,
    )!;
    const boundedStep =
      economyEligible &&
      boundedProfile !== undefined &&
      isBoundedProfileStep(task) &&
      selected.providerKey === boundedProfile.providerKey &&
      selected.modelKey === boundedProfile.modelKey;
    const executionClass = remediationClaimGuard
      ? 'REVISION_REMEDIATION_BOUNDED_REQUIRED'
      : 'ORDINARY';
    if (
      executionClass === 'REVISION_REMEDIATION_BOUNDED_REQUIRED' &&
      (!boundedStep ||
        task !== 'SCRIPT_WRITER_SHORT' ||
        boundedProfile?.key !== PHASE3_SHORT_DE_REVIEW_ES_PROFILE ||
        boundedProfile.version !== 1)
    )
      throw new ProviderError(
        'PERMANENT',
        false,
        'Revision-remediation Script execution requires the governed bounded profile and an authorized execution envelope.',
      );
    if ((boundedStep || isGovernedTerminalStage(task)) && command.creativeRegeneration)
      throw new ProviderError(
        'PERMANENT',
        false,
        'Creative regeneration is not allowed by the execution profile.',
      );
    const governedStage = isGovernedTerminalStage(task);
    const stepPolicy = revisionCapacity
      ? { ...policy, ...(briefCapacity ? contentBriefRevisionPolicy : ideaRevisionPolicy) }
      : boundedStep
        ? boundedProfile.steps[task]
        : governedStage
          ? { ...policy, ...governedTerminalStagePolicies[task] }
          : policy;
    const providerInput =
      task === 'SCRIPT_CRITIC'
        ? scriptCritiqueProviderContext(project)
        : boundedStep
          ? task === 'REVIEW_TRANSLATION_ES'
            ? reviewTranslationProviderContext(project, boundedProfile)
            : scriptWriterShortProviderContext(
                project,
                boundedProfile,
                command.inputArtifactVersionId,
              )
          : project;
    const providerOutputSchema = z.toJSONSchema(selectedOutputSchema);
    // Bounded prompts already render the complete context into instructions. Sending it again as
    // input duplicates provider-bound content and consumes budget without adding information.
    const providerRequestInput = boundedStep || governedStage ? {} : providerInput;
    const effectivePromptTemplate =
      task === 'REVIEW_TRANSLATION_ES'
        ? `${prompt.templateText}\n\n${reviewTranslationPolicyInstructions}`
        : task === 'SCRIPT_CRITIC'
          ? `${prompt.templateText}\n\n${scriptCritiquePolicyInstructions}`
          : prompt.templateText;
    const providerMaterial = providerBoundRequestMaterial(
      effectivePromptTemplate,
      providerInput,
      providerRequestInput,
      providerOutputSchema,
    );
    const inputCeiling = boundedStep
      ? boundedProfile.steps[task].inputTokenCeiling
      : governedStage
        ? governedTerminalStagePolicies[task].inputTokenCeiling
        : null;
    if (inputCeiling !== null && providerMaterial.conservativeInputUnits > inputCeiling)
      throw new ProviderError(
        'PERMANENT',
        false,
        'Provider-bound input exceeds the execution profile ceiling.',
      );
    const envelope =
      scriptRetryAuthorization ??
      revisionCapacity ??
      (boundedStep
        ? await loadBoundedEnvelope(this.db, this.actor, projectId, selected, boundedProfile)
        : governedStage
          ? command.remediationId
            ? await loadGovernedRemediationEnvelope(
                this.db,
                this.actor,
                projectId,
                task,
                selected,
                command.remediationId,
              )
            : await loadGovernedTerminalEnvelope(this.db, this.actor, projectId, task, selected)
          : null);
    const reservedMicrousd = boundedStep
      ? calculateReservation(selectedRow, task, boundedProfile)
      : governedStage
        ? calculateGovernedReservation(selectedRow, task)
        : null;
    // Bind the actual dispatch controls to the immutable SQL policy, at both transaction boundaries.
    const retryExecutionPolicyJson = scriptRetryAuthorization
      ? JSON.stringify([
          selectedRow.providerId,
          selected.providerKey,
          selectedRow.modelId,
          selected.modelKey,
          prompt.id,
          selectedRow.pricingSnapshotId,
          task,
          stepPolicy.reasoningEffort,
          scriptRetryAuthorization.maximum_calls,
          stepPolicy.maximumAttempts,
          0,
          Number(boundedProfile?.fallbackAllowed),
          reservedMicrousd,
          Number(command.creativeRegeneration),
          0,
          Number(boundedProfile?.externalResearchAllowed),
          Number(boundedProfile?.humanReviewRequired),
          stepPolicy.maxOutputTokens,
          inputCeiling,
          stepPolicy.timeoutMs,
          boundedProfile?.key,
          boundedProfile?.version,
          command.mode,
        ])
      : null;
    const runId = claimed?.runId ?? newId('intelligence_run'),
      at = now();
    const retryReservationId = scriptRetryAuthorization ? newId('execution_reservation') : null;
    const regeneration = command.creativeRegeneration ? 1 : 0;
    const insertRun = this.db
      .prepare(
        `INSERT OR IGNORE INTO intelligence_runs(id,workspace_id,project_id,task_type,provider_id,provider_model_id,prompt_version_id,input_artifact_version_id,initiated_by,operating_mode,status,idempotency_key,creative_regeneration_number,safe_metadata_json,pricing_snapshot_id,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?,?,?,'QUEUED',?,?,?, ?,?,?,1)`,
      )
      .bind(
        runId,
        this.actor.workspaceId,
        projectId,
        task,
        selectedRow.providerId,
        selectedRow.modelId,
        prompt.id,
        command.inputArtifactVersionId,
        this.actor.id,
        String(project.operatingMode),
        idempotencyKey,
        regeneration,
        JSON.stringify({
          commandHash,
          ...(translationSource
            ? { translationSourceSnapshot: translationSourceSnapshotEvidence(translationSource) }
            : {}),
          ...(critiqueSource
            ? { critiqueSourceSnapshot: critiqueSourceSnapshotEvidence(critiqueSource) }
            : {}),
          ...(scriptRetryAuthorization
            ? {
                productionScriptRetryAuthorizationId: command.productionScriptRetryAuthorizationId,
                failedProductionScriptRunId: scriptRetryAuthorization.failed_run_id,
              }
            : {}),
          ...(revisionCapacity
            ? {
                [briefCapacity ? 'contentBriefRevisionCapacityId' : 'ideaRevisionCapacityId']:
                  command.contentBriefRevisionCapacityId ?? command.ideaRevisionCapacityId,
                ...(revisionCapacity.recoveryId
                  ? {
                      [briefCapacity ? 'contentBriefRevisionRecoveryId' : 'ideaRevisionRecoveryId']:
                        revisionCapacity.recoveryId,
                    }
                  : {}),
              }
            : {}),
        }),
        selectedRow.pricingSnapshotId ?? null,
        at,
        at,
      );
    const scriptSourceAuthorizationGuard = scriptSourceBrief
      ? this.scriptSourceBriefGuard(scriptSourceBrief)
      : undefined;
    const translationSourceAuthorizationGuard = translationSource
      ? translationSourceGuardStatement(this.db, translationSource)
      : undefined;
    const critiqueSourceAuthorizationGuard = critiqueSource
      ? critiqueSourceGuardStatement(this.db, critiqueSource)
      : undefined;
    if (!claimed && (boundedStep || governedStage) && envelope && reservedMicrousd !== null) {
      try {
        // For Research remediation, this batch commit is the durable authorization point.
        // Later editorial changes do not retroactively cancel an authorized provider attempt.
        await this.db.batch([
          ...(remediationClaimGuard ? [remediationClaimGuard] : []),
          ...(scriptRetryAuthorization
            ? [
                productionScriptRetryClaimGuard(
                  this.db,
                  command.productionScriptRetryAuthorizationId!,
                  this.actor,
                  projectId,
                  retryExecutionPolicyJson!,
                ),
              ]
            : []),
          ...(scriptSourceAuthorizationGuard ? [scriptSourceAuthorizationGuard] : []),
          ...(translationSourceAuthorizationGuard ? [translationSourceAuthorizationGuard] : []),
          ...(critiqueSourceAuthorizationGuard ? [critiqueSourceAuthorizationGuard] : []),
          ...(briefCapacity
            ? [
                await contentBriefClaimGuard(
                  this.db,
                  this.actor,
                  projectId,
                  command.contentBriefRevisionCapacityId!,
                  command.inputArtifactVersionId,
                  this.config.environment ?? 'runtime',
                ),
              ]
            : []),
          insertRun,
          ...(scriptRetryAuthorization
            ? [
                this.db
                  .prepare(
                    `INSERT INTO editorial_execution_reservations(id,envelope_id,workspace_id,project_id,intelligence_run_id,step_key,pricing_snapshot_id,reserved_microusd,status,created_at,project_execution_budget_id) VALUES(?,?,?,?,?,?,?,?,'RESERVED',?,?)`,
                  )
                  .bind(
                    retryReservationId,
                    envelope.id,
                    this.actor.workspaceId,
                    projectId,
                    runId,
                    task,
                    selectedRow.pricingSnapshotId,
                    PRODUCTION_SCRIPT_RETRY_CEILING,
                    at,
                    envelope.projectExecutionBudgetId,
                  ),
                productionScriptRetryClaimAudit(
                  this.db,
                  this.actor,
                  {
                    requestId: this.config.requestId ?? runId,
                    environment: this.config.environment ?? 'runtime',
                    accessIssuer: this.config.accessIssuer,
                    accessSubject: this.config.accessSubject,
                  },
                  command.productionScriptRetryAuthorizationId!,
                  runId,
                  retryReservationId!,
                  at,
                ),
                legacyRemediationClaimStatement(
                  this.db,
                  command.productionScriptRetryAuthorizationId!,
                  runId,
                  retryReservationId!,
                  at,
                ),
              ]
            : [
                reservationStatement(this.db, {
                  envelopeId: String(envelope.id),
                  workspaceId: this.actor.workspaceId,
                  projectId,
                  runId,
                  step: task,
                  pricingSnapshotId: String(selectedRow.pricingSnapshotId),
                  reservedMicrousd,
                  at,
                  projectExecutionBudgetId: governedStage
                    ? String(envelope.projectExecutionBudgetId)
                    : null,
                }),
              ]),
          ...(briefCapacity || scriptRetryAuthorization
            ? [
                this.db
                  .prepare(
                    `UPDATE editorial_execution_envelopes SET status='CONSUMED',updated_at=?,version=version+1 WHERE id=? AND status='ACTIVE' AND (SELECT COUNT(*) FROM editorial_execution_reservations WHERE envelope_id=?) >= maximum_calls`,
                  )
                  .bind(at, envelope.id, envelope.id),
              ]
            : []),
          ...(scriptRetryAuthorization
            ? [
                this.db
                  .prepare(
                    `SELECT CASE WHEN EXISTS(SELECT 1 FROM editorial_legacy_remediation_claims cl JOIN editorial_production_script_retry_capacities c ON c.id=cl.capacity_id JOIN editorial_execution_envelopes e ON e.id=c.envelope_id WHERE cl.capacity_id=? AND cl.run_id=? AND cl.reservation_id=? AND e.status='CONSUMED') THEN 1 ELSE json('legacy_claim_incomplete') END`,
                  )
                  .bind(command.productionScriptRetryAuthorizationId!, runId, retryReservationId!),
              ]
            : []),
        ]);
        // Brief consumption is already part of the claim batch. No follow-up write is needed.
        if (!briefCapacity && !scriptRetryAuthorization)
          await this.db
            .prepare(
              `UPDATE editorial_execution_envelopes SET status='CONSUMED',updated_at=?,version=version+1 WHERE id=? AND status='ACTIVE' AND (SELECT COUNT(*) FROM editorial_execution_reservations WHERE envelope_id=?) >= maximum_calls`,
            )
            .bind(now(), envelope.id, envelope.id)
            .run();
      } catch {
        const winner = await this.existingRun(idempotencyKey);
        if (winner && this.commandHash(winner) === commandHash) {
          if (briefCapacity && winner.status === 'QUEUED')
            return this.execute(projectId, task, command, idempotencyKey);
          return { run: winner, idempotentReplay: true };
        }
        throw new ProviderError(
          'UNAVAILABLE',
          false,
          'The execution step could not be reserved atomically.',
        );
      }
    } else if (!claimed) {
      // Remediation has no Run-only authorization path, even if claim routing changes.
      if (remediationClaimGuard)
        throw new ProviderError(
          'PERMANENT',
          false,
          'Revision-remediation Script execution requires an atomic Run and reservation claim.',
        );
      const authorizationGuards = [
        scriptSourceAuthorizationGuard,
        translationSourceAuthorizationGuard,
        critiqueSourceAuthorizationGuard,
      ].filter((statement): statement is D1PreparedStatement => statement !== undefined);
      if (authorizationGuards.length) await this.db.batch([...authorizationGuards, insertRun]);
      else await insertRun.run();
    }
    // A successful Brief claim inserted this Run and its reservation in the same transaction.
    // Duplicate claims reconcile in the catch above; the winning claim needs no extra read.
    const reserved: Row | null = briefCapacity
      ? { id: runId }
      : await this.db
          .prepare(
            `SELECT id,status,output_artifact_version_id AS outputArtifactVersionId,safe_metadata_json AS safeMetadataJson FROM intelligence_runs WHERE workspace_id=? AND idempotency_key=?`,
          )
          .bind(this.actor.workspaceId, idempotencyKey)
          .first<Row>();
    if (!reserved) throw new ProviderError('PERMANENT', false, 'Reserved run could not be read.');
    if (reserved.id !== runId) {
      if (this.commandHash(reserved) !== commandHash)
        throw new ProviderError(
          'PERMANENT',
          false,
          'Idempotency key is already bound to a different command.',
        );
      return { run: reserved, idempotentReplay: true };
    }
    let providerCompletion:
      | {
          result: ProviderExecutionResult;
          costs: {
            actualCost: number | null;
            actualMicrousd: number | null;
            currency: string | null;
          };
          metadata: Row;
          actualMicrousd: number | null;
        }
      | undefined;
    let validationDiagnostic: ReturnType<typeof sanitizeValidationIssues> | undefined;
    let briefDispatchEntered = false;
    const observer = this.observer(
      runId,
      async (result) => {
        const costs = this.cost(result, selectedRow);
        const metadata = {
          commandHash,
          ...result.safeMetadata,
          actualMicrousd: costs.actualMicrousd,
          accountingPolicy: 'exact_decimal_total_ceil_microusd_v1',
          ...(translationSource
            ? { translationSourceSnapshot: translationSourceSnapshotEvidence(translationSource) }
            : {}),
          ...(critiqueSource
            ? { critiqueSourceSnapshot: critiqueSourceSnapshotEvidence(critiqueSource) }
            : {}),
          cachedInputUnits: result.usage.cachedInputUnits,
          reasoningOutputUnits: result.usage.reasoningOutputUnits,
        };
        const actualMicrousd = costs.actualMicrousd;
        providerCompletion = { result, costs, metadata, actualMicrousd };
        const completedAt = now();
        await this.db.batch([
          this.db
            .prepare(
              `UPDATE intelligence_run_attempts SET provider_request_id=?,safe_metadata_json=? WHERE intelligence_run_id=? AND status='RUNNING'`,
            )
            .bind(result.providerRequestId, JSON.stringify(metadata), runId),
          this.db
            .prepare(
              `UPDATE intelligence_runs SET input_units=?,output_units=?,actual_cost=?,currency=?,safe_metadata_json=?,updated_at=? WHERE id=? AND workspace_id=? AND status='RUNNING'`,
            )
            .bind(
              result.usage.inputUnits,
              result.usage.outputUnits,
              costs.actualCost,
              costs.currency,
              JSON.stringify(metadata),
              completedAt,
              runId,
              this.actor.workspaceId,
            ),
        ]);
      },
      scriptRetryAuthorization
        ? async () => {
            await authorizeProductionScriptRetryDispatch(
              this.db,
              this.actor,
              {
                requestId: this.config.requestId ?? runId,
                environment: this.config.environment ?? 'runtime',
                accessIssuer: this.config.accessIssuer,
                accessSubject: this.config.accessSubject,
              },
              command.productionScriptRetryAuthorizationId!,
              runId,
              1,
              retryExecutionPolicyJson!,
            );
          }
        : revisionCapacity
          ? async () => {
              if (briefCapacity) {
                briefDispatchEntered = true;
                await authorizeContentBriefRevisionDispatch(
                  this.db,
                  this.actor,
                  projectId,
                  command.contentBriefRevisionCapacityId!,
                  runId,
                  this.config.requestId ?? runId,
                  {
                    idempotencyKey,
                    commandHash,
                    ideaVersionId: command.inputArtifactVersionId,
                    environment: this.config.environment ?? 'runtime',
                  },
                );
                return;
              }
              await authorizeIdeaRevisionDispatch(
                this.db,
                this.actor,
                projectId,
                command.ideaRevisionCapacityId!,
                runId,
              );
            }
          : undefined,
    );
    const started = Date.now();
    progress.dispatchPipelineEntered = true;
    try {
      const adapter = new OpenAIResponsesAdapter(
        this.config.openAIApiKey,
        this.config.openAIBaseUrl,
      );
      const result = await new AIExecutionGateway(new Map([['openai', adapter]])).execute<
        Row,
        unknown
      >({
        candidate: selected,
        maximumAttempts: stepPolicy.maximumAttempts,
        observer,
        request: {
          runId,
          taskType: task,
          modelKey: selected.modelKey,
          promptVersionId: prompt.id,
          input: providerMaterial.input,
          instructions: providerMaterial.instructions,
          outputSchema: providerMaterial.outputSchema,
          outputSchemaName: prompt.key,
          idempotencyKey,
          timeoutMs: stepPolicy.timeoutMs,
          maxOutputTokens: stepPolicy.maxOutputTokens,
          reasoningEffort: stepPolicy.reasoningEffort,
        },
      });
      const parsed = selectedOutputSchema.safeParse(result.output);
      if (!parsed.success) {
        validationDiagnostic = sanitizeValidationIssues(
          parsed.error.issues,
          prompt.outputSchemaVersion,
        );
        throw new ProviderError('SCHEMA_VALIDATION', false, 'Provider output failed validation.');
      }
      const costs = this.cost(result, selectedRow);
      const metadata = {
        commandHash,
        ...result.safeMetadata,
        actualMicrousd: costs.actualMicrousd,
        accountingPolicy: 'exact_decimal_total_ceil_microusd_v1',
        ...(translationSource
          ? { translationSourceSnapshot: translationSourceSnapshotEvidence(translationSource) }
          : {}),
        ...(critiqueSource
          ? { critiqueSourceSnapshot: critiqueSourceSnapshotEvidence(critiqueSource) }
          : {}),
        latencyMs: Date.now() - started,
        cachedInputUnits: result.usage.cachedInputUnits,
        reasoningOutputUnits: result.usage.reasoningOutputUnits,
      };
      validateSemantics(task, parsed.data, project, command.inputArtifactVersionId);
      const outputVersionId = await this.persist(
        projectId,
        task,
        runId,
        command.inputArtifactVersionId,
        project.primaryLanguage,
        prompt.outputSchemaVersion,
        ((project.lineage as LineageEdge[] | undefined) ?? []).length
          ? (project.lineage as LineageEdge[])
          : command.inputArtifactVersionId
            ? [
                {
                  sourceVersionId: command.inputArtifactVersionId,
                  dependencyType: 'GENERATED_FROM',
                },
              ]
            : [],
        parsed.data,
        {
          result,
          costs,
          metadata,
          governed: boundedStep || governedStage,
          productionScriptRetryAuthorizationId: command.productionScriptRetryAuthorizationId,
          briefCapacityId: command.contentBriefRevisionCapacityId,
          scriptSourceBrief: scriptSourceBrief ?? null,
          translationSource: translationSource ?? null,
          critiqueSource: critiqueSource ?? null,
          reservedMicrousd,
        },
      );
      return {
        run: {
          id: runId,
          status: 'SUCCEEDED',
          outputArtifactVersionId: outputVersionId,
          usage: result.usage,
          actualCost: costs.actualCost,
          currency: costs.currency,
        },
        idempotentReplay: false,
      };
    } catch (error) {
      if (error instanceof ContentBriefDispatchObserved) {
        const winner = await this.existingRun(idempotencyKey);
        if (winner && this.commandHash(winner) === commandHash)
          return { run: winner, idempotentReplay: true };
        throw new ContentBriefCapacityError(409, 'content_brief_revision_claim_not_resumable');
      }
      const dispatchFailure =
        error instanceof IdeaDispatchError || error instanceof ContentBriefDispatchError
          ? error
          : briefCapacity && !briefDispatchEntered
            ? new ContentBriefDispatchError('NOT_COMMITTED')
            : null;
      const undispatchedIdea =
        revisionCapacity !== null && dispatchFailure?.dispatchOutcome === 'NOT_COMMITTED';
      const mapped = safeError(dispatchFailure ?? error);
      const terminalAt = now();
      const auditId = newId('audit');
      const terminalStatus = mapped.retryable ? 'FAILED_RETRYABLE' : 'FAILED_PERMANENT';
      const failureMetadata = {
        ...(providerCompletion?.metadata ?? { commandHash }),
        ...(translationSource
          ? { translationSourceSnapshot: translationSourceSnapshotEvidence(translationSource) }
          : {}),
        ...(critiqueSource
          ? { critiqueSourceSnapshot: critiqueSourceSnapshotEvidence(critiqueSource) }
          : {}),
        ...(validationDiagnostic ? { validationDiagnostic } : {}),
        ...(dispatchFailure && dispatchFailure.rejection !== 'ELIGIBILITY_REJECTED'
          ? {
              dispatchAuthorizationOutcome: dispatchFailure.dispatchOutcome,
              providerAdapterInvoked: false,
              [briefCapacity ? 'contentBriefRevisionCapacityId' : 'ideaRevisionCapacityId']:
                command.contentBriefRevisionCapacityId ?? command.ideaRevisionCapacityId,
              ...(revisionCapacity?.recoveryId
                ? {
                    [briefCapacity ? 'contentBriefRevisionRecoveryId' : 'ideaRevisionRecoveryId']:
                      revisionCapacity.recoveryId,
                  }
                : {}),
            }
          : {}),
        ...(undispatchedIdea
          ? {
              dispatchAuthorized: false,
              providerCalls: 0,
              [briefCapacity ? 'contentBriefRevisionCapacityId' : 'ideaRevisionCapacityId']:
                command.contentBriefRevisionCapacityId ?? command.ideaRevisionCapacityId,
              ...(revisionCapacity?.recoveryId
                ? {
                    [briefCapacity ? 'contentBriefRevisionRecoveryId' : 'ideaRevisionRecoveryId']:
                      revisionCapacity.recoveryId,
                  }
                : {}),
              ...(dispatchFailure?.rejection === 'ELIGIBILITY_REJECTED'
                ? { preDispatchFailure: 'ELIGIBILITY_REJECTED' }
                : {}),
            }
          : {}),
      };
      const knownActualMicrousd = providerCompletion?.actualMicrousd ?? null;
      const reconciledKnownCost =
        knownActualMicrousd !== null &&
        reservedMicrousd !== null &&
        knownActualMicrousd <= reservedMicrousd;
      const statements: D1PreparedStatement[] = [
        this.db
          .prepare(
            `UPDATE intelligence_run_attempts SET status=?,error_category=?,safe_error_detail=?,safe_metadata_json=?,completed_at=? WHERE intelligence_run_id=? AND status='RUNNING'`,
          )
          .bind(
            terminalStatus,
            mapped.category,
            mapped.message,
            JSON.stringify(failureMetadata),
            terminalAt,
            runId,
          ),
      ];
      // Unknown authorization must retain exposure. Schema 0004 does not permit
      // RESERVED -> AMBIGUOUS: leave that reservation held for investigation.
      // Only a durable DISPATCHED reservation may enter AMBIGUOUS here.
      const reservationFailureScope = dispatchFailure
        ? undispatchedIdea
          ? "status='RESERVED' AND dispatched_at IS NULL"
          : "status='DISPATCHED'"
        : "status IN ('RESERVED','DISPATCHED')";
      if (boundedStep || governedStage)
        statements.push(
          this.db
            .prepare(
              `UPDATE editorial_execution_reservations SET status=?,actual_microusd=?,reconciled_at=? WHERE intelligence_run_id=? AND ${reservationFailureScope}`,
            )
            .bind(
              undispatchedIdea ? 'CANCELLED' : reconciledKnownCost ? 'RECONCILED' : 'AMBIGUOUS',
              undispatchedIdea ? 0 : knownActualMicrousd,
              terminalAt,
              runId,
            ),
        );
      // Do not turn a stale non-commit observation into durable zero-cost proof.
      // A late commit before this terminal batch must roll back the whole batch.
      const zeroDispatchGuard = undispatchedIdea
        ? `id=CASE WHEN started_at IS NULL
            AND NOT EXISTS(SELECT 1 FROM intelligence_run_attempts a WHERE a.intelligence_run_id=intelligence_runs.id)
            AND EXISTS(SELECT 1 FROM editorial_execution_reservations r WHERE r.intelligence_run_id=intelligence_runs.id
              AND r.status='CANCELLED' AND r.actual_microusd=0 AND r.dispatched_at IS NULL)
            THEN id ELSE NULL END,`
        : '';
      statements.push(
        this.terminalAuditStatement(
          auditId,
          runId,
          'intelligence.run_failed',
          'failure',
          terminalAt,
          failureMetadata,
        ),
        this.db
          .prepare(
            `UPDATE intelligence_runs SET ${zeroDispatchGuard}status=?,error_category=?,safe_error_detail=?,input_units=?,output_units=?,actual_cost=?,currency=?,safe_metadata_json=?,terminal_audit_event_id=?,completed_at=?,updated_at=?,version=version+1 WHERE id=? AND workspace_id=?`,
          )
          .bind(
            terminalStatus,
            mapped.category,
            mapped.message,
            undispatchedIdea ? 0 : (providerCompletion?.result.usage.inputUnits ?? null),
            undispatchedIdea ? 0 : (providerCompletion?.result.usage.outputUnits ?? null),
            undispatchedIdea ? 0 : (providerCompletion?.costs.actualCost ?? null),
            undispatchedIdea ? 'USD' : (providerCompletion?.costs.currency ?? null),
            JSON.stringify(failureMetadata),
            auditId,
            terminalAt,
            terminalAt,
            runId,
            this.actor.workspaceId,
          ),
      );
      try {
        await this.db.batch(statements);
      } catch (terminalError) {
        if (dispatchFailure)
          throw briefCapacity
            ? new ContentBriefDispatchError('AMBIGUOUS')
            : new IdeaDispatchError('AMBIGUOUS');
        throw terminalError;
      }
      if (dispatchFailure) throw dispatchFailure;
      if (error instanceof IdeaCapacityError || error instanceof ContentBriefCapacityError)
        throw error;
      throw mapped;
    }
  }

  private async failBriefPreparation(
    projectId: string,
    command: Command,
    idempotencyKey: string,
    commandHash: string,
    claim: BriefClaim,
    error: unknown,
  ) {
    const failure = await inspectContentBriefPreDispatchFailure(
      this.db,
      this.actor,
      projectId,
      command.contentBriefRevisionCapacityId!,
      claim.runId,
      {
        idempotencyKey,
        commandHash,
        ideaVersionId: command.inputArtifactVersionId,
        environment: this.config.environment ?? 'runtime',
      },
    );
    if (failure.dispatchOutcome !== 'NOT_COMMITTED') {
      const winner = await this.existingRun(idempotencyKey);
      if (winner && winner.status !== 'QUEUED' && this.commandHash(winner) === commandHash)
        return { run: winner, idempotentReplay: true };
      throw failure;
    }
    const at = now(),
      auditId = newId('audit');
    const metadata = {
      commandHash,
      contentBriefRevisionCapacityId: command.contentBriefRevisionCapacityId,
      ...(claim.capacity.recoveryId
        ? { contentBriefRevisionRecoveryId: claim.capacity.recoveryId }
        : {}),
      dispatchAuthorized: false,
      providerCalls: 0,
      ...(failure.rejection === 'ELIGIBILITY_REJECTED'
        ? { preDispatchFailure: 'ELIGIBILITY_REJECTED' }
        : { dispatchAuthorizationOutcome: 'NOT_COMMITTED', providerAdapterInvoked: false }),
    };
    try {
      await this.db.batch([
        contentBriefPreDispatchClaimStatement(
          this.db,
          this.actor,
          projectId,
          command.contentBriefRevisionCapacityId!,
          command.inputArtifactVersionId,
          this.config.environment ?? 'runtime',
          claim.runId,
          idempotencyKey,
          commandHash,
          true,
        ),
        this.db
          .prepare(
            `UPDATE editorial_execution_reservations SET status='CANCELLED',actual_microusd=0,reconciled_at=?
          WHERE id=? AND intelligence_run_id=? AND status='RESERVED' AND dispatched_at IS NULL`,
          )
          .bind(at, claim.reservationId, claim.runId),
        this.terminalAuditStatement(auditId, claim.runId, 'intelligence.run_failed', 'failure', at),
        this.db
          .prepare(
            `UPDATE intelligence_runs SET status='FAILED_PERMANENT',error_category='PERMANENT',safe_error_detail=?,
          input_units=0,output_units=0,actual_cost=0,currency='USD',safe_metadata_json=?,terminal_audit_event_id=?,
          completed_at=?,updated_at=?,version=version+1 WHERE id=? AND workspace_id=? AND status='QUEUED'`,
          )
          .bind(
            failure.message,
            JSON.stringify(metadata),
            auditId,
            at,
            at,
            claim.runId,
            this.actor.workspaceId,
          ),
      ]);
    } catch {
      const winner = await this.existingRun(idempotencyKey);
      if (winner && winner.status !== 'QUEUED' && this.commandHash(winner) === commandHash)
        return { run: winner, idempotentReplay: true };
      throw new ContentBriefDispatchError('AMBIGUOUS');
    }
    throw failure.rejection ? failure : error;
  }

  async getRun(runId: string) {
    return this.db
      .prepare(
        `SELECT id,project_id AS projectId,task_type AS taskType,status,output_artifact_version_id AS outputArtifactVersionId,input_units AS inputUnits,output_units AS outputUnits,actual_cost AS actualCost,currency,error_category AS errorCategory,safe_error_detail AS safeErrorDetail,created_at AS createdAt,updated_at AS updatedAt FROM intelligence_runs WHERE id=? AND workspace_id=?`,
      )
      .bind(runId, this.actor.workspaceId)
      .first<Row>();
  }

  async cancel(runId: string) {
    const at = now();
    const result = await this.db
      .prepare(
        `UPDATE intelligence_runs SET status='CANCELLED',completed_at=?,updated_at=?,version=version+1 WHERE id=? AND workspace_id=? AND status IN ('QUEUED','RUNNING')`,
      )
      .bind(at, at, runId, this.actor.workspaceId)
      .run();
    if (!result.meta.changes)
      throw new ProviderError('CANCELLED', false, 'Run cannot be cancelled.');
    await this.db
      .prepare(
        `UPDATE intelligence_run_attempts SET status='CANCELLED',completed_at=? WHERE intelligence_run_id=? AND status='RUNNING'`,
      )
      .bind(at, runId)
      .run();
    return { id: runId, status: 'CANCELLED' };
  }
  private async projectContext(
    projectId: string,
    task: Task,
    inputVersionId: string | null,
    researchOnly = false,
  ) {
    const project = await this.db
      .prepare(
        `SELECT p.id,p.title,p.description,p.format,p.operating_mode AS operatingMode,p.primary_language AS primaryLanguage,b.name AS brandName,b.niche,c.name AS channelName,c.narrative_tone AS narrativeTone,c.editorial_strategy_json AS editorialStrategyJson FROM projects p JOIN content_brands b ON b.id=p.content_brand_id JOIN channel_profiles c ON c.id=p.channel_profile_id WHERE p.id=? AND p.workspace_id=? AND p.deleted_at IS NULL`,
      )
      .bind(projectId, this.actor.workspaceId)
      .first<Row>();
    if (!project) throw new ProviderError('PERMANENT', false, 'Project not found.');
    const projectProfile = boundedProfileForProject({
      format: project.format,
      operatingMode: project.operatingMode,
      primaryLanguage: project.primaryLanguage,
      reviewLanguage: 'es',
    });
    // Revision Ideas start from their exact Research input. Downstream approval
    // does not establish freshness after a Research revision, so do not load it.
    const artifacts =
      researchOnly || task === 'CONTENT_BRIEF' || task === 'SCRIPT_CRITIC'
        ? { results: [] as Row[] }
        : await this.db
            .prepare(
              `SELECT a.artifact_type AS artifactType,v.id AS versionId,v.language_code AS languageCode,v.content_text AS contentText,v.content_json AS contentJson FROM editorial_artifacts a JOIN editorial_artifact_versions v ON v.id=a.current_version_id WHERE a.project_id=? AND a.workspace_id=? AND a.deleted_at IS NULL AND a.status='approved' ORDER BY a.artifact_type`,
            )
            .bind(projectId, this.actor.workspaceId)
            .all<Row>();
    const lineage: LineageEdge[] = [];
    let scriptSourceBrief: ScriptSourceBriefSnapshot | null = null;
    let critiqueSource: CritiqueSourceSnapshot | null = null;
    let storyboardSourceSegments: Row[] = [];
    const exactCurrentApproved = async (versionId: string | null, artifactType: string) => {
      if (!versionId)
        throw new ProviderError(
          'PERMANENT',
          false,
          `Exact approved ${artifactType} input is required.`,
        );
      const row = await this.db
        .prepare(
          `SELECT v.id versionId,a.id artifactId,a.artifact_type artifactType,v.content_json contentJson,v.content_text contentText,v.language_code languageCode FROM editorial_artifact_versions v JOIN editorial_artifacts a ON a.id=v.artifact_id AND a.current_version_id=v.id WHERE v.id=? AND v.workspace_id=? AND a.workspace_id=? AND a.project_id=? AND a.artifact_type=? AND a.status='approved' AND a.deleted_at IS NULL`,
        )
        .bind(versionId, this.actor.workspaceId, this.actor.workspaceId, projectId, artifactType)
        .first<Row>();
      if (!row)
        throw new ProviderError(
          'PERMANENT',
          false,
          `Exact approved current ${artifactType} input is required.`,
        );
      return row;
    };
    if (task === 'TOPIC_RESEARCH' && inputVersionId !== null)
      throw new ProviderError(
        'PERMANENT',
        false,
        'Research does not accept an editorial input version.',
      );
    if (task === 'IDEA_GENERATION') {
      const research = await exactCurrentApproved(inputVersionId, 'RESEARCH');
      if (researchOnly) {
        let summary: unknown;
        try {
          summary =
            typeof research.contentJson === 'string'
              ? (JSON.parse(research.contentJson) as Row | null)?.summary
              : null;
        } catch {
          throw new IdeaCapacityError(422, 'idea_revision_context_unavailable');
        }
        if (
          !(typeof research.contentText === 'string' && research.contentText.trim()) &&
          !(typeof summary === 'string' && summary.trim())
        )
          throw new IdeaCapacityError(422, 'idea_revision_context_unavailable');
        artifacts.results.push({
          artifactType: research.artifactType,
          versionId: research.versionId,
          languageCode: research.languageCode,
          contentText: research.contentText,
          contentJson: research.contentJson,
        });
      }
      lineage.push({
        sourceVersionId: String(research.versionId),
        dependencyType: 'GENERATED_FROM',
      });
    }
    if (task === 'CONTENT_BRIEF') {
      const idea = await exactCurrentApproved(inputVersionId, 'IDEA_CANDIDATE');
      const selected = await this.db
        .prepare(
          `SELECT id FROM idea_candidates WHERE artifact_version_id=? AND workspace_id=? AND project_id=? AND status='SELECTED'`,
        )
        .bind(idea.versionId, this.actor.workspaceId, projectId)
        .first();
      if (!selected)
        throw new ProviderError(
          'PERMANENT',
          false,
          'The exact approved current Idea must be selected.',
        );
      // Resolve lineage before filtering authority: conflicting CURRENT edges must fail closed.
      const links = (
        await this.db
          .prepare(
            `SELECT source_artifact_version_id versionId FROM artifact_dependencies
         WHERE dependent_artifact_version_id=? AND workspace_id=? AND dependency_type='GENERATED_FROM'
           AND validity_status='CURRENT' AND invalidated_at IS NULL AND invalidated_by_version_id IS NULL`,
          )
          .bind(idea.versionId, this.actor.workspaceId)
          .all<Row>()
      ).results;
      if (links.length !== 1)
        throw new ProviderError('PERMANENT', false, 'brief_research_lineage_invalid');
      const research = await exactCurrentApproved(String(links[0]!.versionId), 'RESEARCH');
      for (const source of [idea, research]) {
        const approvals = (
          await this.db
            .prepare(
              `SELECT decision FROM artifact_approvals WHERE workspace_id=? AND artifact_version_id=?`,
            )
            .bind(this.actor.workspaceId, source.versionId)
            .all<Row>()
        ).results;
        if (approvals.length !== 1 || approvals[0]!.decision !== 'APPROVED')
          throw new ProviderError('PERMANENT', false, 'brief_approval_invalid');
        let parsed: unknown = null;
        if (source.contentJson !== null && source.contentJson !== undefined) {
          try {
            if (typeof source.contentJson !== 'string') throw new Error('invalid source');
            parsed = JSON.parse(source.contentJson);
          } catch {
            throw new ProviderError('PERMANENT', false, 'brief_source_invalid');
          }
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
            throw new ProviderError('PERMANENT', false, 'brief_source_invalid');
        }
        const hasText =
          typeof source.contentText === 'string' && source.contentText.trim().length > 0;
        const field = source === research ? 'summary' : 'title';
        const value = (parsed as Row | null)?.[field];
        if (!hasText && !(typeof value === 'string' && value.trim()))
          throw new ProviderError('PERMANENT', false, 'brief_source_invalid');
        artifacts.results.push({
          artifactType: source.artifactType,
          versionId: source.versionId,
          languageCode: source.languageCode,
          contentText: source.contentText,
          contentJson: source.contentJson,
        });
      }
      lineage.push(
        { sourceVersionId: String(idea.versionId), dependencyType: 'GENERATED_FROM' },
        { sourceVersionId: String(research.versionId), dependencyType: 'USES_RESEARCH' },
      );
    }
    if (task === 'SCRIPT_WRITER_SHORT' || task === 'SCRIPT_WRITER_LONG') {
      const brief = await this.db
        .prepare(
          `SELECT a.workspace_id workspaceId,a.project_id projectId,a.id artifactId,a.version artifactRevision,v.id versionId,v.content_hash contentHash,v.language_code languageCode,v.content_text contentText,v.content_json contentJson,a.artifact_type artifactType,
             (SELECT ap.id FROM artifact_approvals ap WHERE ap.workspace_id=a.workspace_id AND ap.artifact_version_id=v.id AND ap.decision='APPROVED' ORDER BY ap.decided_at,ap.id LIMIT 1) approvalId
           FROM editorial_artifact_versions v
           JOIN editorial_artifacts a ON a.id=v.artifact_id AND a.current_version_id=v.id
           WHERE v.id=? AND v.workspace_id=? AND a.workspace_id=? AND a.project_id=?
             AND a.artifact_type='CONTENT_BRIEF' AND a.status='approved' AND a.deleted_at IS NULL
             AND EXISTS(SELECT 1 FROM artifact_approvals ap WHERE ap.workspace_id=a.workspace_id AND ap.artifact_version_id=v.id AND ap.decision='APPROVED')`,
        )
        .bind(inputVersionId, this.actor.workspaceId, this.actor.workspaceId, projectId)
        .first<ScriptSourceBriefSnapshot & Row>();
      if (!brief)
        throw new ProviderError(
          'PERMANENT',
          false,
          'The exact authoritative current approved Content Brief input is required.',
        );
      scriptSourceBrief = {
        workspaceId: brief.workspaceId,
        projectId: brief.projectId,
        artifactId: brief.artifactId,
        artifactRevision: Number(brief.artifactRevision),
        versionId: brief.versionId,
        contentHash: brief.contentHash,
        approvalId: brief.approvalId,
      };
      artifacts.results = artifacts.results.filter(
        (artifact) => artifact.artifactType !== 'CONTENT_BRIEF',
      );
      artifacts.results.push(brief);
      lineage.push({
        sourceVersionId: brief.versionId,
        dependencyType: 'GENERATED_FROM',
      });
    }
    if (task === 'SCRIPT_CRITIC') {
      if (!inputVersionId || project.format !== 'SHORT')
        throw new ProviderError(
          'PERMANENT',
          false,
          'Script Critique requires an exact approved current Short production script.',
        );
      const loadSource = async (versionId: string, artifactType: ArtifactType) => {
        const source = await this.db
          .prepare(
            `SELECT a.workspace_id workspaceId,a.project_id projectId,a.id artifactId,a.version artifactRevision,a.status artifactStatus,a.current_version_id currentVersionId,v.id versionId,v.version_number versionNumber,v.content_hash contentHash,v.language_code languageCode,v.source_type sourceType,v.content_text contentText,v.content_json contentJson,
             (SELECT COUNT(*) FROM artifact_approvals ap WHERE ap.workspace_id=a.workspace_id AND ap.artifact_version_id=v.id AND ap.decision='APPROVED') positiveApprovalCount,
             (SELECT MIN(ap.id) FROM artifact_approvals ap WHERE ap.workspace_id=a.workspace_id AND ap.artifact_version_id=v.id AND ap.decision='APPROVED') approvalId
             FROM editorial_artifact_versions v JOIN editorial_artifacts a ON a.id=v.artifact_id AND a.current_version_id=v.id
             WHERE v.id=? AND v.workspace_id=? AND a.workspace_id=? AND a.project_id=? AND a.artifact_type=? AND a.status='approved' AND a.deleted_at IS NULL`,
          )
          .bind(versionId, this.actor.workspaceId, this.actor.workspaceId, projectId, artifactType)
          .first<Row>();
        if (
          !source ||
          source.workspaceId !== this.actor.workspaceId ||
          source.projectId !== projectId ||
          source.artifactStatus !== 'approved' ||
          source.currentVersionId !== versionId ||
          Number(source.positiveApprovalCount) !== 1 ||
          typeof source.approvalId !== 'string' ||
          typeof source.contentHash !== 'string' ||
          typeof source.languageCode !== 'string' ||
          typeof source.sourceType !== 'string'
        )
          throw new ProviderError(
            'PERMANENT',
            false,
            `The exact authoritative current approved ${artifactType} Critique input is required.`,
          );
        return {
          artifactId: String(source.artifactId),
          artifactRevision: Number(source.artifactRevision),
          artifactStatus: 'approved' as const,
          currentVersionId: String(source.currentVersionId),
          versionId: String(source.versionId),
          versionNumber: Number(source.versionNumber),
          contentHash: String(source.contentHash),
          languageCode: String(source.languageCode),
          sourceType: String(source.sourceType),
          approvalId: String(source.approvalId),
          positiveApprovalCount: 1 as const,
          contentText: typeof source.contentText === 'string' ? source.contentText : null,
          contentJson: typeof source.contentJson === 'string' ? source.contentJson : null,
        } satisfies CritiqueArtifactSnapshot;
      };
      const scriptBase = await loadSource(inputVersionId, 'PRODUCTION_SCRIPT');
      if (
        scriptBase.sourceType !== 'HUMAN_EDITED' ||
        scriptBase.languageCode !== project.primaryLanguage
      )
        throw new ProviderError(
          'PERMANENT',
          false,
          'Script Critique requires the exact current approved human-edited production-language Script.',
        );
      const scriptSegments = (
        await this.db
          .prepare(
            `SELECT id,segment_order AS "order",content_hash AS contentHash,content_text AS text FROM script_segments WHERE workspace_id=? AND script_version_id=? ORDER BY segment_order`,
          )
          .bind(this.actor.workspaceId, inputVersionId)
          .all<CritiqueSourceSegment>()
      ).results;
      if (
        scriptSegments.length === 0 ||
        scriptSegments.some(
          (segment, index) =>
            segment.order !== index + 1 ||
            typeof segment.id !== 'string' ||
            typeof segment.contentHash !== 'string' ||
            typeof segment.text !== 'string' ||
            !segment.text.trim(),
        )
      )
        throw new ProviderError('PERMANENT', false, 'Critique source Script segments are invalid.');
      const briefLinks = (
        await this.db
          .prepare(
            `SELECT d.source_artifact_version_id versionId FROM artifact_dependencies d
             JOIN editorial_artifact_versions v ON v.id=d.source_artifact_version_id
             JOIN editorial_artifacts a ON a.id=v.artifact_id AND a.current_version_id=v.id
             WHERE d.workspace_id=? AND d.dependent_artifact_version_id=? AND d.dependency_type='GENERATED_FROM'
               AND d.validity_status='CURRENT' AND d.invalidated_at IS NULL AND d.invalidated_by_version_id IS NULL
               AND a.workspace_id=? AND a.project_id=? AND a.artifact_type='CONTENT_BRIEF' AND a.status='approved' AND a.deleted_at IS NULL`,
          )
          .bind(this.actor.workspaceId, inputVersionId, this.actor.workspaceId, projectId)
          .all<{ versionId: string }>()
      ).results;
      if (briefLinks.length !== 1)
        throw new ProviderError(
          'PERMANENT',
          false,
          'Critique requires one exact authoritative Brief.',
        );
      const brief = await loadSource(briefLinks[0]!.versionId, 'CONTENT_BRIEF');
      const researchLinks = (
        await this.db
          .prepare(
            `SELECT d.source_artifact_version_id versionId FROM artifact_dependencies d
             JOIN editorial_artifact_versions v ON v.id=d.source_artifact_version_id
             JOIN editorial_artifacts a ON a.id=v.artifact_id AND a.current_version_id=v.id
             WHERE d.workspace_id=? AND d.dependent_artifact_version_id=? AND d.dependency_type='USES_RESEARCH'
               AND d.validity_status='CURRENT' AND d.invalidated_at IS NULL AND d.invalidated_by_version_id IS NULL
               AND a.workspace_id=? AND a.project_id=? AND a.artifact_type='RESEARCH' AND a.status='approved' AND a.deleted_at IS NULL`,
          )
          .bind(this.actor.workspaceId, brief.versionId, this.actor.workspaceId, projectId)
          .all<{ versionId: string }>()
      ).results;
      if (researchLinks.length !== 1)
        throw new ProviderError(
          'PERMANENT',
          false,
          'Critique requires one exact authoritative Research.',
        );
      const research = await loadSource(researchLinks[0]!.versionId, 'RESEARCH');
      critiqueSource = {
        workspaceId: this.actor.workspaceId,
        projectId,
        script: { ...scriptBase, sourceType: 'HUMAN_EDITED', segments: scriptSegments },
        brief,
        research,
      };
      lineage.push({ sourceVersionId: inputVersionId, dependencyType: 'EVALUATES_SOURCE' });
    }
    if (task === 'STORYBOARD_PLANNER') {
      const script = await exactCurrentApproved(inputVersionId, 'PRODUCTION_SCRIPT');
      storyboardSourceSegments = (
        await this.db
          .prepare(
            'SELECT id,segment_order AS "order",content_text AS text FROM script_segments WHERE workspace_id=? AND script_version_id=? ORDER BY segment_order',
          )
          .bind(this.actor.workspaceId, script.versionId)
          .all<Row>()
      ).results;
      if (storyboardSourceSegments.length === 0)
        throw new ProviderError(
          'PERMANENT',
          false,
          'Storyboard requires persisted source segments.',
        );
      const critique = await this.db
        .prepare(
          `SELECT cv.id versionId FROM artifact_dependencies d JOIN editorial_artifact_versions cv ON cv.id=d.dependent_artifact_version_id JOIN editorial_artifacts ca ON ca.id=cv.artifact_id AND ca.current_version_id=cv.id WHERE d.source_artifact_version_id=? AND d.dependency_type='EVALUATES_SOURCE' AND d.validity_status='CURRENT' AND d.invalidated_at IS NULL AND d.invalidated_by_version_id IS NULL AND ca.workspace_id=? AND ca.project_id=? AND ca.artifact_type='SCRIPT_CRITIQUE' AND ca.status='approved' AND ca.deleted_at IS NULL`,
        )
        .bind(script.versionId, this.actor.workspaceId, projectId)
        .first<Row>();
      if (!critique)
        throw new ProviderError(
          'PERMANENT',
          false,
          'Storyboard requires the exact approved current Script Critique.',
        );
      lineage.push(
        { sourceVersionId: String(script.versionId), dependencyType: 'GENERATED_FROM' },
        { sourceVersionId: String(critique.versionId), dependencyType: 'INFORMED_BY' },
      );
    }
    let exactSource: Row | null = null;
    if (task === 'REVIEW_TRANSLATION_ES') {
      if (!inputVersionId)
        throw new ProviderError('PERMANENT', false, 'An exact source script version is required.');
      if (!projectProfile)
        throw new ProviderError(
          'PERMANENT',
          false,
          'The project is outside the approved bounded language profiles.',
        );
      exactSource = await this.db
        .prepare(
          `SELECT v.id AS versionId,v.version_number AS versionNumber,v.language_code AS languageCode,v.content_text AS contentText,v.content_json AS contentJson,v.content_hash AS contentHash,v.source_type AS sourceType,a.id AS artifactId,a.artifact_type AS artifactType,a.workspace_id AS workspaceId,a.project_id AS projectId,a.version AS artifactRevision,a.status AS artifactStatus,a.current_version_id AS currentVersionId,
          (SELECT COUNT(*) FROM artifact_approvals ap WHERE ap.workspace_id=a.workspace_id AND ap.artifact_version_id=v.id AND ap.decision='APPROVED') AS positiveApprovalCount,
          (SELECT MIN(ap.id) FROM artifact_approvals ap WHERE ap.workspace_id=a.workspace_id AND ap.artifact_version_id=v.id AND ap.decision='APPROVED') AS approvalId,
          COALESCE((SELECT json_group_array(json_object('id',ordered.id,'order',ordered.segmentOrder,'contentHash',ordered.contentHash,'text',ordered.contentText)) FROM (SELECT s.id,s.segment_order AS segmentOrder,s.content_hash AS contentHash,s.content_text AS contentText FROM script_segments s WHERE s.workspace_id=a.workspace_id AND s.script_version_id=v.id ORDER BY s.segment_order) ordered),'[]') AS segmentsJson
          FROM editorial_artifact_versions v JOIN editorial_artifacts a ON a.id=v.artifact_id AND a.current_version_id=v.id WHERE v.id=? AND v.workspace_id=? AND a.workspace_id=? AND a.project_id=? AND a.artifact_type='PRODUCTION_SCRIPT' AND v.language_code=? AND v.source_type='HUMAN_EDITED' AND a.status='approved' AND a.deleted_at IS NULL`,
        )
        .bind(
          inputVersionId,
          this.actor.workspaceId,
          this.actor.workspaceId,
          projectId,
          projectProfile.productionLanguage,
        )
        .first<Row>();
      if (!exactSource)
        throw new ProviderError(
          'PERMANENT',
          false,
          'The exact current approved human-edited production script is required.',
        );
      let sourceSegments: TranslationSourceSegment[];
      try {
        const parsed = JSON.parse(String(exactSource.segmentsJson)) as unknown;
        if (!Array.isArray(parsed)) throw new Error('segments_not_array');
        sourceSegments = parsed as TranslationSourceSegment[];
      } catch {
        throw new ProviderError(
          'PERMANENT',
          false,
          'The exact source segment snapshot is invalid.',
        );
      }
      if (
        exactSource.workspaceId !== this.actor.workspaceId ||
        exactSource.projectId !== projectId ||
        exactSource.artifactStatus !== 'approved' ||
        exactSource.currentVersionId !== inputVersionId ||
        exactSource.sourceType !== 'HUMAN_EDITED' ||
        Number(exactSource.positiveApprovalCount) !== 1 ||
        typeof exactSource.approvalId !== 'string' ||
        sourceSegments.length === 0 ||
        sourceSegments.some(
          (segment, index) =>
            typeof segment.id !== 'string' ||
            segment.order !== index + 1 ||
            typeof segment.contentHash !== 'string' ||
            typeof segment.text !== 'string' ||
            !segment.text.trim(),
        )
      )
        throw new ProviderError(
          'PERMANENT',
          false,
          'The exact approved Translation source snapshot is ineligible.',
        );
      exactSource = {
        ...exactSource,
        positiveApprovalCount: 1,
        segments: sourceSegments,
      };
    }
    return {
      ...project,
      reviewLocale: 'es',
      exactSource,
      storyboardSourceSegments,
      lineage,
      scriptSourceBrief,
      critiqueSource,
      approvedArtifacts: artifacts.results.map((item) => ({
        ...item,
        contentText: typeof item.contentText === 'string' ? item.contentText : null,
        contentJson: typeof item.contentJson === 'string' ? item.contentJson : null,
      })),
    } as unknown as Row & {
      operatingMode: string;
      primaryLanguage: string;
      reviewLocale: string;
      storyboardSourceSegments: Row[];
      approvedArtifacts: Row[];
    };
  }
  private scriptSourceBriefGuard(snapshot: ScriptSourceBriefSnapshot) {
    return this.db
      .prepare(
        `SELECT CASE WHEN EXISTS(
          SELECT 1 FROM editorial_artifacts a
          JOIN editorial_artifact_versions v ON v.id=? AND v.artifact_id=a.id AND v.workspace_id=a.workspace_id
          JOIN artifact_approvals ap ON ap.id=? AND ap.workspace_id=a.workspace_id AND ap.artifact_version_id=v.id AND ap.decision='APPROVED'
          WHERE a.id=? AND a.workspace_id=? AND a.project_id=? AND a.artifact_type='CONTENT_BRIEF'
            AND a.current_version_id=v.id AND a.version=? AND a.status='approved' AND a.deleted_at IS NULL
            AND v.content_hash=?
        ) THEN 1 ELSE json('script_source_authorization_changed') END`,
      )
      .bind(
        snapshot.versionId,
        snapshot.approvalId,
        snapshot.artifactId,
        snapshot.workspaceId,
        snapshot.projectId,
        snapshot.artifactRevision,
        snapshot.contentHash,
      );
  }
  private commandHash(row: Row) {
    if (typeof row.safeMetadataJson !== 'string') return null;
    try {
      return (JSON.parse(row.safeMetadataJson) as Row).commandHash;
    } catch {
      return null;
    }
  }
  private existingRun(idempotencyKey: string) {
    return this.db
      .prepare(
        `SELECT id,status,output_artifact_version_id AS outputArtifactVersionId,safe_metadata_json AS safeMetadataJson FROM intelligence_runs WHERE workspace_id=? AND idempotency_key=?`,
      )
      .bind(this.actor.workspaceId, idempotencyKey)
      .first<Row>();
  }
  private isProfileProjectEligible(project: Row, task: Task, profile: BoundedExecutionProfile) {
    if (!isBoundedProfileStep(task)) return false;
    const brief = (project.approvedArtifacts as Row[]).find(
      (item) => item.artifactType === 'CONTENT_BRIEF',
    );
    let briefProductionLanguage: unknown;
    let briefReviewLanguage: unknown;
    if (brief && typeof brief.contentJson === 'string')
      try {
        const content = JSON.parse(brief.contentJson) as Row;
        if (content.format === 'SHORT') {
          briefProductionLanguage = content.productionLanguage;
          briefReviewLanguage = content.reviewLanguage;
        }
      } catch {
        // Invalid persisted JSON is ineligible and fails closed below.
      }
    return isProjectEligibleForBoundedProfile(
      profile,
      {
        format: project.format,
        operatingMode: project.operatingMode,
        primaryLanguage: project.primaryLanguage,
        reviewLanguage: project.reviewLocale,
        briefProductionLanguage,
        briefReviewLanguage,
        hasApprovedBrief: brief !== undefined,
        hasExactSource: project.exactSource !== null,
      },
      task,
    );
  }
  private observer(
    runId: string,
    onProviderSucceeded: (result: ProviderExecutionResult) => Promise<void> = () =>
      Promise.resolve(),
    authorizeDispatch?: () => Promise<void>,
  ) {
    return {
      started: async (attempt: number) => {
        if (authorizeDispatch) {
          await authorizeDispatch();
          return;
        }
        const at = now();
        await this.db.batch([
          this.db
            .prepare(
              `UPDATE editorial_execution_reservations SET status='DISPATCHED',dispatched_at=? WHERE intelligence_run_id=? AND status='RESERVED'`,
            )
            .bind(at, runId),
          this.db
            .prepare(
              `UPDATE intelligence_runs SET status='RUNNING',started_at=COALESCE(started_at,?),updated_at=?,version=version+1 WHERE id=?`,
            )
            .bind(at, at, runId),
          this.db
            .prepare(
              `INSERT INTO intelligence_run_attempts(id,intelligence_run_id,attempt_number,attempt_kind,status,safe_metadata_json,started_at) VALUES(?,?,?,'TECHNICAL','RUNNING','{}',?)`,
            )
            .bind(newId('attempt'), runId, attempt, at),
        ]);
      },
      succeeded: (attempt: number, result: ProviderExecutionResult) => {
        void attempt;
        return onProviderSucceeded(result);
      },
      failed: (attempt: number, error: ProviderError) => {
        void attempt;
        void error;
        return Promise.resolve();
      },
    };
  }
  private async terminalSchemaReady() {
    try {
      const row = await this.db
        .prepare(
          `SELECT COUNT(*) AS count FROM pragma_table_info('intelligence_runs') WHERE name='terminal_audit_event_id'`,
        )
        .first<{ count: number }>();
      return Number(row?.count) === 1;
    } catch {
      return false;
    }
  }
  private terminalAuditStatement(
    auditId: string,
    runId: string,
    action: 'intelligence.run_completed' | 'intelligence.run_failed',
    outcome: 'success' | 'failure',
    at: string,
    metadata: Row = {},
  ) {
    return this.db
      .prepare(
        `INSERT INTO audit_events(id,workspace_id,actor_type,actor_id,actor_role,access_issuer,access_subject,action,resource_type,resource_id,outcome,request_id,environment,metadata_json,occurred_at,ingested_at) VALUES(?,?,'user',?,?,?,?,?,'intelligence_run',?,?,?,?, ?,?,?)`,
      )
      .bind(
        auditId,
        this.actor.workspaceId,
        this.actor.id,
        this.actor.roles[0] ?? null,
        this.config.accessIssuer ?? null,
        this.config.accessSubject ?? null,
        action,
        runId,
        outcome,
        this.config.requestId ?? runId,
        this.config.environment ?? 'runtime',
        JSON.stringify(metadata),
        at,
        at,
      );
  }
  private cost(result: ProviderExecutionResult, row: Row) {
    const input = result.usage.inputUnits,
      output = result.usage.outputUnits,
      cached = result.usage.cachedInputUnits ?? 0;
    const inputPrice = typeof row.inputPrice === 'number' ? row.inputPrice : null,
      outputPrice = typeof row.outputPrice === 'number' ? row.outputPrice : null;
    const cfg = parseCapabilities(row.capabilitiesJson);
    const cachedPrice =
      typeof cfg.cachedInputUnitPriceUsd === 'number' ? cfg.cachedInputUnitPriceUsd : null;
    const actualMicrousd = calculateUsageMicrousd(
      input,
      output,
      inputPrice,
      outputPrice,
      cached,
      cachedPrice,
      result.usage.reasoningOutputUnits ?? 0,
    );
    return {
      actualMicrousd,
      actualCost: actualMicrousd === null ? null : actualMicrousd / 1_000_000,
      currency: typeof row.currency === 'string' ? row.currency : null,
    };
  }

  private async persist(
    projectId: string,
    task: Task,
    runId: string,
    inputVersionId: string | null,
    language: string,
    outputSchemaVersion: string,
    lineage: LineageEdge[],
    output: unknown,
    completion: {
      result: ProviderExecutionResult;
      costs: { actualCost: number | null; actualMicrousd: number | null; currency: string | null };
      metadata: Row;
      governed: boolean;
      productionScriptRetryAuthorizationId?: string | undefined;
      briefCapacityId?: string | undefined;
      scriptSourceBrief: ScriptSourceBriefSnapshot | null;
      translationSource: TranslationSourceSnapshot | null;
      critiqueSource: CritiqueSourceSnapshot | null;
      reservedMicrousd: number | null;
    },
  ) {
    const at = now();
    const statements: D1PreparedStatement[] = [];
    if (task === 'SCRIPT_CRITIC') {
      if (!completion.critiqueSource)
        throw new ProviderError(
          'PERMANENT',
          false,
          'The exact Critique source snapshot is required for persistence.',
        );
      statements.push(critiqueSourceGuardStatement(this.db, completion.critiqueSource));
    }
    if (task === 'REVIEW_TRANSLATION_ES') {
      if (!completion.translationSource)
        throw new ProviderError(
          'PERMANENT',
          false,
          'The exact Translation source snapshot is required for persistence.',
        );
      statements.push(translationSourceGuardStatement(this.db, completion.translationSource));
    }
    if (completion.briefCapacityId)
      statements.push(
        await contentBriefPublicationGuard(this.db, completion.briefCapacityId, runId),
      );
    const createArtifact = async (
      type: ArtifactType,
      value: unknown,
      contentText: string | null,
      outputLanguage: string,
      sourceScriptVersionId: string | null,
    ) => {
      const existing =
        type === 'IDEA_CANDIDATE'
          ? null
          : await this.db
              .prepare(
                `SELECT a.id AS artifactId,a.current_version_id AS currentVersionId,a.version AS artifactRevision,v.version_number AS versionNumber FROM editorial_artifacts a LEFT JOIN editorial_artifact_versions v ON v.id=a.current_version_id WHERE a.workspace_id=? AND a.project_id=? AND a.artifact_type=? AND a.deleted_at IS NULL LIMIT 1`,
              )
              .bind(this.actor.workspaceId, projectId, type)
              .first<{
                artifactId: string;
                currentVersionId: string | null;
                artifactRevision: number;
                versionNumber: number | null;
              }>();
      const artifactId = existing?.artifactId ?? newId('artifact');
      const versionId = newId('artifact_version');
      const versionNumber = Number(existing?.versionNumber ?? 0) + 1;
      const parentVersionId = existing?.currentVersionId ?? null;
      const expectedArtifactRevision = Number(existing?.artifactRevision ?? 1);
      const content = JSON.stringify(value);
      const contentHash = await digest(value);
      if (!existing)
        statements.push(
          this.db
            .prepare(
              `INSERT INTO editorial_artifacts(id,workspace_id,project_id,artifact_type,status,current_version_id,created_at,updated_at,version,created_by,updated_by) VALUES(?,?,?,?,'active',NULL,?,?,1,?,?)`,
            )
            .bind(
              artifactId,
              this.actor.workspaceId,
              projectId,
              type,
              at,
              at,
              this.actor.id,
              this.actor.id,
            ),
        );
      const invalidations: Array<{
        id: string;
        sourceVersionId: string;
        dependentVersionId: string;
        dependentArtifactId: string;
        dependentArtifactRevision: number;
        dependencyType: string;
        artifactType: ArtifactType;
        version: number;
        expectedValidity: string;
      }> = [];
      const setBasedInvalidation =
        Boolean(existing?.currentVersionId) && type !== 'PRODUCTION_SCRIPT';
      if (existing?.currentVersionId && type === 'PRODUCTION_SCRIPT') {
        const dependents = await this.db
          .prepare(
            `SELECT d.id,d.source_artifact_version_id sourceVersionId,d.dependent_artifact_version_id dependentVersionId,d.dependency_type dependencyType,d.version,d.invalidated_at invalidatedAt,d.invalidated_by_version_id invalidatedByVersionId,a.id dependentArtifactId,a.workspace_id dependentWorkspaceId,a.project_id dependentProjectId,a.current_version_id dependentCurrentVersionId,a.version dependentArtifactRevision,a.deleted_at dependentDeletedAt,a.artifact_type artifactType FROM artifact_dependencies d JOIN editorial_artifact_versions v ON v.id=d.dependent_artifact_version_id JOIN editorial_artifacts a ON a.id=v.artifact_id WHERE d.source_artifact_version_id=? AND d.workspace_id=? AND d.validity_status='CURRENT'`,
          )
          .bind(existing.currentVersionId, this.actor.workspaceId)
          .all<{
            id: string;
            sourceVersionId: string;
            dependentVersionId: string;
            dependentArtifactId: string;
            dependentWorkspaceId: string;
            dependentProjectId: string;
            dependentCurrentVersionId: string | null;
            dependentArtifactRevision: number;
            dependentDeletedAt: string | null;
            dependencyType: string;
            artifactType: ArtifactType;
            version: number;
            invalidatedAt: string | null;
            invalidatedByVersionId: string | null;
          }>();
        const plan = terminalInvalidationPlan(type);
        const seenTypes = new Set<ArtifactType>();
        for (const dependent of dependents.results) {
          const effect = plan.effects.find(
            (candidate) => candidate.artifactType === dependent.artifactType,
          );
          const expectedDependencyType =
            dependent.artifactType === 'REVIEW_TRANSLATION'
              ? terminalStageSourceContracts.REVIEW_TRANSLATION[0].dependencyType
              : dependent.artifactType === 'SCRIPT_CRITIQUE'
                ? terminalStageSourceContracts.SCRIPT_CRITIQUE[0].dependencyType
                : dependent.artifactType === 'STORYBOARD'
                  ? terminalStageSourceContracts.STORYBOARD[0].dependencyType
                  : dependent.artifactType === 'PREFLIGHT'
                    ? terminalStageSourceContracts.PREFLIGHT.find(
                        (contract) => contract.artifactType === 'PRODUCTION_SCRIPT',
                      )?.dependencyType
                    : undefined;
          if (
            !effect ||
            !expectedDependencyType ||
            seenTypes.has(dependent.artifactType) ||
            dependent.sourceVersionId !== existing.currentVersionId ||
            dependent.dependentWorkspaceId !== this.actor.workspaceId ||
            dependent.dependentProjectId !== projectId ||
            dependent.dependentCurrentVersionId !== dependent.dependentVersionId ||
            dependent.dependentDeletedAt !== null ||
            dependent.dependencyType !== expectedDependencyType ||
            dependent.invalidatedAt !== null ||
            dependent.invalidatedByVersionId !== null ||
            invalidationFor(dependent.artifactType) !== effect.validity
          )
            throw new ProviderError(
              'PERMANENT',
              false,
              'Current downstream dependency set is incompatible with the terminal invalidation plan.',
            );
          seenTypes.add(dependent.artifactType);
          invalidations.push({ ...dependent, expectedValidity: effect.validity });
        }
      }
      if (
        type === 'PRODUCTION_SCRIPT' &&
        (!completion.scriptSourceBrief ||
          lineage.length !== 1 ||
          inputVersionId === null ||
          inputVersionId !== completion.scriptSourceBrief.versionId ||
          lineage[0]?.sourceVersionId !== completion.scriptSourceBrief.versionId ||
          lineage[0]?.dependencyType !==
            terminalStageSourceContracts.PRODUCTION_SCRIPT[0].dependencyType)
      )
        throw new ProviderError(
          'PERMANENT',
          false,
          'Production Script lineage is incompatible with the terminal source contract.',
        );
      // Insert the version before lineage or invalidations can reference its ID.
      statements.push(
        this.db
          .prepare(
            `INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,parent_version_id,language_code,content_text,content_json,source_type,intelligence_run_id,content_hash,word_count,source_script_version_id,created_at,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .bind(
            versionId,
            this.actor.workspaceId,
            artifactId,
            versionNumber,
            parentVersionId,
            outputLanguage,
            contentText,
            content,
            'AI_GENERATED',
            runId,
            contentHash,
            contentText ? contentText.trim().split(/\s+/u).filter(Boolean).length : null,
            sourceScriptVersionId,
            at,
            this.actor.id,
          ),
      );
      for (const edge of lineage)
        statements.push(
          this.db
            .prepare(
              `INSERT INTO artifact_dependencies(id,workspace_id,source_artifact_version_id,dependent_artifact_version_id,dependency_type,validity_status,created_at,updated_at,version) VALUES(?,?,?,?,?,'CURRENT',?,?,1)`,
            )
            .bind(
              newId('dependency'),
              this.actor.workspaceId,
              edge.sourceVersionId,
              versionId,
              edge.dependencyType,
              at,
              at,
            ),
        );
      if (setBasedInvalidation)
        statements.push(
          this.db
            .prepare(
              `UPDATE artifact_dependencies SET
                validity_status=CASE COALESCE((
                  SELECT a.artifact_type FROM editorial_artifact_versions v
                  JOIN editorial_artifacts a ON a.id=v.artifact_id
                  WHERE v.id=artifact_dependencies.dependent_artifact_version_id
                ),'')
                  WHEN 'REVIEW_TRANSLATION' THEN 'REGENERATION_REQUIRED'
                  WHEN 'SCRIPT_CRITIQUE' THEN 'REGENERATION_REQUIRED'
                  WHEN 'STORYBOARD' THEN 'REAPPROVAL_REQUIRED'
                  WHEN 'PREFLIGHT' THEN 'REAPPROVAL_REQUIRED'
                  ELSE 'STALE' END,
                invalidated_at=?,invalidated_by_version_id=?,updated_at=?,version=version+1
              WHERE workspace_id=? AND source_artifact_version_id=?
                AND validity_status='CURRENT' AND invalidated_at IS NULL
                AND invalidated_by_version_id IS NULL`,
            )
            .bind(at, versionId, at, this.actor.workspaceId, parentVersionId),
          this.db
            .prepare(
              `UPDATE preflight_assessments SET generation_readiness='NOT_READY'
               WHERE workspace_id=? AND artifact_version_id IN (
                 SELECT d.dependent_artifact_version_id FROM artifact_dependencies d
                 JOIN editorial_artifact_versions v ON v.id=d.dependent_artifact_version_id
                 JOIN editorial_artifacts a ON a.id=v.artifact_id
                 WHERE d.workspace_id=? AND d.source_artifact_version_id=?
                   AND d.invalidated_by_version_id=? AND d.invalidated_at=?
                   AND a.artifact_type='PREFLIGHT'
               )`,
            )
            .bind(this.actor.workspaceId, this.actor.workspaceId, parentVersionId, versionId, at),
          this.db
            .prepare(
              `UPDATE editorial_artifacts SET id=CASE WHEN
                NOT EXISTS(SELECT 1 FROM artifact_dependencies d
                  WHERE d.workspace_id=? AND d.source_artifact_version_id=?
                    AND d.validity_status='CURRENT')
                AND NOT EXISTS(
                  SELECT 1 FROM artifact_dependencies d
                  JOIN editorial_artifact_versions v ON v.id=d.dependent_artifact_version_id
                  JOIN editorial_artifacts a ON a.id=v.artifact_id
                  JOIN preflight_assessments p ON p.artifact_version_id=d.dependent_artifact_version_id
                  WHERE d.workspace_id=? AND d.source_artifact_version_id=?
                    AND d.invalidated_by_version_id=? AND d.invalidated_at=?
                    AND a.artifact_type='PREFLIGHT' AND p.generation_readiness!='NOT_READY'
                ) THEN id ELSE NULL END WHERE id=? AND workspace_id=?`,
            )
            .bind(
              this.actor.workspaceId,
              parentVersionId,
              this.actor.workspaceId,
              parentVersionId,
              versionId,
              at,
              artifactId,
              this.actor.workspaceId,
            ),
        );
      for (const dependent of invalidations) {
        statements.push(
          this.db
            .prepare(
              `UPDATE artifact_dependencies SET validity_status=?,invalidated_at=?,invalidated_by_version_id=?,updated_at=?,version=version+1 WHERE id=? AND workspace_id=? AND source_artifact_version_id=? AND dependent_artifact_version_id=? AND dependency_type=? AND validity_status='CURRENT' AND invalidated_at IS NULL AND invalidated_by_version_id IS NULL AND version=?`,
            )
            .bind(
              dependent.expectedValidity,
              at,
              versionId,
              at,
              dependent.id,
              this.actor.workspaceId,
              parentVersionId,
              dependent.dependentVersionId,
              dependent.dependencyType,
              dependent.version,
            ),
        );
        if (dependent.artifactType === 'PREFLIGHT')
          statements.push(
            this.db
              .prepare(
                `UPDATE preflight_assessments SET generation_readiness='NOT_READY' WHERE artifact_version_id=? AND workspace_id=?`,
              )
              .bind(dependent.dependentVersionId, this.actor.workspaceId),
          );
      }
      statements.push(
        this.db
          .prepare(
            `UPDATE editorial_artifacts SET current_version_id=?,status='active',updated_at=?,updated_by=?,version=version+1 WHERE id=? AND workspace_id=? AND current_version_id IS ? AND version=?`,
          )
          .bind(
            versionId,
            at,
            this.actor.id,
            artifactId,
            this.actor.workspaceId,
            parentVersionId,
            expectedArtifactRevision,
          ),
      );
      if (type === 'PRODUCTION_SCRIPT')
        statements.push(
          ...lineage.map((edge) =>
            this.db
              .prepare(
                `UPDATE editorial_artifacts SET id=CASE WHEN
                  (SELECT COUNT(*) FROM artifact_dependencies d WHERE d.workspace_id=? AND d.dependent_artifact_version_id=?)=1
                  AND EXISTS(SELECT 1 FROM artifact_dependencies d WHERE d.workspace_id=? AND d.source_artifact_version_id=? AND d.dependent_artifact_version_id=? AND d.dependency_type=? AND d.validity_status='CURRENT' AND d.invalidated_at IS NULL AND d.invalidated_by_version_id IS NULL)
                  THEN id ELSE NULL END WHERE id=? AND workspace_id=?`,
              )
              .bind(
                this.actor.workspaceId,
                versionId,
                this.actor.workspaceId,
                edge.sourceVersionId,
                versionId,
                edge.dependencyType,
                artifactId,
                this.actor.workspaceId,
              ),
          ),
          ...invalidations.map((dependent) =>
            this.db
              .prepare(
                `UPDATE editorial_artifacts SET id=CASE WHEN EXISTS(
                  SELECT 1 FROM artifact_dependencies d
                  JOIN editorial_artifact_versions dv ON dv.id=d.dependent_artifact_version_id
                  JOIN editorial_artifacts da ON da.id=dv.artifact_id
                  WHERE d.id=? AND d.workspace_id=? AND d.source_artifact_version_id=? AND d.dependent_artifact_version_id=? AND d.dependency_type=? AND d.validity_status=? AND d.invalidated_at=? AND d.invalidated_by_version_id=? AND d.version=?
                    AND dv.artifact_id=? AND da.workspace_id=? AND da.project_id=? AND da.artifact_type=? AND da.current_version_id=? AND da.deleted_at IS NULL AND da.version=?
                ) THEN id ELSE NULL END WHERE id=? AND workspace_id=?`,
              )
              .bind(
                dependent.id,
                this.actor.workspaceId,
                dependent.sourceVersionId,
                dependent.dependentVersionId,
                dependent.dependencyType,
                dependent.expectedValidity,
                at,
                versionId,
                dependent.version + 1,
                dependent.dependentArtifactId,
                this.actor.workspaceId,
                projectId,
                dependent.artifactType,
                dependent.dependentVersionId,
                dependent.dependentArtifactRevision,
                artifactId,
                this.actor.workspaceId,
              ),
          ),
          this.db
            .prepare(
              `UPDATE editorial_artifacts SET id=CASE WHEN current_version_id=? AND version=?
                AND EXISTS(SELECT 1 FROM editorial_artifact_versions v WHERE v.id=? AND v.artifact_id=editorial_artifacts.id AND v.parent_version_id IS ? AND v.version_number=?)
                AND (SELECT COUNT(*) FROM artifact_dependencies d WHERE d.workspace_id=? AND d.source_artifact_version_id=? AND d.invalidated_by_version_id=? AND d.invalidated_at=?)=?
                AND NOT EXISTS(SELECT 1 FROM artifact_dependencies d WHERE d.workspace_id=? AND d.source_artifact_version_id=? AND d.validity_status='CURRENT')
                THEN id ELSE NULL END WHERE id=? AND workspace_id=?`,
            )
            .bind(
              versionId,
              expectedArtifactRevision + 1,
              versionId,
              parentVersionId,
              versionNumber,
              this.actor.workspaceId,
              parentVersionId,
              versionId,
              at,
              invalidations.length,
              this.actor.workspaceId,
              parentVersionId,
              artifactId,
              this.actor.workspaceId,
            ),
          this.scriptSourceBriefGuard(completion.scriptSourceBrief!),
        );
      return { artifactId, versionId };
    };
    let outputVersionId: string;
    if (task === 'IDEA_GENERATION') {
      const items = (
        output as {
          items: Array<{
            title: string;
            angle: string;
            hook: string;
            rationale: string;
            audience: string[];
            targetFormat: string;
            risks: string[];
            confidence: number | null;
          }>;
        }
      ).items;
      let first: string | undefined;
      for (const [index, item] of items.entries()) {
        const created = await createArtifact('IDEA_CANDIDATE', item, null, language, null);
        first ??= created.versionId;
        statements.push(
          this.db
            .prepare(
              `INSERT INTO idea_candidates(id,workspace_id,project_id,artifact_id,artifact_version_id,title,angle,hook,rationale,audience_json,target_format,target_platforms_json,complexity,monetization_compatibility,risks_json,status,recommendation_rank,confidence,evidence_class,created_at,updated_at,version,created_by,updated_by) VALUES(?,?,?,?,?,?,?,?,?,? ,?,'[]','UNKNOWN','UNKNOWN',?,'CANDIDATE',?,?,'HEURISTIC',?,?,1,?,?)`,
            )
            .bind(
              newId('idea'),
              this.actor.workspaceId,
              projectId,
              created.artifactId,
              created.versionId,
              item.title,
              item.angle,
              item.hook,
              item.rationale,
              JSON.stringify(item.audience),
              item.targetFormat,
              JSON.stringify(item.risks),
              index + 1,
              item.confidence,
              at,
              at,
              this.actor.id,
              this.actor.id,
            ),
        );
      }
      outputVersionId = first!;
    } else {
      const contentText =
        task === 'SCRIPT_WRITER_SHORT' || task === 'SCRIPT_WRITER_LONG'
          ? (output as { segments: { text: string }[] }).segments
              .map((segment) => segment.text)
              .join('\n\n')
          : task === 'REVIEW_TRANSLATION_ES'
            ? (output as z.infer<typeof reviewTranslationOutputSchema>).segments
                .map((segment) => segment.text)
                .join('\n\n')
            : null;
      const sourceScriptVersionId =
        task === 'REVIEW_TRANSLATION_ES'
          ? (output as { sourceScriptVersionId: string }).sourceScriptVersionId
          : null;
      const created = await createArtifact(
        artifactType[task],
        output,
        contentText,
        task === 'REVIEW_TRANSLATION_ES' ? 'es' : language,
        sourceScriptVersionId,
      );
      outputVersionId = created.versionId;
      if (task === 'TOPIC_RESEARCH')
        for (const claim of (
          output as {
            claims: { claim: string; evidenceClass: string; confidence: number | null }[];
          }
        ).claims)
          statements.push(
            this.db
              .prepare(
                `INSERT INTO research_claims(id,workspace_id,research_version_id,source_id,claim_text,evidence_class,confidence,created_at,created_by) VALUES(?,?,?,NULL,?,?,?,?,?)`,
              )
              .bind(
                newId('claim'),
                this.actor.workspaceId,
                outputVersionId,
                claim.claim,
                claim.evidenceClass,
                claim.confidence,
                at,
                this.actor.id,
              ),
          );
      if (task === 'SCRIPT_WRITER_SHORT' || task === 'SCRIPT_WRITER_LONG')
        for (const segment of (output as { segments: { order: number; text: string }[] }).segments)
          statements.push(
            this.db
              .prepare(
                `INSERT INTO script_segments(id,workspace_id,script_version_id,segment_order,content_text,content_hash,word_count,created_at) VALUES(?,?,?,?,?,?,?,?)`,
              )
              .bind(
                newId('segment'),
                this.actor.workspaceId,
                outputVersionId,
                segment.order,
                segment.text,
                await digest(segment.text),
                segment.text.trim().split(/\s+/u).filter(Boolean).length,
                at,
              ),
          );
      if (task === 'STORYBOARD_PLANNER') {
        const scenes = (output as { scenes: Row[] }).scenes;
        const v2 = outputSchemaVersion === 'storyboard-output-v2';
        for (const scene of scenes) {
          const sceneId = newId('scene');
          if (v2) {
            const segmentIds = scene.scriptSegmentIds as string[];
            const placeholders = segmentIds.map(() => '?').join(',');
            const valid = (
              await this.db
                .prepare(
                  `SELECT id FROM script_segments WHERE workspace_id=? AND script_version_id=? AND id IN (${placeholders})`,
                )
                .bind(this.actor.workspaceId, inputVersionId, ...segmentIds)
                .all<{ id: string }>()
            ).results;
            if (valid.length !== segmentIds.length)
              throw new ProviderError(
                'SCHEMA_VALIDATION',
                false,
                'Storyboard segment linkage is invalid.',
              );
            statements.push(
              this.db
                .prepare(
                  `INSERT INTO storyboard_scenes(id,workspace_id,storyboard_version_id,scene_order,target_duration_seconds,visual_description,location,action,camera_framing,mood,continuity_notes,generation_instructions,recommended_media_type,asset_requirements_json,transition_notes,character_version_refs_json,created_at,camera_movement,aspect_ratio,safe_area_guidance_json,on_screen_text_json,captions_json,factual_claims_json,media_references_json,audio_guidance_json,continuity_key,continuity_reference_keys_json,contract_version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
                )
                .bind(
                  sceneId,
                  this.actor.workspaceId,
                  outputVersionId,
                  scene.order,
                  scene.targetDurationSeconds,
                  scene.visualDescription,
                  scene.location,
                  scene.action,
                  scene.cameraFraming,
                  scene.mood,
                  scene.continuityNotes,
                  scene.generationInstructions,
                  scene.recommendedMediaType,
                  JSON.stringify(scene.assetRequirements),
                  scene.transitionNotes,
                  JSON.stringify(scene.characterVersionIds),
                  at,
                  scene.cameraMovement,
                  scene.aspectRatio,
                  JSON.stringify(scene.safeAreaGuidance),
                  JSON.stringify(scene.onScreenText),
                  JSON.stringify(scene.captions),
                  JSON.stringify(scene.factualClaims),
                  JSON.stringify(scene.mediaReferences),
                  JSON.stringify(scene.audioGuidance),
                  scene.continuityKey,
                  JSON.stringify(scene.continuityReferenceKeys),
                  'storyboard-output-v2',
                ),
              ...segmentIds.map((segmentId, index) =>
                this.db
                  .prepare(
                    `INSERT INTO scene_script_segments(workspace_id,storyboard_scene_id,script_segment_id,segment_order,created_at) VALUES(?,?,?,?,?)`,
                  )
                  .bind(this.actor.workspaceId, sceneId, segmentId, index + 1, at),
              ),
            );
          } else {
            statements.push(
              this.db
                .prepare(
                  `INSERT INTO storyboard_scenes(id,workspace_id,storyboard_version_id,scene_order,target_duration_seconds,visual_description,location,action,camera_framing,mood,continuity_notes,generation_instructions,recommended_media_type,asset_requirements_json,transition_notes,character_version_refs_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
                )
                .bind(
                  sceneId,
                  this.actor.workspaceId,
                  outputVersionId,
                  scene.order,
                  scene.targetDurationSeconds,
                  scene.visualDescription,
                  scene.location,
                  scene.action,
                  scene.cameraFraming,
                  scene.mood,
                  scene.continuityNotes,
                  scene.generationInstructions,
                  scene.recommendedMediaType,
                  JSON.stringify(scene.assetRequirements),
                  scene.transitionNotes,
                  JSON.stringify(scene.characterVersionIds),
                  at,
                ),
            );
          }
        }
      }
      if (task === 'PREFLIGHT_ANALYSIS') {
        const assessmentId = newId('preflight');
        const value = output as {
          recommendation: string;
          checks: Array<{
            key: string;
            result: string;
            explanation: string;
            evidence: Row;
            ruleVersion: string | null;
          }>;
        };
        statements.push(
          this.db
            .prepare(
              `INSERT INTO preflight_assessments(id,workspace_id,project_id,artifact_id,artifact_version_id,overall_result,generation_readiness,rule_set_version,assessed_at,assessed_by) SELECT ?,?,?,artifact_id,?,?, 'NOT_READY','phase3-v1',?,? FROM editorial_artifact_versions WHERE id=?`,
            )
            .bind(
              assessmentId,
              this.actor.workspaceId,
              projectId,
              outputVersionId,
              value.recommendation,
              at,
              this.actor.id,
              outputVersionId,
            ),
        );
        for (const check of value.checks)
          statements.push(
            this.db
              .prepare(
                `INSERT INTO preflight_checks(id,preflight_assessment_id,check_key,result,explanation,evidence_json,rule_version,override_allowed,created_at) VALUES(?,?,?,?,?,?,?,0,?)`,
              )
              .bind(
                newId('check'),
                assessmentId,
                check.key,
                check.result,
                check.explanation,
                JSON.stringify(check.evidence),
                check.ruleVersion,
                at,
              ),
          );
      }
    }
    const auditId = newId('audit');
    statements.push(
      this.db
        .prepare(
          `UPDATE intelligence_run_attempts SET status='SUCCEEDED',provider_request_id=?,safe_metadata_json=?,completed_at=? WHERE intelligence_run_id=? AND status='RUNNING'`,
        )
        .bind(
          completion.result.providerRequestId,
          JSON.stringify(completion.result.safeMetadata),
          at,
          runId,
        ),
    );
    if (completion.governed) {
      const actualMicrousd = completion.costs.actualMicrousd;
      const reconciled =
        actualMicrousd !== null &&
        completion.reservedMicrousd !== null &&
        actualMicrousd <= completion.reservedMicrousd;
      statements.push(
        this.db
          .prepare(
            `UPDATE editorial_execution_reservations SET status=?,actual_microusd=?,reconciled_at=? WHERE intelligence_run_id=? AND status='DISPATCHED'`,
          )
          .bind(reconciled ? 'RECONCILED' : 'AMBIGUOUS', actualMicrousd, at, runId),
      );
    }
    statements.push(
      this.terminalAuditStatement(
        auditId,
        runId,
        'intelligence.run_completed',
        'success',
        at,
        completion.metadata,
      ),
      this.db
        .prepare(
          `UPDATE intelligence_runs SET output_artifact_version_id=?,status='SUCCEEDED',input_units=?,output_units=?,actual_cost=?,currency=?,safe_metadata_json=?,terminal_audit_event_id=?,completed_at=?,updated_at=?,version=version+1 WHERE id=? AND workspace_id=?`,
        )
        .bind(
          outputVersionId,
          completion.result.usage.inputUnits,
          completion.result.usage.outputUnits,
          completion.costs.actualCost,
          completion.costs.currency,
          JSON.stringify(completion.metadata),
          auditId,
          at,
          at,
          runId,
          this.actor.workspaceId,
        ),
    );
    await this.db.batch(statements);
    return outputVersionId;
  }
}
