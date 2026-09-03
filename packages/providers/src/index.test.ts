import { describe, expect, it, vi } from 'vitest';
import {
  AIExecutionGateway,
  ProviderError,
  ProviderNotConfiguredError,
  routeModel,
  type AIProviderAdapter,
  type ModelCandidate,
} from './index';

const candidates: ModelCandidate[] = [
  {
    providerKey: 'openai',
    modelKey: 'balanced',
    status: 'available',
    capabilities: ['STRUCTURED_OUTPUT'],
    qualityTier: 'BALANCED',
    costRank: 2,
  },
  {
    providerKey: 'future',
    modelKey: 'economy',
    status: 'available',
    capabilities: ['STRUCTURED_OUTPUT'],
    qualityTier: 'ECONOMY',
    costRank: 1,
  },
];
const routing = {
  requiredCapabilities: ['STRUCTURED_OUTPUT'] as const,
  minimumQualityTier: 'ECONOMY' as const,
};
describe('provider-neutral foundation', () => {
  it('represents provider-not-configured without provider dependencies', () => {
    const error = new ProviderNotConfiguredError();
    expect(error.category).toBe('AUTHENTICATION');
    expect(error.retryable).toBe(false);
  });
  it('routes AUTO by capability and quality without a permanent provider assignment', () => {
    expect(routeModel(candidates, { ...routing, mode: 'AUTO' }).modelKey).toBe('balanced');
  });
  it('honors PREFER and refuses an unavailable LOCKED selection', () => {
    expect(
      routeModel(candidates, {
        ...routing,
        mode: 'PREFER',
        preferredProviderKey: 'future',
        preferredModelKey: 'economy',
      }).providerKey,
    ).toBe('future');
    expect(() =>
      routeModel(candidates, {
        ...routing,
        mode: 'LOCKED',
        preferredProviderKey: 'missing',
        preferredModelKey: 'missing',
      }),
    ).toThrow('Locked');
  });
  it('retries technical failures in one run and emits separate attempts', async () => {
    const execute = vi
      .fn()
      .mockRejectedValueOnce(new ProviderError('RATE_LIMIT', true, 'safe'))
      .mockResolvedValue({
        output: { ok: true },
        providerRequestId: 'req_safe',
        usage: {
          inputUnits: 1,
          outputUnits: 1,
          cachedInputUnits: 0,
          reasoningOutputUnits: 0,
          unitName: 'token',
        },
        safeMetadata: {},
      });
    const adapter = {
      providerKey: 'openai',
      capabilities: vi.fn(),
      health: vi.fn(),
      execute,
    } as unknown as AIProviderAdapter;
    const observer = {
      started: vi.fn().mockResolvedValue(undefined),
      succeeded: vi.fn().mockResolvedValue(undefined),
      failed: vi.fn().mockResolvedValue(undefined),
    };
    const result = await new AIExecutionGateway(new Map([['openai', adapter]])).execute({
      request: {
        runId: 'run_1',
        taskType: 'TEST',
        modelKey: 'balanced',
        promptVersionId: 'prompt_1',
        input: {},
        instructions: 'safe',
        outputSchema: {},
        outputSchemaName: 'safe',
        idempotencyKey: 'idem',
        timeoutMs: 100,
        maxOutputTokens: 10,
        reasoningEffort: 'none',
      },
      candidate: candidates[0]!,
      maximumAttempts: 2,
      observer,
    });
    expect(result.output).toEqual({ ok: true });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(observer.started).toHaveBeenCalledTimes(2);
  });
});
