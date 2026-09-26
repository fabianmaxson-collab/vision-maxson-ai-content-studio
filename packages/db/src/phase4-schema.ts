import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// Migration 0017 is the constraint/trigger authority; these declarations provide typed access.

export const sceneProductionPlans = sqliteTable('scene_production_plans', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  projectId: text('project_id').notNull(),
  sourceStoryboardVersionId: text('source_storyboard_version_id').notNull(),
  sceneId: text('scene_id').notNull(),
  sceneOrder: integer('scene_order').notNull(),
  scriptSegmentIdsJson: text('script_segment_ids_json').notNull().default('[]'),
  targetDurationSeconds: real('target_duration_seconds').notNull(),
  aspectRatio: text('aspect_ratio', { enum: ['9:16', '16:9', '1:1', '4:5'] }).notNull(),
  visualStrategy: text('visual_strategy', {
    enum: ['GENERATIVE_VIDEO', 'MOTION_GRAPHIC', 'STATIC_FRAME', 'HYBRID'],
  }).notNull(),
  mediaType: text('media_type', { enum: ['VIDEO', 'IMAGE', 'MIXED'] }).notNull(),
  visualDescription: text('visual_description').notNull(),
  promptIntent: text('prompt_intent').notNull(),
  negativeConstraintsJson: text('negative_constraints_json').notNull().default('[]'),
  continuityKey: text('continuity_key'),
  continuityReferenceKeysJson: text('continuity_reference_keys_json').notNull().default('[]'),
  cameraFraming: text('camera_framing').notNull(),
  cameraMovement: text('camera_movement').notNull(),
  motionPacing: text('motion_pacing', {
    enum: ['SLOW', 'MEASURED', 'MODERATE', 'DYNAMIC', 'FAST'],
  }).notNull(),
  lightingStyle: text('lighting_style').notNull(),
  safeAreaGuidanceJson: text('safe_area_guidance_json').notNull(),
  onScreenElementsJson: text('on_screen_elements_json').notNull().default('[]'),
  captionsJson: text('captions_json').notNull(),
  audioRequirementsJson: text('audio_requirements_json').notNull(),
  factualRestrictionsJson: text('factual_restrictions_json').notNull().default('[]'),
  rightsRequirements: text('rights_requirements', {
    enum: ['ORIGINAL_GENERATIVE', 'APPROVED_ARCHIVE', 'CREATIVE_COMMONS', 'RESTRICTED'],
  }).notNull(),
  qualityTier: text('quality_tier', { enum: ['DRAFT', 'PRODUCTION', 'MASTER'] }).notNull(),
  costCeilingMicroUsd: integer('cost_ceiling_microusd').notNull(),
  approvalStatus: text('approval_status', {
    enum: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED'],
  })
    .notNull()
    .default('DRAFT'),
  version: integer('version').notNull().default(1),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const videoGenerationIntents = sqliteTable('video_generation_intents', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  projectId: text('project_id').notNull(),
  sceneProductionPlanId: text('scene_production_plan_id').notNull(),
  sceneId: text('scene_id').notNull(),
  takeNumber: integer('take_number').notNull(),
  targetDurationSeconds: real('target_duration_seconds').notNull(),
  targetAspectRatio: text('target_aspect_ratio', {
    enum: ['9:16', '16:9', '1:1', '4:5'],
  }).notNull(),
  targetQualityTier: text('target_quality_tier', {
    enum: ['DRAFT', 'PRODUCTION', 'MASTER'],
  }).notNull(),
  prompt: text('prompt').notNull(),
  negativePrompt: text('negative_prompt').notNull().default(''),
  referenceAssetIdsJson: text('reference_asset_ids_json').notNull().default('[]'),
  firstFrameAssetId: text('first_frame_asset_id'),
  lastFrameAssetId: text('last_frame_asset_id'),
  styleReferenceAssetIdsJson: text('style_reference_asset_ids_json').notNull().default('[]'),
  seedPolicyMode: text('seed_policy_mode', {
    enum: ['RANDOM', 'DETERMINISTIC', 'INCREMENT'],
  })
    .notNull()
    .default('RANDOM'),
  seedValue: integer('seed_value'),
  factualRestrictionsJson: text('factual_restrictions_json').notNull().default('[]'),
  costCeilingMicroUsd: integer('cost_ceiling_microusd').notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  createdAt: text('created_at').notNull(),
});

