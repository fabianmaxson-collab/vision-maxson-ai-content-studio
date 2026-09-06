PRAGMA foreign_keys = ON;

CREATE TABLE _migration_0004_preflight_guard (id INTEGER PRIMARY KEY CHECK(id=1));

CREATE TRIGGER migration_0004_guard_singletons BEFORE INSERT ON _migration_0004_preflight_guard
WHEN EXISTS (
  SELECT 1 FROM editorial_artifacts
  WHERE deleted_at IS NULL AND artifact_type IN ('RESEARCH','CONTENT_BRIEF','PRODUCTION_SCRIPT','REVIEW_TRANSLATION','SCRIPT_CRITIQUE','STORYBOARD','PREFLIGHT')
  GROUP BY workspace_id,project_id,artifact_type HAVING COUNT(*)>1
)
BEGIN SELECT RAISE(ABORT,'migration_0004_duplicate_singleton'); END;

CREATE TRIGGER migration_0004_guard_selected_ideas BEFORE INSERT ON _migration_0004_preflight_guard
WHEN EXISTS (SELECT 1 FROM idea_candidates WHERE status='SELECTED' GROUP BY project_id HAVING COUNT(*)>1)
BEGIN SELECT RAISE(ABORT,'migration_0004_duplicate_selected_idea'); END;

CREATE TRIGGER migration_0004_guard_terminal_audit_duplicates BEFORE INSERT ON _migration_0004_preflight_guard
WHEN EXISTS (
  SELECT 1 FROM audit_events
  WHERE resource_type='intelligence_run' AND action IN ('intelligence.run_completed','intelligence.run_failed')
  GROUP BY workspace_id,resource_id HAVING COUNT(*)>1
)
BEGIN SELECT RAISE(ABORT,'migration_0004_duplicate_terminal_audit'); END;

CREATE TRIGGER migration_0004_guard_terminal_audit_missing BEFORE INSERT ON _migration_0004_preflight_guard
WHEN EXISTS (
  SELECT 1 FROM intelligence_runs r
  WHERE r.status IN ('SUCCEEDED','FAILED_RETRYABLE','FAILED_PERMANENT')
    AND NOT EXISTS (
      SELECT 1 FROM audit_events a
      WHERE a.workspace_id=r.workspace_id AND a.resource_type='intelligence_run' AND a.resource_id=r.id
        AND a.action=CASE WHEN r.status='SUCCEEDED' THEN 'intelligence.run_completed' ELSE 'intelligence.run_failed' END
        AND a.outcome=CASE WHEN r.status='SUCCEEDED' THEN 'success' ELSE 'failure' END
    )
)
BEGIN SELECT RAISE(ABORT,'migration_0004_terminal_audit_missing'); END;

CREATE TRIGGER migration_0004_guard_reservation_scope BEFORE INSERT ON _migration_0004_preflight_guard
WHEN EXISTS (
  SELECT 1 FROM editorial_execution_reservations r JOIN editorial_execution_envelopes e ON e.id=r.envelope_id
  WHERE r.workspace_id<>e.workspace_id OR r.project_id<>e.project_id
)
BEGIN SELECT RAISE(ABORT,'migration_0004_reservation_scope_invalid'); END;

CREATE TRIGGER migration_0004_guard_reservation_calls BEFORE INSERT ON _migration_0004_preflight_guard
WHEN EXISTS (
  SELECT 1 FROM editorial_execution_envelopes e
  WHERE (SELECT COUNT(*) FROM editorial_execution_reservations r WHERE r.envelope_id=e.id)>e.maximum_calls
)
BEGIN SELECT RAISE(ABORT,'migration_0004_reservation_call_limit_invalid'); END;

CREATE TRIGGER migration_0004_guard_reservation_budget BEFORE INSERT ON _migration_0004_preflight_guard
WHEN EXISTS (
  SELECT 1 FROM editorial_execution_envelopes e
  WHERE COALESCE((SELECT SUM(r.reserved_microusd) FROM editorial_execution_reservations r WHERE r.envelope_id=e.id AND r.status<>'CANCELLED'),0)>e.monetary_ceiling_microusd
)
BEGIN SELECT RAISE(ABORT,'migration_0004_reservation_budget_invalid'); END;

