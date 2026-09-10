CREATE TABLE editorial_revision_requests (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  reviewed_artifact_id TEXT NOT NULL REFERENCES editorial_artifacts(id),
  reviewed_artifact_version_id TEXT NOT NULL REFERENCES editorial_artifact_versions(id),
  reviewed_artifact_revision INTEGER NOT NULL CHECK(reviewed_artifact_revision>0),
  target_stage TEXT NOT NULL CHECK(target_stage='RESEARCH'),
  target_baseline_version_id TEXT NOT NULL REFERENCES editorial_artifact_versions(id),
  reason_code TEXT NOT NULL CHECK(reason_code IN ('UNRESOLVED_CENTRAL_EVENT','INSUFFICIENT_RESEARCH_EVIDENCE','EDITORIAL_DIRECTION_CHANGE','SCRIPT_REVISION_REQUIRED','STORYBOARD_REVISION_REQUIRED')),
  comment TEXT CHECK(comment IS NULL OR length(comment)<=4000),
  status TEXT DEFAULT 'OPEN' NOT NULL CHECK(status='OPEN'),
  actor_id TEXT NOT NULL REFERENCES users(id),
  actor_role TEXT NOT NULL CHECK(actor_role IN ('owner','admin','operator')),
  idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 200),
  command_hash TEXT NOT NULL CHECK(length(command_hash)=64),
  audit_event_id TEXT NOT NULL UNIQUE REFERENCES audit_events(id),
  created_at TEXT NOT NULL,
  UNIQUE(workspace_id,idempotency_key)
);
CREATE INDEX editorial_revision_requests_project_idx ON editorial_revision_requests(workspace_id,project_id,created_at);
CREATE INDEX editorial_revision_requests_reviewed_idx ON editorial_revision_requests(workspace_id,reviewed_artifact_version_id,created_at);

CREATE TABLE editorial_revision_request_resolutions (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  revision_request_id TEXT NOT NULL UNIQUE REFERENCES editorial_revision_requests(id),
  status TEXT NOT NULL CHECK(status='RESOLVED'),
  resolution_artifact_version_id TEXT NOT NULL REFERENCES editorial_artifact_versions(id),
  resolution_evidence_json TEXT DEFAULT '{}' NOT NULL CHECK(json_valid(resolution_evidence_json) AND length(resolution_evidence_json)<=16384),
  resolved_by TEXT NOT NULL REFERENCES users(id),
  idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 200),
  command_hash TEXT NOT NULL CHECK(length(command_hash)=64),
  audit_event_id TEXT NOT NULL UNIQUE REFERENCES audit_events(id),
  resolved_at TEXT NOT NULL,
  UNIQUE(workspace_id,idempotency_key)
);
CREATE INDEX editorial_revision_request_resolutions_project_idx ON editorial_revision_request_resolutions(workspace_id,project_id,resolved_at);

CREATE TRIGGER editorial_revision_request_reviewed_type_guard BEFORE INSERT ON editorial_revision_requests
WHEN NOT EXISTS (
  SELECT 1 FROM editorial_artifacts a
  WHERE a.id=NEW.reviewed_artifact_id AND a.workspace_id=NEW.workspace_id
    AND a.project_id=NEW.project_id AND a.artifact_type='STORYBOARD'
)
BEGIN SELECT RAISE(ABORT,'revision_reviewed_artifact_type_unsupported'); END;

CREATE TRIGGER editorial_revision_request_scope_guard BEFORE INSERT ON editorial_revision_requests
WHEN NOT EXISTS (
  SELECT 1 FROM editorial_artifacts a
  JOIN editorial_artifact_versions v ON v.artifact_id=a.id
  WHERE a.id=NEW.reviewed_artifact_id
    AND a.workspace_id=NEW.workspace_id
    AND a.project_id=NEW.project_id
    AND a.current_version_id=NEW.reviewed_artifact_version_id
    AND a.version=NEW.reviewed_artifact_revision
    AND v.id=NEW.reviewed_artifact_version_id
    AND v.workspace_id=NEW.workspace_id
    AND a.deleted_at IS NULL
)
BEGIN SELECT RAISE(ABORT,'revision_request_target_not_current'); END;

CREATE TRIGGER editorial_revision_request_baseline_guard BEFORE INSERT ON editorial_revision_requests
WHEN NEW.target_stage='RESEARCH' AND NEW.target_baseline_version_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM editorial_artifact_versions v
  JOIN editorial_artifacts a ON a.id=v.artifact_id
  WHERE v.id=NEW.target_baseline_version_id
    AND v.workspace_id=NEW.workspace_id
    AND a.workspace_id=NEW.workspace_id
    AND a.project_id=NEW.project_id
    AND a.current_version_id=v.id
    AND a.artifact_type='RESEARCH'
    AND a.deleted_at IS NULL
)
BEGIN SELECT RAISE(ABORT,'revision_request_baseline_invalid'); END;

CREATE TRIGGER editorial_revision_request_single_open_guard BEFORE INSERT ON editorial_revision_requests
WHEN EXISTS (
  SELECT 1 FROM editorial_revision_requests r
  LEFT JOIN editorial_revision_request_resolutions x ON x.revision_request_id=r.id
  WHERE r.workspace_id=NEW.workspace_id
    AND r.project_id=NEW.project_id
    AND r.reviewed_artifact_id=NEW.reviewed_artifact_id
    AND r.reviewed_artifact_version_id=NEW.reviewed_artifact_version_id
    AND x.id IS NULL
)
BEGIN SELECT RAISE(ABORT,'revision_request_already_open'); END;

