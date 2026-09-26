-- Migration 0017: Phase 4 Audiovisual Persistence Architecture
-- Canonical 8-table Job/Attempt, MediaAsset, SPP, Routing, Inspection, and Source Link schema.

-- 1. SCENE PRODUCTION PLANS
CREATE TABLE scene_production_plans (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  source_storyboard_version_id TEXT NOT NULL REFERENCES editorial_artifact_versions(id) ON DELETE RESTRICT,
  scene_id TEXT NOT NULL REFERENCES storyboard_scenes(id) ON DELETE RESTRICT,
  scene_order INTEGER NOT NULL CHECK (scene_order > 0),
  script_segment_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(script_segment_ids_json) AND json_type(script_segment_ids_json) = 'array'),
  target_duration_seconds REAL NOT NULL CHECK (target_duration_seconds > 0.0),
  aspect_ratio TEXT NOT NULL CHECK (aspect_ratio IN ('9:16', '16:9', '1:1', '4:5')),
  visual_strategy TEXT NOT NULL CHECK (visual_strategy IN ('GENERATIVE_VIDEO', 'MOTION_GRAPHIC', 'STATIC_FRAME', 'HYBRID')),
  media_type TEXT NOT NULL CHECK (media_type IN ('VIDEO', 'IMAGE', 'MIXED')),
  visual_description TEXT NOT NULL CHECK (length(visual_description) BETWEEN 1 AND 2000),
  prompt_intent TEXT NOT NULL CHECK (length(prompt_intent) BETWEEN 1 AND 2000),
  negative_constraints_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(negative_constraints_json) AND json_type(negative_constraints_json) = 'array'),
  continuity_key TEXT,
  continuity_reference_keys_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(continuity_reference_keys_json) AND json_type(continuity_reference_keys_json) = 'array'),
  camera_framing TEXT NOT NULL CHECK (length(camera_framing) <= 300),
  camera_movement TEXT NOT NULL CHECK (length(camera_movement) <= 300),
  motion_pacing TEXT NOT NULL CHECK (motion_pacing IN ('SLOW', 'MEASURED', 'MODERATE', 'DYNAMIC', 'FAST')),
  lighting_style TEXT NOT NULL CHECK (length(lighting_style) <= 300),
  safe_area_guidance_json TEXT NOT NULL CHECK (json_valid(safe_area_guidance_json) AND json_type(safe_area_guidance_json) = 'object'),
  on_screen_elements_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(on_screen_elements_json) AND json_type(on_screen_elements_json) = 'array'),
  captions_json TEXT NOT NULL CHECK (json_valid(captions_json) AND json_type(captions_json) = 'object'),
  audio_requirements_json TEXT NOT NULL CHECK (json_valid(audio_requirements_json) AND json_type(audio_requirements_json) = 'object'),
  factual_restrictions_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(factual_restrictions_json) AND json_type(factual_restrictions_json) = 'array'),
  rights_requirements TEXT NOT NULL CHECK (rights_requirements IN ('ORIGINAL_GENERATIVE', 'APPROVED_ARCHIVE', 'CREATIVE_COMMONS', 'RESTRICTED')),
  quality_tier TEXT NOT NULL CHECK (quality_tier IN ('DRAFT', 'PRODUCTION', 'MASTER')),
  cost_ceiling_microusd INTEGER NOT NULL CHECK (cost_ceiling_microusd > 0),
  approval_status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (approval_status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT unq_spp_workspace_id UNIQUE (workspace_id, id),
  CONSTRAINT unq_spp_scene_version UNIQUE (workspace_id, project_id, source_storyboard_version_id, scene_id)
);

CREATE INDEX idx_spp_workspace_project_scene ON scene_production_plans(workspace_id, project_id, scene_id);

CREATE TRIGGER trg_spp_no_delete BEFORE DELETE ON scene_production_plans
WHEN 1
BEGIN SELECT RAISE(ABORT, 'spp_delete_forbidden'); END;

CREATE TRIGGER trg_spp_insert_storyboard_version_guard BEFORE INSERT ON scene_production_plans
WHEN NOT EXISTS (
  SELECT 1 FROM editorial_artifact_versions v
  JOIN editorial_artifacts a ON a.id = v.artifact_id
  WHERE v.id = NEW.source_storyboard_version_id
    AND v.workspace_id = NEW.workspace_id
    AND a.workspace_id = NEW.workspace_id
    AND a.project_id = NEW.project_id
    AND a.artifact_type = 'STORYBOARD'
)
BEGIN SELECT RAISE(ABORT, 'spp_storyboard_version_invalid'); END;

CREATE TRIGGER trg_spp_insert_scene_guard BEFORE INSERT ON scene_production_plans
WHEN EXISTS (
  SELECT 1 FROM editorial_artifact_versions v
  WHERE v.id = NEW.source_storyboard_version_id
) AND NOT EXISTS (
  SELECT 1 FROM storyboard_scenes s
  WHERE s.id = NEW.scene_id
    AND s.storyboard_version_id = NEW.source_storyboard_version_id
    AND s.workspace_id = NEW.workspace_id
)
BEGIN SELECT RAISE(ABORT, 'spp_storyboard_scene_invalid'); END;

