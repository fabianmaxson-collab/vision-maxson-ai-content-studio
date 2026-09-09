CREATE TABLE editorial_chained_execution_remediations (
 id TEXT PRIMARY KEY NOT NULL,
 workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 project_id TEXT NOT NULL REFERENCES projects(id),
 parent_remediation_id TEXT NOT NULL UNIQUE REFERENCES editorial_execution_remediations(id),
 remediation_generation INTEGER NOT NULL CHECK(remediation_generation=2),
 historical_reservation_id TEXT NOT NULL UNIQUE REFERENCES editorial_execution_reservations(id),
 historical_run_id TEXT NOT NULL UNIQUE REFERENCES intelligence_runs(id),
 historical_envelope_id TEXT NOT NULL REFERENCES editorial_execution_envelopes(id),
 remediation_project_execution_budget_id TEXT NOT NULL UNIQUE REFERENCES editorial_project_execution_budgets(id),
 remediation_envelope_id TEXT NOT NULL UNIQUE REFERENCES editorial_execution_envelopes(id),
 profile_key TEXT NOT NULL CHECK(profile_key='phase3_storyboard_chained_remediation_v2'),
 profile_version INTEGER NOT NULL CHECK(profile_version=2),
 stage_key TEXT NOT NULL CHECK(stage_key='STORYBOARD_PLANNER'),
 provider_id TEXT NOT NULL REFERENCES ai_providers(id),
 provider_model_id TEXT NOT NULL REFERENCES ai_provider_models(id),
 additional_exposure_microusd INTEGER NOT NULL CHECK(additional_exposure_microusd=321920),
 maximum_calls INTEGER NOT NULL CHECK(maximum_calls=1),
 maximum_attempts INTEGER NOT NULL CHECK(maximum_attempts=1),
 sdk_max_retries INTEGER NOT NULL CHECK(sdk_max_retries=0),
 fallback_enabled INTEGER NOT NULL CHECK(fallback_enabled=0),
 creative_regeneration_enabled INTEGER NOT NULL CHECK(creative_regeneration_enabled=0),
 external_research_enabled INTEGER NOT NULL CHECK(external_research_enabled=0),
 human_approval_required INTEGER NOT NULL CHECK(human_approval_required=1),
 failure_category TEXT NOT NULL CHECK(failure_category='SCHEMA_VALIDATION'),
 diagnostic_category TEXT NOT NULL CHECK(diagnostic_category='duplicate_continuity_key'),
 reason_category TEXT NOT NULL CHECK(reason_category='SCHEMA_VALIDATION_DUPLICATE_CONTINUITY_KEY'),
 idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 200),
 command_hash TEXT NOT NULL CHECK(length(command_hash)=64),
 audit_event_id TEXT NOT NULL UNIQUE REFERENCES audit_events(id),
 authorized_by TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL,
 UNIQUE(workspace_id,idempotency_key)
);
CREATE INDEX editorial_chained_execution_remediations_project_idx ON editorial_chained_execution_remediations(workspace_id,project_id,created_at);

CREATE TRIGGER chained_remediation_parent_guard BEFORE INSERT ON editorial_chained_execution_remediations WHEN NOT EXISTS (
 SELECT 1 FROM editorial_execution_remediations p
 WHERE p.id=NEW.parent_remediation_id AND p.workspace_id=NEW.workspace_id AND p.project_id=NEW.project_id
 AND p.remediation_project_execution_budget_id=(SELECT project_execution_budget_id FROM editorial_execution_envelopes WHERE id=NEW.historical_envelope_id)
 AND p.remediation_envelope_id=NEW.historical_envelope_id AND p.stage_key=NEW.stage_key
 AND p.profile_key='phase3_storyboard_remediation_v1' AND p.profile_version=1 AND p.maximum_calls=1
 AND p.provider_id=NEW.provider_id AND p.provider_model_id=NEW.provider_model_id
) BEGIN SELECT RAISE(ABORT,'chained_remediation_parent_invalid'); END;

CREATE TRIGGER chained_remediation_reservation_guard BEFORE INSERT ON editorial_chained_execution_remediations WHEN NOT EXISTS (
 SELECT 1 FROM editorial_execution_reservations r
 WHERE r.id=NEW.historical_reservation_id AND r.workspace_id=NEW.workspace_id AND r.project_id=NEW.project_id
 AND r.intelligence_run_id=NEW.historical_run_id AND r.envelope_id=NEW.historical_envelope_id
 AND r.project_execution_budget_id=(SELECT project_execution_budget_id FROM editorial_execution_envelopes WHERE id=NEW.historical_envelope_id)
 AND r.status='RECONCILED' AND r.actual_microusd IS NOT NULL AND r.actual_microusd>=0 AND r.dispatched_at IS NOT NULL
) BEGIN SELECT RAISE(ABORT,'chained_remediation_reservation_invalid'); END;

