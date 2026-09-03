import { describe, expect, it, vi } from 'vitest';
import { ProviderError } from './index';
import { mapOpenAIError, OpenAIResponsesAdapter } from './openai';
const request = {
  runId: 'run_1',
  taskType: 'TOPIC_RESEARCH',
  modelKey: 'gpt-test',
  promptVersionId: 'prompt_1',
  input: { private: 'not-logged' },
  instructions: 'instructions',
  outputSchema: { type: 'object' },
  outputSchemaName: 'research',
  idempotencyKey: 'idem',
  timeoutMs: 1000,
  maxOutputTokens: 100,
  reasoningEffort: 'none' as const,
};
describe('OpenAI Responses adapter', () => {
  it('uses store false, structured output and normalizes usage', async () => {
    const create = vi.fn().mockResolvedValue({
      id: 'resp_1',
      status: 'completed',
      output_text: '{"ok":true}',
      model: 'served',
      usage: {
        input_tokens: 10,
        output_tokens: 4,
        input_tokens_details: { cached_tokens: 3 },
        output_tokens_details: { reasoning_tokens: 2 },
      },
    });
    const adapter = new OpenAIResponsesAdapter('unused-test-key', undefined, {
      responses: { create },
    } as never);
    const result = await adapter.execute(request);
    expect(create.mock.calls[0]![0]).toMatchObject({
      store: false,
      model: 'gpt-test',
      text: { format: { type: 'json_schema', strict: true } },
    });
    expect(result.usage).toMatchObject({
      inputUnits: 10,
      outputUnits: 4,
      cachedInputUnits: 3,
      reasoningOutputUnits: 2,
    });
  });
  it('rejects malformed and incomplete responses', async () => {
    for (const response of [
      { id: 'r', status: 'completed', output_text: 'not-json' },
      { id: 'r', status: 'incomplete', output_text: '' },
    ]) {
      const adapter = new OpenAIResponsesAdapter('unused-test-key', undefined, {
        responses: { create: vi.fn().mockResolvedValue(response) },
      } as never);
      await expect(adapter.execute(request)).rejects.toBeInstanceOf(ProviderError);
    }
  });
  it('maps timeout, 429, 5xx and authentication without leaking provider details', () => {
    expect(mapOpenAIError({ name: 'APITimeoutError', message: 'secret' }).category).toBe('TIMEOUT');
    expect(mapOpenAIError({ status: 429 }).category).toBe('RATE_LIMIT');
    expect(mapOpenAIError({ status: 503 }).retryable).toBe(true);
    expect(mapOpenAIError({ status: 401 }).retryable).toBe(false);
    expect(mapOpenAIError({ status: 401, message: 'sk-secret' }).message).not.toContain(
      'sk-secret',
    );
  });
});