CREATE TRIGGER trg_spp_version_guard BEFORE UPDATE ON scene_production_plans
WHEN NEW.version != OLD.version + 1
BEGIN SELECT RAISE(ABORT, 'spp_optimistic_lock_failed'); END;

CREATE TRIGGER trg_spp_terminal_guard BEFORE UPDATE ON scene_production_plans
WHEN OLD.approval_status IN ('APPROVED', 'REJECTED') AND (
  NEW.id != OLD.id
  OR NEW.workspace_id != OLD.workspace_id
  OR NEW.project_id != OLD.project_id
  OR NEW.source_storyboard_version_id != OLD.source_storyboard_version_id
  OR NEW.scene_id != OLD.scene_id
  OR NEW.scene_order != OLD.scene_order
  OR NEW.script_segment_ids_json != OLD.script_segment_ids_json
  OR NEW.target_duration_seconds != OLD.target_duration_seconds
  OR NEW.aspect_ratio != OLD.aspect_ratio
  OR NEW.visual_strategy != OLD.visual_strategy
  OR NEW.media_type != OLD.media_type
  OR NEW.visual_description != OLD.visual_description
  OR NEW.prompt_intent != OLD.prompt_intent
  OR NEW.negative_constraints_json != OLD.negative_constraints_json
  OR NEW.continuity_key IS NOT OLD.continuity_key
  OR NEW.continuity_reference_keys_json != OLD.continuity_reference_keys_json
  OR NEW.camera_framing != OLD.camera_framing
  OR NEW.camera_movement != OLD.camera_movement
  OR NEW.motion_pacing != OLD.motion_pacing
  OR NEW.lighting_style != OLD.lighting_style
  OR NEW.safe_area_guidance_json != OLD.safe_area_guidance_json
  OR NEW.on_screen_elements_json != OLD.on_screen_elements_json
  OR NEW.captions_json != OLD.captions_json
  OR NEW.audio_requirements_json != OLD.audio_requirements_json
  OR NEW.factual_restrictions_json != OLD.factual_restrictions_json
  OR NEW.rights_requirements != OLD.rights_requirements
  OR NEW.quality_tier != OLD.quality_tier
  OR NEW.cost_ceiling_microusd != OLD.cost_ceiling_microusd
  OR NEW.approval_status != OLD.approval_status
  OR NEW.created_at != OLD.created_at
)
BEGIN SELECT RAISE(ABORT, 'spp_terminal_mutation_forbidden'); END;

-- 2. VIDEO GENERATION INTENTS
CREATE TABLE video_generation_intents (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  scene_production_plan_id TEXT NOT NULL REFERENCES scene_production_plans(id) ON DELETE RESTRICT,
  scene_id TEXT NOT NULL,
  take_number INTEGER NOT NULL CHECK (take_number >= 1),
  target_duration_seconds REAL NOT NULL CHECK (target_duration_seconds > 0.0),
  target_aspect_ratio TEXT NOT NULL CHECK (target_aspect_ratio IN ('9:16', '16:9', '1:1', '4:5')),
  target_quality_tier TEXT NOT NULL CHECK (target_quality_tier IN ('DRAFT', 'PRODUCTION', 'MASTER')),
  prompt TEXT NOT NULL CHECK (length(prompt) BETWEEN 1 AND 2000),
  negative_prompt TEXT NOT NULL DEFAULT '' CHECK (length(negative_prompt) <= 1000),
  reference_asset_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(reference_asset_ids_json) AND json_type(reference_asset_ids_json) = 'array'),
  first_frame_asset_id TEXT,
  last_frame_asset_id TEXT,
  style_reference_asset_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(style_reference_asset_ids_json) AND json_type(style_reference_asset_ids_json) = 'array'),
  seed_policy_mode TEXT NOT NULL DEFAULT 'RANDOM' CHECK (seed_policy_mode IN ('RANDOM', 'DETERMINISTIC', 'INCREMENT')),
  seed_value INTEGER CHECK (seed_value IS NULL OR seed_value >= 0),
  factual_restrictions_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(factual_restrictions_json) AND json_type(factual_restrictions_json) = 'array'),
  cost_ceiling_microusd INTEGER NOT NULL CHECK (cost_ceiling_microusd > 0),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 200),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT unq_intents_workspace_id UNIQUE (workspace_id, id),
  CONSTRAINT unq_intents_take UNIQUE (workspace_id, project_id, scene_production_plan_id, take_number),
  CONSTRAINT unq_intents_idempotency UNIQUE (workspace_id, project_id, idempotency_key)
);

CREATE INDEX idx_intents_spp ON video_generation_intents(workspace_id, scene_production_plan_id);

CREATE TRIGGER trg_intents_no_delete BEFORE DELETE ON video_generation_intents
WHEN 1
BEGIN SELECT RAISE(ABORT, 'intent_delete_forbidden'); END;

CREATE TRIGGER trg_intents_no_update BEFORE UPDATE ON video_generation_intents
WHEN 1
BEGIN SELECT RAISE(ABORT, 'intent_update_forbidden'); END;

CREATE TRIGGER trg_intents_insert_spp_guard BEFORE INSERT ON video_generation_intents
WHEN NOT EXISTS (
  SELECT 1 FROM scene_production_plans p
  WHERE p.id = NEW.scene_production_plan_id
    AND p.workspace_id = NEW.workspace_id
    AND p.project_id = NEW.project_id
)
BEGIN SELECT RAISE(ABORT, 'intent_spp_scope_invalid'); END;

