import { z } from 'zod';
const id = z.string().min(3).max(100);
const boundedJson = z
  .record(z.string().max(100), z.unknown())
  .refine((v) => JSON.stringify(v).length <= 8192, 'Configuration exceeds 8 KiB');
export const languageCodeSchema = z
  .string()
  .min(2)
  .max(35)
  .regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/);
export const createBrandSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).default(''),
  niche: z.string().trim().max(200),
  primaryLanguage: languageCodeSchema,
  targetAudience: boundedJson.default({}),
  visualStyle: boundedJson.default({}),
  defaultVoiceProfileId: id.nullable().default(null),
});
export const updateBrandSchema = createBrandSchema
  .partial()
  .extend({ version: z.number().int().positive() });
export const createChannelSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    primaryLanguage: languageCodeSchema,
    secondaryLanguages: z.array(languageCodeSchema).max(20).default([]),
    narrativeTone: z.string().trim().max(500).default(''),
    shortDurationMinSeconds: z.number().int().positive().nullable().default(null),
    shortDurationMaxSeconds: z.number().int().positive().nullable().default(null),
    strategy: boundedJson.default({}),
  })
  .superRefine((v, c) => {
    if (
      v.shortDurationMinSeconds &&
      v.shortDurationMaxSeconds &&
      v.shortDurationMinSeconds > v.shortDurationMaxSeconds
    )
      c.addIssue({ code: 'custom', message: 'Minimum duration exceeds maximum' });
  });
export const createSocialAccountSchema = z.object({
  channelProfileId: id,
  platformId: id,
  displayName: z.string().trim().min(1).max(120),
  handle: z.string().trim().max(200).nullable().default(null),
  externalAccountId: z.string().trim().max(300).nullable().default(null),
});
export const createProjectSchema = z.object({
  contentBrandId: id,
  channelProfileId: id,
  title: z.string().trim().min(1).max(180),
  description: z.string().trim().max(4000).default(''),
  format: z.enum(['SHORT', 'LONG_FORM']),
  primaryLanguage: languageCodeSchema,
  objectiveIds: z.array(id).min(1).max(6),
  targetPlatformIds: z.array(id).min(1).max(20),
  operatingMode: z.enum(['MANUAL', 'ASSISTED', 'AUTONOMOUS']).default('ASSISTED'),
});
export const parameterSchema = z
  .object({
    scopeType: z.enum(['project', 'target', 'variant', 'language_variant']),
    scopeId: id,
    parameterKey: z.string().min(1).max(100),
    mode: z.enum(['AUTO', 'PREFER', 'LOCKED']),
    requestedValue: z.unknown().nullable(),
    effectiveValue: z.unknown().nullable(),
    recommendation: z.unknown().nullable(),
    recommendationSource: z.string().max(200).nullable(),
    recommendationRuleVersion: z.string().max(100).nullable(),
    deviationReason: z.string().max(1000).nullable(),
    version: z.number().int().positive().optional(),
  })
  .refine((v) => v.mode !== 'LOCKED' || v.requestedValue !== null, {
    message: 'LOCKED requires a value',
  });
export const cursorSchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export const createVoiceProfileSchema = z.object({
  name: z.string().trim().min(1).max(120),
  primaryLanguage: languageCodeSchema,
  configuration: boundedJson.default({}),
});
export const createCharacterProfileSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).default(''),
});
export const createCharacterVersionSchema = z.object({ definition: boundedJson });
export const monetizationStatusSchema = z.object({
  programId: id,
  status: z.enum([
    'unknown',
    'not_eligible',
    'eligible',
    'enrolled',
    'suspended',
    'restricted',
    'not_applicable',
  ]),
  region: z.string().max(40).nullable().default(null),
  sourceType: z.enum(['observed', 'estimated', 'approved_default', 'unknown']),
  evidence: boundedJson.default({}),
});
export const deriveShortSchema = z.object({
  title: z.string().trim().min(1).max(180),
  primaryLanguage: languageCodeSchema,
  objectiveIds: z.array(id).min(1).max(6),
  targetPlatformIds: z.array(id).min(1).max(20),
});
