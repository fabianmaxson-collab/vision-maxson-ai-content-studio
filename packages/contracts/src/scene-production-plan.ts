import { z } from 'zod';
import { languageCodeSchema } from './product';

const id = z.string().min(3).max(100);

export const visualStrategySchema = z.enum([
  'GENERATIVE_VIDEO',
  'MOTION_GRAPHIC',
  'STATIC_FRAME',
  'HYBRID',
]);
export type VisualStrategy = z.infer<typeof visualStrategySchema>;

export const mediaTypeSchema = z.enum(['VIDEO', 'IMAGE', 'MIXED']);
export type MediaType = z.infer<typeof mediaTypeSchema>;

export const motionPacingSchema = z.enum(['SLOW', 'MEASURED', 'MODERATE', 'DYNAMIC', 'FAST']);
export type MotionPacing = z.infer<typeof motionPacingSchema>;

export const qualityTierSchema = z.enum(['DRAFT', 'PRODUCTION', 'MASTER']);
export type QualityTier = z.infer<typeof qualityTierSchema>;

export const productionApprovalStatusSchema = z.enum([
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
]);
export type ProductionApprovalStatus = z.infer<typeof productionApprovalStatusSchema>;

export const onScreenElementKindSchema = z.enum([
  'TITLE',
  'LABEL',
  'CALLOUT',
  'DIAGRAM',
  'LOWER_THIRD',
  'DISCLAIMER',
]);
export type OnScreenElementKind = z.infer<typeof onScreenElementKindSchema>;

export const onScreenElementPlacementSchema = z.enum([
  'TOP',
  'CENTER',
  'BOTTOM',
  'LOWER_THIRD',
  'CUSTOM',
]);
export type OnScreenElementPlacement = z.infer<typeof onScreenElementPlacementSchema>;

export const onScreenElementSchema = z
  .object({
    id: z.string().min(1).max(100),
    kind: onScreenElementKindSchema,
    text: z.string().min(1).max(500),
    languageCode: languageCodeSchema,
    startOffsetSeconds: z.number().nonnegative(),
    endOffsetSeconds: z.number().positive(),
    placement: onScreenElementPlacementSchema,
    renderEngine: z.literal('DETERMINISTIC_OVERLAY').default('DETERMINISTIC_OVERLAY'),
    notes: z.string().max(500).optional(),
  })
  .strict()
  .refine((v) => v.endOffsetSeconds > v.startOffsetSeconds, {
    message: 'endOffsetSeconds must be greater than startOffsetSeconds',
  });
export type OnScreenElement = z.infer<typeof onScreenElementSchema>;

export const sppCaptionsSchema = z
  .object({
    mode: z.enum(['REQUIRED', 'OPTIONAL', 'NONE']),
    languageCode: languageCodeSchema,
    sourceScriptSegmentIds: z.array(id).max(20),
    styleGuidance: z.string().max(500),
    safeAreaNotes: z.string().max(500),
    renderEngine: z.literal('DETERMINISTIC_OVERLAY').default('DETERMINISTIC_OVERLAY'),
  })
  .strict();
export type SppCaptions = z.infer<typeof sppCaptionsSchema>;

export const safeAreaGuidanceSchema = z
  .object({
    protectTop: z.boolean(),
    protectBottom: z.boolean(),
    protectSides: z.boolean(),
    notes: z.string().max(500),
  })
  .strict();
export type SafeAreaGuidance = z.infer<typeof safeAreaGuidanceSchema>;

export const audioRequirementsSchema = z
  .object({
    voiceoverRequired: z.boolean(),
    sourceScriptSegmentIds: z.array(id).max(20),
    ambience: z.string().max(500),
    soundEffects: z.array(z.string().max(300)).max(20),
    musicGuidance: z.string().max(500),
  })
  .strict();
export type AudioRequirements = z.infer<typeof audioRequirementsSchema>;

export const rightsRequirementsSchema = z.enum([
  'ORIGINAL_GENERATIVE',
  'APPROVED_ARCHIVE',
  'CREATIVE_COMMONS',
  'RESTRICTED',
]);
export type RightsRequirements = z.infer<typeof rightsRequirementsSchema>;

