import { z } from 'zod';

const id = z.string().min(3).max(100);
const sha256Hex = z
  .string()
  .regex(/^[a-f0-9]{64}$/, 'Must be a 64-character lowercase hexadecimal SHA-256 hash');

export const mediaAssetTypeSchema = z.enum([
  'VIDEO_CLIP',
  'IMAGE',
  'VOICEOVER',
  'MUSIC',
  'SFX',
  'GRAPHIC_OVERLAY',
  'CAPTION_TRACK',
  'REFERENCE_FRAME',
  'ROUGH_CUT',
  'FINAL_MASTER',
]);
export type MediaAssetType = z.infer<typeof mediaAssetTypeSchema>;

export const storageStateSchema = z.enum([
  'TRANSIENT_OPERATIONAL',
  'DURABLE_ARCHIVED',
  'EXPIRING',
  'DELETED',
]);
export type StorageState = z.infer<typeof storageStateSchema>;

export const mediaPublishabilitySchema = z.enum([
  'INTERNAL_ONLY',
  'APPROVED_FOR_RENDER',
  'BLOCKED',
  'READY_FOR_PUBLISH',
]);
export type MediaPublishability = z.infer<typeof mediaPublishabilitySchema>;

export const mediaQaStatusSchema = z.enum(['UNINSPECTED', 'PASS', 'WARNING_NORMALIZABLE', 'FAIL']);
export type MediaQaStatus = z.infer<typeof mediaQaStatusSchema>;

export const mediaApprovalStatusSchema = z.enum(['PENDING', 'APPROVED', 'REJECTED', 'SUPERSEDED']);
export type MediaApprovalStatus = z.infer<typeof mediaApprovalStatusSchema>;

export const mediaValidationStatusSchema = z.enum(['PASS', 'WARNING_NORMALIZABLE', 'FAIL']);
export type MediaValidationStatus = z.infer<typeof mediaValidationStatusSchema>;

export const normalizationDetailsSchema = z
  .object({
    crop: z
      .object({
        x: z.number().int().nonnegative(),
        y: z.number().int().nonnegative(),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
      })
      .strict()
      .optional(),
    scale: z
      .object({
        targetWidth: z.number().int().positive(),
        targetHeight: z.number().int().positive(),
        algorithm: z.enum(['LANCZOS', 'BICUBIC', 'BILINEAR']).default('LANCZOS'),
      })
      .strict()
      .optional(),
    pad: z
      .object({
        top: z.number().int().nonnegative(),
        bottom: z.number().int().nonnegative(),
        left: z.number().int().nonnegative(),
        right: z.number().int().nonnegative(),
        colorHex: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/)
          .default('#000000'),
      })
      .strict()
      .optional(),
    transcode: z
      .object({
        targetVideoCodec: z.string().min(1).max(50),
        targetAudioCodec: z.string().min(1).max(50).optional(),
        targetFps: z.number().positive().optional(),
      })
      .strict()
      .optional(),
    reason: z.string().min(1).max(500),
  })
  .strict();
export type NormalizationDetails = z.infer<typeof normalizationDetailsSchema>;

export const mediaInspectionResultSchema = z
  .object({
    status: mediaValidationStatusSchema,
    actualWidth: z.number().int().positive(),
    actualHeight: z.number().int().positive(),
    calculatedAspectRatio: z.string().min(1).max(30),
    actualDurationSeconds: z.number().positive(),
    fps: z.number().positive(),
    container: z.string().min(1).max(50),
    videoCodec: z.string().min(1).max(50),
    audioCodec: z.string().max(50).nullable(),
    audioPresent: z.boolean(),
    fileSizeBytes: z.number().int().positive(),
    sha256: sha256Hex,
    blackFrameDetected: z.boolean(),
    frozenFrameDetected: z.boolean(),
    watermarkDetected: z.boolean(),
    declaredVsActualMismatch: z.boolean(),
    normalizationRequired: z.boolean(),
    normalizationDetails: normalizationDetailsSchema.optional(),
    notes: z.string().max(1000).optional(),
  })
  .strict();
export type MediaInspectionResult = z.infer<typeof mediaInspectionResultSchema>;

/**
 * Canonical Persisted Media Asset.
 * STRICT INVARIANT: Private by default.
 * NO permanent `publicDownloadUrl` property is permitted.
 */
export const mediaAssetSchema = z
  .object({
    id: id,
    projectId: id,
    sceneId: id.optional(),
    assetType: mediaAssetTypeSchema,
    providerId: z.string().min(1).max(50).optional(),
    providerModelId: z.string().min(1).max(100).optional(),
    providerRequestId: z.string().min(1).max(200).optional(),
    promptHash: z.string().max(64).optional(),
    generationParameters: z.record(z.string().max(100), z.unknown()).default({}),
    sourceAssetIds: z.array(id).max(20).default([]),
    fileHashSha256: sha256Hex,
    mimeType: z.string().min(3).max(100),
    fileSizeBytes: z.number().int().nonnegative(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    fps: z.number().positive().optional(),
    durationSeconds: z.number().positive().optional(),
    videoCodec: z.string().max(50).optional(),
    audioCodec: z.string().max(50).optional(),
    storageState: storageStateSchema,
    r2Key: z.string().min(1).max(500).optional(),
    driveFileId: z.string().min(1).max(200).optional(),
    publishability: mediaPublishabilitySchema,
    watermarkDetected: z.boolean().default(false),
    qaStatus: mediaQaStatusSchema,
    approvalStatus: mediaApprovalStatusSchema,
    estimatedCostMicroUsd: z.number().int().positive(),
    actualCostMicroUsd: z.number().int().nonnegative().optional(),
    createdAt: z.string().datetime(),
    expiresAt: z.string().datetime().optional(),
    supersededById: id.optional(),
  })
  .strict();
export type MediaAsset = z.infer<typeof mediaAssetSchema>;
