import { describe, expect, it } from 'vitest';
import {
  boundedProfileForProject,
  conservativeInputTokenUpperBound,
  isProjectEligibleForBoundedProfile,
  phase3ShortDeReviewEsProfile as germanProfile,
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
    expect(
      conservativeInputTokenUpperBound({
        instructions: 'abc',
        input: {},
        outputSchema: { type: 'object' },
      }),
    ).toBeGreaterThan(1024);
  });
  it('counts exact provider fields once, including schema, instructions, and framing', () => {
    const baseline = conservativeInputTokenUpperBound({
      instructions: '',
      input: {},
      outputSchema: {},
    });
    expect(baseline).toBe(1028);
    expect(
      conservativeInputTokenUpperBound({
        instructions: 'instruction',
        input: {},
        outputSchema: {},
      }),
    ).toBe(baseline + 11);
    expect(
      conservativeInputTokenUpperBound({
        instructions: '',
        input: {},
        outputSchema: { required: ['title'] },
      }),
    ).toBeGreaterThan(baseline);
  });
  it('handles German UTF-8 conservatively without treating characters as bytes', () => {
    const ascii = conservativeInputTokenUpperBound({
      instructions: 'Pragnant',
      input: {},
      outputSchema: {},
    });
    const german = conservativeInputTokenUpperBound({
      instructions: 'Prägnant',
      input: {},
      outputSchema: {},
    });
    expect(german).toBe(ascii + 1);
  });
  it('fits the measured Tim der Chronist request after removing duplicated context', () => {
    const measured = conservativeInputTokenUpperBound({
      instructions: 'x'.repeat(4091),
      input: {},
      outputSchema: 'x'.repeat(618),
    });
    expect(measured).toBe(5737);
    expect(measured).toBeLessThanOrEqual(germanProfile.steps.SCRIPT_WRITER_SHORT.inputTokenCeiling);
  });
  it('still fails closed for oversized provider-bound material', () => {
    const measured = conservativeInputTokenUpperBound({
      instructions: 'x'.repeat(8192),
      input: {},
      outputSchema: {},
    });
    expect(measured).toBeGreaterThan(germanProfile.steps.SCRIPT_WRITER_SHORT.inputTokenCeiling);
  });
  it('does not mutate catalog policy objects', () =>
    expect(defaultTaskPolicies.SCRIPT_WRITER_SHORT!.minimumQualityTier).toBe('BALANCED'));
});
describe('German bounded editorial profile', () => {
  const eligible = {
    format: 'SHORT',
    operatingMode: 'ASSISTED',
    primaryLanguage: 'de',
    reviewLanguage: 'es',
    briefProductionLanguage: 'de',
    briefReviewLanguage: 'es',
    hasApprovedBrief: true,
    hasExactSource: true,
  };

  it('defines an explicit de to es profile with the exact approved bounds', () => {
    expect(germanProfile.key).toBe('phase3_short_de_review_es_v1');
    expect(germanProfile.productionLanguage).toBe('de');
    expect(germanProfile.reviewLanguage).toBe('es');
    expect(germanProfile.providerKey).toBe('openai');
    expect(germanProfile.modelKey).toBe('gpt-5.6-luna');
    expect(germanProfile).toMatchObject({
      projectFormat: 'SHORT',
      operatingMode: 'ASSISTED',
      maximumDispatches: 2,
      totalMaximumOutputTokens: 1792,
      monetaryCeilingMicrousd: 7000,
      creativeRegenerationAllowed: false,
      fallbackAllowed: false,
      externalResearchAllowed: false,
      humanReviewRequired: true,
    });
  });

  it('shares immutable step bounds with English without expanding its language', () => {
    expect(germanProfile.steps).toBe(profile.steps);
    expect(germanProfile.productionLanguage).toBe('de');
    expect(profile.productionLanguage).toBe('en');
    expect(germanProfile.steps.SCRIPT_WRITER_SHORT).toMatchObject({
      maximumAttempts: 1,
      timeoutMs: 45_000,
      inputTokenCeiling: 8192,
      maxOutputTokens: 768,
      reasoningEffort: 'none',
    });
    expect(germanProfile.steps.REVIEW_TRANSLATION_ES.maxOutputTokens).toBe(1024);
  });

  it('selects profiles only for their exact server-owned language pair', () => {
    expect(boundedProfileForProject(eligible)?.key).toBe(germanProfile.key);
    expect(boundedProfileForProject({ ...eligible, primaryLanguage: 'en' })?.key).toBe(profile.key);
    expect(boundedProfileForProject({ ...eligible, primaryLanguage: 'fr' })).toBeUndefined();
    expect(boundedProfileForProject({ ...eligible, reviewLanguage: 'de' })).toBeUndefined();
  });

  it('requires a matching approved de to es brief for both German steps', () => {
    expect(isProjectEligibleForBoundedProfile(germanProfile, eligible, 'SCRIPT_WRITER_SHORT')).toBe(
      true,
    );
    expect(
      isProjectEligibleForBoundedProfile(germanProfile, eligible, 'REVIEW_TRANSLATION_ES'),
    ).toBe(true);
    for (const mismatch of [
      { primaryLanguage: 'en' },
      { briefProductionLanguage: 'en' },
      { briefReviewLanguage: 'de' },
      { hasApprovedBrief: false },
    ])
      expect(
        isProjectEligibleForBoundedProfile(
          germanProfile,
          { ...eligible, ...mismatch },
          'SCRIPT_WRITER_SHORT',
        ),
      ).toBe(false);
  });

  it('rejects cross-profile eligibility and requires an exact source for translation', () => {
    expect(isProjectEligibleForBoundedProfile(profile, eligible, 'SCRIPT_WRITER_SHORT')).toBe(
      false,
    );
    expect(
      isProjectEligibleForBoundedProfile(
        germanProfile,
        { ...eligible, primaryLanguage: 'en', briefProductionLanguage: 'en' },
        'SCRIPT_WRITER_SHORT',
      ),
    ).toBe(false);
    expect(
      isProjectEligibleForBoundedProfile(
        germanProfile,
        { ...eligible, hasExactSource: false },
        'REVIEW_TRANSLATION_ES',
      ),
    ).toBe(false);
  });

  it('keeps Luna economy eligibility contextual and the catalog policy unchanged', () => {
    expect(taskPolicy('SCRIPT_WRITER_SHORT').minimumQualityTier).toBe('BALANCED');
    expect(taskPolicy('SCRIPT_WRITER_SHORT', { economyEligible: true }).minimumQualityTier).toBe(
      'ECONOMY',
    );
    expect(() =>
      routeModel([luna], {
        mode: 'LOCKED',
        preferredProviderKey: 'openai',
        preferredModelKey: luna.modelKey,
        requiredCapabilities: ['STRUCTURED_OUTPUT'],
        minimumQualityTier: taskPolicy('SCRIPT_WRITER_SHORT').minimumQualityTier,
      }),
    ).toThrow();
  });
});