/**
 * Canonical Provider-Neutral Scene Production Plan.
 * Derived deterministically from an approved Storyboard scene.
 * Contains ZERO provider or model bindings.
 */
export const sceneProductionPlanSchema = z
  .object({
    id: id,
    projectId: id,
    sourceStoryboardVersionId: id,
    sceneOrder: z.number().int().positive(),
    scriptSegmentIds: z.array(id).min(1).max(20),
    targetDurationSeconds: z.number().positive(),
    aspectRatio: z.enum(['9:16', '16:9', '1:1', '4:5']),
    visualStrategy: visualStrategySchema,
    mediaType: mediaTypeSchema,
    visualDescription: z.string().min(1).max(2000),
    promptIntent: z.string().min(1).max(2000),
    negativeConstraints: z.array(z.string().max(300)).max(20).default([]),
    continuityKey: z.string().min(1).max(100).nullable().default(null),
    continuityReferenceKeys: z.array(z.string().min(1).max(100)).max(20).default([]),
    cameraFraming: z.string().max(300),
    cameraMovement: z.string().max(300),
    motionPacing: motionPacingSchema,
    lightingStyle: z.string().max(300),
    safeAreaGuidance: safeAreaGuidanceSchema,
    onScreenElements: z.array(onScreenElementSchema).max(20).default([]),
    captions: sppCaptionsSchema,
    audioRequirements: audioRequirementsSchema,
    factualRestrictions: z.array(z.string().max(500)).max(20).default([]),
    rightsRequirements: rightsRequirementsSchema,
    qualityTier: qualityTierSchema,
    costCeilingMicroUsd: z.number().int().positive(),
    approvalStatus: productionApprovalStatusSchema,
  })
  .strict();
export type SceneProductionPlan = z.infer<typeof sceneProductionPlanSchema>;

export const seedPolicySchema = z
  .object({
    mode: z.enum(['RANDOM', 'DETERMINISTIC', 'INCREMENT']),
    seedValue: z.number().int().nonnegative().optional(),
  })
  .strict();
export type SeedPolicy = z.infer<typeof seedPolicySchema>;

/**
 * Provider-Neutral Video Generation Intent.
 * Request to materialize one visual asset for an SPP scene.
 * Contains creative generation parameters, but NO provider/model binding.
 */
export const videoGenerationIntentSchema = z
  .object({
    id: id,
    projectId: id,
    sceneProductionPlanId: id,
    sceneId: z.string().min(1).max(100),
    takeNumber: z.number().int().min(1, 'takeNumber must be >= 1'),
    targetDurationSeconds: z.number().positive(),
    targetAspectRatio: z.enum(['9:16', '16:9', '1:1', '4:5']),
    targetQualityTier: qualityTierSchema,
    prompt: z.string().min(1).max(2000),
    negativePrompt: z.string().max(1000).default(''),
    referenceAssetIds: z.array(id).max(20).default([]),
    firstFrameAssetId: id.optional(),
    lastFrameAssetId: id.optional(),
    styleReferenceAssetIds: z.array(id).max(20).default([]),
    seedPolicy: seedPolicySchema.default({ mode: 'RANDOM' }),
    factualRestrictions: z.array(z.string().max(500)).max(20).default([]),
    costCeilingMicroUsd: z.number().int().positive(),
    idempotencyKey: z.string().min(8).max(200),
  })
  .strict();
export type VideoGenerationIntent = z.infer<typeof videoGenerationIntentSchema>;

/**
 * Provider Routing Decision.
 * Decoupled from creative planning; selects provider and model based on capabilities and cost.
 */
export const providerRoutingDecisionSchema = z
  .object({
    videoGenerationIntentId: id,
    providerId: z.string().min(1).max(50),
    modelId: z.string().min(1).max(100),
    capabilityProfileVersion: z.string().min(1).max(50),
    estimatedCostMicroUsd: z.number().int().positive(),
    routingReason: z.string().min(1).max(500),
    routingFactors: z.record(z.string().max(100), z.union([z.string(), z.number(), z.boolean()])),
    decisionTimestamp: z.string().datetime(),
  })
  .strict();
export type ProviderRoutingDecision = z.infer<typeof providerRoutingDecisionSchema>;
