import type {
  NormalizedProviderError,
  ProviderVideoOutputDescriptor,
  VideoProviderCapabilityProfile,
} from '../video-provider-adapter';

export const AGNES_PROVIDER_ID = 'agnes';
export const AGNES_BASE_URL = 'https://apihub.agnes-ai.com/v1';
export const AGNES_VIDEOS_ENDPOINT = 'https://apihub.agnes-ai.com/v1/videos';
export const AGNES_STATUS_BASE_URL = 'https://apihub.agnes-ai.com/agnesapi';

export const AGNES_MODELS = {
  FLASH: 'agnes-video-2.5-flash',
  FULL: 'agnes-video-2.5',
} as const;

export type AgnesModelId = (typeof AGNES_MODELS)[keyof typeof AGNES_MODELS];

export const AGNES_VIDEO_25_FLASH_PROFILE: VideoProviderCapabilityProfile = {
  providerId: AGNES_PROVIDER_ID,
  modelId: AGNES_MODELS.FLASH,
  profileVersion: '2026-09-agnes-flash-v1',
  supportedAspectRatios: ['9:16', '16:9', '1:1'],
  allowedDurationsSeconds: [4, 5, 6, 7, 8, 9, 10, 11, 12],
  supportedResolutions: ['720P'],
  maxReferenceImages: 5,
  maxReferenceVideos: 0,
  maxAudioReferences: 3,
  textToVideo: 'DOCUMENTED_NOT_TESTED',
  imageToVideo: 'DOCUMENTED_NOT_TESTED',
  referenceVideoSupported: false,
  pollingSupported: true,
  webhookSupported: false,
  notes:
    '720P target. Desktop AgnesCode observed output for 9:16 was 768x1344. Reference video unsupported. Duration passed as string "4"-"12".',
};

export const AGNES_VIDEO_25_FULL_PROFILE: VideoProviderCapabilityProfile = {
  providerId: AGNES_PROVIDER_ID,
  modelId: AGNES_MODELS.FULL,
  profileVersion: '2026-09-agnes-full-v1',
  supportedAspectRatios: ['9:16', '16:9', '1:1'],
  allowedDurationsSeconds: [4, 5, 6, 7, 8, 9, 10, 11, 12],
  supportedResolutions: ['720P', '1080P', '1K', '2K'],
  maxReferenceImages: 8,
  maxReferenceVideos: 1,
  maxAudioReferences: 3,
  textToVideo: 'DOCUMENTED_NOT_TESTED',
  imageToVideo: 'DOCUMENTED_NOT_TESTED',
  referenceVideoSupported: true,
  pollingSupported: true,
  webhookSupported: false,
  notes:
    'Supports up to 2K resolution, 1 video reference, 8 images, 3 audio tracks, <= 12 combined media files.',
};

/**
 * Builds canonical Agnes polling URL with video_id and model_name query parameters.
 * Explicitly avoids incorrect GET /v1/videos/{id} pattern.
 */
export function buildAgnesPollUrl(videoId: string, modelId: string): string {
  if (!videoId || !videoId.trim()) {
    throw new Error('Agnes videoId is required for polling');
  }
  if (!modelId || !modelId.trim()) {
    throw new Error('Agnes modelId is required for polling');
  }
  const params = new URLSearchParams({
    video_id: videoId.trim(),
    model_name: modelId.trim(),
  });
  return `${AGNES_STATUS_BASE_URL}?${params.toString()}`;
}

export interface AgnesValidationParams {
  readonly modelId: string;
  readonly durationSeconds: number;
  readonly resolution?: string;
  readonly referenceImagesCount?: number;
  readonly referenceVideoCount?: number;
  readonly referenceAudioCount?: number;
}

/**
 * Validates generation parameters against known Agnes capabilities.
 */
export function validateAgnesDispatchParams(params: AgnesValidationParams): {
  readonly valid: boolean;
  readonly error?: string;
} {
  const {
    modelId,
    durationSeconds,
    resolution,
    referenceImagesCount = 0,
    referenceVideoCount = 0,
    referenceAudioCount = 0,
  } = params;

  if (modelId !== AGNES_MODELS.FLASH && modelId !== AGNES_MODELS.FULL) {
    return {
      valid: false,
      error: `Unsupported Agnes model: ${modelId}. Allowed models: ${Object.values(AGNES_MODELS).join(', ')}`,
    };
  }

  if (!Number.isInteger(durationSeconds) || durationSeconds < 4 || durationSeconds > 12) {
    return {
      valid: false,
      error: `Agnes duration must be an integer between 4 and 12 seconds. Received: ${durationSeconds}`,
    };
  }

  const profile =
    modelId === AGNES_MODELS.FLASH ? AGNES_VIDEO_25_FLASH_PROFILE : AGNES_VIDEO_25_FULL_PROFILE;

  if (resolution && !profile.supportedResolutions.includes(resolution)) {
    return {
      valid: false,
      error: `Resolution ${resolution} is not supported by model ${modelId}. Supported: ${profile.supportedResolutions.join(', ')}`,
    };
  }

  if (modelId === AGNES_MODELS.FULL) {
    const combined = referenceImagesCount + referenceVideoCount + referenceAudioCount;
    if (combined > 12) {
      return {
        valid: false,
        error: `Agnes 2.5 full supports at most 12 combined media files. Received: ${combined}`,
      };
    }
  }

  if (referenceImagesCount > profile.maxReferenceImages) {
    return {
      valid: false,
      error: `Model ${modelId} supports at most ${profile.maxReferenceImages} reference images. Received: ${referenceImagesCount}`,
    };
  }

  if (referenceVideoCount > profile.maxReferenceVideos) {
    return {
      valid: false,
      error: `Model ${modelId} supports at most ${profile.maxReferenceVideos} reference video. Received: ${referenceVideoCount}`,
    };
  }

  if (referenceAudioCount > profile.maxAudioReferences) {
    return {
      valid: false,
      error: `Model ${modelId} supports at most ${profile.maxAudioReferences} reference audio files. Received: ${referenceAudioCount}`,
    };
  }

  return { valid: true };
}

