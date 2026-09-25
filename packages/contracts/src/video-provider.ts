import { z } from 'zod';

const id = z.string().min(3).max(100);

/**
 * Normalized Video Job States.
 * Tracks the end-to-end lifecycle of an asynchronous, high-cost video generation.
 */
export const videoJobStateSchema = z.enum([
  'PLANNED',
  'RESERVED',
  'DISPATCHING',
  'BACKOFF_WAIT',
  'AMBIGUOUS_DISPATCH',
  'POLLING',
  'PROVIDER_COMPLETED',
  'PROVIDER_FAILED',
  'INGESTING',
  'VALIDATING',
  'NORMALIZING',
  'ARCHIVING',
  'PERSISTED',
  'FAILED_CLOSED',
  'FAILED_TERMINAL',
]);
export type VideoJobState = z.infer<typeof videoJobStateSchema>;

export const terminalVideoJobStates = new Set<VideoJobState>([
  'PERSISTED',
  'FAILED_CLOSED',
  'FAILED_TERMINAL',
]);

export function isTerminalVideoJobState(state: VideoJobState): boolean {
  return terminalVideoJobStates.has(state);
}

/**
 * Provider Error Category Taxonomy.
 */
export const providerErrorCategorySchema = z.enum([
  'PROVIDER_CAPACITY_PRE_DISPATCH',
  'RATE_LIMIT_PRE_DISPATCH',
  'AUTHENTICATION',
  'INVALID_REQUEST',
  'CONTENT_POLICY',
  'PROVIDER_INTERNAL',
  'TIMEOUT_PRE_DISPATCH',
  'AMBIGUOUS_AFTER_DISPATCH',
  'GENERATION_FAILED',
  'OUTPUT_CORRUPTED',
  'DOWNLOAD_FAILED',
]);
export type ProviderErrorCategory = z.infer<typeof providerErrorCategorySchema>;

/**
 * Retry Classification.
 * Strictly separates safe technical retries from terminal states.
 * Under no circumstance does this include automatic creative regeneration.
 */
export const retryClassificationSchema = z.enum([
  'SAFE_TECHNICAL_REDISPATCH',
  'POLL_EXISTING_JOB',
  'FAIL_CLOSED',
  'HUMAN_REVIEW_REQUIRED',
]);
export type RetryClassification = z.infer<typeof retryClassificationSchema>;

/**
 * Normalized Provider Error.
 */
export const normalizedProviderErrorSchema = z
  .object({
    providerId: z.string().min(1).max(50),
    rawCode: z.string().min(1).max(100),
    safeMessage: z.string().min(1).max(1000),
    category: providerErrorCategorySchema,
    httpStatus: z.number().int().min(100).max(599).optional(),
    providerJobId: z.string().min(1).max(200).optional(),
    retryClass: retryClassificationSchema,
    dispatchKnown: z.boolean(),
    createdAt: z.string().datetime(),
  })
  .strict();
export type NormalizedProviderError = z.infer<typeof normalizedProviderErrorSchema>;

/**
 * Capability Evidence Level.
 */
export const capabilityEvidenceSchema = z.enum([
  'TESTED_BY_US',
  'DOCUMENTED_NOT_TESTED',
  'UNKNOWN',
]);
export type CapabilityEvidence = z.infer<typeof capabilityEvidenceSchema>;

/**
 * Video Provider Capability Profile.
 */
export const videoProviderCapabilityProfileSchema = z
  .object({
    providerId: z.string().min(1).max(50),
    modelId: z.string().min(1).max(100),
    profileVersion: z.string().min(1).max(50),
    supportedAspectRatios: z.array(z.string().min(1).max(10)),
    allowedDurationsSeconds: z.array(z.number().positive()),
    supportedResolutions: z.array(z.string().min(1).max(20)),
    maxReferenceImages: z.number().int().nonnegative(),
    maxReferenceVideos: z.number().int().nonnegative(),
    maxAudioReferences: z.number().int().nonnegative(),
    textToVideo: capabilityEvidenceSchema,
    imageToVideo: capabilityEvidenceSchema,
    referenceVideoSupported: z.boolean(),
    pollingSupported: z.boolean(),
    webhookSupported: z.boolean(),
    notes: z.string().max(1000).optional(),
  })
  .strict();