CREATE TRIGGER migration_0004_guard_research_source_version BEFORE INSERT ON _migration_0004_preflight_guard
WHEN EXISTS (
  SELECT 1 FROM research_sources s
  LEFT JOIN editorial_artifact_versions v ON v.id=s.research_version_id AND v.workspace_id=s.workspace_id
  LEFT JOIN editorial_artifacts a ON a.id=v.artifact_id AND a.workspace_id=s.workspace_id
  WHERE v.id IS NULL OR a.id IS NULL OR a.artifact_type<>'RESEARCH'
)
BEGIN SELECT RAISE(ABORT,'migration_0004_research_source_version_invalid'); END;

CREATE TRIGGER migration_0004_guard_observed_claim_scope BEFORE INSERT ON _migration_0004_preflight_guard
WHEN EXISTS (
  SELECT 1 FROM research_claims c LEFT JOIN research_sources s ON s.id=c.source_id
  WHERE c.evidence_class='OBSERVED' AND (s.id IS NULL OR s.workspace_id<>c.workspace_id OR s.research_version_id<>c.research_version_id)
)
BEGIN SELECT RAISE(ABORT,'migration_0004_observed_claim_scope_invalid'); END;

INSERT INTO _migration_0004_preflight_guard(id) VALUES(1);

DROP TRIGGER migration_0004_guard_singletons;
DROP TRIGGER migration_0004_guard_selected_ideas;
DROP TRIGGER migration_0004_guard_terminal_audit_duplicates;
DROP TRIGGER migration_0004_guard_terminal_audit_missing;
DROP TRIGGER migration_0004_guard_reservation_scope;
DROP TRIGGER migration_0004_guard_reservation_calls;
DROP TRIGGER migration_0004_guard_reservation_budget;
DROP TRIGGER migration_0004_guard_research_source_version;
DROP TRIGGER migration_0004_guard_observed_claim_scope;
DROP TABLE _migration_0004_preflight_guard;

CREATE TABLE editorial_project_execution_budgets (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  profile_key TEXT NOT NULL,
  profile_version INTEGER NOT NULL CHECK(profile_version>0),
  currency TEXT NOT NULL CHECK(currency='USD'),
  monetary_ceiling_microusd INTEGER NOT NULL CHECK(monetary_ceiling_microusd>0),
  status TEXT DEFAULT 'ACTIVE' NOT NULL CHECK(status IN ('ACTIVE','CONSUMED','CANCELLED','EXPIRED')),
  authorized_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER DEFAULT 1 NOT NULL CHECK(version>0)
);

CREATE UNIQUE INDEX editorial_project_budgets_active_uq
  ON editorial_project_execution_budgets(workspace_id,project_id,profile_key,profile_version)
  WHERE status='ACTIVE';
CREATE INDEX editorial_project_budgets_project_idx
  ON editorial_project_execution_budgets(workspace_id,project_id,status);

PRAGMA defer_foreign_keys = ON;

CREATE TABLE _0004_editorial_execution_envelopes_new (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  profile_key TEXT NOT NULL,
  profile_version INTEGER NOT NULL CHECK(profile_version>0),
  provider_id TEXT NOT NULL REFERENCES ai_providers(id),
  provider_model_id TEXT NOT NULL REFERENCES ai_provider_models(id),
  currency TEXT NOT NULL CHECK(currency='USD'),
  monetary_ceiling_microusd INTEGER NOT NULL CHECK(monetary_ceiling_microusd>0),
  maximum_calls INTEGER NOT NULL,
  status TEXT DEFAULT 'ACTIVE' NOT NULL CHECK(status IN ('ACTIVE','CONSUMED','CANCELLED','EXPIRED')),
  authorized_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER DEFAULT 1 NOT NULL CHECK(version>0),
  project_execution_budget_id TEXT REFERENCES editorial_project_execution_budgets(id),
  stage_key TEXT CHECK(stage_key IS NULL OR stage_key IN ('TOPIC_RESEARCH','IDEA_GENERATION','CONTENT_BRIEF','SCRIPT_WRITER_SHORT','SCRIPT_WRITER_LONG','REVIEW_TRANSLATION_ES','SCRIPT_CRITIC','STORYBOARD_PLANNER')),
  CHECK(
    (project_execution_budget_id IS NULL AND stage_key IS NULL AND maximum_calls=2 AND monetary_ceiling_microusd<=7000)
    OR
    (project_execution_budget_id IS NOT NULL AND stage_key IS NOT NULL AND maximum_calls=1)
  )
);