CREATE TRIGGER editorial_revision_request_actor_scope_guard BEFORE INSERT ON editorial_revision_requests
WHEN NOT EXISTS (
  SELECT 1 FROM users u
  JOIN user_roles ur ON ur.workspace_id=u.workspace_id AND ur.user_id=u.id
  JOIN roles role ON role.id=ur.role_id AND role.key=NEW.actor_role
  WHERE u.id=NEW.actor_id AND u.workspace_id=NEW.workspace_id
    AND u.status='active' AND u.deleted_at IS NULL
)
BEGIN SELECT RAISE(ABORT,'revision_request_actor_scope_invalid'); END;

CREATE TRIGGER editorial_revision_request_audit_guard BEFORE INSERT ON editorial_revision_requests
WHEN NOT EXISTS (
  SELECT 1 FROM audit_events a
  WHERE a.id=NEW.audit_event_id AND a.workspace_id=NEW.workspace_id
    AND a.actor_type='user' AND a.actor_id=NEW.actor_id AND a.actor_role=NEW.actor_role
    AND a.action='editorial.revision_requested'
    AND a.resource_type='editorial_revision_request'
    AND a.resource_id=NEW.id AND a.outcome='success'
)
BEGIN SELECT RAISE(ABORT,'revision_request_audit_invalid'); END;

CREATE TRIGGER editorial_revision_resolution_scope_guard BEFORE INSERT ON editorial_revision_request_resolutions
WHEN NOT EXISTS (
  SELECT 1 FROM editorial_revision_requests r
  JOIN editorial_artifact_versions v ON v.id=NEW.resolution_artifact_version_id
  JOIN editorial_artifacts a ON a.id=v.artifact_id
  WHERE r.id=NEW.revision_request_id
    AND r.workspace_id=NEW.workspace_id AND r.project_id=NEW.project_id
    AND r.target_stage='RESEARCH'
    AND a.workspace_id=NEW.workspace_id AND a.project_id=NEW.project_id
    AND a.current_version_id=v.id AND a.artifact_type='STORYBOARD'
    AND a.status='approved' AND a.deleted_at IS NULL
    AND v.id<>r.reviewed_artifact_version_id
    AND EXISTS (
      SELECT 1 FROM artifact_approvals ap
      WHERE ap.workspace_id=NEW.workspace_id
        AND ap.artifact_version_id=v.id AND ap.decision='APPROVED'
    )
)
BEGIN SELECT RAISE(ABORT,'revision_request_resolution_invalid'); END;

CREATE TRIGGER editorial_revision_resolution_actor_scope_guard BEFORE INSERT ON editorial_revision_request_resolutions
WHEN NOT EXISTS (
  SELECT 1 FROM users u
  JOIN audit_events a ON a.id=NEW.audit_event_id
  JOIN user_roles ur ON ur.workspace_id=u.workspace_id AND ur.user_id=u.id
  JOIN roles role ON role.id=ur.role_id AND role.key=a.actor_role
  WHERE u.id=NEW.resolved_by AND u.workspace_id=NEW.workspace_id
    AND u.status='active' AND u.deleted_at IS NULL
    AND a.workspace_id=NEW.workspace_id AND a.actor_type='user'
    AND a.actor_id=NEW.resolved_by
)
BEGIN SELECT RAISE(ABORT,'revision_request_resolver_scope_invalid'); END;

CREATE TRIGGER editorial_revision_resolution_audit_guard BEFORE INSERT ON editorial_revision_request_resolutions
WHEN NOT EXISTS (
  SELECT 1 FROM audit_events a
  WHERE a.id=NEW.audit_event_id AND a.workspace_id=NEW.workspace_id
    AND a.actor_type='user' AND a.actor_id=NEW.resolved_by
    AND a.actor_role IN ('owner','admin','operator')
    AND a.action='editorial.revision_request_resolved'
    AND a.resource_type='editorial_revision_request'
    AND a.resource_id=NEW.revision_request_id AND a.outcome='success'
)
BEGIN SELECT RAISE(ABORT,'revision_request_resolution_audit_invalid'); END;

CREATE TRIGGER editorial_revision_requests_no_update BEFORE UPDATE ON editorial_revision_requests BEGIN SELECT RAISE(ABORT,'editorial revision requests are append-only'); END;
CREATE TRIGGER editorial_revision_requests_no_delete BEFORE DELETE ON editorial_revision_requests BEGIN SELECT RAISE(ABORT,'editorial revision requests are append-only'); END;
CREATE TRIGGER editorial_revision_request_resolutions_no_update BEFORE UPDATE ON editorial_revision_request_resolutions BEGIN SELECT RAISE(ABORT,'editorial revision request resolutions are append-only'); END;
CREATE TRIGGER editorial_revision_request_resolutions_no_delete BEFORE DELETE ON editorial_revision_request_resolutions BEGIN SELECT RAISE(ABORT,'editorial revision request resolutions are append-only'); END;
