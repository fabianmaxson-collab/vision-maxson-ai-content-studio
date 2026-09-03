import { describe, expect, it } from 'vitest';
import { ProviderNotConfiguredError } from './index';

describe('provider-neutral foundation', () => {
  it('represents provider-not-configured without provider dependencies', () => {
    const error = new ProviderNotConfiguredError();
    expect(error.category).toBe('AUTHENTICATION');
    expect(error.retryable).toBe(false);
  });
});