export const providerRoutingDecisions = sqliteTable('provider_routing_decisions', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  projectId: text('project_id').notNull(),
  videoGenerationIntentId: text('video_generation_intent_id').notNull(),
  providerId: text('provider_id').notNull(),
  providerModelId: text('provider_model_id').notNull(),
  capabilityProfileVersion: text('capability_profile_version').notNull(),
  estimatedCostMicroUsd: integer('estimated_cost_microusd').notNull(),
  routingReason: text('routing_reason').notNull(),
  routingFactorsJson: text('routing_factors_json').notNull(),
  decisionTimestamp: text('decision_timestamp').notNull(),
  createdAt: text('created_at').notNull(),
});

export const audiovisualGenerationJobs = sqliteTable('audiovisual_generation_jobs', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  projectId: text('project_id').notNull(),
  videoGenerationIntentId: text('video_generation_intent_id').notNull(),
  state: text('state', {
    enum: [
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
    ],
  })
    .notNull()
    .default('PLANNED'),
  version: integer('version').notNull().default(1),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const audiovisualGenerationAttempts = sqliteTable('audiovisual_generation_attempts', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  projectId: text('project_id').notNull(),
  generationJobId: text('generation_job_id').notNull(),
  routingDecisionId: text('routing_decision_id').notNull(),
  attemptNumber: integer('attempt_number').notNull(),
  providerId: text('provider_id').notNull(),
  providerModelId: text('provider_model_id').notNull(),
  providerJobId: text('provider_job_id'),
  providerRequestId: text('provider_request_id'),
  state: text('state', {
    enum: ['DISPATCHING', 'POLLING', 'AMBIGUOUS', 'COMPLETED', 'FAILED'],
  })
    .notNull()
    .default('DISPATCHING'),
  dispatchKnown: integer('dispatch_known', { mode: 'boolean' }).notNull().default(false),
  pollCount: integer('poll_count').notNull().default(0),
  lastPolledAt: text('last_polled_at'),
  encryptedTransientDownloadUrl: text('encrypted_transient_download_url'),
  transientDownloadExpiresAt: text('transient_download_expires_at'),
  secretScrubbedAt: text('secret_scrubbed_at'),
  errorCategory: text('error_category'),
  retryClassification: text('retry_classification'),
  errorRawCode: text('error_raw_code'),
  errorSafeMessage: text('error_safe_message'),
  errorHttpStatus: integer('error_http_status'),
  estimatedCostMicroUsd: integer('estimated_cost_microusd').notNull(),
  actualCostMicroUsd: integer('actual_cost_microusd'),
  idempotencyKey: text('idempotency_key').notNull(),
  startedAt: text('started_at').notNull(),
  dispatchedAt: text('dispatched_at').notNull(),
  completedAt: text('completed_at'),
  updatedAt: text('updated_at').notNull(),
});

