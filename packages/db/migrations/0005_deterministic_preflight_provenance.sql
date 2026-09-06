PRAGMA foreign_keys = ON;
PRAGMA defer_foreign_keys = ON;

CREATE TABLE _migration_0005_guard (id INTEGER PRIMARY KEY CHECK(id=1));
CREATE TRIGGER migration_0005_source_guard BEFORE INSERT ON _migration_0005_guard
WHEN EXISTS(SELECT 1 FROM editorial_artifact_versions WHERE source_type NOT IN ('AI_GENERATED','HUMAN_EDITED','IMPORTED'))
  OR EXISTS(SELECT 1 FROM editorial_artifact_versions WHERE source_type='AI_GENERATED' AND intelligence_run_id IS NULL)
BEGIN SELECT RAISE(ABORT,'migration_0005_historical_source_invalid'); END;
INSERT INTO _migration_0005_guard(id) VALUES(1);
DROP TRIGGER migration_0005_source_guard;
DROP TABLE _migration_0005_guard;

DROP TRIGGER editorial_versions_no_update;
DROP TRIGGER editorial_versions_no_delete;
DROP TRIGGER artifact_approvals_no_update;
DROP TRIGGER artifact_approvals_no_delete;
DROP TRIGGER artifact_status_events_no_update;
DROP TRIGGER artifact_status_events_no_delete;
DROP TRIGGER research_sources_version_insert_guard;
DROP TRIGGER research_sources_version_update_guard;
DROP TRIGGER research_sources_fingerprint_insert_guard;
DROP TRIGGER research_claim_source_insert_guard;

CREATE TABLE _0005_artifact_current_versions AS
SELECT id,current_version_id FROM editorial_artifacts WHERE current_version_id IS NOT NULL;
CREATE TABLE _0005_artifact_dependencies AS SELECT * FROM artifact_dependencies;
CREATE TABLE _0005_artifact_approvals AS SELECT * FROM artifact_approvals;
CREATE TABLE _0005_artifact_status_events AS SELECT * FROM artifact_status_events;
CREATE TABLE _0005_research_sources AS SELECT * FROM research_sources;
CREATE TABLE _0005_research_claims AS SELECT * FROM research_claims;
CREATE TABLE _0005_idea_candidates AS SELECT * FROM idea_candidates;
CREATE TABLE _0005_idea_score_components AS SELECT * FROM idea_score_components;
CREATE TABLE _0005_script_segments AS SELECT * FROM script_segments;
CREATE TABLE _0005_storyboard_scenes AS SELECT * FROM storyboard_scenes;
CREATE TABLE _0005_scene_script_segments AS SELECT * FROM scene_script_segments;
CREATE TABLE _0005_preflight_assessments AS SELECT * FROM preflight_assessments;
CREATE TABLE _0005_preflight_checks AS SELECT * FROM preflight_checks;

DELETE FROM preflight_checks;
DELETE FROM preflight_assessments;
DELETE FROM scene_script_segments;
DELETE FROM storyboard_scenes;
DELETE FROM script_segments;
DELETE FROM idea_score_components;
DELETE FROM idea_candidates;
DELETE FROM research_claims;
DELETE FROM research_sources;
DELETE FROM artifact_status_events;
DELETE FROM artifact_approvals;
DELETE FROM artifact_dependencies;
UPDATE editorial_artifacts SET current_version_id=NULL WHERE current_version_id IS NOT NULL;

CREATE TABLE _0005_editorial_artifact_versions_new (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  artifact_id TEXT NOT NULL REFERENCES editorial_artifacts(id),
  version_number INTEGER NOT NULL CHECK(version_number>0),
  parent_version_id TEXT REFERENCES _0005_editorial_artifact_versions_new(id),
  language_code TEXT NOT NULL,
  content_text TEXT CHECK(content_text IS NULL OR length(content_text)<=262144),
  content_json TEXT CHECK(content_json IS NULL OR (json_valid(content_json) AND length(content_json)<=262144)),
  source_type TEXT NOT NULL CHECK(source_type IN ('AI_GENERATED','HUMAN_EDITED','IMPORTED','DETERMINISTIC')),
  intelligence_run_id TEXT REFERENCES intelligence_runs(id),
  content_hash TEXT NOT NULL CHECK(length(content_hash)=64),
  word_count INTEGER CHECK(word_count IS NULL OR word_count>=0),
  narration_rate_profile_id TEXT,
  estimated_duration_seconds REAL CHECK(estimated_duration_seconds IS NULL OR estimated_duration_seconds>=0),
  source_script_version_id TEXT REFERENCES _0005_editorial_artifact_versions_new(id),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  UNIQUE(artifact_id,version_number),
  CHECK(content_text IS NOT NULL OR content_json IS NOT NULL),
  CHECK(source_type!='AI_GENERATED' OR intelligence_run_id IS NOT NULL),
  CHECK(source_type!='DETERMINISTIC' OR intelligence_run_id IS NULL),
  CHECK(source_script_version_id IS NULL OR source_script_version_id!=id)
);

