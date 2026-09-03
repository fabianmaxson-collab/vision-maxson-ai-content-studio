import OpenAI from 'openai';
import {
  type AIExecutionRequest,
  type AIProviderAdapter,
  type ProviderConnectivityAdapter,
  type ProviderConnectivityRequest,
  type ProviderConnectivityResult,
  type ModelCapability,
  ProviderError,
  type ProviderExecutionResult,
} from './index';

type ResponsesClient = Pick<OpenAI, 'responses'>;
const capabilities: readonly ModelCapability[] = [
  'STRUCTURED_OUTPUT',
  'MULTILINGUAL_TEXT',
  'RESEARCH_SYNTHESIS',
  'SCRIPT_GENERATION',
  'CRITIQUE',
  'TRANSLATION',
  'STORYBOARD_PLANNING',
];
export function mapOpenAIError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  const value = error as { status?: number; name?: string; code?: string };
  const safe = 'OpenAI request failed.';
  if (value.name === 'AbortError' || value.name === 'APITimeoutError')
    return new ProviderError('TIMEOUT', true, safe);
  if (value.status === 429)
    return new ProviderError(
      'RATE_LIMIT',
      value.code !== 'insufficient_quota',
      value.code === 'insufficient_quota' ? 'quota_or_billing_failure' : safe,
    );
  if (value.status === 401 || value.status === 403)
    return new ProviderError('AUTHENTICATION', false, safe);
  if (value.status === 404) return new ProviderError('UNAVAILABLE', false, safe);
  if (value.status && value.status >= 500) return new ProviderError('UNAVAILABLE', true, safe);
  if (value.code === 'content_filter') return new ProviderError('SAFETY_REFUSAL', false, safe);
  return new ProviderError('PERMANENT', false, safe);
}
export class OpenAIResponsesAdapter implements AIProviderAdapter, ProviderConnectivityAdapter {
  readonly providerKey = 'openai';
  private readonly client: ResponsesClient;
  constructor(apiKey: string, baseURL = 'https://api.openai.com/v1', client?: ResponsesClient) {
    this.client = client ?? new OpenAI({ apiKey, baseURL, maxRetries: 0, timeout: 60_000, fetch });
  }
  capabilities() {
    return Promise.resolve(capabilities);
  }
  health() {
    return Promise.resolve<'available'>('available');
  }
  async checkConnectivity(
    request: ProviderConnectivityRequest,
  ): Promise<ProviderConnectivityResult> {
    const result = await this.execute<Record<string, never>, { ok: boolean }>({
      runId: 'connectivity-check',
      taskType: 'PROVIDER_CONNECTIVITY',
      modelKey: request.modelKey,
      promptVersionId: 'connectivity-v1',
      input: {},
      instructions: 'Return the requested connectivity result.',
      outputSchema: {
        type: 'object',
        properties: { ok: { type: 'boolean', const: true } },
        required: ['ok'],
        additionalProperties: false,
      },
      outputSchemaName: 'provider_connectivity',
      idempotencyKey: 'connectivity-check',
      timeoutMs: request.timeoutMs,
      maxOutputTokens: request.maxOutputTokens,
      reasoningEffort: request.reasoningEffort,
    });
    if (result.output.ok !== true)
      throw new ProviderError('INVALID_RESPONSE', false, 'Provider returned an invalid result.');
    return {
      ok: true,
      providerRequestId: result.providerRequestId,
      usage: result.usage,
      safeMetadata: result.safeMetadata,
    };
  }
  async execute<TInput, TOutput>(
    request: AIExecutionRequest<TInput>,
  ): Promise<ProviderExecutionResult<TOutput>> {
    try {
      const response = await this.client.responses.create(
        {
          model: request.modelKey,
          store: false,
          instructions: request.instructions,
          input: JSON.stringify(request.input),
          max_output_tokens: request.maxOutputTokens,
          reasoning: { effort: request.reasoningEffort },
          text: {
            format: {
              type: 'json_schema',
              name: request.outputSchemaName,
              schema: request.outputSchema,
              strict: true,
            },
          },
        },
        { timeout: request.timeoutMs, maxRetries: 0 },
      );
      if (response.status === 'incomplete')
        throw new ProviderError('INVALID_RESPONSE', true, 'Provider response was incomplete.');
      if (response.status !== 'completed' || !response.output_text)
        throw new ProviderError('SAFETY_REFUSAL', false, 'Provider did not return usable output.');
      let output: TOutput;
      try {
        output = JSON.parse(response.output_text) as TOutput;
      } catch {
        throw new ProviderError('INVALID_RESPONSE', false, 'Provider returned malformed JSON.');
      }
      return {
        output,
        providerRequestId: response.id ?? null,
        usage: {
          inputUnits: response.usage?.input_tokens ?? null,
          outputUnits: response.usage?.output_tokens ?? null,
          cachedInputUnits: response.usage?.input_tokens_details?.cached_tokens ?? null,
          reasoningOutputUnits: response.usage?.output_tokens_details?.reasoning_tokens ?? null,
          unitName: response.usage ? 'token' : null,
        },
        safeMetadata: { responseStatus: response.status, servedModel: response.model },
      };
    } catch (error) {
      throw mapOpenAIError(error);
    }
  }
}
