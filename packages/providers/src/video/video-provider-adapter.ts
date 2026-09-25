/**
 * Normalized Video Provider Adapter Interface and Types.
 * Strict Phase 4 provider-neutral video abstraction.
 */

export type VideoJobState =
  | 'PLANNED'
  | 'RESERVED'
  | 'DISPATCHING'
  | 'BACKOFF_WAIT'
  | 'AMBIGUOUS_DISPATCH'
  | 'POLLING'
  | 'PROVIDER_COMPLETED'
  | 'PROVIDER_FAILED'
  | 'INGESTING'
  | 'VALIDATING'
  | 'NORMALIZING'
  | 'ARCHIVING'
  | 'PERSISTED'
  | 'FAILED_CLOSED'
  | 'FAILED_TERMINAL';

export const TERMINAL_VIDEO_JOB_STATES: ReadonlySet<VideoJobState> = new Set<VideoJobState>([
  'PERSISTED',
  'FAILED_CLOSED',
  'FAILED_TERMINAL',
]);

export function isTerminalVideoJobState(state: VideoJobState): boolean {
  return TERMINAL_VIDEO_JOB_STATES.has(state);
}

export type ProviderErrorCategory =
  | 'PROVIDER_CAPACITY_PRE_DISPATCH'
  | 'RATE_LIMIT_PRE_DISPATCH'
  | 'AUTHENTICATION'
  | 'INVALID_REQUEST'
  | 'CONTENT_POLICY'
  | 'PROVIDER_INTERNAL'
  | 'TIMEOUT_PRE_DISPATCH'
  | 'AMBIGUOUS_AFTER_DISPATCH'
  | 'GENERATION_FAILED'
  | 'OUTPUT_CORRUPTED'
  | 'DOWNLOAD_FAILED';

export type RetryClassification =
  'SAFE_TECHNICAL_REDISPATCH' | 'POLL_EXISTING_JOB' | 'FAIL_CLOSED' | 'HUMAN_REVIEW_REQUIRED';

export interface NormalizedProviderError {
  readonly providerId: string;
  readonly rawCode: string;
  readonly safeMessage: string;
  readonly category: ProviderErrorCategory;
  readonly httpStatus?: number;
  readonly providerJobId?: string;
  readonly retryClass: RetryClassification;
  readonly dispatchKnown: boolean;
  readonly createdAt: string;
}

export type CapabilityEvidence = 'TESTED_BY_US' | 'DOCUMENTED_NOT_TESTED' | 'UNKNOWN';

export interface VideoProviderCapabilityProfile {
  readonly providerId: string;
  readonly modelId: string;
  readonly profileVersion: string;
  readonly supportedAspectRatios: readonly string[];
  readonly allowedDurationsSeconds: readonly number[];
  readonly supportedResolutions: readonly string[];
  readonly maxReferenceImages: number;
  readonly maxReferenceVideos: number;
  readonly maxAudioReferences: number;
  readonly textToVideo: CapabilityEvidence;
  readonly imageToVideo: CapabilityEvidence;
  readonly referenceVideoSupported: boolean;
  readonly pollingSupported: boolean;
  readonly webhookSupported: boolean;
  readonly notes?: string;
}

export interface VideoGenerationDispatchRequest {
  readonly intentId: string;
  readonly idempotencyKey: string;
  readonly modelId: string;
  readonly prompt: string;
  readonly negativePrompt?: string;
  readonly durationSeconds: number;
  readonly aspectRatio: '9:16' | '16:9' | '1:1' | '4:5';
  readonly resolution?: string;
  readonly seed?: number;
  readonly referenceImageUrls?: readonly string[];
  readonly referenceVideoUrl?: string;
  readonly referenceAudioUrls?: readonly string[];
}

export interface VideoGenerationDispatchResult {
  readonly providerJobId: string;
  readonly providerRequestId?: string;
  readonly status: 'QUEUED' | 'PROCESSING' | 'FAILED' | 'COMPLETED';
  readonly estimatedCostMicroUsd: number;
  readonly dispatchedAt: string;
  readonly rawResponse?: Record<string, unknown>;
}

export interface VideoGenerationPollRequest {
  readonly providerJobId: string;
  readonly modelId: string;
}

export interface ProviderVideoOutputDescriptor {
  readonly providerId: string;
  readonly providerJobId: string;
  readonly ephemeralDownloadUrl: string;
  readonly declaredWidth?: number;
  readonly declaredHeight?: number;
  readonly declaredDurationSeconds?: number;
  readonly expiresAt?: string;
}

export interface VideoGenerationPollResult {
  readonly providerJobId: string;
  readonly status: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  readonly progressPercentage?: number;
  readonly output?: ProviderVideoOutputDescriptor;
  readonly error?: NormalizedProviderError;
  readonly actualCostMicroUsd?: number;
  readonly polledAt: string;
}

/**
 * Normalized Video Provider Adapter Interface.
 * Implementations must NOT expose arbitrary URL download functions.
 */
export interface VideoProviderAdapter {
  readonly providerId: string;
  getCapabilityProfile(modelId: string): VideoProviderCapabilityProfile;
  dispatchGeneration(
    request: VideoGenerationDispatchRequest,
  ): Promise<VideoGenerationDispatchResult>;
  pollGeneration(request: VideoGenerationPollRequest): Promise<VideoGenerationPollResult>;
  cancelGeneration?(
    providerJobId: string,
  ): Promise<{ readonly cancelled: boolean; readonly rawStatus?: string }>;
  normalizeError(
    rawError: unknown,
    context: { readonly dispatchKnown: boolean; readonly providerJobId?: string },
  ): NormalizedProviderError;
  buildSecureOutputDescriptor(payload: {
    readonly providerJobId: string;
    readonly rawUrl: string;
    readonly declaredWidth?: number;
    readonly declaredHeight?: number;
    readonly declaredDurationSeconds?: number;
    readonly expiresAt?: string;
  }): ProviderVideoOutputDescriptor;
}
