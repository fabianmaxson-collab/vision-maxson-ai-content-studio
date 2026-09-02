PRAGMA foreign_keys = ON;

CREATE TABLE workspaces (id TEXT PRIMARY KEY NOT NULL, slug TEXT NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER DEFAULT 1 NOT NULL, deleted_at TEXT);
CREATE UNIQUE INDEX workspaces_slug_uq ON workspaces(slug);
CREATE TABLE users (id TEXT PRIMARY KEY NOT NULL, workspace_id TEXT NOT NULL REFERENCES workspaces(id), email TEXT NOT NULL, display_name TEXT, status TEXT DEFAULT 'active' NOT NULL CHECK(status IN ('active','disabled')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER DEFAULT 1 NOT NULL, created_by TEXT, updated_by TEXT, deleted_at TEXT);
CREATE UNIQUE INDEX users_workspace_email_uq ON users(workspace_id,email); CREATE INDEX users_workspace_idx ON users(workspace_id);
CREATE TABLE roles (id TEXT PRIMARY KEY NOT NULL, key TEXT NOT NULL CHECK(key IN ('owner','admin','operator','viewer')), description TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER DEFAULT 1 NOT NULL);
CREATE UNIQUE INDEX roles_key_uq ON roles(key);
CREATE TABLE user_roles (workspace_id TEXT NOT NULL REFERENCES workspaces(id), user_id TEXT NOT NULL REFERENCES users(id), role_id TEXT NOT NULL REFERENCES roles(id), created_at TEXT NOT NULL, created_by TEXT, PRIMARY KEY(workspace_id,user_id,role_id));
CREATE INDEX user_roles_user_idx ON user_roles(workspace_id,user_id);
CREATE TABLE access_identities (id TEXT PRIMARY KEY NOT NULL, workspace_id TEXT NOT NULL REFERENCES workspaces(id), user_id TEXT NOT NULL REFERENCES users(id), issuer TEXT NOT NULL, subject TEXT NOT NULL, email TEXT NOT NULL, last_seen_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER DEFAULT 1 NOT NULL, deleted_at TEXT);
CREATE UNIQUE INDEX access_identity_issuer_subject_uq ON access_identities(issuer,subject); CREATE INDEX access_identity_user_idx ON access_identities(workspace_id,user_id);
CREATE TABLE sessions (id TEXT PRIMARY KEY NOT NULL, workspace_id TEXT NOT NULL REFERENCES workspaces(id), user_id TEXT NOT NULL REFERENCES users(id), access_subject TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER DEFAULT 1 NOT NULL);
CREATE INDEX sessions_user_idx ON sessions(workspace_id,user_id);
CREATE TABLE application_settings (workspace_id TEXT NOT NULL REFERENCES workspaces(id), key TEXT NOT NULL, value_json TEXT NOT NULL, is_public INTEGER DEFAULT 0 NOT NULL CHECK(is_public IN (0,1)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER DEFAULT 1 NOT NULL, created_by TEXT, updated_by TEXT, deleted_at TEXT, PRIMARY KEY(workspace_id,key));
CREATE TABLE feature_flags (workspace_id TEXT NOT NULL REFERENCES workspaces(id), key TEXT NOT NULL, enabled INTEGER DEFAULT 0 NOT NULL CHECK(enabled IN (0,1)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER DEFAULT 1 NOT NULL, created_by TEXT, updated_by TEXT, deleted_at TEXT, PRIMARY KEY(workspace_id,key));
CREATE TABLE audit_events (id TEXT PRIMARY KEY NOT NULL, workspace_id TEXT NOT NULL REFERENCES workspaces(id), actor_type TEXT NOT NULL, actor_id TEXT, actor_role TEXT, access_issuer TEXT, access_subject TEXT, action TEXT NOT NULL, resource_type TEXT NOT NULL, resource_id TEXT, outcome TEXT NOT NULL, reason TEXT, request_id TEXT NOT NULL, environment TEXT NOT NULL, metadata_json TEXT DEFAULT '{}' NOT NULL, before_hash TEXT, after_hash TEXT, occurred_at TEXT NOT NULL, ingested_at TEXT NOT NULL);
CREATE INDEX audit_workspace_time_idx ON audit_events(workspace_id,occurred_at); CREATE INDEX audit_action_idx ON audit_events(workspace_id,action);
CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON audit_events BEGIN SELECT RAISE(ABORT,'audit_events are append-only'); END;
CREATE TRIGGER audit_events_no_delete BEFORE DELETE ON audit_events BEGIN SELECT RAISE(ABORT,'audit_events are append-only'); END;

INSERT INTO roles(id,key,description,created_at,updated_at,version) VALUES
('role_owner','owner','Maximum authority',datetime('now'),datetime('now'),1),
('role_admin','admin','Operational administration',datetime('now'),datetime('now'),1),
('role_operator','operator','Functional equivalent of the Master Specification Editor role',datetime('now'),datetime('now'),1),
('role_viewer','viewer','Read-only access',datetime('now'),datetime('now'),1);
