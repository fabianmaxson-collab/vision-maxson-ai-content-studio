import { describe, expect, it } from 'vitest';
import {
  conservativeInputTokenUpperBound,
  phase3ShortEnReviewEsProfile as profile,
  reserveMicrousd,
} from './execution-profile';
import { defaultTaskPolicies, taskPolicy } from './policy';
import { routeModel, type ModelCandidate } from './index';

const luna: ModelCandidate = {
  providerKey: 'openai',
  modelKey: 'gpt-5.6-luna',
  status: 'available',
  capabilities: ['STRUCTURED_OUTPUT', 'MULTILINGUAL_TEXT', 'SCRIPT_GENERATION', 'TRANSLATION'],
  qualityTier: 'ECONOMY',
  costRank: 1,
};
const pricing = {
  currency: 'USD',
  unitName: 'token',
  inputUnitPrice: 0.0000002,
  outputUnitPrice: 0.0000012,
  verificationStatus: 'externally_verified',
  effectiveFrom: '2026-09-03',
  effectiveTo: null,
};
describe('phase 3 bounded execution profile', () => {
  it('keeps Luna ineligible for balanced research', () =>
    expect(() =>
      routeModel([luna], {
        mode: 'LOCKED',
        preferredProviderKey: 'openai',
        preferredModelKey: luna.modelKey,
        requiredCapabilities: ['STRUCTURED_OUTPUT'],
        minimumQualityTier: taskPolicy('TOPIC_RESEARCH').minimumQualityTier,
      }),
    ).toThrow('Locked'));
  it('keeps brief balanced, critique high, and storyboard balanced', () => {
    expect(taskPolicy('CONTENT_BRIEF').minimumQualityTier).toBe('BALANCED');
    expect(taskPolicy('SCRIPT_CRITIC').minimumQualityTier).toBe('HIGH');
    expect(taskPolicy('STORYBOARD_PLANNER').minimumQualityTier).toBe('BALANCED');
  });
  it('only permits economy for the three context-sensitive tasks', () => {
    expect(taskPolicy('IDEA_GENERATION', { economyEligible: true }).minimumQualityTier).toBe(
      'ECONOMY',
    );
    expect(taskPolicy('SCRIPT_WRITER_SHORT', { economyEligible: true }).minimumQualityTier).toBe(
      'ECONOMY',
    );
    expect(taskPolicy('REVIEW_TRANSLATION_ES', { economyEligible: true }).minimumQualityTier).toBe(
      'ECONOMY',
    );
    expect(taskPolicy('TOPIC_RESEARCH', { economyEligible: true }).minimumQualityTier).toBe(
      'BALANCED',
    );
  });
  it('defines exactly two one-attempt steps', () => {
    expect(Object.keys(profile.steps)).toEqual(['SCRIPT_WRITER_SHORT', 'REVIEW_TRANSLATION_ES']);
    expect(Object.values(profile.steps).every((s) => s.maximumAttempts === 1)).toBe(true);
    expect(profile.maximumDispatches).toBe(2);
    expect(profile.externalResearchAllowed).toBe(false);
    expect(profile.specializedVerificationAllowed).toBe(false);
    expect(profile.humanReviewRequired).toBe(true);
    expect(profile.reviewTranslationIsReviewOnly).toBe(true);
  });
  it('sets the approved output, input, timeout and reasoning ceilings', () => {
    expect(profile.steps.SCRIPT_WRITER_SHORT.maxOutputTokens).toBe(768);
    expect(profile.steps.REVIEW_TRANSLATION_ES.maxOutputTokens).toBe(1024);
    expect(profile.totalMaximumOutputTokens).toBe(1792);
    expect(
      Object.values(profile.steps).every(
        (s) =>
          s.inputTokenCeiling === 8192 && s.timeoutMs === 45000 && s.reasoningEffort === 'none',
      ),
    ).toBe(true);
  });
  it('uses an integer conservative reservation below the hard profile ceiling', () => {
    const a = reserveMicrousd(pricing, 8192, 768, new Date('2026-09-04'));
    const b = reserveMicrousd(pricing, 8192, 1024, new Date('2026-09-04'));
    expect(Number.isInteger(a)).toBe(true);
    expect(a + b).toBeLessThanOrEqual(profile.monetaryCeilingMicrousd);
  });
  it.each([
    { ...pricing, currency: 'EUR' },
    { ...pricing, unitName: 'request' },
    { ...pricing, verificationStatus: 'stale' },
    { ...pricing, inputUnitPrice: null },
    { ...pricing, effectiveTo: '2026-09-04' },
  ])('rejects incompatible or incomplete pricing %#', (value) =>
    expect(() => reserveMicrousd(value, 8192, 768, new Date('2026-09-04'))).toThrow(
      'pricing_unverified',
    ),
  );
  it('rejects future pricing and accounts for provider framing', () => {
    expect(() =>
      reserveMicrousd({ ...pricing, effectiveFrom: '2027-01-01' }, 1, 1, new Date('2026-09-04')),
    ).toThrow();
    expect(conservativeInputTokenUpperBound({ x: 'abc' })).toBeGreaterThan(1024);
  });
  it('does not mutate catalog policy objects', () =>
    expect(defaultTaskPolicies.SCRIPT_WRITER_SHORT!.minimumQualityTier).toBe('BALANCED'));
});
