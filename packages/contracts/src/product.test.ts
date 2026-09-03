import { describe, expect, it } from 'vitest';
import { createChannelSchema, parameterSchema } from './product';
describe('Phase 2 contracts', () => {
  it('rejects inverted duration ranges', () =>
    expect(
      createChannelSchema.safeParse({
        name: 'Channel',
        primaryLanguage: 'en',
        shortDurationMinSeconds: 90,
        shortDurationMaxSeconds: 65,
      }).success,
    ).toBe(false));
  it('rejects LOCKED without a selected value', () =>
    expect(
      parameterSchema.safeParse({
        scopeType: 'project',
        scopeId: 'project_1',
        parameterKey: 'duration',
        mode: 'LOCKED',
        requestedValue: null,
        effectiveValue: null,
        recommendation: null,
        recommendationSource: null,
        recommendationRuleVersion: null,
        deviationReason: null,
      }).success,
    ).toBe(false));
  it('limits configuration payload size', () =>
    expect(
      createChannelSchema.safeParse({
        name: 'Channel',
        primaryLanguage: 'en',
        strategy: { value: 'x'.repeat(9000) },
      }).success,
    ).toBe(false));
});
