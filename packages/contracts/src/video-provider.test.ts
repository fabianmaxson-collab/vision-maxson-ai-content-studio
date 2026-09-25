import { describe, expect, it } from 'vitest';
import {
  isTerminalVideoJobState,
  normalizedProviderErrorSchema,
  providerErrorCategorySchema,
  providerVideoOutputDescriptorSchema,
  retryClassificationSchema,
  videoGenerationPollResultSchema,
  videoJobStateSchema,
  type NormalizedProviderError,
  type VideoJobState,
} from './video-provider';

describe('Video Provider Contracts', () => {
  it('H. Validates all 15 canonical video job states', () => {
    const states: VideoJobState[] = [
      'PLANNED',
      'RESERVED',
      'DISPATCHING',
      'BACKOFF_WAIT',
      'AMBIGUOUS_DISPATCH',
      'POLLING',
      'PROVIDER_COMPLETED',
      'PROVIDER_FAILED',
      'INGESTING',
      'VALIDATING',
      'NORMALIZING',
      'ARCHIVING',
      'PERSISTED',
      'FAILED_CLOSED',
      'FAILED_TERMINAL',
    ];

    for (const state of states) {
      expect(videoJobStateSchema.safeParse(state).success).toBe(true);
    }

    expect(videoJobStateSchema.safeParse('INVALID_STATE').success).toBe(false);
  });

  it('I. Accurately classifies terminal vs non-terminal video job states', () => {
    expect(isTerminalVideoJobState('PERSISTED')).toBe(true);
    expect(isTerminalVideoJobState('FAILED_CLOSED')).toBe(true);
    expect(isTerminalVideoJobState('FAILED_TERMINAL')).toBe(true);

    expect(isTerminalVideoJobState('PLANNED')).toBe(false);
    expect(isTerminalVideoJobState('RESERVED')).toBe(false);
    expect(isTerminalVideoJobState('DISPATCHING')).toBe(false);
    expect(isTerminalVideoJobState('BACKOFF_WAIT')).toBe(false);
    expect(isTerminalVideoJobState('AMBIGUOUS_DISPATCH')).toBe(false);
    expect(isTerminalVideoJobState('POLLING')).toBe(false);
    expect(isTerminalVideoJobState('PROVIDER_COMPLETED')).toBe(false);
    expect(isTerminalVideoJobState('PROVIDER_FAILED')).toBe(false);
    expect(isTerminalVideoJobState('INGESTING')).toBe(false);
    expect(isTerminalVideoJobState('VALIDATING')).toBe(false);
    expect(isTerminalVideoJobState('NORMALIZING')).toBe(false);
    expect(isTerminalVideoJobState('ARCHIVING')).toBe(false);
  });

  it('J. Error taxonomy enforces valid categories, retry classifications and structured errors', () => {
    const error: NormalizedProviderError = {
      providerId: 'agnes',
      rawCode: 'video_queue_full',
      safeMessage:
        'Agnes video generation queue is currently saturated. Temporary provider capacity issue.',
      category: 'PROVIDER_CAPACITY_PRE_DISPATCH',
      retryClass: 'SAFE_TECHNICAL_REDISPATCH',
      dispatchKnown: false,
      createdAt: '2026-09-25T16:30:00.000Z',
    };

    const parsed = normalizedProviderErrorSchema.safeParse(error);
    expect(parsed.success).toBe(true);

    // Verify category enum
    expect(providerErrorCategorySchema.safeParse('PROVIDER_CAPACITY_PRE_DISPATCH').success).toBe(
      true,
    );
    expect(providerErrorCategorySchema.safeParse('INVALID_REQUEST').success).toBe(true);
    expect(providerErrorCategorySchema.safeParse('UNKNOWN_CATEGORY').success).toBe(false);

    // Verify retry classification enum
    expect(retryClassificationSchema.safeParse('SAFE_TECHNICAL_REDISPATCH').success).toBe(true);
    expect(retryClassificationSchema.safeParse('FAIL_CLOSED').success).toBe(true);
    expect(retryClassificationSchema.safeParse('CREATIVE_RETRY').success).toBe(false);
  });

  it('Enforces output requirement on COMPLETED poll results', () => {
    const completedWithoutOutput = {
      providerJobId: 'job_123',
      status: 'COMPLETED' as const,
      polledAt: '2026-09-25T16:30:00.000Z',
    };
    expect(videoGenerationPollResultSchema.safeParse(completedWithoutOutput).success).toBe(false);

    const completedWithOutput = {
      ...completedWithoutOutput,
      output: {
        providerId: 'agnes',
        providerJobId: 'job_123',
        ephemeralDownloadUrl: 'https://apihub.agnes-ai.com/videos/output.mp4',
        declaredWidth: 768,
        declaredHeight: 1344,
        declaredDurationSeconds: 6,
      },
    };
    expect(videoGenerationPollResultSchema.safeParse(completedWithOutput).success).toBe(true);
  });

  it('Enforces error requirement on FAILED poll results', () => {
    const failedWithoutError = {
      providerJobId: 'job_123',
      status: 'FAILED' as const,
      polledAt: '2026-09-25T16:30:00.000Z',
    };
    expect(videoGenerationPollResultSchema.safeParse(failedWithoutError).success).toBe(false);

    const failedWithError = {
      ...failedWithoutError,
      error: {
        providerId: 'agnes',
        rawCode: 'render_error',
        safeMessage: 'Model failed to generate video frames.',
        category: 'GENERATION_FAILED' as const,
        retryClass: 'FAIL_CLOSED' as const,
        dispatchKnown: true,
        createdAt: '2026-09-25T16:30:00.000Z',
      },
    };
    expect(videoGenerationPollResultSchema.safeParse(failedWithError).success).toBe(true);
  });

  it('Validates ProviderVideoOutputDescriptor', () => {
    const descriptor = {
      providerId: 'agnes',
      providerJobId: 'job_abc',
      ephemeralDownloadUrl: 'https://apihub.agnes-ai.com/cdn/render.mp4',
      declaredWidth: 1080,
      declaredHeight: 1920,
      declaredDurationSeconds: 6,
    };
    expect(providerVideoOutputDescriptorSchema.safeParse(descriptor).success).toBe(true);
  });
});
