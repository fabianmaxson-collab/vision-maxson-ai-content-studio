import { z } from 'zod';
import { languageCodeSchema } from './product';

const id = z.string().min(3).max(100);
const boundedText = z.string().max(262144);
const boundedObject = z
  .record(z.string().max(120), z.unknown())
  .refine((value) => JSON.stringify(value).length <= 262144, 'Artifact exceeds 256 KiB');
export const artifactTypeSchema = z.enum([
  'RESEARCH',
  'IDEA_CANDIDATE',
  'CONTENT_BRIEF',
  'PRODUCTION_SCRIPT',
  'REVIEW_TRANSLATION',
  'SCRIPT_CRITIQUE',
  'STORYBOARD',
  'PREFLIGHT',
]);
export const artifactSourceTypeSchema = z.enum([
  'AI_GENERATED',
  'HUMAN_EDITED',
  'IMPORTED',
  'DETERMINISTIC',
]);
export const createArtifactVersionSchema = z
  .object({
    artifactType: artifactTypeSchema,
    artifactId: id.optional(),
    parentVersionId: id.nullable().default(null),
    languageCode: languageCodeSchema,
    contentText: boundedText.nullable().default(null),
    content: boundedObject.nullable().default(null),
    sourceType: z.enum(['HUMAN_EDITED', 'IMPORTED']),
    sourceScriptVersionId: id.nullable().default(null),
    expectedArtifactVersion: z.number().int().positive().optional(),
  })
  .refine((value) => value.contentText !== null || value.content !== null, 'Content is required')
  .superRefine((value, context) => {
    if (value.artifactType === 'REVIEW_TRANSLATION' && !value.sourceScriptVersionId)
      context.addIssue({ code: 'custom', message: 'Review translation requires source script' });
  });
export const approvalSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  comment: z.string().trim().max(4000).nullable().default(null),
});
export const researchClaimSchema = z
  .object({
    claim: z.string().trim().min(1).max(16000),
    evidenceClass: z.enum(['OBSERVED', 'AI_INFERENCE', 'UNKNOWN']),
    sourceId: id.nullable().default(null),
    confidence: z.number().min(0).max(1).nullable().default(null),
  })
  .refine((value) => value.evidenceClass !== 'OBSERVED' || value.sourceId !== null, {
    message: 'Observed claims require a source',
  });
export const contentBriefSchema = z.object({
  topic: z.string().max(1000),
  objective: z.string().max(1000),
  audience: z.string().max(4000),
  primaryPlatformId: id,
  secondaryPlatformIds: z.array(id).max(20),
  productionLanguage: languageCodeSchema,
  reviewLanguage: languageCodeSchema.default('es'),
  format: z.enum(['SHORT', 'LONG_FORM']),
  targetDurationSeconds: z.number().positive().nullable(),
  narrativeAngle: z.string().max(4000),
  hook: z.string().max(4000),
  tone: z.string().max(1000),
  cta: z.string().max(2000),
  visualDirection: z.string().max(8000),
  characterVersionIds: z.array(id).max(50),
  voiceProfileId: id.nullable(),
  monetizationStrategy: z.string().max(8000),
  platformConstraints: z.array(z.string().max(2000)).max(50),
  editorialConstraints: z.array(z.string().max(2000)).max(50),
  researchVersionIds: z.array(id).max(50),
  userNotes: z.string().max(8000),
});
const critiqueIssue = z.object({
  dimension: z.string().max(100),
  issue: z.string().max(4000),
  severity: z.enum(['INFO', 'LOW', 'MEDIUM', 'HIGH', 'BLOCKING']),
  recommendation: z.string().max(4000),
  confidence: z.number().min(0).max(1).nullable(),
  evidenceType: z.enum(['HEURISTIC', 'RULE_BASED', 'SOURCE_BACKED']),
});
export const scriptCritiqueSchema = z.object({
  sourceScriptVersionId: id,
  strengths: z.array(z.string().max(4000)).max(50),
  issues: z.array(critiqueIssue).max(100),
  dimensionsEvaluated: z.array(z.string().max(100)).max(50),
});
export const storyboardSceneSchema = z.object({
  order: z.number().int().positive(),
  targetDurationSeconds: z.number().positive().nullable(),
  scriptSegmentIds: z.array(id).max(100),
  visualDescription: z.string().max(16000),
  location: z.string().max(2000),
  action: z.string().max(8000),
  cameraFraming: z.string().max(2000),
  mood: z.string().max(2000),
  continuityNotes: z.string().max(8000),
  generationInstructions: z.string().max(16000),
  recommendedMediaType: z.enum(['IMAGE', 'VIDEO', 'MIXED', 'UNKNOWN']),
  assetRequirements: z.array(z.string().max(1000)).max(100),
  transitionNotes: z.string().max(4000),
  characterVersionIds: z.array(id).max(50),
});
export const preflightCheckSchema = z.object({
  key: z.string().min(1).max(100),
  result: z.enum(['PASS', 'WARNING', 'BLOCKED', 'UNKNOWN']),
  explanation: z.string().max(4000),
  evidence: boundedObject,
  ruleVersion: z.string().max(100).nullable(),
});
export const intelligenceTaskSchema = z.enum([
  'TOPIC_RESEARCH',
  'IDEA_GENERATION',
  'CONTENT_BRIEF',
  'SCRIPT_WRITER_SHORT',
  'SCRIPT_WRITER_LONG',
  'SCRIPT_CRITIC',
  'REVIEW_TRANSLATION_ES',
  'STORYBOARD_PLANNER',
  'PREFLIGHT_ANALYSIS',
]);
export const researchOutputSchema = z
  .object({
    summary: z.string().min(1).max(32000),
    claims: z
      .array(
        z.object({
          claim: z.string().min(1).max(16000),
          evidenceClass: z.enum(['AI_INFERENCE', 'UNKNOWN']),
          confidence: z.number().min(0).max(1).nullable(),
        }),
      )
      .max(100),
  })
  .strict();
