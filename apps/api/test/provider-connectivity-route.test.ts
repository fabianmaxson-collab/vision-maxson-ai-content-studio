import { ProviderError, type ProviderConnectivityAdapter } from '@vision-maxson/providers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, type Bindings } from '../src/app';

const identity = {
  issuer: 'https://visionmaxson.cloudflareaccess.com',
  subject: 'subject',
  email: 'owner@example.test',
};
type AuditWrite = { sql: string; args: unknown[] };
type SetupOptions = {
  outcome?: 'success' | 'authentication_failure';
  auditFailure?: boolean;
};
function setup(role: 'owner' | 'admin' | 'operator', options: SetupOptions = {}) {
  const writes: AuditWrite[] = [];
  const db = {
    prepare: vi.fn((sql: string) => {
      let bound: unknown[] = [];
      const statement = {
        bind: vi.fn((...args: unknown[]) => {
          bound = args;
          return statement;
        }),
        first: vi.fn(() => {
          if (sql.includes('FROM access_identities'))
            return Promise.resolve({
              id: 'user_1',
              workspaceId: 'workspace_primary',
              email: identity.email,
              roleList: role,
            });
          if (sql.includes('FROM ai_providers'))
            return Promise.resolve({
              providerId: 'provider_openai',
              providerKey: 'openai',
              providerStatus: 'inactive',
              modelKey: 'gpt-5.6-luna',
              modelStatus: 'inactive',
              inputPrice: 0.0000002,
              outputPrice: 0.0000012,
              currency: 'USD',
            });
          return Promise.resolve(null);
        }),
        run: vi.fn(() => {
          if (sql.includes('INSERT INTO audit_events')) {
            const placeholders = [...sql.matchAll(/\?/gu)].length;
            if (placeholders !== bound.length)
              return Promise.reject(
                new Error(
                  `D1 bind mismatch: ${placeholders} placeholders for ${bound.length} arguments`,
                ),
              );
            if (options.auditFailure) return Promise.reject(new Error('D1 audit unavailable'));
            writes.push({ sql, args: bound });
          }
          return Promise.resolve({});
        }),
      };
      return statement;
    }),
  } as unknown as D1Database;
  const checkConnectivity =
    options.outcome === 'authentication_failure'
      ? vi
          .fn()
          .mockRejectedValue(
            new ProviderError('AUTHENTICATION', false, 'raw unsafe provider error'),
          )
      : vi.fn().mockResolvedValue({
          ok: true,
          providerRequestId: 'response_1',
          usage: {
            inputUnits: 5,
            outputUnits: 2,
            cachedInputUnits: 0,
            reasoningOutputUnits: 0,
            unitName: 'token',
          },
          safeMetadata: { servedModel: 'gpt-5.6-luna' },
        });
  const adapter: ProviderConnectivityAdapter = { providerKey: 'openai', checkConnectivity };
  const bindings: Bindings = {
    ENVIRONMENT: 'staging',
    RELEASE_VERSION: 'test',
    ACCESS_TEAM_DOMAIN: identity.issuer,
    ACCESS_AUD: '1234567890123456',
    APP_ORIGIN: 'https://staging.vision.directormaxson.com',
    OWNER_BOOTSTRAP_ENABLED: 'false',
    BOOTSTRAP_OWNER_EMAIL: identity.email,
    TOKEN_ENCRYPTION_KEY: 'unused',
    OPENAI_API_KEY: 'x',
    OPENAI_PROVIDER_ENABLED: 'true',
    AI_PROVIDER_CONNECTIVITY_DIAGNOSTIC_ENABLED: 'true',
    OPENAI_API_BASE_URL: 'https://api.openai.com/v1',
    DB: db,
    ASSETS: {} as Fetcher,
  };
  return {
    app: createApp(
      () => Promise.resolve(identity),
      () => adapter,
    ),
    bindings,
    writes,
    checkConnectivity,
  };
}
async function post(
  app: ReturnType<typeof createApp>,
  bindings: Bindings,
  origin = bindings.APP_ORIGIN,
) {
  return app.request(
    '/api/v1/admin/ai/providers/provider_openai/connectivity-check',
    {
      method: 'POST',
      headers: {
        Origin: origin,
        'Cf-Access-Jwt-Assertion': 'verified-by-test-double',
      },
    },
    bindings,
  );
}
function expectSafeAudit(write: AuditWrite, outcome: 'success' | 'failure', reason: string | null) {
  expect(write.sql).toContain('INSERT INTO audit_events');
  expect(write.args).toHaveLength(16);
  expect(write.args[9]).toBe(outcome);
  expect(write.args[10]).toBe(reason);
  const serialized = JSON.stringify(write);
  expect(serialized).not.toMatch(
    /OPENAI_API_KEY|raw unsafe provider error|Return the requested connectivity result|full provider response|credential value/u,
  );
  expect(write.sql).not.toMatch(
    /intelligence_runs|editorial_artifacts|artifact_versions|projects/u,
  );
}

describe('provider connectivity admin route', () => {
  beforeEach(() => vi.restoreAllMocks());

  it.each(['owner', 'admin'] as const)(
    'allows %s and persists exactly one safe successful audit event',
    async (role) => {
      const { app, bindings, writes, checkConnectivity } = setup(role);
      const response = await post(app, bindings);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        ok: true,
        providerKey: 'openai',
        modelKey: 'gpt-5.6-luna',
      });
      expect(checkConnectivity).toHaveBeenCalledOnce();
      expect(writes).toHaveLength(1);
      expectSafeAudit(writes[0]!, 'success', null);
    },
  );

  it('persists exactly one safe audit event for a normalized provider failure', async () => {
    const { app, bindings, writes, checkConnectivity } = setup('owner', {
      outcome: 'authentication_failure',
    });
    const response = await post(app, bindings);
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: 'authentication_failure',
    });
    expect(checkConnectivity).toHaveBeenCalledOnce();
    expect(writes).toHaveLength(1);
    expectSafeAudit(writes[0]!, 'failure', 'authentication_failure');
  });

  it('safely handles audit persistence failure without retry or pollution', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { app, bindings, writes, checkConnectivity } = setup('owner', { auditFailure: true });
    const response = await post(app, bindings);
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toMatchObject({ title: 'Internal Server Error', status: 500 });
    expect(JSON.stringify(body)).not.toMatch(/OPENAI_API_KEY|credential|provider response/u);
    expect(checkConnectivity).toHaveBeenCalledOnce();
    expect(writes).toHaveLength(0);
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/OPENAI_API_KEY|credential value/u);
  });

  it('denies an unauthorized role before provider execution', async () => {
    const { app, bindings, checkConnectivity } = setup('operator');
    const response = await post(app, bindings);
    expect(response.status).toBe(403);
    expect(checkConnectivity).not.toHaveBeenCalled();
  });

  it('preserves same-origin mutation protection', async () => {
    const { app, bindings, checkConnectivity } = setup('owner');
    const response = await post(app, bindings, 'https://attacker.example');
    expect(response.status).toBe(403);
    expect(checkConnectivity).not.toHaveBeenCalled();
  });
});