CREATE TABLE _0004_editorial_execution_reservations_new (
  id TEXT PRIMARY KEY NOT NULL,
  envelope_id TEXT NOT NULL REFERENCES _0004_editorial_execution_envelopes_new(id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  intelligence_run_id TEXT NOT NULL REFERENCES intelligence_runs(id),
  step_key TEXT NOT NULL CHECK(step_key IN ('TOPIC_RESEARCH','IDEA_GENERATION','CONTENT_BRIEF','SCRIPT_WRITER_SHORT','SCRIPT_WRITER_LONG','REVIEW_TRANSLATION_ES','SCRIPT_CRITIC','STORYBOARD_PLANNER')),
  pricing_snapshot_id TEXT NOT NULL REFERENCES ai_pricing_snapshots(id),
  reserved_microusd INTEGER NOT NULL CHECK(reserved_microusd>0),
  actual_microusd INTEGER CHECK(actual_microusd IS NULL OR actual_microusd>=0),
  status TEXT DEFAULT 'RESERVED' NOT NULL CHECK(status IN ('RESERVED','DISPATCHED','RECONCILED','AMBIGUOUS','CANCELLED')),
  created_at TEXT NOT NULL,
  dispatched_at TEXT,
  reconciled_at TEXT,
  project_execution_budget_id TEXT REFERENCES editorial_project_execution_budgets(id),
  UNIQUE(envelope_id,step_key),
  UNIQUE(intelligence_run_id)
);

INSERT INTO _0004_editorial_execution_envelopes_new(
  id,workspace_id,project_id,profile_key,profile_version,provider_id,provider_model_id,currency,
  monetary_ceiling_microusd,maximum_calls,status,authorized_by,created_at,updated_at,version,
  project_execution_budget_id,stage_key
)
SELECT id,workspace_id,project_id,profile_key,profile_version,provider_id,provider_model_id,currency,
  monetary_ceiling_microusd,maximum_calls,status,authorized_by,created_at,updated_at,version,NULL,NULL
FROM editorial_execution_envelopes;

INSERT INTO _0004_editorial_execution_reservations_new(
  id,envelope_id,workspace_id,project_id,intelligence_run_id,step_key,pricing_snapshot_id,
  reserved_microusd,actual_microusd,status,created_at,dispatched_at,reconciled_at,project_execution_budget_id
)
SELECT id,envelope_id,workspace_id,project_id,intelligence_run_id,step_key,pricing_snapshot_id,
  reserved_microusd,actual_microusd,status,created_at,dispatched_at,reconciled_at,NULL
FROM editorial_execution_reservations;

CREATE TABLE _migration_0004_copy_guard (id INTEGER PRIMARY KEY CHECK(id=1));
CREATE TRIGGER migration_0004_guard_envelope_copy BEFORE INSERT ON _migration_0004_copy_guard
WHEN (SELECT COUNT(*) FROM editorial_execution_envelopes)<>(SELECT COUNT(*) FROM _0004_editorial_execution_envelopes_new)
  OR EXISTS (
    SELECT 1 FROM editorial_execution_envelopes old
    LEFT JOIN _0004_editorial_execution_envelopes_new new ON new.id=old.id
    WHERE new.id IS NULL OR new.workspace_id<>old.workspace_id OR new.project_id<>old.project_id
      OR new.profile_key<>old.profile_key OR new.profile_version<>old.profile_version
      OR new.provider_id<>old.provider_id OR new.provider_model_id<>old.provider_model_id
      OR new.currency<>old.currency OR new.monetary_ceiling_microusd<>old.monetary_ceiling_microusd
      OR new.maximum_calls<>old.maximum_calls OR new.status<>old.status OR new.authorized_by<>old.authorized_by
      OR new.created_at<>old.created_at OR new.updated_at<>old.updated_at OR new.version<>old.version
      OR new.project_execution_budget_id IS NOT NULL OR new.stage_key IS NOT NULL
  )
BEGIN SELECT RAISE(ABORT,'migration_0004_envelope_copy_mismatch'); END;

CREATE TRIGGER migration_0004_guard_reservation_copy BEFORE INSERT ON _migration_0004_copy_guard
WHEN (SELECT COUNT(*) FROM editorial_execution_reservations)<>(SELECT COUNT(*) FROM _0004_editorial_execution_reservations_new)
  OR EXISTS (
    SELECT 1 FROM editorial_execution_reservations old
    LEFT JOIN _0004_editorial_execution_reservations_new new ON new.id=old.id
    WHERE new.id IS NULL OR new.envelope_id<>old.envelope_id OR new.workspace_id<>old.workspace_id
      OR new.project_id<>old.project_id OR new.intelligence_run_id<>old.intelligence_run_id
      OR new.step_key<>old.step_key OR new.pricing_snapshot_id<>old.pricing_snapshot_id
      OR new.reserved_microusd<>old.reserved_microusd OR new.actual_microusd IS NOT old.actual_microusd
      OR new.status<>old.status OR new.created_at<>old.created_at
      OR new.dispatched_at IS NOT old.dispatched_at OR new.reconciled_at IS NOT old.reconciled_at
      OR new.project_execution_budget_id IS NOT NULL
  )
BEGIN SELECT RAISE(ABORT,'migration_0004_reservation_copy_mismatch'); END;

INSERT INTO _migration_0004_copy_guard(id) VALUES(1);
DROP TRIGGER migration_0004_guard_envelope_copy;
DROP TRIGGER migration_0004_guard_reservation_copy;
DROP TABLE _migration_0004_copy_guard;

DROP TABLE editorial_execution_reservations;
DROP TABLE editorial_execution_envelopes;
ALTER TABLE _0004_editorial_execution_envelopes_new RENAME TO editorial_execution_envelopes;
ALTER TABLE _0004_editorial_execution_reservations_new RENAME TO editorial_execution_reservations;

CREATE UNIQUE INDEX editorial_execution_envelopes_active_profile_idx
  ON editorial_execution_envelopes(workspace_id,project_id,profile_key,profile_version)
  WHERE status='ACTIVE' AND project_execution_budget_id IS NULL;
CREATE INDEX editorial_execution_envelopes_project_idx
  ON editorial_execution_envelopes(workspace_id,project_id,status);
CREATE UNIQUE INDEX editorial_stage_envelopes_active_uq
  ON editorial_execution_envelopes(project_execution_budget_id,stage_key)
  WHERE project_execution_budget_id IS NOT NULL AND status='ACTIVE';
CREATE INDEX editorial_stage_envelopes_budget_idx
  ON editorial_execution_envelopes(project_execution_budget_id,status,stage_key);
CREATE INDEX editorial_execution_reservations_envelope_idx
  ON editorial_execution_reservations(envelope_id,status);
CREATE INDEX editorial_reservations_project_budget_idx
  ON editorial_execution_reservations(project_execution_budget_id,status);

CREATE TRIGGER editorial_project_budget_version_guard BEFORE UPDATE ON editorial_project_execution_budgets
WHEN NEW.version<>OLD.version+1
BEGIN SELECT RAISE(ABORT,'project_budget_version_invalid'); END;

CREATE TRIGGER editorial_project_budget_terminal_guard BEFORE UPDATE ON editorial_project_execution_budgets
WHEN OLD.status IN ('CONSUMED','CANCELLED','EXPIRED') AND NEW.status<>OLD.status
BEGIN SELECT RAISE(ABORT,'project_budget_terminal'); END;

CREATE TRIGGER editorial_execution_envelope_budget_guard BEFORE INSERT ON editorial_execution_envelopes
WHEN NEW.project_execution_budget_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM editorial_project_execution_budgets b
  WHERE b.id=NEW.project_execution_budget_id AND b.workspace_id=NEW.workspace_id
    AND b.project_id=NEW.project_id AND b.currency=NEW.currency AND b.status='ACTIVE'
    AND NEW.monetary_ceiling_microusd<=b.monetary_ceiling_microusd
)
BEGIN SELECT RAISE(ABORT,'project_budget_scope_or_status_invalid'); END;