CREATE TRIGGER chained_remediation_run_guard BEFORE INSERT ON editorial_chained_execution_remediations WHEN NOT EXISTS (
 SELECT 1 FROM intelligence_runs run
 WHERE run.id=NEW.historical_run_id AND run.workspace_id=NEW.workspace_id AND run.project_id=NEW.project_id
 AND run.provider_id=NEW.provider_id AND run.provider_model_id=NEW.provider_model_id
 AND run.task_type='STORYBOARD_PLANNER' AND run.status='FAILED_PERMANENT'
 AND run.error_category=NEW.failure_category AND run.safe_error_detail=NEW.diagnostic_category
) BEGIN SELECT RAISE(ABORT,'chained_remediation_run_invalid'); END;

CREATE TRIGGER chained_remediation_attempt_guard BEFORE INSERT ON editorial_chained_execution_remediations WHEN NOT EXISTS (
 SELECT 1 FROM intelligence_run_attempts a
 WHERE a.intelligence_run_id=NEW.historical_run_id AND a.attempt_number=1
 AND a.status='FAILED_PERMANENT' AND a.error_category=NEW.failure_category
 AND a.safe_error_detail=NEW.diagnostic_category
 AND (SELECT COUNT(*) FROM intelligence_run_attempts x WHERE x.intelligence_run_id=NEW.historical_run_id)=1
) BEGIN SELECT RAISE(ABORT,'chained_remediation_attempt_invalid'); END;

CREATE TRIGGER chained_remediation_parent_envelope_guard BEFORE INSERT ON editorial_chained_execution_remediations WHEN NOT EXISTS (
 SELECT 1 FROM editorial_execution_envelopes e
 WHERE e.id=NEW.historical_envelope_id AND e.workspace_id=NEW.workspace_id AND e.project_id=NEW.project_id
 AND e.status='CONSUMED' AND e.maximum_calls=1
 AND (SELECT COUNT(*) FROM editorial_execution_reservations r WHERE r.envelope_id=e.id)=1
) BEGIN SELECT RAISE(ABORT,'chained_remediation_parent_envelope_invalid'); END;

CREATE TRIGGER chained_remediation_no_output_guard BEFORE INSERT ON editorial_chained_execution_remediations WHEN EXISTS (
 SELECT 1 FROM editorial_artifact_versions v JOIN editorial_artifacts a ON a.id=v.artifact_id
 WHERE v.intelligence_run_id=NEW.historical_run_id AND a.artifact_type='STORYBOARD'
) BEGIN SELECT RAISE(ABORT,'chained_remediation_output_exists'); END;

CREATE TRIGGER chained_remediation_new_budget_guard BEFORE INSERT ON editorial_chained_execution_remediations WHEN NOT EXISTS (
 SELECT 1 FROM editorial_project_execution_budgets b WHERE b.id=NEW.remediation_project_execution_budget_id
 AND b.workspace_id=NEW.workspace_id AND b.project_id=NEW.project_id AND b.profile_key=NEW.profile_key AND b.profile_version=2
 AND b.currency='USD' AND b.monetary_ceiling_microusd=NEW.additional_exposure_microusd AND b.status='ACTIVE' AND b.version=1
) BEGIN SELECT RAISE(ABORT,'chained_remediation_new_budget_invalid'); END;

CREATE TRIGGER chained_remediation_new_envelope_guard BEFORE INSERT ON editorial_chained_execution_remediations WHEN NOT EXISTS (
 SELECT 1 FROM editorial_execution_envelopes e WHERE e.id=NEW.remediation_envelope_id
 AND e.workspace_id=NEW.workspace_id AND e.project_id=NEW.project_id AND e.project_execution_budget_id=NEW.remediation_project_execution_budget_id
 AND e.profile_key=NEW.profile_key AND e.profile_version=2 AND e.stage_key=NEW.stage_key
 AND e.provider_id=NEW.provider_id AND e.provider_model_id=NEW.provider_model_id
 AND e.currency='USD' AND e.monetary_ceiling_microusd=NEW.additional_exposure_microusd
 AND e.maximum_calls=1 AND e.status='ACTIVE' AND e.version=1
) BEGIN SELECT RAISE(ABORT,'chained_remediation_new_envelope_invalid'); END;

CREATE TRIGGER chained_remediation_provider_guard BEFORE INSERT ON editorial_chained_execution_remediations WHEN NOT EXISTS (
 SELECT 1 FROM ai_providers p JOIN ai_provider_models m ON m.provider_id=p.id
 WHERE p.id=NEW.provider_id AND p.key='openai' AND p.status='configured'
 AND m.id=NEW.provider_model_id AND m.model_key='gpt-5.6-terra' AND m.status='available'
) BEGIN SELECT RAISE(ABORT,'chained_remediation_provider_invalid'); END;

CREATE TRIGGER chained_remediation_audit_guard BEFORE INSERT ON editorial_chained_execution_remediations WHEN NOT EXISTS (
 SELECT 1 FROM audit_events a WHERE a.id=NEW.audit_event_id AND a.workspace_id=NEW.workspace_id
 AND a.action='editorial.chained_remediation_capacity_authorized'
 AND a.resource_type='editorial_chained_execution_remediation' AND a.resource_id=NEW.id AND a.outcome='success'
) BEGIN SELECT RAISE(ABORT,'chained_remediation_audit_invalid'); END;