CREATE TRIGGER trg_intents_insert_first_frame_guard BEFORE INSERT ON video_generation_intents
WHEN NEW.first_frame_asset_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM media_assets m
  WHERE m.id = NEW.first_frame_asset_id
    AND m.workspace_id = NEW.workspace_id
    AND m.project_id = NEW.project_id
)
BEGIN SELECT RAISE(ABORT, 'intent_first_frame_scope_invalid'); END;

CREATE TRIGGER trg_intents_insert_last_frame_guard BEFORE INSERT ON video_generation_intents
WHEN NEW.last_frame_asset_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM media_assets m
  WHERE m.id = NEW.last_frame_asset_id
    AND m.workspace_id = NEW.workspace_id
    AND m.project_id = NEW.project_id
)
BEGIN SELECT RAISE(ABORT, 'intent_last_frame_scope_invalid'); END;

-- 3. PROVIDER ROUTING DECISIONS
CREATE TABLE provider_routing_decisions (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  video_generation_intent_id TEXT NOT NULL REFERENCES video_generation_intents(id) ON DELETE RESTRICT,
  provider_id TEXT NOT NULL REFERENCES ai_providers(id) ON DELETE RESTRICT,
  provider_model_id TEXT NOT NULL REFERENCES ai_provider_models(id) ON DELETE RESTRICT,
  capability_profile_version TEXT NOT NULL CHECK (length(capability_profile_version) BETWEEN 1 AND 50),
  estimated_cost_microusd INTEGER NOT NULL CHECK (estimated_cost_microusd > 0),
  routing_reason TEXT NOT NULL CHECK (length(routing_reason) BETWEEN 1 AND 500),
  routing_factors_json TEXT NOT NULL CHECK (json_valid(routing_factors_json) AND json_type(routing_factors_json) = 'object'),
  decision_timestamp TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT unq_routing_workspace_id UNIQUE (workspace_id, id)
);

CREATE INDEX idx_routing_intent ON provider_routing_decisions(workspace_id, video_generation_intent_id);

CREATE TRIGGER trg_routing_no_delete BEFORE DELETE ON provider_routing_decisions
WHEN 1
BEGIN SELECT RAISE(ABORT, 'routing_delete_forbidden'); END;

CREATE TRIGGER trg_routing_no_update BEFORE UPDATE ON provider_routing_decisions
WHEN 1
BEGIN SELECT RAISE(ABORT, 'routing_update_forbidden'); END;

CREATE TRIGGER trg_routing_insert_intent_guard BEFORE INSERT ON provider_routing_decisions
WHEN NOT EXISTS (
  SELECT 1 FROM video_generation_intents i
  WHERE i.id = NEW.video_generation_intent_id
    AND i.workspace_id = NEW.workspace_id
    AND i.project_id = NEW.project_id
)
BEGIN SELECT RAISE(ABORT, 'routing_intent_scope_invalid'); END;

CREATE TRIGGER trg_routing_provider_model_ownership_guard BEFORE INSERT ON provider_routing_decisions
WHEN NOT EXISTS (
  SELECT 1 FROM ai_provider_models m
  WHERE m.id = NEW.provider_model_id
    AND m.provider_id = NEW.provider_id
)
BEGIN SELECT RAISE(ABORT, 'routing_provider_model_ownership_invalid'); END;

-- 4. AUDIOVISUAL GENERATION JOBS
CREATE TABLE audiovisual_generation_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  video_generation_intent_id TEXT NOT NULL REFERENCES video_generation_intents(id) ON DELETE RESTRICT,
  state TEXT NOT NULL DEFAULT 'PLANNED' CHECK (
    state IN (
      'PLANNED', 'RESERVED', 'DISPATCHING', 'BACKOFF_WAIT', 'AMBIGUOUS_DISPATCH',
      'POLLING', 'PROVIDER_COMPLETED', 'PROVIDER_FAILED', 'INGESTING', 'VALIDATING',
      'NORMALIZING', 'ARCHIVING', 'PERSISTED', 'FAILED_CLOSED', 'FAILED_TERMINAL'
    )
  ),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT unq_jobs_workspace_id UNIQUE (workspace_id, id),
  CONSTRAINT unq_jobs_intent UNIQUE (workspace_id, video_generation_intent_id)
);

CREATE INDEX idx_jobs_intent ON audiovisual_generation_jobs(workspace_id, video_generation_intent_id);
CREATE INDEX idx_jobs_state ON audiovisual_generation_jobs(workspace_id, state);
CREATE INDEX idx_jobs_project ON audiovisual_generation_jobs(workspace_id, project_id);

CREATE TRIGGER trg_jobs_no_delete BEFORE DELETE ON audiovisual_generation_jobs
WHEN 1
BEGIN SELECT RAISE(ABORT, 'jobs_delete_forbidden'); END;

CREATE TRIGGER trg_jobs_insert_intent_guard BEFORE INSERT ON audiovisual_generation_jobs
WHEN NOT EXISTS (
  SELECT 1 FROM video_generation_intents i
  WHERE i.id = NEW.video_generation_intent_id
    AND i.workspace_id = NEW.workspace_id
    AND i.project_id = NEW.project_id
)
BEGIN SELECT RAISE(ABORT, 'jobs_intent_scope_invalid'); END;

