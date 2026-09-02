import { describe, expect, it } from 'vitest';

import { createApp, type Bindings } from '../src/app';

const bindings: Bindings = {
  ENVIRONMENT: 'local',
  RELEASE_VERSION: 'test',
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
    const response = await createApp().request('/api/v1/missing', undefined, bindings);

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
});
