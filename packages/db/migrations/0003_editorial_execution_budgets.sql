PRAGMA foreign_keys = ON;

CREATE TABLE editorial_execution_envelopes (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  profile_key TEXT NOT NULL,
  profile_version INTEGER NOT NULL CHECK(profile_version>0),
  provider_id TEXT NOT NULL REFERENCES ai_providers(id),
  provider_model_id TEXT NOT NULL REFERENCES ai_provider_models(id),
  currency TEXT NOT NULL CHECK(currency='USD'),
  monetary_ceiling_microusd INTEGER NOT NULL CHECK(monetary_ceiling_microusd>0 AND monetary_ceiling_microusd<=7000),
  maximum_calls INTEGER NOT NULL CHECK(maximum_calls=2),
  status TEXT DEFAULT 'ACTIVE' NOT NULL CHECK(status IN ('ACTIVE','CONSUMED','CANCELLED','EXPIRED')),
  authorized_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER DEFAULT 1 NOT NULL
);
CREATE UNIQUE INDEX editorial_execution_envelopes_active_profile_idx
  ON editorial_execution_envelopes(workspace_id,project_id,profile_key,profile_version)
  WHERE status='ACTIVE';
CREATE INDEX editorial_execution_envelopes_project_idx
  ON editorial_execution_envelopes(workspace_id,project_id,status);

CREATE TABLE editorial_execution_reservations (
  id TEXT PRIMARY KEY NOT NULL,
  envelope_id TEXT NOT NULL REFERENCES editorial_execution_envelopes(id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  intelligence_run_id TEXT NOT NULL REFERENCES intelligence_runs(id),
  step_key TEXT NOT NULL CHECK(step_key IN ('SCRIPT_WRITER_SHORT','REVIEW_TRANSLATION_ES')),
  pricing_snapshot_id TEXT NOT NULL REFERENCES ai_pricing_snapshots(id),
  reserved_microusd INTEGER NOT NULL CHECK(reserved_microusd>0),
  actual_microusd INTEGER CHECK(actual_microusd IS NULL OR actual_microusd>=0),
  status TEXT DEFAULT 'RESERVED' NOT NULL CHECK(status IN ('RESERVED','DISPATCHED','RECONCILED','AMBIGUOUS','CANCELLED')),
  created_at TEXT NOT NULL,
  dispatched_at TEXT,
  reconciled_at TEXT,
  UNIQUE(envelope_id,step_key),
  UNIQUE(intelligence_run_id)
);
CREATE INDEX editorial_execution_reservations_envelope_idx
  ON editorial_execution_reservations(envelope_id,status);

CREATE TRIGGER editorial_execution_reservation_scope_guard BEFORE INSERT ON editorial_execution_reservations
WHEN NOT EXISTS (SELECT 1 FROM editorial_execution_envelopes e WHERE e.id=NEW.envelope_id AND e.workspace_id=NEW.workspace_id AND e.project_id=NEW.project_id AND e.status='ACTIVE')
BEGIN SELECT RAISE(ABORT,'execution_envelope_scope_or_status_invalid'); END;

CREATE TRIGGER editorial_execution_reservation_call_limit_guard BEFORE INSERT ON editorial_execution_reservations
WHEN (SELECT COUNT(*) FROM editorial_execution_reservations r WHERE r.envelope_id=NEW.envelope_id) >= (SELECT maximum_calls FROM editorial_execution_envelopes e WHERE e.id=NEW.envelope_id)
BEGIN SELECT RAISE(ABORT,'execution_envelope_call_limit_exceeded'); END;

CREATE TRIGGER editorial_execution_reservation_budget_guard BEFORE INSERT ON editorial_execution_reservations
WHEN COALESCE((SELECT SUM(r.reserved_microusd) FROM editorial_execution_reservations r WHERE r.envelope_id=NEW.envelope_id),0) + NEW.reserved_microusd > (SELECT monetary_ceiling_microusd FROM editorial_execution_envelopes e WHERE e.id=NEW.envelope_id)
BEGIN SELECT RAISE(ABORT,'execution_envelope_budget_exceeded'); END;