CREATE TRIGGER editorial_execution_envelope_terminal_guard BEFORE UPDATE ON editorial_execution_envelopes
WHEN OLD.status IN ('CONSUMED','CANCELLED','EXPIRED') AND NEW.status<>OLD.status
BEGIN SELECT RAISE(ABORT,'execution_envelope_terminal'); END;

CREATE TRIGGER editorial_execution_reservation_scope_guard BEFORE INSERT ON editorial_execution_reservations
WHEN NOT EXISTS (
  SELECT 1 FROM editorial_execution_envelopes e
  WHERE e.id=NEW.envelope_id AND e.workspace_id=NEW.workspace_id AND e.project_id=NEW.project_id AND e.status='ACTIVE'
)
BEGIN SELECT RAISE(ABORT,'execution_envelope_scope_or_status_invalid'); END;

CREATE TRIGGER editorial_execution_reservation_governance_guard BEFORE INSERT ON editorial_execution_reservations
WHEN NOT EXISTS (
  SELECT 1 FROM editorial_execution_envelopes e
  WHERE e.id=NEW.envelope_id AND (
    (e.project_execution_budget_id IS NULL AND NEW.project_execution_budget_id IS NULL)
    OR
    (e.project_execution_budget_id=NEW.project_execution_budget_id AND e.stage_key=NEW.step_key
      AND EXISTS (
        SELECT 1 FROM editorial_project_execution_budgets b
        WHERE b.id=e.project_execution_budget_id AND b.workspace_id=NEW.workspace_id
          AND b.project_id=NEW.project_id AND b.status='ACTIVE' AND b.currency=e.currency
      )
    )
  )
)
BEGIN SELECT RAISE(ABORT,'execution_reservation_governance_invalid'); END;

