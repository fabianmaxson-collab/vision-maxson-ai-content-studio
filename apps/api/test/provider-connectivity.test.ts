import { describe, expect, it, vi } from 'vitest';
import {
  ProviderError,
  type ProviderConnectivityAdapter,
  type ProviderConnectivityResult,
} from '@vision-maxson/providers';
import {
  ProviderConnectivityService,
  type ConnectivityConfig,
} from '../src/providers/connectivity';

const baseConfig: ConnectivityConfig = {
  environment: 'staging',
  diagnosticEnabled: true,
  providerEnabled: true,
  credentialPresent: true,
};
const catalog = {
  providerId: 'provider_openai',
  providerKey: 'openai',
  providerStatus: 'inactive',
  modelKey: 'gpt-5.6-luna',
  modelStatus: 'inactive',
  inputPrice: 0.0000002,
  outputPrice: 0.0000012,
  currency: 'USD',
};
const usage = {
  inputUnits: 10,
  outputUnits: 3,
  cachedInputUnits: 0,
  reasoningOutputUnits: 0,
  unitName: 'token',
};
type FixtureRow = Omit<typeof catalog, 'modelKey'> & { modelKey: string | null };
function fixture(row: FixtureRow | null = catalog, outcome?: ProviderConnectivityResult | Error) {
  const first = vi.fn().mockResolvedValue(row);
  const db = {
    prepare: vi.fn(() => ({ bind: vi.fn(() => ({ first })) })),
  } as unknown as D1Database;
  const checkConnectivity =
    outcome instanceof Error
      ? vi.fn().mockRejectedValue(outcome)
      : vi.fn().mockResolvedValue(
          outcome ?? {
            ok: true,
            providerRequestId: 'response_safe',
            usage,
            safeMetadata: { servedModel: 'gpt-5.6-luna' },
          },
        );
  const adapter = { providerKey: 'openai', checkConnectivity } as ProviderConnectivityAdapter;
  return {
    service: new ProviderConnectivityService(db, new Map([['openai', adapter]])),
    checkConnectivity,
  };
}

describe('provider connectivity service', () => {
  it.each([
    [{ ...baseConfig, environment: 'production' }, 'environment_unavailable'],
    [{ ...baseConfig, diagnosticEnabled: false }, 'diagnostic_disabled'],
    [{ ...baseConfig, providerEnabled: false }, 'provider_disabled'],
    [{ ...baseConfig, credentialPresent: false }, 'credential_missing'],
  ] as const)('rejects unsafe configuration', async (config, code) => {
    await expect(fixture().service.check('provider_openai', config)).resolves.toEqual({
      ok: false,
      code,
    });
  });

  it('reports absent, disabled and unavailable catalog states without calling an adapter', async () => {
    await expect(fixture(null).service.check('missing', baseConfig)).resolves.toEqual({
      ok: false,
      code: 'provider_absent',
    });
    await expect(
      fixture({ ...catalog, providerStatus: 'disabled' }).service.check(
        'provider_openai',
        baseConfig,
      ),
    ).resolves.toEqual({ ok: false, code: 'provider_disabled' });
    await expect(
      fixture({ ...catalog, modelKey: null }).service.check('provider_openai', baseConfig),
    ).resolves.toEqual({ ok: false, code: 'model_unavailable' });
  });

  it('uses Luna once, accepts inactive catalog state, and calculates only real usage cost', async () => {
    const { service, checkConnectivity } = fixture();
    const result = await service.check('provider_openai', baseConfig);
    expect(result).toMatchObject({
      ok: true,
      providerStatus: 'inactive',
      modelKey: 'gpt-5.6-luna',
      usage,
      cost: { currency: 'USD' },
    });
    expect(result.ok && result.cost?.amount).toBeCloseTo(0.0000056);
    expect(checkConnectivity).toHaveBeenCalledOnce();
    expect(checkConnectivity).toHaveBeenCalledWith({
      modelKey: 'gpt-5.6-luna',
      timeoutMs: 30_000,
      maxOutputTokens: 128,
      reasoningEffort: 'none',
    });
  });

  it.each([
    [new ProviderError('AUTHENTICATION', false, 'unsafe secret'), 'authentication_failure'],
    [
      new ProviderError('RATE_LIMIT', false, 'quota_or_billing_failure'),
      'quota_or_billing_failure',
    ],
    [new ProviderError('RATE_LIMIT', true, 'safe'), 'rate_limit'],
    [new ProviderError('TIMEOUT', true, 'safe'), 'timeout'],
    [new ProviderError('INVALID_RESPONSE', false, 'unsafe response'), 'malformed_output'],
    [new Error('network details'), 'provider_or_network_failure'],
  ] as const)('maps provider failures to redacted diagnostics', async (error, code) => {
    const result = await fixture(catalog, error).service.check('provider_openai', baseConfig);
    expect(result).toEqual({ ok: false, code });
    if (error.message !== code) expect(JSON.stringify(result)).not.toContain(error.message);
  });
});