export const ideaGenerationOutputSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            title: z.string().min(1).max(1000),
            angle: z.string().max(4000),
            hook: z.string().max(4000),
            rationale: z.string().max(4000),
            audience: z.array(z.string().max(1000)).max(20),
            targetFormat: z.enum(['SHORT', 'LONG_FORM']),
            risks: z.array(z.string().max(2000)).max(30),
            confidence: z.number().min(0).max(1).nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(10),
  })
  .strict();
export const productionScriptOutputSchema = z
  .object({
    title: z.string().min(1).max(1000),
    languageCode: languageCodeSchema,
    segments: z
      .array(
        z
          .object({ order: z.number().int().positive(), text: z.string().min(1).max(32768) })
          .strict(),
      )
      .min(1)
      .max(500),
  })
  .strict();
export const reviewTranslationOutputSchema = z
  .object({
    sourceScriptVersionId: id,
    languageCode: z.literal('es'),
    faithfulTranslation: z.string().min(1).max(262144),
  })
  .strict();
export const storyboardOutputSchema = z
  .object({ scenes: z.array(storyboardSceneSchema).min(1).max(500) })
  .strict();
export const preflightAnalysisOutputSchema = z
  .object({
    checks: z.array(preflightCheckSchema).min(1).max(100),
    recommendation: z.enum(['PASS', 'WARNING', 'BLOCKED', 'UNKNOWN']),
  })
  .strict();
export const intelligenceCommandSchema = z
  .object({
    mode: z.enum(['AUTO', 'PREFER', 'LOCKED']).default('AUTO'),
    preferredProviderKey: z.string().min(1).max(100).optional(),
    preferredModelKey: z.string().min(1).max(200).optional(),
    inputArtifactVersionId: id.nullable().default(null),
    creativeRegeneration: z.boolean().default(false),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.mode === 'LOCKED' && (!value.preferredProviderKey || !value.preferredModelKey))
      context.addIssue({ code: 'custom', message: 'LOCKED requires provider and model' });
  });
export const terminalDependencyTypeSchema = z.enum([
  'GENERATED_FROM',
  'USES_RESEARCH',
  'EVALUATES_SOURCE',
  'INFORMED_BY',
  'VALIDATED_BY',
]);
export const terminalDependencyValiditySchema = z.enum([
  'CURRENT',
  'STALE',
  'INVALIDATED',
  'REGENERATION_REQUIRED',
  'REAPPROVAL_REQUIRED',
]);
export const terminalApprovalStatusSchema = z.enum(['APPROVED', 'REJECTED']).nullable();
export const terminalArtifactVersionSnapshotSchema = z
  .object({
    artifactType: artifactTypeSchema,
    artifactId: id,
    versionId: id,
    currentVersionId: id,
    workspaceId: id,
    projectId: id,
    projectFormat: z.enum(['SHORT', 'LONG_FORM']),
    productionLanguage: languageCodeSchema,
    reviewLanguage: languageCodeSchema,
    languageCode: languageCodeSchema,
    approval: terminalApprovalStatusSchema,
    selected: z.boolean(),
    invalidated: z.boolean(),
    authoritativeProduction: z.boolean(),
    reviewOnly: z.boolean(),
    sourceScriptVersionId: id.nullable(),
  })
  .strict();
export const terminalDependencySnapshotSchema = z
  .object({
    sourceVersionId: id,
    dependentVersionId: id,
    dependencyType: terminalDependencyTypeSchema,
    validity: terminalDependencyValiditySchema,
    invalidatedAt: z.string().datetime().nullable(),
    invalidatedByVersionId: id.nullable(),
  })
  .strict();
export const terminalPreflightCheckSnapshotSchema = z
  .object({
    key: z.string().min(1).max(100),
    result: z.enum(['PASS', 'WARNING', 'BLOCKED', 'UNKNOWN']),
    hardBlocker: z.boolean(),
  })
  .strict();
export const terminalPreflightSnapshotSchema = terminalArtifactVersionSnapshotSchema
  .extend({
    artifactType: z.literal('PREFLIGHT'),
    overallResult: z.enum(['PASS', 'WARNING', 'BLOCKED', 'UNKNOWN']),
    checks: z.array(terminalPreflightCheckSnapshotSchema).min(1).max(100),
    validatedVersionIds: z.array(id).min(1).max(20),
  })
  .strict();
export const terminalGraphSnapshotSchema = z
  .object({
    project: z
      .object({
        workspaceId: id,
        projectId: id,
        status: z.string().min(1).max(100),
        format: z.enum(['SHORT', 'LONG_FORM']),
        productionLanguage: languageCodeSchema,
        reviewLanguage: languageCodeSchema,
      })
      .strict(),
    research: terminalArtifactVersionSnapshotSchema,
    ideas: z.array(terminalArtifactVersionSnapshotSchema).min(1).max(10),
    brief: terminalArtifactVersionSnapshotSchema,
    script: terminalArtifactVersionSnapshotSchema,
    translation: terminalArtifactVersionSnapshotSchema.nullable(),
    critique: terminalArtifactVersionSnapshotSchema,
    storyboard: terminalArtifactVersionSnapshotSchema,
    preflight: terminalPreflightSnapshotSchema,
    dependencies: z.array(terminalDependencySnapshotSchema).max(100),
  })
  .strict();
export type TerminalGraphSnapshotContract = z.infer<typeof terminalGraphSnapshotSchema>;
