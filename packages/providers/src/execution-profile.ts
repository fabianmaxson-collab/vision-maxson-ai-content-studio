import type { ReasoningEffort } from './index';

export const PHASE3_SHORT_EN_REVIEW_ES_PROFILE = 'phase3_short_en_review_es_v1' as const;
export type BoundedProfileStep = 'SCRIPT_WRITER_SHORT' | 'REVIEW_TRANSLATION_ES';

export interface BoundedStepPolicy {
  maxOutputTokens: number;
  maximumAttempts: 1;
  timeoutMs: number;
  inputTokenCeiling: number;
  reasoningEffort: ReasoningEffort;
}

export const phase3ShortEnReviewEsProfile = Object.freeze({
  key: PHASE3_SHORT_EN_REVIEW_ES_PROFILE,
  version: 1,
  projectFormat: 'SHORT' as const,
  operatingMode: 'ASSISTED' as const,
  productionLanguage: 'en' as const,
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
  steps: Object.freeze({
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
  } satisfies Readonly<Record<BoundedProfileStep, BoundedStepPolicy>>),
});

export function isBoundedProfileStep(task: string): task is BoundedProfileStep {
  return task === 'SCRIPT_WRITER_SHORT' || task === 'REVIEW_TRANSLATION_ES';
}

/** Conservative upper bound: UTF-8 bytes plus framing allowance. */
export function conservativeInputTokenUpperBound(value: unknown, providerOverheadTokens = 1024) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength + providerOverheadTokens;
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
