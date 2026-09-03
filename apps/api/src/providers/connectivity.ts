import {
  ProviderError,
  type ProviderConnectivityAdapter,
  type ProviderConnectivityResult,
} from '@vision-maxson/providers';

export type ConnectivityFailureCode =
  | 'diagnostic_disabled'
  | 'environment_unavailable'
  | 'provider_absent'
  | 'credential_missing'
  | 'provider_disabled'
  | 'model_unavailable'
  | 'authentication_failure'
  | 'quota_or_billing_failure'
  | 'rate_limit'
  | 'timeout'
  | 'provider_or_network_failure'
  | 'malformed_output';

type CatalogRow = {
  providerId: string;
  providerKey: string;
  providerStatus: string;
  modelKey: string | null;
  modelStatus: string | null;
  inputPrice: number | null;
  outputPrice: number | null;
  currency: string | null;
};
export type ConnectivityConfig = {
  environment: string;
  diagnosticEnabled: boolean;
  providerEnabled: boolean;
  credentialPresent: boolean;
};
export type ConnectivityResponse =
  | { ok: false; code: ConnectivityFailureCode }
  | {
      ok: true;
      providerId: string;
      providerKey: string;
      providerStatus: string;
      modelKey: string;
      providerRequestId: string | null;
      usage: ProviderConnectivityResult['usage'];
      cost: { amount: number; currency: string } | null;
      safeMetadata: ProviderConnectivityResult['safeMetadata'];
    };

const failureCode = (error: ProviderError): ConnectivityFailureCode => {
  if (error.category === 'AUTHENTICATION') return 'authentication_failure';
  if (error.category === 'RATE_LIMIT')
    return error.message === 'quota_or_billing_failure' ? 'quota_or_billing_failure' : 'rate_limit';
  if (error.category === 'TIMEOUT') return 'timeout';
  if (error.category === 'INVALID_RESPONSE' || error.category === 'SCHEMA_VALIDATION')
    return 'malformed_output';
  return 'provider_or_network_failure';
};

export class ProviderConnectivityService {
  constructor(
    private readonly db: D1Database,
    private readonly adapters: ReadonlyMap<string, ProviderConnectivityAdapter>,
  ) {}

  async check(providerId: string, config: ConnectivityConfig): Promise<ConnectivityResponse> {
    if (config.environment !== 'staging') return { ok: false, code: 'environment_unavailable' };
    if (!config.diagnosticEnabled) return { ok: false, code: 'diagnostic_disabled' };
    if (!config.providerEnabled) return { ok: false, code: 'provider_disabled' };
    if (!config.credentialPresent) return { ok: false, code: 'credential_missing' };
    const row = await this.db
      .prepare(
        "SELECT p.id AS providerId,p.key AS providerKey,p.status AS providerStatus,m.model_key AS modelKey,m.status AS modelStatus,ps.input_unit_price AS inputPrice,ps.output_unit_price AS outputPrice,ps.currency FROM ai_providers p LEFT JOIN ai_provider_models m ON m.provider_id=p.id AND m.model_key='gpt-5.6-luna' LEFT JOIN ai_pricing_snapshots ps ON ps.provider_model_id=m.id AND ps.effective_to IS NULL WHERE p.id=? LIMIT 1",
      )
      .bind(providerId)
      .first<CatalogRow>();
    if (!row) return { ok: false, code: 'provider_absent' };
    if (row.providerStatus === 'disabled') return { ok: false, code: 'provider_disabled' };
    if (!row.modelKey || row.modelStatus === 'disabled')
      return { ok: false, code: 'model_unavailable' };
    const adapter = this.adapters.get(row.providerKey);
    if (!adapter) return { ok: false, code: 'provider_absent' };
    try {
      const result = await adapter.checkConnectivity({
        modelKey: row.modelKey,
        timeoutMs: 30_000,
        maxOutputTokens: 128,
        reasoningEffort: 'none',
      });
      const billableInput =
        result.usage.inputUnits === null
          ? null
          : result.usage.inputUnits - (result.usage.cachedInputUnits ?? 0);
      const cost =
        billableInput !== null &&
        result.usage.outputUnits !== null &&
        row.inputPrice !== null &&
        row.outputPrice !== null &&
        (result.usage.cachedInputUnits ?? 0) === 0 &&
        row.currency
          ? {
              amount: billableInput * row.inputPrice + result.usage.outputUnits * row.outputPrice,
              currency: row.currency,
            }
          : null;
      return {
        ok: true,
        providerId: row.providerId,
        providerKey: row.providerKey,
        providerStatus: row.providerStatus,
        modelKey: row.modelKey,
        providerRequestId: result.providerRequestId,
        usage: result.usage,
        cost,
        safeMetadata: result.safeMetadata,
      };
    } catch (error) {
      const safe =
        error instanceof ProviderError
          ? error
          : new ProviderError('UNAVAILABLE', true, 'Provider request failed.');
      return { ok: false, code: failureCode(safe) };
    }
  }
}