CREATE TRIGGER editorial_execution_reservation_currency_guard BEFORE INSERT ON editorial_execution_reservations
WHEN NOT EXISTS (
  SELECT 1 FROM editorial_execution_envelopes e JOIN ai_pricing_snapshots p ON p.id=NEW.pricing_snapshot_id
  WHERE e.id=NEW.envelope_id AND p.currency=e.currency
)
BEGIN SELECT RAISE(ABORT,'execution_reservation_currency_mismatch'); END;

CREATE TRIGGER editorial_execution_reservation_call_limit_guard BEFORE INSERT ON editorial_execution_reservations
WHEN (SELECT COUNT(*) FROM editorial_execution_reservations r WHERE r.envelope_id=NEW.envelope_id)
  >= (SELECT maximum_calls FROM editorial_execution_envelopes e WHERE e.id=NEW.envelope_id)
BEGIN SELECT RAISE(ABORT,'execution_envelope_call_limit_exceeded'); END;

CREATE TRIGGER editorial_execution_reservation_stage_budget_guard BEFORE INSERT ON editorial_execution_reservations
WHEN COALESCE((
  SELECT SUM(CASE r.status
    WHEN 'RECONCILED' THEN r.actual_microusd
    WHEN 'CANCELLED' THEN 0
    WHEN 'AMBIGUOUS' THEN MAX(r.reserved_microusd,COALESCE(r.actual_microusd,r.reserved_microusd))
    ELSE r.reserved_microusd END)
  FROM editorial_execution_reservations r WHERE r.envelope_id=NEW.envelope_id
),0)+NEW.reserved_microusd > (
  SELECT monetary_ceiling_microusd FROM editorial_execution_envelopes e WHERE e.id=NEW.envelope_id
)
BEGIN SELECT RAISE(ABORT,'execution_envelope_budget_exceeded'); END;

CREATE TRIGGER editorial_execution_reservation_ambiguous_guard BEFORE INSERT ON editorial_execution_reservations
WHEN NEW.project_execution_budget_id IS NOT NULL AND EXISTS (
  SELECT 1 FROM editorial_execution_reservations r
  WHERE r.project_execution_budget_id=NEW.project_execution_budget_id AND r.status='AMBIGUOUS'
)
BEGIN SELECT RAISE(ABORT,'project_budget_has_ambiguous_reservation'); END;

