import type { ReasoningEffort } from './index';

export const PHASE3_SHORT_EN_REVIEW_ES_PROFILE = 'phase3_short_en_review_es_v1' as const;
export const PHASE3_SHORT_DE_REVIEW_ES_PROFILE = 'phase3_short_de_review_es_v1' as const;
export type BoundedProfileStep = 'SCRIPT_WRITER_SHORT' | 'REVIEW_TRANSLATION_ES';

export interface BoundedStepPolicy {
  maxOutputTokens: number;
  maximumAttempts: 1;
  timeoutMs: number;
  inputTokenCeiling: number;
  reasoningEffort: ReasoningEffort;
}

const boundedSteps = Object.freeze({
  SCRIPT_WRITER_SHORT: Object.freeze({
    maxOutputTokens: 768,
    maximumAttempts: 1,
    timeoutMs: 45_000,
    inputTokenCeiling: 8192,
    reasoningEffort: 'none',
  }),
  REVIEW_TRANSLATION_ES: Object.freeze({
    maxOutputTokens: 1024,
    maximumAttempts: 1,
    timeoutMs: 45_000,
    inputTokenCeiling: 8192,
    reasoningEffort: 'none',
  }),
} satisfies Readonly<Record<BoundedProfileStep, BoundedStepPolicy>>);

const defineBoundedShortProfile = <
  Key extends typeof PHASE3_SHORT_EN_REVIEW_ES_PROFILE | typeof PHASE3_SHORT_DE_REVIEW_ES_PROFILE,
  Language extends 'en' | 'de',
>(
  key: Key,
  productionLanguage: Language,
) =>
  Object.freeze({
    key,
    version: 1,
    projectFormat: 'SHORT' as const,
    operatingMode: 'ASSISTED' as const,
    productionLanguage,
    reviewLanguage: 'es' as const,
    providerKey: 'openai' as const,
    modelKey: 'gpt-5.6-luna' as const,
    maximumDispatches: 2,
    totalMaximumOutputTokens: 1792,
    monetaryCeilingMicrousd: 7000,
    creativeRegenerationAllowed: false,
    fallbackAllowed: false,
    externalResearchAllowed: false,
    specializedVerificationAllowed: false,
    humanReviewRequired: true,
    reviewTranslationIsReviewOnly: true,
    steps: boundedSteps,
  });

export const phase3ShortEnReviewEsProfile = defineBoundedShortProfile(
  PHASE3_SHORT_EN_REVIEW_ES_PROFILE,
  'en',
);
export const phase3ShortDeReviewEsProfile = defineBoundedShortProfile(
  PHASE3_SHORT_DE_REVIEW_ES_PROFILE,
  'de',
);
export type BoundedExecutionProfile =
  typeof phase3ShortEnReviewEsProfile | typeof phase3ShortDeReviewEsProfile;
export const boundedExecutionProfiles: readonly BoundedExecutionProfile[] = Object.freeze([
  phase3ShortEnReviewEsProfile,
  phase3ShortDeReviewEsProfile,
]);

export function boundedProfileForProject(project: {
  format: unknown;
  operatingMode: unknown;
  primaryLanguage: unknown;
  reviewLanguage: unknown;
}) {
  return boundedExecutionProfiles.find(
    (profile) =>
      project.format === profile.projectFormat &&
      project.operatingMode === profile.operatingMode &&
      project.primaryLanguage === profile.productionLanguage &&
      project.reviewLanguage === profile.reviewLanguage,
  );
}

export function isProjectEligibleForBoundedProfile(
  profile: BoundedExecutionProfile,
  project: {
    format: unknown;
    operatingMode: unknown;
    primaryLanguage: unknown;
    reviewLanguage: unknown;
    briefProductionLanguage: unknown;
    briefReviewLanguage: unknown;
    hasApprovedBrief: boolean;
    hasExactSource: boolean;
  },
  task: BoundedProfileStep,
) {
  if (
    project.format !== profile.projectFormat ||
    project.operatingMode !== profile.operatingMode ||
    project.primaryLanguage !== profile.productionLanguage ||
    project.reviewLanguage !== profile.reviewLanguage
  )
    return false;
  if (task === 'SCRIPT_WRITER_SHORT')
    return (
      project.hasApprovedBrief &&
      project.briefProductionLanguage === profile.productionLanguage &&
      project.briefReviewLanguage === profile.reviewLanguage
    );
  if (profile.key === PHASE3_SHORT_DE_REVIEW_ES_PROFILE)
    return (
      project.hasExactSource &&
      project.hasApprovedBrief &&
      project.briefProductionLanguage === profile.productionLanguage &&
      project.briefReviewLanguage === profile.reviewLanguage
    );
  return project.hasExactSource;
}

export function isBoundedProfileStep(task: string): task is BoundedProfileStep {
  return task === 'SCRIPT_WRITER_SHORT' || task === 'REVIEW_TRANSLATION_ES';
}

const utf8Bytes = (value: string) => new TextEncoder().encode(value).byteLength;

/**
 * Conservative upper bound over the exact independently serialized fields sent to the provider.
 * A UTF-8 byte is counted as at most one token, and framing remains an explicit fixed allowance.
 */
export function conservativeInputTokenUpperBound(
  value: { instructions: string; input: unknown; outputSchema: unknown },
  providerOverheadTokens = 1024,
) {
  return (
    utf8Bytes(value.instructions) +
    utf8Bytes(JSON.stringify(value.input)) +
    utf8Bytes(JSON.stringify(value.outputSchema)) +
    providerOverheadTokens
  );
}

export interface VerifiedTokenPricing {
  currency: string | null;
  unitName: string | null;
  inputUnitPrice: number | null;
  outputUnitPrice: number | null;
  verificationStatus: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export function reserveMicrousd(
  pricing: VerifiedTokenPricing,
  inputTokens: number,
  outputTokens: number,
  at = new Date(),
) {
  if (
    pricing.currency !== 'USD' ||
    pricing.unitName !== 'token' ||
    pricing.inputUnitPrice === null ||
    pricing.outputUnitPrice === null ||
    !Number.isFinite(pricing.inputUnitPrice) ||
    !Number.isFinite(pricing.outputUnitPrice) ||
    pricing.inputUnitPrice < 0 ||
    pricing.outputUnitPrice < 0 ||
    !['owner_approved', 'externally_verified'].includes(pricing.verificationStatus) ||
    pricing.effectiveTo !== null ||
    new Date(pricing.effectiveFrom).getTime() > at.getTime()
  )
    throw new Error('pricing_unverified_or_incompatible');
  // 25% input-price safety premium covers provider accounting variance.
  return Math.ceil(
    (inputTokens * pricing.inputUnitPrice * 1.25 + outputTokens * pricing.outputUnitPrice) *
      1_000_000,
  );
}