INSERT INTO _0005_editorial_artifact_versions_new(
 id,workspace_id,artifact_id,version_number,parent_version_id,language_code,content_text,content_json,
 source_type,intelligence_run_id,content_hash,word_count,narration_rate_profile_id,
 estimated_duration_seconds,source_script_version_id,created_at,created_by
)
SELECT id,workspace_id,artifact_id,version_number,parent_version_id,language_code,content_text,content_json,
 source_type,intelligence_run_id,content_hash,word_count,narration_rate_profile_id,
 estimated_duration_seconds,source_script_version_id,created_at,created_by
FROM editorial_artifact_versions;

CREATE TABLE _migration_0005_copy_guard (id INTEGER PRIMARY KEY CHECK(id=1));
CREATE TRIGGER migration_0005_copy_guard BEFORE INSERT ON _migration_0005_copy_guard
WHEN (SELECT COUNT(*) FROM editorial_artifact_versions)<>(SELECT COUNT(*) FROM _0005_editorial_artifact_versions_new)
 OR EXISTS(
  SELECT 1 FROM editorial_artifact_versions old
  LEFT JOIN _0005_editorial_artifact_versions_new new ON new.id=old.id
  WHERE new.id IS NULL OR new.workspace_id<>old.workspace_id OR new.artifact_id<>old.artifact_id
   OR new.version_number<>old.version_number OR new.parent_version_id IS NOT old.parent_version_id
   OR new.language_code<>old.language_code OR new.content_text IS NOT old.content_text
   OR new.content_json IS NOT old.content_json OR new.source_type<>old.source_type
   OR new.intelligence_run_id IS NOT old.intelligence_run_id OR new.content_hash<>old.content_hash
   OR new.word_count IS NOT old.word_count OR new.narration_rate_profile_id IS NOT old.narration_rate_profile_id
   OR new.estimated_duration_seconds IS NOT old.estimated_duration_seconds
   OR new.source_script_version_id IS NOT old.source_script_version_id OR new.created_at<>old.created_at
   OR new.created_by<>old.created_by
 )
BEGIN SELECT RAISE(ABORT,'migration_0005_copy_mismatch'); END;
INSERT INTO _migration_0005_copy_guard(id) VALUES(1);
DROP TRIGGER migration_0005_copy_guard;
DROP TABLE _migration_0005_copy_guard;

DELETE FROM editorial_artifact_versions;
DROP TABLE editorial_artifact_versions;
ALTER TABLE _0005_editorial_artifact_versions_new RENAME TO editorial_artifact_versions;

UPDATE editorial_artifacts
SET current_version_id=(SELECT current_version_id FROM _0005_artifact_current_versions saved WHERE saved.id=editorial_artifacts.id)
WHERE id IN (SELECT id FROM _0005_artifact_current_versions);
INSERT INTO artifact_dependencies SELECT * FROM _0005_artifact_dependencies;
INSERT INTO artifact_approvals SELECT * FROM _0005_artifact_approvals;
INSERT INTO artifact_status_events SELECT * FROM _0005_artifact_status_events;
INSERT INTO research_sources SELECT * FROM _0005_research_sources;
INSERT INTO research_claims SELECT * FROM _0005_research_claims;
INSERT INTO idea_candidates SELECT * FROM _0005_idea_candidates;
INSERT INTO idea_score_components SELECT * FROM _0005_idea_score_components;
INSERT INTO script_segments SELECT * FROM _0005_script_segments;
INSERT INTO storyboard_scenes SELECT * FROM _0005_storyboard_scenes;
INSERT INTO scene_script_segments SELECT * FROM _0005_scene_script_segments;
INSERT INTO preflight_assessments SELECT * FROM _0005_preflight_assessments;
INSERT INTO preflight_checks SELECT * FROM _0005_preflight_checks;