CREATE TRIGGER editorial_execution_reservation_global_budget_guard BEFORE INSERT ON editorial_execution_reservations
WHEN NEW.project_execution_budget_id IS NOT NULL AND COALESCE((
  SELECT SUM(CASE r.status
    WHEN 'RECONCILED' THEN r.actual_microusd
    WHEN 'CANCELLED' THEN 0
    WHEN 'AMBIGUOUS' THEN MAX(r.reserved_microusd,COALESCE(r.actual_microusd,r.reserved_microusd))
    ELSE r.reserved_microusd END)
  FROM editorial_execution_reservations r WHERE r.project_execution_budget_id=NEW.project_execution_budget_id
),0)+NEW.reserved_microusd > (
  SELECT monetary_ceiling_microusd FROM editorial_project_execution_budgets b
  WHERE b.id=NEW.project_execution_budget_id AND b.status='ACTIVE'
)
BEGIN SELECT RAISE(ABORT,'project_execution_budget_exceeded'); END;

CREATE TRIGGER editorial_execution_reservation_lifecycle_guard BEFORE UPDATE ON editorial_execution_reservations
WHEN NOT (
  OLD.status=NEW.status
  OR (OLD.status='RESERVED' AND NEW.status IN ('DISPATCHED','CANCELLED'))
  OR (OLD.status='DISPATCHED' AND NEW.status IN ('RECONCILED','AMBIGUOUS','CANCELLED'))
  OR (OLD.status='AMBIGUOUS' AND NEW.status IN ('RECONCILED','CANCELLED'))
)
BEGIN SELECT RAISE(ABORT,'execution_reservation_transition_invalid'); END;

CREATE TRIGGER editorial_execution_reservation_reconcile_guard BEFORE UPDATE ON editorial_execution_reservations
WHEN NEW.status='RECONCILED' AND (NEW.actual_microusd IS NULL OR NEW.actual_microusd>NEW.reserved_microusd)
BEGIN SELECT RAISE(ABORT,'execution_reservation_reconciliation_overrun'); END;

ALTER TABLE research_sources ADD COLUMN source_key TEXT;
ALTER TABLE research_sources ADD COLUMN source_fingerprint TEXT;
ALTER TABLE research_sources ADD COLUMN content_hash TEXT;
ALTER TABLE research_sources ADD COLUMN provenance_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(provenance_json) AND length(provenance_json)<=16384);

CREATE UNIQUE INDEX research_sources_fingerprint_uq
  ON research_sources(research_version_id,source_fingerprint)
  WHERE source_fingerprint IS NOT NULL;

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

CREATE TRIGGER research_sources_fingerprint_update_guard BEFORE UPDATE OF source_fingerprint ON research_sources
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

CREATE TRIGGER research_claim_source_update_guard BEFORE UPDATE OF source_id,research_version_id,workspace_id ON research_claims
WHEN NEW.source_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM research_sources s
  WHERE s.id=NEW.source_id AND s.workspace_id=NEW.workspace_id AND s.research_version_id=NEW.research_version_id
)
BEGIN SELECT RAISE(ABORT,'research_claim_source_scope_invalid'); END;

CREATE UNIQUE INDEX idea_candidates_selected_project_uq
  ON idea_candidates(project_id) WHERE status='SELECTED';

CREATE UNIQUE INDEX editorial_artifacts_singleton_active_uq
  ON editorial_artifacts(workspace_id,project_id,artifact_type)
  WHERE deleted_at IS NULL AND artifact_type IN ('RESEARCH','CONTENT_BRIEF','PRODUCTION_SCRIPT','REVIEW_TRANSLATION','SCRIPT_CRITIQUE','STORYBOARD','PREFLIGHT');
CREATE INDEX editorial_artifacts_current_resolution_idx
  ON editorial_artifacts(workspace_id,project_id,artifact_type,current_version_id)
  WHERE deleted_at IS NULL;
CREATE INDEX artifact_dependencies_dependent_idx
  ON artifact_dependencies(workspace_id,dependent_artifact_version_id,dependency_type,validity_status);

ALTER TABLE audit_events ADD COLUMN terminal_intelligence_run_id TEXT
  GENERATED ALWAYS AS (
    CASE WHEN resource_type='intelligence_run' AND action IN ('intelligence.run_completed','intelligence.run_failed')
      THEN resource_id ELSE NULL END
  ) VIRTUAL;

