CREATE TABLE editorial_execution_remediations (
 id TEXT PRIMARY KEY NOT NULL, workspace_id TEXT NOT NULL REFERENCES workspaces(id), project_id TEXT NOT NULL REFERENCES projects(id),
 original_project_execution_budget_id TEXT NOT NULL REFERENCES editorial_project_execution_budgets(id), expected_original_budget_version INTEGER NOT NULL CHECK(expected_original_budget_version>0),
 historical_reservation_id TEXT NOT NULL REFERENCES editorial_execution_reservations(id), historical_run_id TEXT NOT NULL REFERENCES intelligence_runs(id), historical_envelope_id TEXT NOT NULL REFERENCES editorial_execution_envelopes(id),
 remediation_project_execution_budget_id TEXT NOT NULL UNIQUE REFERENCES editorial_project_execution_budgets(id), remediation_envelope_id TEXT NOT NULL UNIQUE REFERENCES editorial_execution_envelopes(id),
 profile_key TEXT NOT NULL CHECK(profile_key='phase3_storyboard_remediation_v1'), profile_version INTEGER NOT NULL CHECK(profile_version=1), stage_key TEXT NOT NULL CHECK(stage_key='STORYBOARD_PLANNER'),
 provider_id TEXT NOT NULL REFERENCES ai_providers(id), provider_model_id TEXT NOT NULL REFERENCES ai_provider_models(id), additional_exposure_microusd INTEGER NOT NULL CHECK(additional_exposure_microusd=321920),
 maximum_calls INTEGER NOT NULL CHECK(maximum_calls=1), maximum_attempts INTEGER NOT NULL CHECK(maximum_attempts=1), sdk_max_retries INTEGER NOT NULL CHECK(sdk_max_retries=0),
 fallback_enabled INTEGER NOT NULL CHECK(fallback_enabled=0), creative_regeneration_enabled INTEGER NOT NULL CHECK(creative_regeneration_enabled=0), external_research_enabled INTEGER NOT NULL CHECK(external_research_enabled=0), human_approval_required INTEGER NOT NULL CHECK(human_approval_required=1),
 reason_category TEXT NOT NULL CHECK(reason_category='PROVIDER_OUTPUT_SCHEMA_VALIDATION_AMBIGUOUS'), idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 200), command_hash TEXT NOT NULL CHECK(length(command_hash)=64),
 audit_event_id TEXT NOT NULL UNIQUE REFERENCES audit_events(id), authorized_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL,
 UNIQUE(workspace_id,idempotency_key), UNIQUE(historical_reservation_id,profile_key,profile_version)
);
CREATE INDEX editorial_execution_remediations_project_idx ON editorial_execution_remediations(workspace_id,project_id,created_at);
CREATE TRIGGER editorial_execution_remediation_evidence_guard BEFORE INSERT ON editorial_execution_remediations WHEN NOT EXISTS (
 SELECT 1 FROM editorial_project_execution_budgets ob JOIN editorial_execution_reservations r ON r.id=NEW.historical_reservation_id JOIN intelligence_runs run ON run.id=NEW.historical_run_id
 JOIN editorial_execution_envelopes olde ON olde.id=NEW.historical_envelope_id JOIN editorial_project_execution_budgets nb ON nb.id=NEW.remediation_project_execution_budget_id JOIN editorial_execution_envelopes ne ON ne.id=NEW.remediation_envelope_id
 JOIN ai_providers p ON p.id=NEW.provider_id JOIN ai_provider_models m ON m.id=NEW.provider_model_id AND m.provider_id=p.id JOIN audit_events a ON a.id=NEW.audit_event_id
 WHERE ob.id=NEW.original_project_execution_budget_id AND ob.workspace_id=NEW.workspace_id AND ob.project_id=NEW.project_id AND ob.status='ACTIVE' AND ob.version=NEW.expected_original_budget_version
 AND r.workspace_id=NEW.workspace_id AND r.project_id=NEW.project_id AND r.project_execution_budget_id=ob.id AND r.intelligence_run_id=run.id AND r.envelope_id=olde.id AND r.status='AMBIGUOUS' AND r.actual_microusd IS NULL AND r.dispatched_at IS NOT NULL
 AND run.workspace_id=NEW.workspace_id AND run.project_id=NEW.project_id AND run.task_type='STORYBOARD_PLANNER' AND run.status='FAILED_PERMANENT' AND run.error_category='SCHEMA_VALIDATION'
 AND olde.workspace_id=NEW.workspace_id AND olde.project_id=NEW.project_id AND olde.project_execution_budget_id=ob.id AND olde.stage_key='STORYBOARD_PLANNER' AND olde.status='CONSUMED' AND olde.maximum_calls=1
 AND (SELECT COUNT(*) FROM editorial_execution_reservations x WHERE x.envelope_id=olde.id)=1
 AND nb.workspace_id=NEW.workspace_id AND nb.project_id=NEW.project_id AND nb.profile_key=NEW.profile_key AND nb.profile_version=NEW.profile_version AND nb.currency='USD' AND nb.monetary_ceiling_microusd=NEW.additional_exposure_microusd AND nb.status='ACTIVE' AND nb.version=1
 AND ne.workspace_id=NEW.workspace_id AND ne.project_id=NEW.project_id AND ne.project_execution_budget_id=nb.id AND ne.profile_key=NEW.profile_key AND ne.profile_version=NEW.profile_version AND ne.stage_key=NEW.stage_key AND ne.provider_id=NEW.provider_id AND ne.provider_model_id=NEW.provider_model_id AND ne.currency='USD' AND ne.monetary_ceiling_microusd=NEW.additional_exposure_microusd AND ne.maximum_calls=1 AND ne.status='ACTIVE' AND ne.version=1
 AND p.key='openai' AND p.status='configured' AND m.model_key='gpt-5.6-terra' AND m.status='available'
 AND a.workspace_id=NEW.workspace_id AND a.action='editorial.remediation_capacity_authorized' AND a.resource_type='editorial_execution_remediation' AND a.resource_id=NEW.id AND a.outcome='success'
) BEGIN SELECT RAISE(ABORT,'remediation_evidence_invalid'); END;