CREATE TRIGGER trg_jobs_version_guard BEFORE UPDATE ON audiovisual_generation_jobs
WHEN NEW.version != OLD.version + 1
BEGIN SELECT RAISE(ABORT, 'jobs_optimistic_lock_failed'); END;

CREATE TRIGGER trg_jobs_terminal_guard BEFORE UPDATE ON audiovisual_generation_jobs
WHEN OLD.state IN ('PERSISTED', 'FAILED_CLOSED', 'FAILED_TERMINAL')
BEGIN SELECT RAISE(ABORT, 'jobs_terminal_state_immutable'); END;

CREATE TRIGGER trg_jobs_state_transition_guard BEFORE UPDATE OF state ON audiovisual_generation_jobs
WHEN OLD.state NOT IN ('PERSISTED', 'FAILED_CLOSED', 'FAILED_TERMINAL') AND NOT (
  (OLD.state = 'PLANNED' AND NEW.state IN ('RESERVED', 'FAILED_CLOSED', 'FAILED_TERMINAL')) OR
  (OLD.state = 'RESERVED' AND NEW.state IN ('DISPATCHING', 'FAILED_CLOSED', 'FAILED_TERMINAL')) OR
  (OLD.state = 'DISPATCHING' AND NEW.state IN ('POLLING', 'BACKOFF_WAIT', 'AMBIGUOUS_DISPATCH', 'PROVIDER_COMPLETED', 'PROVIDER_FAILED', 'FAILED_CLOSED', 'FAILED_TERMINAL')) OR
  (OLD.state = 'BACKOFF_WAIT' AND NEW.state IN ('DISPATCHING', 'FAILED_CLOSED', 'FAILED_TERMINAL')) OR
  (OLD.state = 'AMBIGUOUS_DISPATCH' AND NEW.state IN ('POLLING', 'PROVIDER_COMPLETED', 'PROVIDER_FAILED', 'FAILED_CLOSED', 'FAILED_TERMINAL')) OR
  (OLD.state = 'POLLING' AND NEW.state IN ('PROVIDER_COMPLETED', 'PROVIDER_FAILED', 'FAILED_CLOSED', 'FAILED_TERMINAL')) OR
  (OLD.state = 'PROVIDER_COMPLETED' AND NEW.state IN ('INGESTING', 'FAILED_CLOSED', 'FAILED_TERMINAL')) OR
  (OLD.state = 'PROVIDER_FAILED' AND NEW.state IN ('BACKOFF_WAIT', 'FAILED_CLOSED', 'FAILED_TERMINAL')) OR
  (OLD.state = 'INGESTING' AND NEW.state IN ('VALIDATING', 'FAILED_CLOSED', 'FAILED_TERMINAL')) OR
  (OLD.state = 'VALIDATING' AND NEW.state IN ('NORMALIZING', 'ARCHIVING', 'PERSISTED', 'FAILED_CLOSED', 'FAILED_TERMINAL')) OR
  (OLD.state = 'NORMALIZING' AND NEW.state IN ('VALIDATING', 'ARCHIVING', 'PERSISTED', 'FAILED_CLOSED', 'FAILED_TERMINAL')) OR
  (OLD.state = 'ARCHIVING' AND NEW.state IN ('PERSISTED', 'FAILED_CLOSED', 'FAILED_TERMINAL'))
)
BEGIN SELECT RAISE(ABORT, 'jobs_illegal_state_transition'); END;

-- 5. AUDIOVISUAL GENERATION ATTEMPTS
CREATE TABLE audiovisual_generation_attempts (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  generation_job_id TEXT NOT NULL REFERENCES audiovisual_generation_jobs(id) ON DELETE RESTRICT,
  routing_decision_id TEXT NOT NULL REFERENCES provider_routing_decisions(id) ON DELETE RESTRICT,
  attempt_number INTEGER NOT NULL CHECK (attempt_number >= 1),
  provider_id TEXT NOT NULL REFERENCES ai_providers(id) ON DELETE RESTRICT,
  provider_model_id TEXT NOT NULL REFERENCES ai_provider_models(id) ON DELETE RESTRICT,
  provider_job_id TEXT CHECK (provider_job_id IS NULL OR length(provider_job_id) <= 200),
  provider_request_id TEXT CHECK (provider_request_id IS NULL OR length(provider_request_id) <= 200),
  state TEXT NOT NULL DEFAULT 'DISPATCHING' CHECK (state IN ('DISPATCHING', 'POLLING', 'AMBIGUOUS', 'COMPLETED', 'FAILED')),
  dispatch_known INTEGER NOT NULL DEFAULT 0 CHECK (dispatch_known IN (0, 1)),
  poll_count INTEGER NOT NULL DEFAULT 0 CHECK (poll_count >= 0),
  last_polled_at TEXT,
  encrypted_transient_download_url TEXT,
  transient_download_expires_at TEXT,
  secret_scrubbed_at TEXT,
  error_category TEXT CHECK (
    error_category IS NULL OR error_category IN (
      'PROVIDER_CAPACITY_PRE_DISPATCH', 'RATE_LIMIT_PRE_DISPATCH', 'AUTHENTICATION',
      'INVALID_REQUEST', 'CONTENT_POLICY', 'PROVIDER_INTERNAL', 'TIMEOUT_PRE_DISPATCH',
      'AMBIGUOUS_AFTER_DISPATCH', 'GENERATION_FAILED', 'OUTPUT_CORRUPTED', 'DOWNLOAD_FAILED'
    )
  ),
  retry_classification TEXT CHECK (
    retry_classification IS NULL OR retry_classification IN (
      'SAFE_TECHNICAL_REDISPATCH', 'POLL_EXISTING_JOB', 'FAIL_CLOSED', 'HUMAN_REVIEW_REQUIRED'
    )
  ),
  error_raw_code TEXT,
  error_safe_message TEXT,
  error_http_status INTEGER CHECK (error_http_status IS NULL OR (error_http_status BETWEEN 100 AND 599)),
  estimated_cost_microusd INTEGER NOT NULL CHECK (estimated_cost_microusd >= 0),
  actual_cost_microusd INTEGER CHECK (actual_cost_microusd IS NULL OR actual_cost_microusd >= 0),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 200),
  started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  dispatched_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT unq_attempts_workspace_id UNIQUE (workspace_id, id),
  CONSTRAINT unq_attempts_job_attempt UNIQUE (workspace_id, generation_job_id, attempt_number),
  CONSTRAINT unq_attempts_idempotency UNIQUE (workspace_id, project_id, idempotency_key)
);