DROP TABLE _0005_preflight_checks;
DROP TABLE _0005_preflight_assessments;
DROP TABLE _0005_scene_script_segments;
DROP TABLE _0005_storyboard_scenes;
DROP TABLE _0005_script_segments;
DROP TABLE _0005_idea_score_components;
DROP TABLE _0005_idea_candidates;
DROP TABLE _0005_research_claims;
DROP TABLE _0005_research_sources;
DROP TABLE _0005_artifact_status_events;
DROP TABLE _0005_artifact_approvals;
DROP TABLE _0005_artifact_dependencies;
DROP TABLE _0005_artifact_current_versions;

CREATE TABLE _migration_0005_fk_guard (id INTEGER PRIMARY KEY CHECK(id=1));
CREATE TRIGGER migration_0005_fk_guard BEFORE INSERT ON _migration_0005_fk_guard
WHEN EXISTS(SELECT 1 FROM pragma_foreign_key_check)
BEGIN SELECT RAISE(ABORT,'migration_0005_foreign_key_mismatch'); END;
INSERT INTO _migration_0005_fk_guard(id) VALUES(1);
DROP TRIGGER migration_0005_fk_guard;
DROP TABLE _migration_0005_fk_guard;

CREATE INDEX artifact_versions_artifact_idx ON editorial_artifact_versions(workspace_id,artifact_id,version_number);
CREATE UNIQUE INDEX artifact_versions_hash_uq ON editorial_artifact_versions(artifact_id,content_hash);
CREATE TRIGGER editorial_versions_no_update BEFORE UPDATE ON editorial_artifact_versions BEGIN SELECT RAISE(ABORT,'editorial artifact versions are immutable'); END;
CREATE TRIGGER editorial_versions_no_delete BEFORE DELETE ON editorial_artifact_versions BEGIN SELECT RAISE(ABORT,'editorial artifact versions are immutable'); END;
CREATE TRIGGER artifact_approvals_no_update BEFORE UPDATE ON artifact_approvals BEGIN SELECT RAISE(ABORT,'artifact approvals are append-only'); END;
CREATE TRIGGER artifact_approvals_no_delete BEFORE DELETE ON artifact_approvals BEGIN SELECT RAISE(ABORT,'artifact approvals are append-only'); END;
CREATE TRIGGER artifact_status_events_no_update BEFORE UPDATE ON artifact_status_events BEGIN SELECT RAISE(ABORT,'artifact status events are append-only'); END;
CREATE TRIGGER artifact_status_events_no_delete BEFORE DELETE ON artifact_status_events BEGIN SELECT RAISE(ABORT,'artifact status events are append-only'); END;

CREATE TRIGGER research_sources_version_insert_guard BEFORE INSERT ON research_sources
WHEN NOT EXISTS (
  SELECT 1 FROM editorial_artifact_versions v JOIN editorial_artifacts a ON a.id=v.artifact_id
  WHERE v.id=NEW.research_version_id AND v.workspace_id=NEW.workspace_id
    AND a.workspace_id=NEW.workspace_id AND a.artifact_type='RESEARCH'
)
BEGIN SELECT RAISE(ABORT,'research_source_version_invalid'); END;

CREATE TRIGGER research_sources_version_update_guard BEFORE UPDATE OF research_version_id,workspace_id ON research_sources
WHEN NOT EXISTS (
  SELECT 1 FROM editorial_artifact_versions v JOIN editorial_artifacts a ON a.id=v.artifact_id
  WHERE v.id=NEW.research_version_id AND v.workspace_id=NEW.workspace_id
    AND a.workspace_id=NEW.workspace_id AND a.artifact_type='RESEARCH'
)
BEGIN SELECT RAISE(ABORT,'research_source_version_invalid'); END;

CREATE TRIGGER research_sources_fingerprint_insert_guard BEFORE INSERT ON research_sources
WHEN NEW.source_fingerprint IS NOT NULL AND (
  length(NEW.source_fingerprint)<>64 OR NEW.source_fingerprint<>lower(NEW.source_fingerprint)
  OR NEW.source_fingerprint GLOB '*[^0-9a-f]*'
)
BEGIN SELECT RAISE(ABORT,'research_source_fingerprint_invalid'); END;

CREATE TRIGGER research_claim_source_insert_guard BEFORE INSERT ON research_claims
WHEN NEW.source_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM research_sources s
  WHERE s.id=NEW.source_id AND s.workspace_id=NEW.workspace_id AND s.research_version_id=NEW.research_version_id
)
BEGIN SELECT RAISE(ABORT,'research_claim_source_scope_invalid'); END;
