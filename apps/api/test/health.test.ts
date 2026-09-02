import { describe, expect, it } from 'vitest';

import { createApp, type Bindings } from '../src/app';

const bindings: Bindings = {
  ENVIRONMENT: 'local',
  RELEASE_VERSION: 'test',
  ACCESS_TEAM_DOMAIN: 'https://team.cloudflareaccess.com',
  ACCESS_AUD: '1234567890123456',
  APP_ORIGIN: 'http://localhost:8787',
  OWNER_BOOTSTRAP_ENABLED: 'false',
  BOOTSTRAP_OWNER_EMAIL: 'owner@example.test',
  TOKEN_ENCRYPTION_KEY: 'not-used-by-these-tests',
  DB: {} as D1Database,
  ASSETS: {
    fetch: () => Promise.resolve(new Response('asset')),
  } as unknown as Fetcher,
};

describe('API foundation', () => {
  it('reports a non-cacheable healthy response', async () => {
    const response = await createApp().request('/api/v1/health', undefined, bindings);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({
      status: 'ok',
      service: 'vision-maxson-api',
      environment: 'local',
      version: 'test',
    });
  });

  it('returns a problem response for unknown API routes', async () => {
    const response = await createApp().request('/api/v2/missing', undefined, bindings);

    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toMatchObject({
      title: 'Not Found',
      status: 404,
    });
  });

  it('delegates non-API routes to the static asset binding', async () => {
    const response = await createApp().request('/dashboard', undefined, bindings);

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('asset');
  });

  it('denies a cryptographically accepted but unprovisioned identity', async () => {
    const statement = {
      bind: () => statement,
      first: () => Promise.resolve(null),
      run: () => Promise.resolve({}),
    };
    const db = { prepare: () => statement } as unknown as D1Database;
    const app = createApp(() =>
      Promise.resolve({
        issuer: 'https://visionmaxson.cloudflareaccess.com',
        subject: 'unprovisioned-subject',
        email: 'unprovisioned@example.test',
      }),
    );

    const response = await app.request(
      '/api/v1/me',
      { headers: { 'Cf-Access-Jwt-Assertion': 'verified-by-test-double' } },
      { ...bindings, DB: db },
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      title: 'Forbidden',
      detail: 'This authenticated identity is not provisioned.',
    });
  });
});
