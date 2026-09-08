DROP TRIGGER editorial_execution_remediation_evidence_guard;

CREATE TRIGGER editorial_execution_remediation_original_budget_guard BEFORE INSERT ON editorial_execution_remediations WHEN NOT EXISTS (
 SELECT 1 FROM editorial_project_execution_budgets b
 WHERE b.id=NEW.original_project_execution_budget_id AND b.workspace_id=NEW.workspace_id AND b.project_id=NEW.project_id
 AND b.status='ACTIVE' AND b.version=NEW.expected_original_budget_version
) BEGIN SELECT RAISE(ABORT,'remediation_original_budget_invalid'); END;

CREATE TRIGGER editorial_execution_remediation_historical_reservation_guard BEFORE INSERT ON editorial_execution_remediations WHEN NOT EXISTS (
 SELECT 1 FROM editorial_execution_reservations r
 WHERE r.id=NEW.historical_reservation_id AND r.workspace_id=NEW.workspace_id AND r.project_id=NEW.project_id
 AND r.project_execution_budget_id=NEW.original_project_execution_budget_id AND r.intelligence_run_id=NEW.historical_run_id
 AND r.envelope_id=NEW.historical_envelope_id AND r.status='AMBIGUOUS' AND r.actual_microusd IS NULL AND r.dispatched_at IS NOT NULL
) BEGIN SELECT RAISE(ABORT,'remediation_historical_reservation_invalid'); END;

CREATE TRIGGER editorial_execution_remediation_historical_run_guard BEFORE INSERT ON editorial_execution_remediations WHEN NOT EXISTS (
 SELECT 1 FROM intelligence_runs r
 WHERE r.id=NEW.historical_run_id AND r.workspace_id=NEW.workspace_id AND r.project_id=NEW.project_id
 AND r.task_type='STORYBOARD_PLANNER' AND r.status='FAILED_PERMANENT' AND r.error_category='SCHEMA_VALIDATION'
) BEGIN SELECT RAISE(ABORT,'remediation_historical_run_invalid'); END;

CREATE TRIGGER editorial_execution_remediation_historical_envelope_guard BEFORE INSERT ON editorial_execution_remediations WHEN NOT EXISTS (
 SELECT 1 FROM editorial_execution_envelopes e
 WHERE e.id=NEW.historical_envelope_id AND e.workspace_id=NEW.workspace_id AND e.project_id=NEW.project_id
 AND e.project_execution_budget_id=NEW.original_project_execution_budget_id AND e.stage_key='STORYBOARD_PLANNER'
 AND e.status='CONSUMED' AND e.maximum_calls=1
 AND (SELECT COUNT(*) FROM editorial_execution_reservations r WHERE r.envelope_id=e.id)=1
) BEGIN SELECT RAISE(ABORT,'remediation_historical_envelope_invalid'); END;

CREATE TRIGGER editorial_execution_remediation_new_budget_guard BEFORE INSERT ON editorial_execution_remediations WHEN NOT EXISTS (
 SELECT 1 FROM editorial_project_execution_budgets b
 WHERE b.id=NEW.remediation_project_execution_budget_id AND b.workspace_id=NEW.workspace_id AND b.project_id=NEW.project_id
 AND b.profile_key=NEW.profile_key AND b.profile_version=NEW.profile_version AND b.currency='USD'
 AND b.monetary_ceiling_microusd=NEW.additional_exposure_microusd AND b.status='ACTIVE' AND b.version=1
) BEGIN SELECT RAISE(ABORT,'remediation_new_budget_invalid'); END;

CREATE TRIGGER editorial_execution_remediation_new_envelope_guard BEFORE INSERT ON editorial_execution_remediations WHEN NOT EXISTS (
 SELECT 1 FROM editorial_execution_envelopes e
 WHERE e.id=NEW.remediation_envelope_id AND e.workspace_id=NEW.workspace_id AND e.project_id=NEW.project_id
 AND e.project_execution_budget_id=NEW.remediation_project_execution_budget_id AND e.profile_key=NEW.profile_key
 AND e.profile_version=NEW.profile_version AND e.stage_key=NEW.stage_key AND e.provider_id=NEW.provider_id
 AND e.provider_model_id=NEW.provider_model_id AND e.currency='USD' AND e.monetary_ceiling_microusd=NEW.additional_exposure_microusd
 AND e.maximum_calls=1 AND e.status='ACTIVE' AND e.version=1
) BEGIN SELECT RAISE(ABORT,'remediation_new_envelope_invalid'); END;

CREATE TRIGGER editorial_execution_remediation_provider_model_guard BEFORE INSERT ON editorial_execution_remediations WHEN NOT EXISTS (
 SELECT 1 FROM ai_providers p JOIN ai_provider_models m ON m.provider_id=p.id
 WHERE p.id=NEW.provider_id AND p.key='openai' AND p.status='configured'
 AND m.id=NEW.provider_model_id AND m.model_key='gpt-5.6-terra' AND m.status='available'
) BEGIN SELECT RAISE(ABORT,'remediation_provider_model_invalid'); END;

CREATE TRIGGER editorial_execution_remediation_audit_guard BEFORE INSERT ON editorial_execution_remediations WHEN NOT EXISTS (
 SELECT 1 FROM audit_events a
 WHERE a.id=NEW.audit_event_id AND a.workspace_id=NEW.workspace_id AND a.action='editorial.remediation_capacity_authorized'
 AND a.resource_type='editorial_execution_remediation' AND a.resource_id=NEW.id AND a.outcome='success'
) BEGIN SELECT RAISE(ABORT,'remediation_audit_invalid'); END;