CREATE INDEX idx_attempts_job ON audiovisual_generation_attempts(workspace_id, generation_job_id);
CREATE INDEX idx_attempts_routing ON audiovisual_generation_attempts(workspace_id, routing_decision_id);
CREATE INDEX idx_attempts_state ON audiovisual_generation_attempts(workspace_id, state);

CREATE TRIGGER trg_attempts_no_delete BEFORE DELETE ON audiovisual_generation_attempts
WHEN 1
BEGIN SELECT RAISE(ABORT, 'attempts_delete_forbidden'); END;

CREATE TRIGGER trg_attempts_insert_consistency_guard BEFORE INSERT ON audiovisual_generation_attempts
WHEN NOT EXISTS (
  SELECT 1 FROM provider_routing_decisions r
  JOIN audiovisual_generation_jobs j ON j.id = NEW.generation_job_id
  WHERE r.id = NEW.routing_decision_id
    AND r.workspace_id = NEW.workspace_id
    AND r.project_id = NEW.project_id
    AND r.provider_id = NEW.provider_id
    AND r.provider_model_id = NEW.provider_model_id
    AND j.workspace_id = NEW.workspace_id
    AND j.project_id = NEW.project_id
    AND j.video_generation_intent_id = r.video_generation_intent_id
)
BEGIN SELECT RAISE(ABORT, 'attempts_routing_job_inconsistent'); END;

CREATE TRIGGER trg_attempts_provider_model_ownership_guard BEFORE INSERT ON audiovisual_generation_attempts
WHEN NOT EXISTS (
  SELECT 1 FROM ai_provider_models m
  WHERE m.id = NEW.provider_model_id
    AND m.provider_id = NEW.provider_id
)
BEGIN SELECT RAISE(ABORT, 'attempts_provider_model_ownership_invalid'); END;

CREATE TRIGGER trg_attempts_state_transition_guard BEFORE UPDATE OF state ON audiovisual_generation_attempts
WHEN OLD.state NOT IN ('COMPLETED', 'FAILED') AND NOT (
  (OLD.state = 'DISPATCHING' AND NEW.state IN ('POLLING', 'AMBIGUOUS', 'COMPLETED', 'FAILED')) OR
  (OLD.state = 'POLLING' AND NEW.state IN ('POLLING', 'COMPLETED', 'FAILED')) OR
  (OLD.state = 'AMBIGUOUS' AND NEW.state IN ('POLLING', 'COMPLETED', 'FAILED'))
)
BEGIN SELECT RAISE(ABORT, 'attempts_illegal_state_transition'); END;

CREATE TRIGGER trg_attempts_terminal_provenance_guard BEFORE UPDATE ON audiovisual_generation_attempts
WHEN OLD.state IN ('COMPLETED', 'FAILED') AND (
  NEW.id != OLD.id
  OR NEW.workspace_id != OLD.workspace_id
  OR NEW.project_id != OLD.project_id
  OR NEW.generation_job_id != OLD.generation_job_id
  OR NEW.routing_decision_id != OLD.routing_decision_id
  OR NEW.attempt_number != OLD.attempt_number
  OR NEW.provider_id != OLD.provider_id
  OR NEW.provider_model_id != OLD.provider_model_id
  OR NEW.provider_job_id IS NOT OLD.provider_job_id
  OR NEW.provider_request_id IS NOT OLD.provider_request_id
  OR NEW.state != OLD.state
  OR NEW.dispatch_known != OLD.dispatch_known
  OR NEW.poll_count != OLD.poll_count
  OR NEW.last_polled_at IS NOT OLD.last_polled_at
  OR NEW.error_category IS NOT OLD.error_category
  OR NEW.retry_classification IS NOT OLD.retry_classification
  OR NEW.error_raw_code IS NOT OLD.error_raw_code
  OR NEW.error_safe_message IS NOT OLD.error_safe_message
  OR NEW.error_http_status IS NOT OLD.error_http_status
  OR NEW.estimated_cost_microusd != OLD.estimated_cost_microusd
  OR NEW.actual_cost_microusd IS NOT OLD.actual_cost_microusd
  OR NEW.idempotency_key != OLD.idempotency_key
  OR NEW.started_at != OLD.started_at
  OR NEW.dispatched_at != OLD.dispatched_at
  OR NEW.completed_at IS NOT OLD.completed_at
)
BEGIN SELECT RAISE(ABORT, 'attempts_terminal_provenance_immutable'); END;

