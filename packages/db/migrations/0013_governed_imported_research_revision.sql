CREATE TABLE editorial_research_revision_imports (
 id TEXT PRIMARY KEY NOT NULL,
 workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 project_id TEXT NOT NULL REFERENCES projects(id),
 revision_request_id TEXT NOT NULL REFERENCES editorial_revision_requests(id),
 research_artifact_id TEXT NOT NULL REFERENCES editorial_artifacts(id),
 parent_research_version_id TEXT NOT NULL REFERENCES editorial_artifact_versions(id),
 new_research_version_id TEXT NOT NULL UNIQUE REFERENCES editorial_artifact_versions(id),
 expected_artifact_revision INTEGER NOT NULL CHECK(expected_artifact_revision>0),
 actor_id TEXT NOT NULL REFERENCES users(id),
 actor_role TEXT NOT NULL CHECK(actor_role IN ('owner','admin','operator')),
 audit_event_id TEXT NOT NULL UNIQUE REFERENCES audit_events(id),
 idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 200),
 command_hash TEXT NOT NULL CHECK(length(command_hash)=64),
 result_json TEXT NOT NULL CHECK(json_valid(result_json) AND length(result_json)<=16384),
 environment TEXT NOT NULL CHECK(length(environment) BETWEEN 1 AND 100),
 created_at TEXT NOT NULL,
 UNIQUE(workspace_id,idempotency_key),
 UNIQUE(revision_request_id,parent_research_version_id)
);
CREATE INDEX editorial_research_revision_imports_project_idx ON editorial_research_revision_imports(workspace_id,project_id,created_at);
CREATE TRIGGER editorial_research_revision_import_scope_guard BEFORE INSERT ON editorial_research_revision_imports WHEN NOT EXISTS (
 SELECT 1 FROM editorial_revision_requests r LEFT JOIN editorial_revision_request_resolutions x ON x.revision_request_id=r.id
 JOIN editorial_artifacts a ON a.id=NEW.research_artifact_id
 JOIN editorial_artifact_versions p ON p.id=NEW.parent_research_version_id
 JOIN editorial_artifact_versions n ON n.id=NEW.new_research_version_id
 WHERE r.id=NEW.revision_request_id AND r.workspace_id=NEW.workspace_id AND r.project_id=NEW.project_id AND r.target_stage='RESEARCH' AND r.status='OPEN' AND x.id IS NULL
 AND a.workspace_id=NEW.workspace_id AND a.project_id=NEW.project_id AND a.artifact_type='RESEARCH' AND a.deleted_at IS NULL
 AND a.current_version_id=n.id AND a.version=NEW.expected_artifact_revision+1
 AND p.workspace_id=NEW.workspace_id AND p.artifact_id=a.id AND n.workspace_id=NEW.workspace_id AND n.artifact_id=a.id
 AND n.parent_version_id=p.id AND n.version_number=p.version_number+1 AND n.source_type='IMPORTED'
) BEGIN SELECT RAISE(ABORT,'research_revision_import_scope_invalid'); END;
CREATE TRIGGER editorial_research_revision_import_actor_guard BEFORE INSERT ON editorial_research_revision_imports WHEN NOT EXISTS (
 SELECT 1 FROM users u JOIN user_roles ur ON ur.workspace_id=u.workspace_id AND ur.user_id=u.id JOIN roles role ON role.id=ur.role_id AND role.key=NEW.actor_role
 WHERE u.id=NEW.actor_id AND u.workspace_id=NEW.workspace_id AND u.status='active' AND u.deleted_at IS NULL
) BEGIN SELECT RAISE(ABORT,'research_revision_import_actor_invalid'); END;
CREATE TRIGGER editorial_research_revision_import_audit_guard BEFORE INSERT ON editorial_research_revision_imports WHEN NOT EXISTS (
 SELECT 1 FROM audit_events a WHERE a.id=NEW.audit_event_id AND a.workspace_id=NEW.workspace_id AND a.actor_type='user' AND a.actor_id=NEW.actor_id AND a.actor_role=NEW.actor_role
 AND json_type(a.metadata_json,'$.workspaceId')='text' AND json_extract(a.metadata_json,'$.workspaceId')=NEW.workspace_id
 AND json_type(a.metadata_json,'$.revisionRequestId')='text' AND json_extract(a.metadata_json,'$.revisionRequestId')=NEW.revision_request_id
 AND json_type(a.metadata_json,'$.projectId')='text' AND json_extract(a.metadata_json,'$.projectId')=NEW.project_id
 AND json_type(a.metadata_json,'$.researchArtifactId')='text' AND json_extract(a.metadata_json,'$.researchArtifactId')=NEW.research_artifact_id
 AND json_type(a.metadata_json,'$.parentVersionId')='text' AND json_extract(a.metadata_json,'$.parentVersionId')=NEW.parent_research_version_id
 AND json_type(a.metadata_json,'$.newVersionId')='text' AND json_extract(a.metadata_json,'$.newVersionId')=NEW.new_research_version_id
 AND json_type(a.metadata_json,'$.targetStage')='text' AND json_extract(a.metadata_json,'$.targetStage')='RESEARCH'
 AND json_type(a.metadata_json,'$.reasonCode')='text' AND json_extract(a.metadata_json,'$.reasonCode')=(SELECT reason_code FROM editorial_revision_requests WHERE id=NEW.revision_request_id)
 AND a.action='editorial.research_revision_imported' AND a.resource_type='editorial_revision_request' AND a.resource_id=NEW.revision_request_id AND a.outcome='success' AND a.environment=NEW.environment
) BEGIN SELECT RAISE(ABORT,'research_revision_import_audit_invalid'); END;
CREATE TRIGGER editorial_research_revision_imports_no_update BEFORE UPDATE ON editorial_research_revision_imports BEGIN SELECT RAISE(ABORT,'editorial research revision imports are append-only'); END;
CREATE TRIGGER editorial_research_revision_imports_no_delete BEFORE DELETE ON editorial_research_revision_imports BEGIN SELECT RAISE(ABORT,'editorial research revision imports are append-only'); END;

