PRAGMA foreign_keys = OFF;

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
DROP TRIGGER research_sources_version_insert_guard;
DROP TRIGGER research_sources_version_update_guard;

PRAGMA legacy_alter_table = ON;
ALTER TABLE editorial_artifact_versions RENAME TO _0005_editorial_artifact_versions_old;

CREATE TABLE editorial_artifact_versions (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  artifact_id TEXT NOT NULL REFERENCES editorial_artifacts(id),
  version_number INTEGER NOT NULL CHECK(version_number>0),
  parent_version_id TEXT REFERENCES editorial_artifact_versions(id),
  language_code TEXT NOT NULL,
  content_text TEXT CHECK(content_text IS NULL OR length(content_text)<=262144),
  content_json TEXT CHECK(content_json IS NULL OR (json_valid(content_json) AND length(content_json)<=262144)),
  source_type TEXT NOT NULL CHECK(source_type IN ('AI_GENERATED','HUMAN_EDITED','IMPORTED','DETERMINISTIC')),
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
  CHECK(source_type!='DETERMINISTIC' OR intelligence_run_id IS NULL),
  CHECK(source_script_version_id IS NULL OR source_script_version_id!=id)
);

INSERT INTO editorial_artifact_versions(
 id,workspace_id,artifact_id,version_number,parent_version_id,language_code,content_text,content_json,
 source_type,intelligence_run_id,content_hash,word_count,narration_rate_profile_id,
 estimated_duration_seconds,source_script_version_id,created_at,created_by
)
SELECT id,workspace_id,artifact_id,version_number,parent_version_id,language_code,content_text,content_json,
 source_type,intelligence_run_id,content_hash,word_count,narration_rate_profile_id,
 estimated_duration_seconds,source_script_version_id,created_at,created_by
FROM _0005_editorial_artifact_versions_old;

CREATE TABLE _migration_0005_copy_guard (id INTEGER PRIMARY KEY CHECK(id=1));
CREATE TRIGGER migration_0005_copy_guard BEFORE INSERT ON _migration_0005_copy_guard
WHEN (SELECT COUNT(*) FROM _0005_editorial_artifact_versions_old)<>(SELECT COUNT(*) FROM editorial_artifact_versions)
 OR EXISTS(
  SELECT 1 FROM _0005_editorial_artifact_versions_old old
  LEFT JOIN editorial_artifact_versions new ON new.id=old.id
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

DROP TABLE _0005_editorial_artifact_versions_old;
PRAGMA legacy_alter_table = OFF;
PRAGMA foreign_keys = ON;

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