CREATE TRIGGER trg_attempts_terminal_scrub_url_guard BEFORE UPDATE ON audiovisual_generation_attempts
WHEN OLD.state IN ('COMPLETED', 'FAILED') AND (
  NEW.encrypted_transient_download_url IS NOT OLD.encrypted_transient_download_url
  AND NEW.encrypted_transient_download_url IS NOT NULL
)
BEGIN SELECT RAISE(ABORT, 'attempts_terminal_url_scrub_only'); END;

CREATE TRIGGER trg_attempts_terminal_scrub_expires_guard BEFORE UPDATE ON audiovisual_generation_attempts
WHEN OLD.state IN ('COMPLETED', 'FAILED') AND (
  NEW.transient_download_expires_at IS NOT OLD.transient_download_expires_at
  AND NEW.transient_download_expires_at IS NOT NULL
)
BEGIN SELECT RAISE(ABORT, 'attempts_terminal_expires_scrub_only'); END;

CREATE TRIGGER trg_attempts_terminal_scrub_timestamp_guard BEFORE UPDATE ON audiovisual_generation_attempts
WHEN OLD.state IN ('COMPLETED', 'FAILED') AND OLD.secret_scrubbed_at IS NOT NULL AND NEW.secret_scrubbed_at != OLD.secret_scrubbed_at
BEGIN SELECT RAISE(ABORT, 'attempts_secret_scrubbed_at_immutable'); END;

-- 6. MEDIA ASSETS
CREATE TABLE media_assets (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  scene_id TEXT,
  generation_attempt_id TEXT REFERENCES audiovisual_generation_attempts(id) ON DELETE RESTRICT,
  asset_type TEXT NOT NULL CHECK (
    asset_type IN (
      'VIDEO_CLIP', 'IMAGE', 'VOICEOVER', 'MUSIC', 'SFX',
      'GRAPHIC_OVERLAY', 'CAPTION_TRACK', 'REFERENCE_FRAME', 'ROUGH_CUT', 'FINAL_MASTER'
    )
  ),
  provider_id TEXT CHECK (provider_id IS NULL OR length(provider_id) <= 50),
  provider_model_id TEXT CHECK (provider_model_id IS NULL OR length(provider_model_id) <= 100),
  provider_request_id TEXT CHECK (provider_request_id IS NULL OR length(provider_request_id) <= 200),
  prompt_hash TEXT CHECK (prompt_hash IS NULL OR length(prompt_hash) <= 64),
  generation_parameters_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(generation_parameters_json) AND json_type(generation_parameters_json) = 'object'),
  file_hash_sha256 TEXT NOT NULL CHECK (
    length(file_hash_sha256) = 64
    AND file_hash_sha256 = lower(file_hash_sha256)
    AND NOT file_hash_sha256 GLOB '*[^0-9a-f]*'
  ),
  mime_type TEXT NOT NULL CHECK (length(mime_type) BETWEEN 3 AND 100),
  file_size_bytes INTEGER NOT NULL CHECK (file_size_bytes >= 0),
  width INTEGER CHECK (width IS NULL OR width > 0),
  height INTEGER CHECK (height IS NULL OR height > 0),
  fps REAL CHECK (fps IS NULL OR fps > 0.0),
  duration_seconds REAL CHECK (duration_seconds IS NULL OR duration_seconds > 0.0),
  video_codec TEXT CHECK (video_codec IS NULL OR length(video_codec) <= 50),
  audio_codec TEXT CHECK (audio_codec IS NULL OR length(audio_codec) <= 50),
  storage_state TEXT NOT NULL CHECK (storage_state IN ('TRANSIENT_OPERATIONAL', 'DURABLE_ARCHIVED', 'EXPIRING', 'DELETED')),
  r2_key TEXT CHECK (r2_key IS NULL OR length(r2_key) <= 500),
  drive_file_id TEXT CHECK (drive_file_id IS NULL OR length(drive_file_id) <= 200),
  publishability TEXT NOT NULL DEFAULT 'INTERNAL_ONLY' CHECK (
    publishability IN ('INTERNAL_ONLY', 'APPROVED_FOR_RENDER', 'BLOCKED', 'READY_FOR_PUBLISH')
  ),
  watermark_detected INTEGER NOT NULL DEFAULT 0 CHECK (watermark_detected IN (0, 1)),
  qa_status TEXT NOT NULL DEFAULT 'UNINSPECTED' CHECK (qa_status IN ('UNINSPECTED', 'PASS', 'WARNING_NORMALIZABLE', 'FAIL')),
  approval_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (approval_status IN ('PENDING', 'APPROVED', 'REJECTED', 'SUPERSEDED')),
  estimated_cost_microusd INTEGER NOT NULL CHECK (estimated_cost_microusd > 0),
  actual_cost_microusd INTEGER CHECK (actual_cost_microusd IS NULL OR actual_cost_microusd >= 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT,
  superseded_by_id TEXT REFERENCES media_assets(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  CONSTRAINT unq_media_assets_workspace_id UNIQUE (workspace_id, id),
  CHECK (
    (storage_state != 'TRANSIENT_OPERATIONAL' OR r2_key IS NOT NULL)
    AND (storage_state != 'DURABLE_ARCHIVED' OR drive_file_id IS NOT NULL)
  )
);

CREATE INDEX idx_media_assets_workspace_project ON media_assets(workspace_id, project_id);
CREATE INDEX idx_media_assets_attempt ON media_assets(workspace_id, generation_attempt_id);
CREATE INDEX idx_media_assets_r2_lookup ON media_assets(workspace_id, r2_key) WHERE r2_key IS NOT NULL;
CREATE INDEX idx_media_assets_sha256 ON media_assets(workspace_id, file_hash_sha256);

CREATE TRIGGER trg_media_assets_no_delete BEFORE DELETE ON media_assets
WHEN 1
BEGIN SELECT RAISE(ABORT, 'media_assets_delete_forbidden'); END;

CREATE TRIGGER trg_media_assets_insert_attempt_guard BEFORE INSERT ON media_assets
WHEN NEW.generation_attempt_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM audiovisual_generation_attempts a
  WHERE a.id = NEW.generation_attempt_id
    AND a.workspace_id = NEW.workspace_id
    AND a.project_id = NEW.project_id
)
BEGIN SELECT RAISE(ABORT, 'media_assets_attempt_scope_invalid'); END;

