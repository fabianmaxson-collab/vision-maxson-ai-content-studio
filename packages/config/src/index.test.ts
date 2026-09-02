import { describe, expect, it } from 'vitest';
import { parseConfig } from './index';

describe('runtime config', () => {
  it('normalizes the owner email', () =>
    expect(
      parseConfig({
        ENVIRONMENT: 'staging',
        RELEASE_VERSION: 'x',
        ACCESS_TEAM_DOMAIN: 'https://team.cloudflareaccess.com',
        ACCESS_AUD: '1234567890123456',
        APP_ORIGIN: 'https://example.com',
        OWNER_BOOTSTRAP_ENABLED: 'true',
        BOOTSTRAP_OWNER_EMAIL: ' OWNER@Example.com ',
        TOKEN_ENCRYPTION_KEY: 'key',
      }).BOOTSTRAP_OWNER_EMAIL,
    ).toBe('owner@example.com'));
  it('rejects insecure origins', () =>
    expect(() =>
      parseConfig({
        ENVIRONMENT: 'staging',
        RELEASE_VERSION: 'x',
        ACCESS_TEAM_DOMAIN: 'https://team.cloudflareaccess.com',
        ACCESS_AUD: '1234567890123456',
        APP_ORIGIN: 'http://example.com',
        OWNER_BOOTSTRAP_ENABLED: 'false',
        BOOTSTRAP_OWNER_EMAIL: 'owner@example.com',
        TOKEN_ENCRYPTION_KEY: 'key',
      }),
    ).toThrow());
});
