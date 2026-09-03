PRAGMA foreign_keys = ON;

CREATE TABLE editorial_artifacts (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  artifact_type TEXT NOT NULL CHECK(artifact_type IN ('RESEARCH','IDEA_CANDIDATE','CONTENT_BRIEF','PRODUCTION_SCRIPT','REVIEW_TRANSLATION','SCRIPT_CRITIQUE','STORYBOARD','PREFLIGHT')),
  current_version_id TEXT,
  status TEXT DEFAULT 'draft' NOT NULL CHECK(status IN ('draft','active','approved','rejected','archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER DEFAULT 1 NOT NULL,
  created_by TEXT REFERENCES users(id),
  updated_by TEXT REFERENCES users(id),
  deleted_at TEXT
);
CREATE INDEX editorial_artifacts_project_idx ON editorial_artifacts(workspace_id,project_id,artifact_type) WHERE deleted_at IS NULL;

CREATE TABLE ai_providers (
  id TEXT PRIMARY KEY NOT NULL,
  key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  status TEXT DEFAULT 'inactive' NOT NULL CHECK(status IN ('inactive','configured','degraded','disabled')),
  adapter_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER DEFAULT 1 NOT NULL
);
CREATE TABLE ai_provider_models (
  id TEXT PRIMARY KEY NOT NULL,
  provider_id TEXT NOT NULL REFERENCES ai_providers(id),
  model_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  status TEXT DEFAULT 'inactive' NOT NULL CHECK(status IN ('inactive','available','degraded','disabled')),
  capabilities_json TEXT DEFAULT '{}' NOT NULL CHECK(json_valid(capabilities_json) AND length(capabilities_json)<=16384),
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER DEFAULT 1 NOT NULL,
  UNIQUE(provider_id,model_key)
);
CREATE TABLE prompt_definitions (
  id TEXT PRIMARY KEY NOT NULL,
  key TEXT NOT NULL UNIQUE,
  task_type TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT DEFAULT 'active' NOT NULL CHECK(status IN ('active','inactive')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER DEFAULT 1 NOT NULL
);
CREATE TABLE prompt_versions (
  id TEXT PRIMARY KEY NOT NULL,
  prompt_definition_id TEXT NOT NULL REFERENCES prompt_definitions(id),
  version_number INTEGER NOT NULL CHECK(version_number>0),
  template_text TEXT NOT NULL CHECK(length(template_text)<=65536),
  input_schema_version TEXT NOT NULL,
  output_schema_version TEXT NOT NULL,
  status TEXT DEFAULT 'draft' NOT NULL CHECK(status IN ('draft','active','retired')),
  content_hash TEXT NOT NULL CHECK(length(content_hash)=64),
  created_at TEXT NOT NULL,
  created_by TEXT REFERENCES users(id),
  UNIQUE(prompt_definition_id,version_number)
);
CREATE TABLE ai_pricing_snapshots (
  id TEXT PRIMARY KEY NOT NULL,
  provider_model_id TEXT NOT NULL REFERENCES ai_provider_models(id),
  currency TEXT,
  input_unit_price REAL CHECK(input_unit_price IS NULL OR input_unit_price>=0),
  output_unit_price REAL CHECK(output_unit_price IS NULL OR output_unit_price>=0),
  unit_name TEXT,
  source_label TEXT,
  source_url TEXT,
  verification_status TEXT DEFAULT 'unverified' NOT NULL CHECK(verification_status IN ('unverified','owner_approved','externally_verified','stale','superseded')),
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT REFERENCES users(id)
);

CREATE TABLE intelligence_runs (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  task_type TEXT NOT NULL,
  provider_id TEXT REFERENCES ai_providers(id),
  provider_model_id TEXT REFERENCES ai_provider_models(id),
  prompt_version_id TEXT REFERENCES prompt_versions(id),
  input_artifact_version_id TEXT,
  output_artifact_version_id TEXT,
  initiated_by TEXT NOT NULL REFERENCES users(id),
  operating_mode TEXT NOT NULL CHECK(operating_mode IN ('MANUAL','ASSISTED','AUTONOMOUS')),
  status TEXT DEFAULT 'QUEUED' NOT NULL CHECK(status IN ('QUEUED','RUNNING','SUCCEEDED','FAILED_RETRYABLE','FAILED_PERMANENT','CANCELLED')),
  idempotency_key TEXT NOT NULL,
  creative_regeneration_number INTEGER DEFAULT 0 NOT NULL CHECK(creative_regeneration_number BETWEEN 0 AND 2),
  safe_metadata_json TEXT DEFAULT '{}' NOT NULL CHECK(json_valid(safe_metadata_json) AND length(safe_metadata_json)<=16384),
  input_units INTEGER CHECK(input_units IS NULL OR input_units>=0),
  output_units INTEGER CHECK(output_units IS NULL OR output_units>=0),
  estimated_cost REAL CHECK(estimated_cost IS NULL OR estimated_cost>=0),
  actual_cost REAL CHECK(actual_cost IS NULL OR actual_cost>=0),
  currency TEXT,
  pricing_snapshot_id TEXT REFERENCES ai_pricing_snapshots(id),
  error_category TEXT,
  safe_error_detail TEXT CHECK(safe_error_detail IS NULL OR length(safe_error_detail)<=2000),
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER DEFAULT 1 NOT NULL,
  UNIQUE(workspace_id,idempotency_key)
);
CREATE INDEX intelligence_runs_project_idx ON intelligence_runs(workspace_id,project_id,created_at);
CREATE TABLE intelligence_run_attempts (
  id TEXT PRIMARY KEY NOT NULL,
  intelligence_run_id TEXT NOT NULL REFERENCES intelligence_runs(id),
  attempt_number INTEGER NOT NULL CHECK(attempt_number>0),
  attempt_kind TEXT NOT NULL CHECK(attempt_kind IN ('TECHNICAL','CREATIVE_REGENERATION')),
  status TEXT NOT NULL CHECK(status IN ('RUNNING','SUCCEEDED','FAILED_RETRYABLE','FAILED_PERMANENT','CANCELLED')),
  provider_request_id TEXT,
  safe_metadata_json TEXT DEFAULT '{}' NOT NULL CHECK(json_valid(safe_metadata_json) AND length(safe_metadata_json)<=8192),
  error_category TEXT,
  safe_error_detail TEXT CHECK(safe_error_detail IS NULL OR length(safe_error_detail)<=2000),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE(intelligence_run_id,attempt_number)
);

CREATE TABLE editorial_artifact_versions (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  artifact_id TEXT NOT NULL REFERENCES editorial_artifacts(id),
  version_number INTEGER NOT NULL CHECK(version_number>0),
  parent_version_id TEXT REFERENCES editorial_artifact_versions(id),
  language_code TEXT NOT NULL,
  content_text TEXT CHECK(content_text IS NULL OR length(content_text)<=262144),
  content_json TEXT CHECK(content_json IS NULL OR (json_valid(content_json) AND length(content_json)<=262144)),
  source_type TEXT NOT NULL CHECK(source_type IN ('AI_GENERATED','HUMAN_EDITED','IMPORTED')),
  intelligence_run_id TEXT REFERENCES intelligence_runs(id),
  content_hash TEXT NOT NULL CHECK(length(content_hash)=64),
  word_count INTEGER CHECK(word_count IS NULL OR word_count>=0),
  narration_rate_profile_id TEXT,
  estimated_duration_seconds REAL CHECK(estimated_duration_seconds IS NULL OR estimated_duration_seconds>=0),
  source_script_version_id TEXT REFERENCES editorial_artifact_versions(id),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  UNIQUE(artifact_id,version_number),
  CHECK(content_text IS NOT NULL OR content_json IS NOT NULL),
  CHECK(source_type!='AI_GENERATED' OR intelligence_run_id IS NOT NULL),
  CHECK(source_script_version_id IS NULL OR source_script_version_id!=id)
);
CREATE INDEX artifact_versions_artifact_idx ON editorial_artifact_versions(workspace_id,artifact_id,version_number);
CREATE UNIQUE INDEX artifact_versions_hash_uq ON editorial_artifact_versions(artifact_id,content_hash);

CREATE TABLE artifact_dependencies (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  source_artifact_version_id TEXT NOT NULL REFERENCES editorial_artifact_versions(id),
  dependent_artifact_version_id TEXT NOT NULL REFERENCES editorial_artifact_versions(id),
  dependency_type TEXT NOT NULL,
  validity_status TEXT DEFAULT 'CURRENT' NOT NULL CHECK(validity_status IN ('CURRENT','STALE','INVALIDATED','REGENERATION_REQUIRED','REAPPROVAL_REQUIRED')),
  invalidated_at TEXT,
  invalidated_by_version_id TEXT REFERENCES editorial_artifact_versions(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER DEFAULT 1 NOT NULL,
  CHECK(source_artifact_version_id!=dependent_artifact_version_id),
  UNIQUE(source_artifact_version_id,dependent_artifact_version_id,dependency_type)
);
CREATE INDEX artifact_dependencies_source_idx ON artifact_dependencies(workspace_id,source_artifact_version_id,validity_status);
CREATE TABLE artifact_approvals (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  artifact_version_id TEXT NOT NULL REFERENCES editorial_artifact_versions(id),
  decision TEXT NOT NULL CHECK(decision IN ('APPROVED','REJECTED')),
  actor_id TEXT NOT NULL REFERENCES users(id),
  actor_role TEXT NOT NULL CHECK(actor_role IN ('owner','admin','operator')),
  comment TEXT CHECK(comment IS NULL OR length(comment)<=4000),
  decided_at TEXT NOT NULL,
  UNIQUE(artifact_version_id,actor_id,decision)
);
CREATE INDEX artifact_approvals_version_idx ON artifact_approvals(workspace_id,artifact_version_id,decided_at);
CREATE TABLE artifact_status_events (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  artifact_id TEXT NOT NULL REFERENCES editorial_artifacts(id),
  artifact_version_id TEXT REFERENCES editorial_artifact_versions(id),
  previous_status TEXT,
  next_status TEXT NOT NULL,
  reason TEXT,
  actor_id TEXT REFERENCES users(id),
  occurred_at TEXT NOT NULL
);

CREATE TABLE research_sources (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  research_version_id TEXT NOT NULL REFERENCES editorial_artifact_versions(id),
  source_type TEXT NOT NULL,
  title TEXT NOT NULL,
  source_url TEXT,
  source_reference TEXT,
  retrieved_at TEXT,
  published_at TEXT,
  verification_status TEXT DEFAULT 'unverified' NOT NULL CHECK(verification_status IN ('unverified','owner_approved','externally_verified','stale')),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id)
);
CREATE INDEX research_sources_version_idx ON research_sources(workspace_id,research_version_id);
CREATE TABLE research_claims (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  research_version_id TEXT NOT NULL REFERENCES editorial_artifact_versions(id),
  source_id TEXT REFERENCES research_sources(id),
  claim_text TEXT NOT NULL CHECK(length(claim_text)<=16000),
  evidence_class TEXT NOT NULL CHECK(evidence_class IN ('OBSERVED','AI_INFERENCE','UNKNOWN')),
  excerpt TEXT CHECK(excerpt IS NULL OR length(excerpt)<=4000),
  confidence REAL CHECK(confidence IS NULL OR (confidence>=0 AND confidence<=1)),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  CHECK(evidence_class!='OBSERVED' OR source_id IS NOT NULL)
);

CREATE TABLE idea_candidates (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  artifact_id TEXT NOT NULL REFERENCES editorial_artifacts(id),
  artifact_version_id TEXT NOT NULL REFERENCES editorial_artifact_versions(id),
  title TEXT NOT NULL,
  angle TEXT NOT NULL DEFAULT '',
  hook TEXT NOT NULL DEFAULT '',
  rationale TEXT NOT NULL DEFAULT '',
  audience_json TEXT DEFAULT '{}' NOT NULL CHECK(json_valid(audience_json)),
  target_format TEXT NOT NULL CHECK(target_format IN ('SHORT','LONG_FORM')),
  target_platforms_json TEXT DEFAULT '[]' NOT NULL CHECK(json_valid(target_platforms_json)),
  complexity TEXT CHECK(complexity IN ('LOW','MEDIUM','HIGH','UNKNOWN')),
  monetization_compatibility TEXT CHECK(monetization_compatibility IN ('COMPATIBLE','INCOMPATIBLE','UNKNOWN')),
  risks_json TEXT DEFAULT '[]' NOT NULL CHECK(json_valid(risks_json)),
  status TEXT DEFAULT 'CANDIDATE' NOT NULL CHECK(status IN ('CANDIDATE','SELECTED','APPROVED','REJECTED')),
  recommendation_rank INTEGER CHECK(recommendation_rank IS NULL OR recommendation_rank>0),
  confidence REAL CHECK(confidence IS NULL OR (confidence>=0 AND confidence<=1)),
  evidence_class TEXT NOT NULL CHECK(evidence_class IN ('HEURISTIC','RULE_BASED','SOURCE_BACKED','UNKNOWN')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER DEFAULT 1 NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  updated_by TEXT NOT NULL REFERENCES users(id),
  UNIQUE(artifact_version_id)
);
CREATE INDEX idea_candidates_project_idx ON idea_candidates(workspace_id,project_id,status);
CREATE TABLE idea_score_components (
  id TEXT PRIMARY KEY NOT NULL,
  idea_candidate_id TEXT NOT NULL REFERENCES idea_candidates(id),
  dimension TEXT NOT NULL,
  score REAL CHECK(score IS NULL OR (score>=0 AND score<=100)),
  confidence REAL CHECK(confidence IS NULL OR (confidence>=0 AND confidence<=1)),
  evidence_class TEXT NOT NULL CHECK(evidence_class IN ('HEURISTIC','RULE_BASED','SOURCE_BACKED','UNKNOWN')),
  explanation TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE(idea_candidate_id,dimension)
);

CREATE TABLE narration_rate_profiles (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,
  language_code TEXT NOT NULL,
  words_per_minute REAL NOT NULL CHECK(words_per_minute>0),
  version_number INTEGER NOT NULL CHECK(version_number>0),
  status TEXT DEFAULT 'active' NOT NULL CHECK(status IN ('active','retired')),
  source_label TEXT NOT NULL,
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  UNIQUE(workspace_id,name,version_number)
);
CREATE TABLE script_segments (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  script_version_id TEXT NOT NULL REFERENCES editorial_artifact_versions(id),
  segment_order INTEGER NOT NULL CHECK(segment_order>0),
  content_text TEXT NOT NULL CHECK(length(content_text)<=32768),
  content_hash TEXT NOT NULL CHECK(length(content_hash)=64),
  word_count INTEGER NOT NULL CHECK(word_count>=0),
  estimated_duration_seconds REAL CHECK(estimated_duration_seconds IS NULL OR estimated_duration_seconds>=0),
  created_at TEXT NOT NULL,
  UNIQUE(script_version_id,segment_order)
);
CREATE TABLE storyboard_scenes (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  storyboard_version_id TEXT NOT NULL REFERENCES editorial_artifact_versions(id),
  scene_order INTEGER NOT NULL CHECK(scene_order>0),
  target_duration_seconds REAL CHECK(target_duration_seconds IS NULL OR target_duration_seconds>0),
  visual_description TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL DEFAULT '',
  camera_framing TEXT NOT NULL DEFAULT '',
  mood TEXT NOT NULL DEFAULT '',
  continuity_notes TEXT NOT NULL DEFAULT '',
  generation_instructions TEXT NOT NULL DEFAULT '',
  recommended_media_type TEXT CHECK(recommended_media_type IN ('IMAGE','VIDEO','MIXED','UNKNOWN')),
  asset_requirements_json TEXT DEFAULT '[]' NOT NULL CHECK(json_valid(asset_requirements_json)),
  transition_notes TEXT NOT NULL DEFAULT '',
  character_version_refs_json TEXT DEFAULT '[]' NOT NULL CHECK(json_valid(character_version_refs_json)),
  created_at TEXT NOT NULL,
  UNIQUE(storyboard_version_id,scene_order)
);
CREATE TABLE scene_script_segments (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  storyboard_scene_id TEXT NOT NULL REFERENCES storyboard_scenes(id),
  script_segment_id TEXT NOT NULL REFERENCES script_segments(id),
  segment_order INTEGER NOT NULL CHECK(segment_order>0),
  created_at TEXT NOT NULL,
  PRIMARY KEY(storyboard_scene_id,script_segment_id)
);

CREATE TABLE preflight_assessments (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  artifact_id TEXT NOT NULL REFERENCES editorial_artifacts(id),
  artifact_version_id TEXT NOT NULL REFERENCES editorial_artifact_versions(id),
  overall_result TEXT NOT NULL CHECK(overall_result IN ('PASS','WARNING','BLOCKED','UNKNOWN')),
  generation_readiness TEXT NOT NULL CHECK(generation_readiness IN ('NOT_READY','READY_FOR_GENERATION')),
  rule_set_version TEXT NOT NULL,
  assessed_at TEXT NOT NULL,
  assessed_by TEXT NOT NULL REFERENCES users(id),
  UNIQUE(artifact_version_id)
);
CREATE INDEX preflight_project_idx ON preflight_assessments(workspace_id,project_id,assessed_at);
CREATE TABLE preflight_checks (
  id TEXT PRIMARY KEY NOT NULL,
  preflight_assessment_id TEXT NOT NULL REFERENCES preflight_assessments(id),
  check_key TEXT NOT NULL,
  result TEXT NOT NULL CHECK(result IN ('PASS','WARNING','BLOCKED','UNKNOWN')),
  explanation TEXT NOT NULL,
  evidence_json TEXT DEFAULT '{}' NOT NULL CHECK(json_valid(evidence_json) AND length(evidence_json)<=16384),
  rule_version TEXT,
  override_allowed INTEGER DEFAULT 0 NOT NULL CHECK(override_allowed IN (0,1)),
  override_actor_id TEXT REFERENCES users(id),
  override_reason TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(preflight_assessment_id,check_key)
);

CREATE TRIGGER editorial_versions_no_update BEFORE UPDATE ON editorial_artifact_versions BEGIN SELECT RAISE(ABORT,'editorial artifact versions are immutable'); END;
CREATE TRIGGER editorial_versions_no_delete BEFORE DELETE ON editorial_artifact_versions BEGIN SELECT RAISE(ABORT,'editorial artifact versions are immutable'); END;
CREATE TRIGGER artifact_approvals_no_update BEFORE UPDATE ON artifact_approvals BEGIN SELECT RAISE(ABORT,'artifact approvals are append-only'); END;
CREATE TRIGGER artifact_approvals_no_delete BEFORE DELETE ON artifact_approvals BEGIN SELECT RAISE(ABORT,'artifact approvals are append-only'); END;
CREATE TRIGGER artifact_status_events_no_update BEFORE UPDATE ON artifact_status_events BEGIN SELECT RAISE(ABORT,'artifact status events are append-only'); END;
CREATE TRIGGER artifact_status_events_no_delete BEFORE DELETE ON artifact_status_events BEGIN SELECT RAISE(ABORT,'artifact status events are append-only'); END;
CREATE TRIGGER prompt_versions_no_update BEFORE UPDATE ON prompt_versions BEGIN SELECT RAISE(ABORT,'prompt versions are immutable'); END;
CREATE TRIGGER prompt_versions_no_delete BEFORE DELETE ON prompt_versions BEGIN SELECT RAISE(ABORT,'prompt versions are immutable'); END;

INSERT INTO prompt_definitions(id,key,task_type,description,status,created_at,updated_at,version) VALUES
('prompt_topic_research','topic_research','TOPIC_RESEARCH','Research planning prompt definition','active',datetime('now'),datetime('now'),1),
('prompt_idea_generation','idea_generation','IDEA_GENERATION','Idea candidate generation prompt definition','active',datetime('now'),datetime('now'),1),
('prompt_content_brief','content_brief','CONTENT_BRIEF','Content brief prompt definition','active',datetime('now'),datetime('now'),1),
('prompt_script_writer_short','script_writer_short','SCRIPT_WRITER_SHORT','Short production script prompt definition','active',datetime('now'),datetime('now'),1),
('prompt_script_writer_long','script_writer_long','SCRIPT_WRITER_LONG','Long-form production script prompt definition','active',datetime('now'),datetime('now'),1),
('prompt_script_critic','script_critic','SCRIPT_CRITIC','Script critique prompt definition','active',datetime('now'),datetime('now'),1),
('prompt_review_translation_es','review_translation_es','REVIEW_TRANSLATION_ES','Spanish review translation prompt definition','active',datetime('now'),datetime('now'),1),
('prompt_storyboard_planner','storyboard_planner','STORYBOARD_PLANNER','Storyboard planning prompt definition','active',datetime('now'),datetime('now'),1),
('prompt_preflight_analysis','preflight_analysis','PREFLIGHT_ANALYSIS','Preflight explanation prompt definition','active',datetime('now'),datetime('now'),1);