CREATE TRIGGER editorial_research_revision_import_result_guard BEFORE INSERT ON editorial_research_revision_imports
WHEN NOT EXISTS (
 SELECT 1 FROM editorial_artifact_versions v
 WHERE v.id=NEW.new_research_version_id
 AND json_type(NEW.result_json)='object'
 AND (SELECT count(*) FROM json_each(NEW.result_json))=9
 AND json_type(NEW.result_json,'$.receiptId')='text' AND json_extract(NEW.result_json,'$.receiptId')=NEW.id
 AND json_type(NEW.result_json,'$.revisionRequestId')='text' AND json_extract(NEW.result_json,'$.revisionRequestId')=NEW.revision_request_id
 AND json_type(NEW.result_json,'$.projectId')='text' AND json_extract(NEW.result_json,'$.projectId')=NEW.project_id
 AND json_type(NEW.result_json,'$.researchArtifactId')='text' AND json_extract(NEW.result_json,'$.researchArtifactId')=NEW.research_artifact_id
 AND json_type(NEW.result_json,'$.parentVersionId')='text' AND json_extract(NEW.result_json,'$.parentVersionId')=NEW.parent_research_version_id
 AND json_type(NEW.result_json,'$.versionId')='text' AND json_extract(NEW.result_json,'$.versionId')=NEW.new_research_version_id
 AND json_type(NEW.result_json,'$.versionNumber')='integer' AND json_extract(NEW.result_json,'$.versionNumber')=v.version_number
 AND json_type(NEW.result_json,'$.contentHash')='text' AND json_extract(NEW.result_json,'$.contentHash')=v.content_hash
 AND json_type(NEW.result_json,'$.auditEventId')='text' AND json_extract(NEW.result_json,'$.auditEventId')=NEW.audit_event_id
) BEGIN SELECT RAISE(ABORT,'research_revision_import_result_invalid'); END;
