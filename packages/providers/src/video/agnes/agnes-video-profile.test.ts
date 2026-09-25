import { describe, expect, it } from 'vitest';
import {
  AGNES_BASE_URL,
  AGNES_MODELS,
  AGNES_STATUS_BASE_URL,
  AGNES_VIDEOS_ENDPOINT,
  AGNES_VIDEO_25_FLASH_PROFILE,
  AGNES_VIDEO_25_FULL_PROFILE,
  buildAgnesPollUrl,
  buildAgnesSecureOutputDescriptor,
  normalizeAgnesError,
  validateAgnesDispatchParams,
} from './agnes-video-profile';

describe('Agnes Video Profile & Capability Suite', () => {
  it('Verifies canonical endpoint constants', () => {
    expect(AGNES_BASE_URL).toBe('https://apihub.agnes-ai.com/v1');
    expect(AGNES_VIDEOS_ENDPOINT).toBe('https://apihub.agnes-ai.com/v1/videos');
    expect(AGNES_STATUS_BASE_URL).toBe('https://apihub.agnes-ai.com/agnesapi');
  });

  it('R. Agnes polling contract strictly formats /agnesapi with video_id and model_name', () => {
    const videoId = 'video_job_998877';
    const modelId = AGNES_MODELS.FLASH;
    const pollUrl = buildAgnesPollUrl(videoId, modelId);

    // Must NOT use /v1/videos/{id}
    expect(pollUrl).not.toContain('/v1/videos/');

    // Must use /agnesapi
    expect(pollUrl.startsWith('https://apihub.agnes-ai.com/agnesapi')).toBe(true);

    const parsed = new URL(pollUrl);
    expect(parsed.searchParams.get('video_id')).toBe('video_job_998877');
    expect(parsed.searchParams.get('model_name')).toBe('agnes-video-2.5-flash');
  });

  it('M. Validates Agnes Flash 2.5 capability profile', () => {
    expect(AGNES_VIDEO_25_FLASH_PROFILE.providerId).toBe('agnes');
    expect(AGNES_VIDEO_25_FLASH_PROFILE.modelId).toBe('agnes-video-2.5-flash');
    expect(AGNES_VIDEO_25_FLASH_PROFILE.supportedResolutions).toEqual(['720P']);
    expect(AGNES_VIDEO_25_FLASH_PROFILE.maxReferenceImages).toBe(5);
    expect(AGNES_VIDEO_25_FLASH_PROFILE.maxReferenceVideos).toBe(0);
    expect(AGNES_VIDEO_25_FLASH_PROFILE.referenceVideoSupported).toBe(false);

    // Valid Flash dispatch params
    const validFlash = validateAgnesDispatchParams({
      modelId: AGNES_MODELS.FLASH,
      durationSeconds: 6,
      resolution: '720P',
      referenceImagesCount: 3,
      referenceVideoCount: 0,
      referenceAudioCount: 1,
    });
    expect(validFlash.valid).toBe(true);

    // Rejects reference video on Flash
    const flashWithVideo = validateAgnesDispatchParams({
      modelId: AGNES_MODELS.FLASH,
      durationSeconds: 6,
      referenceVideoCount: 1,
    });
    expect(flashWithVideo.valid).toBe(false);
    expect(flashWithVideo.error).toContain('supports at most 0 reference video');

    // Rejects > 5 images on Flash
    const flashTooManyImages = validateAgnesDispatchParams({
      modelId: AGNES_MODELS.FLASH,
      durationSeconds: 6,
      referenceImagesCount: 6,
    });
    expect(flashTooManyImages.valid).toBe(false);
    expect(flashTooManyImages.error).toContain('supports at most 5 reference images');
  });

  it('N. Validates Agnes Full 2.5 capability profile', () => {
    expect(AGNES_VIDEO_25_FULL_PROFILE.providerId).toBe('agnes');
    expect(AGNES_VIDEO_25_FULL_PROFILE.modelId).toBe('agnes-video-2.5');
    expect(AGNES_VIDEO_25_FULL_PROFILE.supportedResolutions).toEqual(['720P', '1080P', '1K', '2K']);
    expect(AGNES_VIDEO_25_FULL_PROFILE.maxReferenceImages).toBe(8);
    expect(AGNES_VIDEO_25_FULL_PROFILE.maxReferenceVideos).toBe(1);
    expect(AGNES_VIDEO_25_FULL_PROFILE.referenceVideoSupported).toBe(true);

    // Valid Full dispatch params
    const validFull = validateAgnesDispatchParams({
      modelId: AGNES_MODELS.FULL,
      durationSeconds: 10,
      resolution: '1080P',
      referenceImagesCount: 6,
      referenceVideoCount: 1,
      referenceAudioCount: 2,
    });
    expect(validFull.valid).toBe(true);

    // Rejects combined media > 12 on Full
    const fullTooManyCombined = validateAgnesDispatchParams({
      modelId: AGNES_MODELS.FULL,
      durationSeconds: 10,
      referenceImagesCount: 8,
      referenceVideoCount: 1,
      referenceAudioCount: 4, // 8 + 1 + 4 = 13 (> 12)
    });
    expect(fullTooManyCombined.valid).toBe(false);
    expect(fullTooManyCombined.error).toContain('at most 12 combined media files');
  });

  it('O. Rejects duration below 4 seconds', () => {
    const tooShort = validateAgnesDispatchParams({
      modelId: AGNES_MODELS.FLASH,
      durationSeconds: 3,
    });
    expect(tooShort.valid).toBe(false);
    expect(tooShort.error).toContain('integer between 4 and 12 seconds');
  });

  it('P. Rejects duration above 12 seconds', () => {
    const tooLong = validateAgnesDispatchParams({
      modelId: AGNES_MODELS.FLASH,
      durationSeconds: 13,
    });
    expect(tooLong.valid).toBe(false);
    expect(tooLong.error).toContain('integer between 4 and 12 seconds');
  });

  it('Q. Rejects invalid resolution', () => {
    // 1080P on Flash is invalid
    const flash1080p = validateAgnesDispatchParams({
      modelId: AGNES_MODELS.FLASH,
      durationSeconds: 6,
      resolution: '1080P',
    });
    expect(flash1080p.valid).toBe(false);
    expect(flash1080p.error).toContain('Resolution 1080P is not supported by model');

    // 4K on Full is invalid
    const full4k = validateAgnesDispatchParams({
      modelId: AGNES_MODELS.FULL,
      durationSeconds: 6,
      resolution: '4K',
    });
    expect(full4k.valid).toBe(false);
    expect(full4k.error).toContain('Resolution 4K is not supported by model');
  });

  it('K. Agnes video_queue_full maps to PROVIDER_CAPACITY_PRE_DISPATCH', () => {
    const rawError = {
      code: 'video_queue_full',
      message: 'Server queue is full, please retry later',
    };
    const normalized = normalizeAgnesError(rawError, {
      dispatchKnown: false,
    });

    expect(normalized.providerId).toBe('agnes');
    expect(normalized.rawCode).toBe('video_queue_full');
    expect(normalized.category).toBe('PROVIDER_CAPACITY_PRE_DISPATCH');
    expect(normalized.retryClass).toBe('SAFE_TECHNICAL_REDISPATCH');
    expect(normalized.dispatchKnown).toBe(false);
  });

  it('L. Unknown Agnes error fails closed', () => {
    const unknownError = new Error('Unexpected network anomaly');
    const normalized = normalizeAgnesError(unknownError, {
      dispatchKnown: true,
      providerJobId: 'job_unknown_123',
    });

    expect(normalized.providerId).toBe('agnes');
    expect(normalized.rawCode).toBe('unknown_provider_error');
    expect(normalized.category).toBe('PROVIDER_INTERNAL');
    expect(normalized.retryClass).toBe('FAIL_CLOSED');
    expect(normalized.dispatchKnown).toBe(true);
    expect(normalized.providerJobId).toBe('job_unknown_123');
  });

  it('SSRF Protection: Rejects unauthorized or non-HTTPS output URLs', () => {
    // Valid Agnes URL
    const validDescriptor = buildAgnesSecureOutputDescriptor({
      providerJobId: 'job_sec_1',
      rawUrl: 'https://apihub.agnes-ai.com/videos/output_123.mp4',
      declaredWidth: 768,
      declaredHeight: 1344,
      declaredDurationSeconds: 6,
    });
    expect(validDescriptor.ephemeralDownloadUrl).toBe(
      'https://apihub.agnes-ai.com/videos/output_123.mp4',
    );

    // Rejects HTTP
    expect(() =>
      buildAgnesSecureOutputDescriptor({
        providerJobId: 'job_sec_2',
        rawUrl: 'http://apihub.agnes-ai.com/videos/output.mp4',
      }),
    ).toThrow('must use HTTPS');

    // Rejects malicious / external origin
    expect(() =>
      buildAgnesSecureOutputDescriptor({
        providerJobId: 'job_sec_3',
        rawUrl: 'https://evil-host.com/payload.mp4',
      }),
    ).toThrow('Rejected unauthorized video download host');

    // Rejects local IP / SSRF attempt
    expect(() =>
      buildAgnesSecureOutputDescriptor({
        providerJobId: 'job_sec_4',
        rawUrl: 'https://169.254.169.254/latest/meta-data',
      }),
    ).toThrow('Rejected unauthorized video download host');
  });
});