CREATE UNIQUE INDEX audit_terminal_intelligence_run_uq
  ON audit_events(workspace_id,terminal_intelligence_run_id)
  WHERE terminal_intelligence_run_id IS NOT NULL;

ALTER TABLE intelligence_runs ADD COLUMN terminal_audit_event_id TEXT;

UPDATE intelligence_runs
SET terminal_audit_event_id=(
  SELECT a.id FROM audit_events a
  WHERE a.workspace_id=intelligence_runs.workspace_id AND a.resource_type='intelligence_run'
    AND a.resource_id=intelligence_runs.id
    AND a.action=CASE WHEN intelligence_runs.status='SUCCEEDED' THEN 'intelligence.run_completed' ELSE 'intelligence.run_failed' END
    AND a.outcome=CASE WHEN intelligence_runs.status='SUCCEEDED' THEN 'success' ELSE 'failure' END
)
WHERE status IN ('SUCCEEDED','FAILED_RETRYABLE','FAILED_PERMANENT');

CREATE TRIGGER terminal_audit_insert_scope_guard BEFORE INSERT ON audit_events
WHEN NEW.action IN ('intelligence.run_completed','intelligence.run_failed') AND NOT EXISTS (
  SELECT 1 FROM intelligence_runs r
  WHERE r.id=NEW.resource_id AND r.workspace_id=NEW.workspace_id AND NEW.resource_type='intelligence_run'
)
BEGIN SELECT RAISE(ABORT,'terminal_audit_scope_invalid'); END;

CREATE TRIGGER intelligence_run_terminal_insert_guard BEFORE INSERT ON intelligence_runs
WHEN NEW.status IN ('SUCCEEDED','FAILED_RETRYABLE','FAILED_PERMANENT')
  AND (NEW.terminal_audit_event_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM audit_events a WHERE a.id=NEW.terminal_audit_event_id
      AND a.workspace_id=NEW.workspace_id AND a.resource_type='intelligence_run' AND a.resource_id=NEW.id
      AND a.action=CASE WHEN NEW.status='SUCCEEDED' THEN 'intelligence.run_completed' ELSE 'intelligence.run_failed' END
      AND a.outcome=CASE WHEN NEW.status='SUCCEEDED' THEN 'success' ELSE 'failure' END
  ))
BEGIN SELECT RAISE(ABORT,'intelligence_run_terminal_audit_invalid'); END;

CREATE TRIGGER intelligence_run_terminal_update_guard BEFORE UPDATE OF status,terminal_audit_event_id ON intelligence_runs
WHEN NEW.status IN ('SUCCEEDED','FAILED_RETRYABLE','FAILED_PERMANENT')
  AND (NEW.terminal_audit_event_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM audit_events a WHERE a.id=NEW.terminal_audit_event_id
      AND a.workspace_id=NEW.workspace_id AND a.resource_type='intelligence_run' AND a.resource_id=NEW.id
      AND a.action=CASE WHEN NEW.status='SUCCEEDED' THEN 'intelligence.run_completed' ELSE 'intelligence.run_failed' END
      AND a.outcome=CASE WHEN NEW.status='SUCCEEDED' THEN 'success' ELSE 'failure' END
  ))
BEGIN SELECT RAISE(ABORT,'intelligence_run_terminal_audit_invalid'); END;

CREATE TRIGGER intelligence_run_terminal_pointer_guard BEFORE UPDATE OF terminal_audit_event_id ON intelligence_runs
WHEN OLD.terminal_audit_event_id IS NOT NULL AND NEW.terminal_audit_event_id IS NOT OLD.terminal_audit_event_id
BEGIN SELECT RAISE(ABORT,'intelligence_run_terminal_audit_immutable'); END;

CREATE TRIGGER intelligence_run_terminal_status_guard BEFORE UPDATE OF status ON intelligence_runs
WHEN OLD.status IN ('SUCCEEDED','FAILED_RETRYABLE','FAILED_PERMANENT') AND NEW.status<>OLD.status
BEGIN SELECT RAISE(ABORT,'intelligence_run_terminal_status_immutable'); END;

PRAGMA defer_foreign_keys = OFF;
PRAGMA foreign_key_check;