export type VideoProviderCapabilityProfile = z.infer<typeof videoProviderCapabilityProfileSchema>;

/**
 * Video Generation Dispatch Request.
 */
export const videoGenerationDispatchRequestSchema = z
  .object({
    intentId: id,
    idempotencyKey: z.string().min(8).max(200),
    modelId: z.string().min(1).max(100),
    prompt: z.string().min(1).max(2000),
    negativePrompt: z.string().max(1000).default(''),
    durationSeconds: z.number().positive(),
    aspectRatio: z.enum(['9:16', '16:9', '1:1', '4:5']),
    resolution: z.string().max(20).optional(),
    seed: z.number().int().nonnegative().optional(),
    referenceImageUrls: z.array(z.string().url().max(2048)).max(10).default([]),
    referenceVideoUrl: z.string().url().max(2048).optional(),
    referenceAudioUrls: z.array(z.string().url().max(2048)).max(5).default([]),
  })
  .strict();
export type VideoGenerationDispatchRequest = z.infer<typeof videoGenerationDispatchRequestSchema>;

/**
 * Video Generation Dispatch Result.
 */
export const videoGenerationDispatchResultSchema = z
  .object({
    providerJobId: z.string().min(1).max(200),
    providerRequestId: z.string().min(1).max(200).optional(),
    status: z.enum(['QUEUED', 'PROCESSING', 'FAILED', 'COMPLETED']),
    estimatedCostMicroUsd: z.number().int().nonnegative(),
    dispatchedAt: z.string().datetime(),
    rawResponse: z.record(z.string().max(100), z.unknown()).optional(),
  })
  .strict();
export type VideoGenerationDispatchResult = z.infer<typeof videoGenerationDispatchResultSchema>;

/**
 * Video Generation Poll Request.
 */
export const videoGenerationPollRequestSchema = z
  .object({
    providerJobId: z.string().min(1).max(200),
    modelId: z.string().min(1).max(100),
  })
  .strict();
export type VideoGenerationPollRequest = z.infer<typeof videoGenerationPollRequestSchema>;

/**
 * Secure Provider Video Output Descriptor.
 * Adapter-owned output descriptor.
 * Caller MUST NOT supply arbitrary download URLs.
 */
export const providerVideoOutputDescriptorSchema = z
  .object({
    providerId: z.string().min(1).max(50),
    providerJobId: z.string().min(1).max(200),
    ephemeralDownloadUrl: z.string().url().max(2048),
    declaredWidth: z.number().int().positive().optional(),
    declaredHeight: z.number().int().positive().optional(),
    declaredDurationSeconds: z.number().positive().optional(),
    expiresAt: z.string().datetime().optional(),
  })
  .strict();
export type ProviderVideoOutputDescriptor = z.infer<typeof providerVideoOutputDescriptorSchema>;

/**
 * Video Generation Poll Result.
 */
export const videoGenerationPollResultSchema = z
  .object({
    providerJobId: z.string().min(1).max(200),
    status: z.enum(['QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED']),
    progressPercentage: z.number().min(0).max(100).optional(),
    output: providerVideoOutputDescriptorSchema.optional(),
    error: normalizedProviderErrorSchema.optional(),
    actualCostMicroUsd: z.number().int().nonnegative().optional(),
    polledAt: z.string().datetime(),
  })
  .strict()
  .refine((v) => v.status !== 'COMPLETED' || v.output !== undefined, {
    message: 'Completed poll result must contain output descriptor',
  })
  .refine((v) => v.status !== 'FAILED' || v.error !== undefined, {
    message: 'Failed poll result must contain normalized error',
  });
export type VideoGenerationPollResult = z.infer<typeof videoGenerationPollResultSchema>;
