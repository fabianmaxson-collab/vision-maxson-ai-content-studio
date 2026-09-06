import { describe, expect, it } from 'vitest';
import { providerModelStatusTransitionSchema } from './providers';

describe('provider model administration contracts', () => {
  it('accepts only a strict optimistic availability transition', () => {
    expect(
      providerModelStatusTransitionSchema.safeParse({
        expectedStatus: 'inactive',
        targetStatus: 'available',
        version: 1,
      }).success,
    ).toBe(true);
    for (const input of [
      { expectedStatus: 'inactive', targetStatus: 'inactive', version: 1 },
      { expectedStatus: 'inactive', targetStatus: 'degraded', version: 1 },
      { expectedStatus: 'disabled', targetStatus: 'available', version: 1 },
      { expectedStatus: 'inactive', targetStatus: 'available', version: 0 },
      { expectedStatus: 'inactive', targetStatus: 'available', version: 1, extra: true },
    ]) {
      expect(providerModelStatusTransitionSchema.safeParse(input).success).toBe(false);
    }
  });
});
