import { describe, expect, it } from 'vitest';
import {
  mediaAssetSchema,
  mediaInspectionResultSchema,
  type MediaAsset,
  type MediaInspectionResult,
} from './media-asset';

describe('MediaAsset Contract', () => {
  const validAsset: MediaAsset = {
    id: 'asset_video_scene_1_raw_take_1',
    projectId: 'project_2135b883-8499-48e9-a4a7-bb04b970d72a',
    sceneId: 'scene-01',
    assetType: 'VIDEO_CLIP',
    providerId: 'agnes',
    providerModelId: 'agnes-video-2.5-flash',
    providerRequestId: 'agnes_req_d8e7c6b5a4',
    promptHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    generationParameters: {
      durationSeconds: 6,
      aspectRatio: '9:16',
      model: 'agnes-video-2.5-flash',
    },
    sourceAssetIds: [],
    fileHashSha256: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90',
    mimeType: 'video/mp4',
    fileSizeBytes: 4820150,
    width: 768,
    height: 1344,
    fps: 24,
    durationSeconds: 6,
    videoCodec: 'h264',
    audioCodec: 'aac',
    storageState: 'TRANSIENT_OPERATIONAL',
    r2Key: 'projects/p1/scenes/s1/assets/a1/raw_output.mp4',
    driveFileId: 'drive_file_1A2B3C4D5E6F',
    publishability: 'INTERNAL_ONLY',
    watermarkDetected: false,
    qaStatus: 'WARNING_NORMALIZABLE',
    approvalStatus: 'PENDING',
    estimatedCostMicroUsd: 60000,
    actualCostMicroUsd: 60000,
    createdAt: '2026-09-25T16:30:00.000Z',
  };

  it('A. MediaAsset validates private-by-default structure with durable r2Key and driveFileId', () => {
    const parsed = mediaAssetSchema.safeParse(validAsset);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.r2Key).toBe('projects/p1/scenes/s1/assets/a1/raw_output.mp4');
    expect(parsed.data?.driveFileId).toBe('drive_file_1A2B3C4D5E6F');
  });

  it('B. MediaAsset strictly rejects providerEphemeralUrl (transient state only)', () => {
    const assetWithEphemeralUrl = {
      ...validAsset,
      providerEphemeralUrl: 'https://apihub.agnes-ai.com/cdn/videos/temp_output_789456.mp4',
    };
    const parsed = mediaAssetSchema.safeParse(assetWithEphemeralUrl);
    expect(parsed.success).toBe(false);
  });

  it('C. MediaAsset strictly forbids permanent publicDownloadUrl', () => {
    const assetWithPublicUrl = {
      ...validAsset,
      publicDownloadUrl: 'https://cdn.vision.directormaxson.com/public/video.mp4',
    };
    const parsed = mediaAssetSchema.safeParse(assetWithPublicUrl);
    expect(parsed.success).toBe(false);
  });

  it('D. MediaAsset strictly forbids signedAccessUrl (runtime-only concept)', () => {
    const assetWithSignedUrl = {
      ...validAsset,
      signedAccessUrl: 'https://staging.vision.directormaxson.com/api/assets/a1/preview?token=abc',
    };
    const parsed = mediaAssetSchema.safeParse(assetWithSignedUrl);
    expect(parsed.success).toBe(false);
  });

  it('S. 768x1344 requested-as-9:16 is detected as non-exact and represented as WARNING_NORMALIZABLE', () => {
    // Exact 9:16 aspect ratio is 9 / 16 = 0.5625
    // 768 / 1344 = 0.571428... (deviation: 1.58%)
    // Exact 9:16 for height 1344 would be width 756 (12px excess width)
    const inspection: MediaInspectionResult = {
      status: 'WARNING_NORMALIZABLE',
      actualWidth: 768,
      actualHeight: 1344,
      calculatedAspectRatio: '768:1344 (1:1.750)',
      actualDurationSeconds: 6.04,
      fps: 24,
      container: 'mp4',
      videoCodec: 'h264',
      audioCodec: null,
      audioPresent: false,
      fileSizeBytes: 4820150,
      sha256: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90',
      blackFrameDetected: false,
      frozenFrameDetected: false,
      watermarkDetected: false,
      declaredVsActualMismatch: true,
      normalizationRequired: true,
      normalizationDetails: {
        crop: {
          x: 6, // center crop 6px from left and right
          y: 0,
          width: 756,
          height: 1344,
        },
        scale: {
          targetWidth: 1080,
          targetHeight: 1920,
          algorithm: 'LANCZOS',
        },
        reason:
          'Agnes declared 9:16 but emitted 768x1344 (1:1.75). Normalized via 12px center crop to 756x1344 (exact 9:16) and Lanczos scaled to 1080x1920 master.',
      },
      notes:
        'Visual focal point is centered rocket; 6px horizontal crop safely preserves safe areas.',
    };

    const parsed = mediaInspectionResultSchema.safeParse(inspection);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.status).toBe('WARNING_NORMALIZABLE');
    expect(parsed.data?.normalizationRequired).toBe(true);
    expect(parsed.data?.normalizationDetails?.crop?.width).toBe(756);
  });
});