/**
 * Normalizes raw Agnes errors into canonical taxonomy.
 * Pure mapping logic - no side effects.
 */
export function normalizeAgnesError(
  rawError: unknown,
  context: { readonly dispatchKnown: boolean; readonly providerJobId?: string },
): NormalizedProviderError {
  const now = new Date().toISOString();
  const rawString =
    typeof rawError === 'string'
      ? rawError
      : rawError && typeof rawError === 'object'
        ? JSON.stringify(rawError)
        : String(rawError);

  // Exact matching for observed capacity error
  if (
    rawString.includes('video_queue_full') ||
    rawString.includes('queue_full') ||
    rawString.includes('server_busy')
  ) {
    return {
      providerId: AGNES_PROVIDER_ID,
      rawCode: 'video_queue_full',
      safeMessage:
        'Agnes video generation queue is currently saturated. Temporary provider capacity issue.',
      category: 'PROVIDER_CAPACITY_PRE_DISPATCH',
      retryClass: 'SAFE_TECHNICAL_REDISPATCH',
      dispatchKnown: false,
      createdAt: now,
      ...(context.providerJobId ? { providerJobId: context.providerJobId } : {}),
    };
  }

  if (rawString.includes('rate_limit') || rawString.includes('429')) {
    return {
      providerId: AGNES_PROVIDER_ID,
      rawCode: 'rate_limit_exceeded',
      safeMessage: 'Agnes API rate limit exceeded.',
      category: 'RATE_LIMIT_PRE_DISPATCH',
      retryClass: 'SAFE_TECHNICAL_REDISPATCH',
      dispatchKnown: context.dispatchKnown,
      createdAt: now,
      ...(context.providerJobId ? { providerJobId: context.providerJobId } : {}),
    };
  }

  if (
    rawString.includes('unauthorized') ||
    rawString.includes('invalid_api_key') ||
    rawString.includes('401')
  ) {
    return {
      providerId: AGNES_PROVIDER_ID,
      rawCode: 'authentication_failed',
      safeMessage: 'Agnes authentication failed. Verify API key credentials.',
      category: 'AUTHENTICATION',
      retryClass: 'FAIL_CLOSED',
      dispatchKnown: false,
      createdAt: now,
    };
  }

  if (rawString.includes('content_filter') || rawString.includes('safety')) {
    return {
      providerId: AGNES_PROVIDER_ID,
      rawCode: 'content_policy_violation',
      safeMessage: 'Generation prompt or reference rejected by content policy.',
      category: 'CONTENT_POLICY',
      retryClass: 'HUMAN_REVIEW_REQUIRED',
      dispatchKnown: context.dispatchKnown,
      createdAt: now,
      ...(context.providerJobId ? { providerJobId: context.providerJobId } : {}),
    };
  }

  // Conservative fallback: Unknown error fails closed
  return {
    providerId: AGNES_PROVIDER_ID,
    rawCode: 'unknown_provider_error',
    safeMessage: 'An unknown Agnes provider error occurred. Failing closed.',
    category: 'PROVIDER_INTERNAL',
    retryClass: 'FAIL_CLOSED',
    dispatchKnown: context.dispatchKnown,
    createdAt: now,
    ...(context.providerJobId ? { providerJobId: context.providerJobId } : {}),
  };
}

/**
 * Validates and constructs a secure provider video output descriptor.
 * Rejects non-HTTPS or non-Agnes origins to protect against SSRF.
 */
export function buildAgnesSecureOutputDescriptor(payload: {
  readonly providerJobId: string;
  readonly rawUrl: string;
  readonly declaredWidth?: number;
  readonly declaredHeight?: number;
  readonly declaredDurationSeconds?: number;
  readonly expiresAt?: string;
}): ProviderVideoOutputDescriptor {
  const parsed = new URL(payload.rawUrl);
  if (parsed.protocol !== 'https:') {
    throw new Error('Agnes output URL must use HTTPS');
  }

  // Allow only Agnes domains
  const host = parsed.hostname.toLowerCase();
  const isAllowedHost =
    host === 'apihub.agnes-ai.com' || host === 'agnes-ai.com' || host.endsWith('.agnes-ai.com');

  if (!isAllowedHost) {
    throw new Error(`Rejected unauthorized video download host: ${host}`);
  }

  return {
    providerId: AGNES_PROVIDER_ID,
    providerJobId: payload.providerJobId,
    ephemeralDownloadUrl: payload.rawUrl,
    ...(payload.declaredWidth ? { declaredWidth: payload.declaredWidth } : {}),
    ...(payload.declaredHeight ? { declaredHeight: payload.declaredHeight } : {}),
    ...(payload.declaredDurationSeconds
      ? { declaredDurationSeconds: payload.declaredDurationSeconds }
      : {}),
    ...(payload.expiresAt ? { expiresAt: payload.expiresAt } : {}),
  };
}
