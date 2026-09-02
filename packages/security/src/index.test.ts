import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, identityFromPayload } from './index';

const key = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
describe('security primitives', () => {
  it('round trips AES-GCM secrets and binds context', async () => {
    const encrypted = await encryptSecret('refresh-token', key, 'connection:1');
    expect(encrypted).not.toContain('refresh-token');
    await expect(decryptSecret(encrypted, key, 'connection:1')).resolves.toBe('refresh-token');
    await expect(decryptSecret(encrypted, key, 'connection:2')).rejects.toThrow();
  });
  it('normalizes a verified JWT payload identity', () =>
    expect(
      identityFromPayload(
        { sub: 'google-id', email: ' Owner@Example.COM ' },
        'https://team.cloudflareaccess.com/',
      ).email,
    ).toBe('owner@example.com'));
});