CREATE TRIGGER trg_media_assets_insert_superseded_guard BEFORE INSERT ON media_assets
WHEN NEW.superseded_by_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM media_assets m
  WHERE m.id = NEW.superseded_by_id
    AND m.workspace_id = NEW.workspace_id
    AND m.project_id = NEW.project_id
)
BEGIN SELECT RAISE(ABORT, 'media_assets_superseded_scope_invalid'); END;

CREATE TRIGGER trg_media_assets_update_superseded_guard BEFORE UPDATE OF superseded_by_id ON media_assets
WHEN NEW.superseded_by_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM media_assets m
  WHERE m.id = NEW.superseded_by_id
    AND m.workspace_id = NEW.workspace_id
    AND m.project_id = NEW.project_id
)
BEGIN SELECT RAISE(ABORT, 'media_assets_superseded_scope_invalid'); END;

CREATE TRIGGER trg_media_assets_version_guard BEFORE UPDATE ON media_assets
WHEN NEW.version != OLD.version + 1
BEGIN SELECT RAISE(ABORT, 'media_assets_optimistic_lock_failed'); END;

CREATE TRIGGER trg_media_assets_immutable_provenance_guard BEFORE UPDATE ON media_assets
WHEN (
  NEW.id != OLD.id
  OR NEW.workspace_id != OLD.workspace_id
  OR NEW.project_id != OLD.project_id
  OR NEW.scene_id IS NOT OLD.scene_id
  OR NEW.generation_attempt_id IS NOT OLD.generation_attempt_id
  OR NEW.asset_type != OLD.asset_type
  OR NEW.provider_id IS NOT OLD.provider_id
  OR NEW.provider_model_id IS NOT OLD.provider_model_id
  OR NEW.provider_request_id IS NOT OLD.provider_request_id
  OR NEW.prompt_hash IS NOT OLD.prompt_hash
  OR NEW.generation_parameters_json != OLD.generation_parameters_json
  OR NEW.file_hash_sha256 != OLD.file_hash_sha256
  OR NEW.mime_type != OLD.mime_type
  OR NEW.file_size_bytes != OLD.file_size_bytes
  OR NEW.width IS NOT OLD.width
  OR NEW.height IS NOT OLD.height
  OR NEW.fps IS NOT OLD.fps
  OR NEW.duration_seconds IS NOT OLD.duration_seconds
  OR NEW.video_codec IS NOT OLD.video_codec
  OR NEW.audio_codec IS NOT OLD.audio_codec
  OR NEW.estimated_cost_microusd != OLD.estimated_cost_microusd
  OR NEW.actual_cost_microusd IS NOT OLD.actual_cost_microusd
  OR NEW.created_at != OLD.created_at
)
BEGIN SELECT RAISE(ABORT, 'media_assets_provenance_immutable'); END;

CREATE TRIGGER trg_media_assets_watermark_monotonic_guard BEFORE UPDATE OF watermark_detected ON media_assets
WHEN OLD.watermark_detected = 1 AND NEW.watermark_detected = 0
BEGIN SELECT RAISE(ABORT, 'media_assets_watermark_cannot_reset'); END;