export const mediaAssets = sqliteTable('media_assets', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  projectId: text('project_id').notNull(),
  sceneId: text('scene_id'),
  generationAttemptId: text('generation_attempt_id'),
  assetType: text('asset_type', {
    enum: [
      'VIDEO_CLIP',
      'IMAGE',
      'VOICEOVER',
      'MUSIC',
      'SFX',
      'GRAPHIC_OVERLAY',
      'CAPTION_TRACK',
      'REFERENCE_FRAME',
      'ROUGH_CUT',
      'FINAL_MASTER',
    ],
  }).notNull(),
  providerId: text('provider_id'),
  providerModelId: text('provider_model_id'),
  providerRequestId: text('provider_request_id'),
  promptHash: text('prompt_hash'),
  generationParametersJson: text('generation_parameters_json').notNull().default('{}'),
  fileHashSha256: text('file_hash_sha256').notNull(),
  mimeType: text('mime_type').notNull(),
  fileSizeBytes: integer('file_size_bytes').notNull(),
  width: integer('width'),
  height: integer('height'),
  fps: real('fps'),
  durationSeconds: real('duration_seconds'),
  videoCodec: text('video_codec'),
  audioCodec: text('audio_codec'),
  storageState: text('storage_state', {
    enum: ['TRANSIENT_OPERATIONAL', 'DURABLE_ARCHIVED', 'EXPIRING', 'DELETED'],
  }).notNull(),
  r2Key: text('r2_key'),
  driveFileId: text('drive_file_id'),
  publishability: text('publishability', {
    enum: ['INTERNAL_ONLY', 'APPROVED_FOR_RENDER', 'BLOCKED', 'READY_FOR_PUBLISH'],
  })
    .notNull()
    .default('INTERNAL_ONLY'),
  watermarkDetected: integer('watermark_detected', { mode: 'boolean' }).notNull().default(false),
  qaStatus: text('qa_status', {
    enum: ['UNINSPECTED', 'PASS', 'WARNING_NORMALIZABLE', 'FAIL'],
  })
    .notNull()
    .default('UNINSPECTED'),
  approvalStatus: text('approval_status', {
    enum: ['PENDING', 'APPROVED', 'REJECTED', 'SUPERSEDED'],
  })
    .notNull()
    .default('PENDING'),
  estimatedCostMicroUsd: integer('estimated_cost_microusd').notNull(),
  actualCostMicroUsd: integer('actual_cost_microusd'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  expiresAt: text('expires_at'),
  supersededById: text('superseded_by_id'),
  version: integer('version').notNull().default(1),
});

export const mediaAssetInspections = sqliteTable('media_asset_inspections', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  projectId: text('project_id').notNull(),
  mediaAssetId: text('media_asset_id').notNull(),
  status: text('status', {
    enum: ['PASS', 'WARNING_NORMALIZABLE', 'FAIL'],
  }).notNull(),
  actualWidth: integer('actual_width').notNull(),
  actualHeight: integer('actual_height').notNull(),
  calculatedAspectRatio: text('calculated_aspect_ratio').notNull(),
  actualDurationSeconds: real('actual_duration_seconds').notNull(),
  fps: real('fps').notNull(),
  container: text('container').notNull(),
  videoCodec: text('video_codec').notNull(),
  audioCodec: text('audio_codec'),
  audioPresent: integer('audio_present', { mode: 'boolean' }).notNull(),
  fileSizeBytes: integer('file_size_bytes').notNull(),
  sha256: text('sha256').notNull(),
  blackFrameDetected: integer('black_frame_detected', { mode: 'boolean' }).notNull(),
  frozenFrameDetected: integer('frozen_frame_detected', { mode: 'boolean' }).notNull(),
  watermarkDetected: integer('watermark_detected', { mode: 'boolean' }).notNull(),
  declaredVsActualMismatch: integer('declared_vs_actual_mismatch', { mode: 'boolean' }).notNull(),
  normalizationRequired: integer('normalization_required', { mode: 'boolean' }).notNull(),
  normalizationDetailsJson: text('normalization_details_json'),
  notes: text('notes'),
  createdAt: text('created_at').notNull(),
});

export const mediaAssetSourceLinks = sqliteTable('media_asset_source_links', {
  workspaceId: text('workspace_id').notNull(),
  targetAssetId: text('target_asset_id').notNull(),
  sourceAssetId: text('source_asset_id').notNull(),
  linkType: text('link_type', {
    enum: [
      'REFERENCE_FRAME',
      'FIRST_FRAME',
      'LAST_FRAME',
      'STYLE_REFERENCE',
      'NORMALIZED_FROM',
      'ROUGH_CUT_SOURCE',
      'FINAL_MASTER_SOURCE',
      'DERIVED_FROM',
      'COMPOSED_FROM',
      'EXTRACTED_FROM',
      'AUDIO_SEPARATED_FROM',
    ],
  }).notNull(),
  createdAt: text('created_at').notNull(),
});