-- 7. MEDIA ASSET INSPECTIONS
CREATE TABLE media_asset_inspections (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  media_asset_id TEXT NOT NULL REFERENCES media_assets(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('PASS', 'WARNING_NORMALIZABLE', 'FAIL')),
  actual_width INTEGER NOT NULL CHECK (actual_width > 0),
  actual_height INTEGER NOT NULL CHECK (actual_height > 0),
  calculated_aspect_ratio TEXT NOT NULL CHECK (length(calculated_aspect_ratio) <= 30),
  actual_duration_seconds REAL NOT NULL CHECK (actual_duration_seconds > 0.0),
  fps REAL NOT NULL CHECK (fps > 0.0),
  container TEXT NOT NULL CHECK (length(container) <= 50),
  video_codec TEXT NOT NULL CHECK (length(video_codec) <= 50),
  audio_codec TEXT CHECK (audio_codec IS NULL OR length(audio_codec) <= 50),
  audio_present INTEGER NOT NULL CHECK (audio_present IN (0, 1)),
  file_size_bytes INTEGER NOT NULL CHECK (file_size_bytes > 0),
  sha256 TEXT NOT NULL CHECK (
    length(sha256) = 64
    AND sha256 = lower(sha256)
    AND NOT sha256 GLOB '*[^0-9a-f]*'
  ),
  black_frame_detected INTEGER NOT NULL CHECK (black_frame_detected IN (0, 1)),
  frozen_frame_detected INTEGER NOT NULL CHECK (frozen_frame_detected IN (0, 1)),
  watermark_detected INTEGER NOT NULL CHECK (watermark_detected IN (0, 1)),
  declared_vs_actual_mismatch INTEGER NOT NULL CHECK (declared_vs_actual_mismatch IN (0, 1)),
  normalization_required INTEGER NOT NULL CHECK (normalization_required IN (0, 1)),
  normalization_details_json TEXT CHECK (normalization_details_json IS NULL OR (json_valid(normalization_details_json) AND json_type(normalization_details_json) = 'object')),
  notes TEXT CHECK (notes IS NULL OR length(notes) <= 1000),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT unq_inspections_workspace_id UNIQUE (workspace_id, id)
);

CREATE INDEX idx_inspections_asset ON media_asset_inspections(workspace_id, media_asset_id);
CREATE INDEX idx_inspections_status ON media_asset_inspections(workspace_id, status);

CREATE TRIGGER trg_inspections_no_delete BEFORE DELETE ON media_asset_inspections
WHEN 1
BEGIN SELECT RAISE(ABORT, 'inspections_delete_forbidden'); END;

CREATE TRIGGER trg_inspections_no_update BEFORE UPDATE ON media_asset_inspections
WHEN 1
BEGIN SELECT RAISE(ABORT, 'inspections_update_forbidden'); END;

CREATE TRIGGER trg_inspections_insert_asset_guard BEFORE INSERT ON media_asset_inspections
WHEN NOT EXISTS (
  SELECT 1 FROM media_assets m
  WHERE m.id = NEW.media_asset_id
    AND m.workspace_id = NEW.workspace_id
    AND m.project_id = NEW.project_id
)
BEGIN SELECT RAISE(ABORT, 'inspections_asset_scope_invalid'); END;

-- 8. MEDIA ASSET SOURCE LINKS
CREATE TABLE media_asset_source_links (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  target_asset_id TEXT NOT NULL,
  source_asset_id TEXT NOT NULL,
  link_type TEXT NOT NULL CHECK (
    link_type IN (
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
      'AUDIO_SEPARATED_FROM'
    )
  ),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (workspace_id, target_asset_id, source_asset_id, link_type),
  FOREIGN KEY (workspace_id, target_asset_id) REFERENCES media_assets(workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, source_asset_id) REFERENCES media_assets(workspace_id, id) ON DELETE RESTRICT
);

CREATE INDEX idx_source_links_target ON media_asset_source_links(workspace_id, target_asset_id);
CREATE INDEX idx_source_links_source ON media_asset_source_links(workspace_id, source_asset_id);
CREATE INDEX idx_source_links_type ON media_asset_source_links(workspace_id, link_type);

CREATE TRIGGER trg_source_links_no_delete BEFORE DELETE ON media_asset_source_links
WHEN 1
BEGIN SELECT RAISE(ABORT, 'source_links_delete_forbidden'); END;

CREATE TRIGGER trg_source_links_no_update BEFORE UPDATE ON media_asset_source_links
WHEN 1
BEGIN SELECT RAISE(ABORT, 'source_links_update_forbidden'); END;

CREATE TRIGGER trg_source_links_insert_self_link_guard BEFORE INSERT ON media_asset_source_links
WHEN NEW.target_asset_id = NEW.source_asset_id
BEGIN SELECT RAISE(ABORT, 'source_links_self_link_forbidden'); END;

CREATE TRIGGER trg_source_links_insert_tenant_guard BEFORE INSERT ON media_asset_source_links
WHEN (
  (SELECT project_id FROM media_assets WHERE id = NEW.target_asset_id AND workspace_id = NEW.workspace_id) != (SELECT project_id FROM media_assets WHERE id = NEW.source_asset_id AND workspace_id = NEW.workspace_id)
  OR (SELECT 1 FROM media_assets WHERE id = NEW.target_asset_id AND workspace_id = NEW.workspace_id) IS NULL
  OR (SELECT 1 FROM media_assets WHERE id = NEW.source_asset_id AND workspace_id = NEW.workspace_id) IS NULL
)
BEGIN SELECT RAISE(ABORT, 'source_links_cross_project_forbidden'); END;
