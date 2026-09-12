-- Additive, forward-only authorization receipts. No historical rows are rewritten.
CREATE TABLE editorial_content_brief_revision_capacities (
 id TEXT PRIMARY KEY NOT NULL,
 workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 project_id TEXT NOT NULL REFERENCES projects(id),
 revision_request_id TEXT NOT NULL REFERENCES editorial_revision_requests(id),
 research_artifact_id TEXT NOT NULL REFERENCES editorial_artifacts(id),
 research_version_id TEXT NOT NULL REFERENCES editorial_artifact_versions(id),
 research_approval_id TEXT NOT NULL REFERENCES artifact_approvals(id),
 expected_research_artifact_revision INTEGER NOT NULL CHECK(expected_research_artifact_revision>0),
 expected_project_version INTEGER NOT NULL CHECK(expected_project_version>0),
 research_content_hash TEXT NOT NULL CHECK(length(research_content_hash)=64),
 idea_candidate_id TEXT NOT NULL REFERENCES idea_candidates(id),
 expected_idea_candidate_revision INTEGER NOT NULL CHECK(expected_idea_candidate_revision>0),
 idea_artifact_id TEXT NOT NULL REFERENCES editorial_artifacts(id),
 idea_version_id TEXT NOT NULL REFERENCES editorial_artifact_versions(id),
 idea_approval_id TEXT NOT NULL REFERENCES artifact_approvals(id),
 idea_content_hash TEXT NOT NULL CHECK(length(idea_content_hash)=64),
 expected_idea_artifact_revision INTEGER NOT NULL CHECK(expected_idea_artifact_revision>0),
 brief_artifact_id TEXT NOT NULL REFERENCES editorial_artifacts(id),
 expected_current_brief_version_id TEXT NOT NULL REFERENCES editorial_artifact_versions(id),
 expected_brief_artifact_revision INTEGER NOT NULL CHECK(expected_brief_artifact_revision>0),
 required_project_status TEXT NOT NULL DEFAULT 'ANALYZING' CHECK(required_project_status='ANALYZING'),
 binding_json TEXT NOT NULL CHECK(json_valid(binding_json)),
 policy_snapshot_json TEXT NOT NULL CHECK(json_valid(policy_snapshot_json)),
 request_id TEXT NOT NULL CHECK(length(request_id)>0),
 budget_id TEXT NOT NULL UNIQUE REFERENCES editorial_project_execution_budgets(id),
 envelope_id TEXT NOT NULL UNIQUE REFERENCES editorial_execution_envelopes(id),
 stage_key TEXT NOT NULL CHECK(stage_key='CONTENT_BRIEF'),
 profile_key TEXT NOT NULL CHECK(profile_key='phase3_content_brief_revision_v1'),
 profile_version INTEGER NOT NULL CHECK(profile_version=1),
 provider_id TEXT NOT NULL REFERENCES ai_providers(id),
 provider_model_id TEXT NOT NULL REFERENCES ai_provider_models(id) CHECK(provider_model_id='model_openai_gpt_5_6_terra_20260903'),
 prompt_version_id TEXT NOT NULL REFERENCES prompt_versions(id) CHECK(prompt_version_id='prompt_version_content_brief_v1'),
 pricing_snapshot_id TEXT NOT NULL REFERENCES ai_pricing_snapshots(id) CHECK(pricing_snapshot_id='pricing_model_openai_gpt_5_6_terra_20260903'),
 monetary_ceiling_microusd INTEGER NOT NULL CHECK(monetary_ceiling_microusd=201920),
 maximum_calls INTEGER NOT NULL CHECK(maximum_calls=1),
 maximum_attempts INTEGER NOT NULL DEFAULT 1 CHECK(maximum_attempts=1),
 sdk_max_retries INTEGER NOT NULL DEFAULT 0 CHECK(sdk_max_retries=0),
 fallback_enabled INTEGER NOT NULL DEFAULT 0 CHECK(fallback_enabled=0),
 external_tools_enabled INTEGER NOT NULL DEFAULT 0 CHECK(external_tools_enabled=0),
 creative_regeneration_enabled INTEGER NOT NULL DEFAULT 0 CHECK(creative_regeneration_enabled=0),
 human_selection_required INTEGER NOT NULL DEFAULT 1 CHECK(human_selection_required=1),
 human_approval_required INTEGER NOT NULL DEFAULT 1 CHECK(human_approval_required=1),
 actor_id TEXT NOT NULL REFERENCES users(id),
 actor_role TEXT NOT NULL CHECK(actor_role IN ('owner','admin')),
 environment TEXT NOT NULL CHECK(length(environment) BETWEEN 1 AND 100),
 audit_event_id TEXT NOT NULL UNIQUE REFERENCES audit_events(id),
 idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 200 AND idempotency_key=trim(idempotency_key)),
 command_hash TEXT NOT NULL CHECK(length(command_hash)=64),
 result_json TEXT NOT NULL CHECK(json_valid(result_json) AND length(result_json)<=16384),
 created_at TEXT NOT NULL,
 UNIQUE(workspace_id,idempotency_key),
 UNIQUE(workspace_id,project_id,revision_request_id,stage_key)
);
CREATE VIEW content_brief_revision_eligible_inputs AS
SELECT r.id revision_request_id,r.workspace_id,r.project_id,a.id research_artifact_id,v.id research_version_id,
 a.version research_artifact_revision,p.version project_version,ap.id research_approval_id,
 v.content_hash research_content_hash,ic.id idea_candidate_id,ic.version expected_idea_candidate_revision,
 ia.id idea_artifact_id,iv.id idea_version_id,ip.id idea_approval_id,iv.content_hash idea_content_hash,
 ia.version expected_idea_artifact_revision,ba.id brief_artifact_id,bv.id expected_current_brief_version_id,
 ba.version expected_brief_artifact_revision,
 json_array(v.content_hash,ic.id,ic.version,ia.id,iv.id,ip.id,iv.content_hash,ia.version,ba.id,bv.id,ba.version) binding_json
FROM editorial_revision_requests r
JOIN projects p ON p.id=r.project_id AND p.workspace_id=r.workspace_id
JOIN editorial_research_revision_imports i ON i.revision_request_id=r.id AND i.workspace_id=r.workspace_id AND i.project_id=p.id
JOIN editorial_artifacts a ON a.id=i.research_artifact_id AND a.workspace_id=r.workspace_id AND a.project_id=p.id
JOIN editorial_artifact_versions v ON v.id=i.new_research_version_id AND v.artifact_id=a.id AND v.workspace_id=r.workspace_id
JOIN artifact_approvals ap ON ap.artifact_version_id=v.id AND ap.workspace_id=r.workspace_id AND ap.decision='APPROVED'
JOIN idea_candidates ic ON ic.workspace_id=r.workspace_id AND ic.project_id=p.id AND ic.status='SELECTED'
JOIN editorial_artifacts ia ON ia.id=ic.artifact_id AND ia.workspace_id=r.workspace_id AND ia.project_id=p.id AND ia.artifact_type='IDEA_CANDIDATE' AND ia.status='approved' AND ia.deleted_at IS NULL
JOIN editorial_artifact_versions iv ON iv.id=ic.artifact_version_id AND iv.id=ia.current_version_id AND iv.artifact_id=ia.id AND iv.workspace_id=r.workspace_id
JOIN artifact_approvals ip ON ip.artifact_version_id=iv.id AND ip.workspace_id=r.workspace_id AND ip.decision='APPROVED'
JOIN editorial_artifacts ba ON ba.workspace_id=r.workspace_id AND ba.project_id=p.id AND ba.artifact_type='CONTENT_BRIEF' AND ba.deleted_at IS NULL
JOIN editorial_artifact_versions bv ON bv.id=ba.current_version_id AND bv.artifact_id=ba.id AND bv.workspace_id=r.workspace_id
WHERE r.status='OPEN' AND r.target_stage='RESEARCH'
 AND NOT EXISTS(SELECT 1 FROM editorial_revision_request_resolutions x WHERE x.revision_request_id=r.id)
 AND p.status='ANALYZING' AND p.archived_at IS NULL AND p.deleted_at IS NULL
 AND a.artifact_type='RESEARCH' AND a.status='approved' AND a.deleted_at IS NULL AND a.current_version_id=v.id AND v.source_type='IMPORTED'
 AND NOT EXISTS(SELECT 1 FROM artifact_approvals other WHERE other.artifact_version_id=v.id AND other.id<>ap.id)
 AND NOT EXISTS(SELECT 1 FROM artifact_approvals other WHERE other.artifact_version_id=iv.id AND other.id<>ip.id)
 AND (SELECT count(*) FROM idea_candidates selected WHERE selected.workspace_id=r.workspace_id AND selected.project_id=p.id AND selected.status='SELECTED')=1
 AND (SELECT count(*) FROM editorial_artifacts target WHERE target.workspace_id=r.workspace_id AND target.project_id=p.id AND target.artifact_type='CONTENT_BRIEF' AND target.deleted_at IS NULL)=1
 AND (SELECT count(*) FROM artifact_dependencies d WHERE d.dependent_artifact_version_id=iv.id AND d.dependency_type='GENERATED_FROM' AND d.validity_status='CURRENT')=1
 AND EXISTS(SELECT 1 FROM artifact_dependencies d WHERE d.workspace_id=r.workspace_id AND d.dependent_artifact_version_id=iv.id AND d.source_artifact_version_id=v.id AND d.dependency_type='GENERATED_FROM' AND d.validity_status='CURRENT')
 AND NOT EXISTS(SELECT 1 FROM intelligence_runs ir WHERE ir.workspace_id=r.workspace_id AND ir.project_id=p.id AND ir.task_type='CONTENT_BRIEF' AND ir.input_artifact_version_id=iv.id AND ir.status='SUCCEEDED')
 AND NOT EXISTS(SELECT 1 FROM artifact_dependencies d JOIN editorial_artifact_versions dv ON dv.id=d.dependent_artifact_version_id JOIN editorial_artifacts da ON da.id=dv.artifact_id WHERE d.source_artifact_version_id=iv.id AND d.dependency_type='GENERATED_FROM' AND da.artifact_type='CONTENT_BRIEF')
 AND EXISTS(SELECT 1 FROM editorial_execution_envelopes e WHERE e.workspace_id=r.workspace_id AND e.project_id=p.id AND e.profile_key='phase3_terminal_graph_v1' AND e.profile_version=1 AND e.stage_key='CONTENT_BRIEF' AND e.status='CONSUMED' AND e.maximum_calls=1);
CREATE VIEW content_brief_revision_eligible_policy AS
SELECT p.id provider_id,m.id provider_model_id,pv.id prompt_version_id,ps.id pricing_snapshot_id,
 json_array(m.version,m.capabilities_json,m.effective_from,m.effective_to,pv.content_hash,pv.template_text,pv.input_schema_version,pv.output_schema_version,ps.input_unit_price,ps.output_unit_price,ps.effective_from,ps.effective_to) policy_snapshot_json
FROM ai_providers p JOIN ai_provider_models m ON m.provider_id=p.id
JOIN ai_pricing_snapshots ps ON ps.provider_model_id=m.id
JOIN prompt_versions pv ON pv.id='prompt_version_content_brief_v1'
JOIN prompt_definitions pd ON pd.id=pv.prompt_definition_id
WHERE p.key='openai' AND p.status='configured' AND m.model_key='gpt-5.6-terra'
 AND m.id='model_openai_gpt_5_6_terra_20260903' AND m.status='available'
 AND json_extract(m.capabilities_json,'$.qualityTier')='BALANCED'
 AND EXISTS(SELECT 1 FROM json_each(m.capabilities_json,'$.capabilities') WHERE value='STRUCTURED_OUTPUT')
 AND EXISTS(SELECT 1 FROM json_each(m.capabilities_json,'$.capabilities') WHERE value='MULTILINGUAL_TEXT')
 AND m.effective_to IS NULL AND julianday(m.effective_from)<=julianday('now')
 AND ps.id='pricing_model_openai_gpt_5_6_terra_20260903' AND ps.currency='USD' AND ps.unit_name='token'
 AND ps.verification_status='externally_verified' AND ps.effective_to IS NULL AND julianday(ps.effective_from)<=julianday('now')
 AND ps.input_unit_price=0.000002 AND ps.output_unit_price=0.000012
 AND pv.status='active' AND pd.status='active' AND pd.key='content_brief';
CREATE TRIGGER content_brief_revision_capacity_scope_guard BEFORE INSERT ON editorial_content_brief_revision_capacities WHEN NOT EXISTS(SELECT 1 FROM content_brief_revision_eligible_inputs x WHERE x.revision_request_id=NEW.revision_request_id AND x.workspace_id=NEW.workspace_id AND x.project_id=NEW.project_id AND x.research_artifact_id=NEW.research_artifact_id AND x.research_version_id=NEW.research_version_id AND x.research_approval_id=NEW.research_approval_id AND x.research_artifact_revision=NEW.expected_research_artifact_revision AND x.project_version=NEW.expected_project_version AND x.binding_json=NEW.binding_json  AND x.research_content_hash=NEW.research_content_hash AND x.idea_candidate_id=NEW.idea_candidate_id AND x.expected_idea_candidate_revision=NEW.expected_idea_candidate_revision AND x.idea_artifact_id=NEW.idea_artifact_id AND x.idea_version_id=NEW.idea_version_id AND x.idea_approval_id=NEW.idea_approval_id AND x.idea_content_hash=NEW.idea_content_hash AND x.expected_idea_artifact_revision=NEW.expected_idea_artifact_revision AND x.brief_artifact_id=NEW.brief_artifact_id AND x.expected_current_brief_version_id=NEW.expected_current_brief_version_id AND x.expected_brief_artifact_revision=NEW.expected_brief_artifact_revision)
BEGIN SELECT RAISE(ABORT,'content_brief_revision_capacity_invalid'); END;
CREATE TRIGGER content_brief_revision_capacity_policy_guard BEFORE INSERT ON editorial_content_brief_revision_capacities WHEN NOT EXISTS(SELECT 1 FROM content_brief_revision_eligible_policy x WHERE x.provider_id=NEW.provider_id AND x.provider_model_id=NEW.provider_model_id AND x.prompt_version_id=NEW.prompt_version_id AND x.pricing_snapshot_id=NEW.pricing_snapshot_id AND x.policy_snapshot_json=NEW.policy_snapshot_json)
BEGIN SELECT RAISE(ABORT,'content_brief_revision_capacity_invalid'); END;
CREATE TRIGGER content_brief_revision_capacity_actor_guard BEFORE INSERT ON editorial_content_brief_revision_capacities WHEN NOT EXISTS(SELECT 1 FROM users u JOIN user_roles ur ON ur.user_id=u.id AND ur.workspace_id=u.workspace_id JOIN roles r ON r.id=ur.role_id WHERE u.id=NEW.actor_id AND u.workspace_id=NEW.workspace_id AND u.status='active' AND u.deleted_at IS NULL AND r.key=NEW.actor_role AND r.key IN ('owner','admin'))
BEGIN SELECT RAISE(ABORT,'content_brief_revision_capacity_invalid'); END;
CREATE TRIGGER content_brief_revision_capacity_budget_guard BEFORE INSERT ON editorial_content_brief_revision_capacities WHEN NOT EXISTS(SELECT 1 FROM editorial_project_execution_budgets b JOIN editorial_execution_envelopes e ON e.project_execution_budget_id=b.id
WHERE b.id=NEW.budget_id AND e.id=NEW.envelope_id AND b.workspace_id=NEW.workspace_id AND e.workspace_id=NEW.workspace_id AND b.project_id=NEW.project_id AND e.project_id=NEW.project_id
AND b.profile_key=NEW.profile_key AND e.profile_key=NEW.profile_key AND b.profile_version=1 AND e.profile_version=1 AND b.status='ACTIVE' AND e.status='ACTIVE' AND b.version=1 AND e.version=1
AND b.currency='USD' AND e.currency='USD' AND b.monetary_ceiling_microusd=201920 AND e.monetary_ceiling_microusd=201920 AND e.maximum_calls=1 AND e.stage_key='CONTENT_BRIEF'
AND b.authorized_by=NEW.actor_id AND e.authorized_by=NEW.actor_id AND e.provider_id=NEW.provider_id AND e.provider_model_id=NEW.provider_model_id
AND NOT EXISTS(SELECT 1 FROM editorial_execution_reservations q WHERE q.envelope_id=e.id OR q.project_execution_budget_id=b.id))
BEGIN SELECT RAISE(ABORT,'content_brief_revision_capacity_invalid'); END;
CREATE TRIGGER content_brief_revision_capacity_result_guard BEFORE INSERT ON editorial_content_brief_revision_capacities WHEN NOT EXISTS(SELECT 1 WHERE json_type(NEW.result_json)='object' AND (SELECT count(*) FROM json_each(NEW.result_json))=20 AND NOT EXISTS(SELECT 1 FROM json_each(json_object('capacityId',NEW.id,'projectId',NEW.project_id,'revisionRequestId',NEW.revision_request_id,'researchArtifactId',NEW.research_artifact_id,'researchVersionId',NEW.research_version_id,'researchApprovalId',NEW.research_approval_id,'ideaCandidateId',NEW.idea_candidate_id,'ideaArtifactId',NEW.idea_artifact_id,'ideaVersionId',NEW.idea_version_id,'ideaApprovalId',NEW.idea_approval_id,'briefArtifactId',NEW.brief_artifact_id,'expectedCurrentBriefVersionId',NEW.expected_current_brief_version_id,'budgetId',NEW.budget_id,'envelopeId',NEW.envelope_id,'auditEventId',NEW.audit_event_id,'profileKey',NEW.profile_key,'profileVersion',NEW.profile_version,'stageKey',NEW.stage_key,'monetaryCeilingMicrousd',NEW.monetary_ceiling_microusd,'maximumCalls',NEW.maximum_calls)) expected WHERE json_type(NEW.result_json,'$.'||expected.key) IS NOT expected.type OR json_extract(NEW.result_json,'$.'||expected.key) IS NOT expected.value)) BEGIN SELECT RAISE(ABORT,'content_brief_revision_receipt_invalid'); END;
CREATE TRIGGER content_brief_revision_capacity_audit_guard BEFORE INSERT ON editorial_content_brief_revision_capacities WHEN NOT EXISTS(SELECT 1 FROM audit_events a WHERE a.id=NEW.audit_event_id AND a.workspace_id=NEW.workspace_id AND a.actor_id=NEW.actor_id AND a.actor_type='user' AND a.actor_role=NEW.actor_role AND a.environment=NEW.environment AND a.request_id=NEW.request_id AND a.action='editorial.content_brief_revision_capacity_authorized' AND a.resource_type='editorial_content_brief_revision_capacity' AND a.resource_id=NEW.id AND a.outcome='success' AND json_type(a.metadata_json)='object' AND (SELECT count(*) FROM json_each(a.metadata_json))=28 AND NOT EXISTS(SELECT 1 FROM json_each(json_object('capacityId',NEW.id,'projectId',NEW.project_id,'revisionRequestId',NEW.revision_request_id,'researchArtifactId',NEW.research_artifact_id,'researchVersionId',NEW.research_version_id,'researchApprovalId',NEW.research_approval_id,'ideaCandidateId',NEW.idea_candidate_id,'ideaArtifactId',NEW.idea_artifact_id,'ideaVersionId',NEW.idea_version_id,'ideaApprovalId',NEW.idea_approval_id,'briefArtifactId',NEW.brief_artifact_id,'expectedCurrentBriefVersionId',NEW.expected_current_brief_version_id,'budgetId',NEW.budget_id,'envelopeId',NEW.envelope_id,'auditEventId',NEW.audit_event_id,'profileKey',NEW.profile_key,'profileVersion',NEW.profile_version,'stageKey',NEW.stage_key,'monetaryCeilingMicrousd',NEW.monetary_ceiling_microusd,'maximumCalls',NEW.maximum_calls,'workspaceId',NEW.workspace_id,'actorId',NEW.actor_id,'actorRole',NEW.actor_role,'environment',NEW.environment,'providerId',NEW.provider_id,'modelId',NEW.provider_model_id,'promptVersionId',NEW.prompt_version_id,'pricingSnapshotId',NEW.pricing_snapshot_id)) expected WHERE json_type(a.metadata_json,'$.'||expected.key) IS NOT expected.type OR json_extract(a.metadata_json,'$.'||expected.key) IS NOT expected.value)) BEGIN SELECT RAISE(ABORT,'content_brief_revision_audit_invalid'); END;
CREATE TRIGGER content_brief_revision_capacity_no_update BEFORE UPDATE ON editorial_content_brief_revision_capacities BEGIN SELECT RAISE(ABORT,'content brief revision capacity is append-only'); END;
CREATE TRIGGER content_brief_revision_capacity_no_delete BEFORE DELETE ON editorial_content_brief_revision_capacities BEGIN SELECT RAISE(ABORT,'content brief revision capacity is append-only'); END;
CREATE TABLE editorial_content_brief_revision_capacity_recoveries (
 id TEXT PRIMARY KEY NOT NULL,
 workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 project_id TEXT NOT NULL REFERENCES projects(id),
 content_brief_revision_capacity_id TEXT NOT NULL UNIQUE REFERENCES editorial_content_brief_revision_capacities(id),
 revision_request_id TEXT NOT NULL REFERENCES editorial_revision_requests(id),
 research_artifact_id TEXT NOT NULL REFERENCES editorial_artifacts(id),
 research_version_id TEXT NOT NULL REFERENCES editorial_artifact_versions(id),
 research_approval_id TEXT NOT NULL REFERENCES artifact_approvals(id),
 budget_id TEXT NOT NULL REFERENCES editorial_project_execution_budgets(id),
 original_envelope_id TEXT NOT NULL REFERENCES editorial_execution_envelopes(id),
 failed_reservation_id TEXT NOT NULL UNIQUE REFERENCES editorial_execution_reservations(id),
 failed_run_id TEXT NOT NULL UNIQUE REFERENCES intelligence_runs(id),
 replacement_envelope_id TEXT NOT NULL UNIQUE REFERENCES editorial_execution_envelopes(id),
 original_project_version INTEGER NOT NULL CHECK(original_project_version>0),
 recovery_project_version INTEGER NOT NULL CHECK(recovery_project_version>0),
 provider_id TEXT NOT NULL REFERENCES ai_providers(id),
 provider_model_id TEXT NOT NULL REFERENCES ai_provider_models(id),
 prompt_version_id TEXT NOT NULL REFERENCES prompt_versions(id),
 pricing_snapshot_id TEXT NOT NULL REFERENCES ai_pricing_snapshots(id),
 profile_key TEXT NOT NULL CHECK(profile_key='phase3_content_brief_revision_v1'),
 profile_version INTEGER NOT NULL CHECK(profile_version=1),
 stage_key TEXT NOT NULL CHECK(stage_key='CONTENT_BRIEF'),
 monetary_ceiling_microusd INTEGER NOT NULL CHECK(monetary_ceiling_microusd=201920),
 maximum_calls INTEGER NOT NULL CHECK(maximum_calls=1),
 actor_id TEXT NOT NULL REFERENCES users(id),
 actor_role TEXT NOT NULL CHECK(actor_role IN ('owner','admin')),
 environment TEXT NOT NULL CHECK(length(environment) BETWEEN 1 AND 100),
 audit_event_id TEXT NOT NULL UNIQUE REFERENCES audit_events(id),
 idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 200 AND idempotency_key=trim(idempotency_key)),
 command_hash TEXT NOT NULL CHECK(length(command_hash)=64),
 result_json TEXT NOT NULL CHECK(json_valid(result_json) AND length(result_json)<=16384),
 created_at TEXT NOT NULL,
 CHECK(original_envelope_id<>replacement_envelope_id),
 UNIQUE(workspace_id,idempotency_key)
);
-- Durable server-written evidence, not an assertion supplied by the recovery client.
CREATE VIEW content_brief_revision_zero_provider_failures AS
SELECT c.id capacity_id,r.id failed_reservation_id,ir.id failed_run_id
FROM editorial_content_brief_revision_capacities c
JOIN editorial_execution_envelopes e ON e.id=c.envelope_id AND e.project_execution_budget_id=c.budget_id AND e.workspace_id=c.workspace_id AND e.project_id=c.project_id
JOIN editorial_execution_reservations r ON r.envelope_id=e.id AND r.project_execution_budget_id=c.budget_id AND r.workspace_id=c.workspace_id AND r.project_id=c.project_id
JOIN intelligence_runs ir ON ir.id=r.intelligence_run_id AND ir.workspace_id=c.workspace_id AND ir.project_id=c.project_id
JOIN audit_events a ON a.id=ir.terminal_audit_event_id AND a.workspace_id=c.workspace_id AND a.resource_id=ir.id
WHERE e.status='CONSUMED' AND e.maximum_calls=1 AND e.stage_key=c.stage_key AND e.profile_key=c.profile_key
 AND r.status='CANCELLED' AND r.actual_microusd=0 AND r.dispatched_at IS NULL AND r.reconciled_at IS NOT NULL
 AND r.step_key=c.stage_key AND r.pricing_snapshot_id=c.pricing_snapshot_id AND r.reserved_microusd=c.monetary_ceiling_microusd
 AND (SELECT count(*) FROM editorial_execution_reservations q WHERE q.envelope_id=e.id)=1
 AND ir.status='FAILED_PERMANENT' AND ir.task_type=c.stage_key AND ir.actual_cost=0 AND ir.currency='USD'
 AND ir.input_units=0 AND ir.output_units=0 AND ir.started_at IS NULL AND ir.completed_at IS NOT NULL
 AND ir.output_artifact_version_id IS NULL AND ir.creative_regeneration_number=0
 AND ir.provider_id=c.provider_id AND ir.provider_model_id=c.provider_model_id
 AND ir.prompt_version_id=c.prompt_version_id AND ir.pricing_snapshot_id=c.pricing_snapshot_id
 AND ir.input_artifact_version_id=c.idea_version_id
 AND ir.error_category='PERMANENT' AND ir.safe_error_detail='content_brief_revision_dispatch_ineligible'
 AND json_type(ir.safe_metadata_json)='object' AND (SELECT count(*) FROM json_each(ir.safe_metadata_json))=5
 AND json_type(ir.safe_metadata_json,'$.commandHash')='text' AND length(json_extract(ir.safe_metadata_json,'$.commandHash'))=64
 AND json_type(ir.safe_metadata_json,'$.dispatchAuthorized')='false'
 AND json_type(ir.safe_metadata_json,'$.providerCalls')='integer' AND json_extract(ir.safe_metadata_json,'$.providerCalls')=0
 AND json_extract(ir.safe_metadata_json,'$.contentBriefRevisionCapacityId')=c.id
 AND json_extract(ir.safe_metadata_json,'$.preDispatchFailure')='ELIGIBILITY_REJECTED'
 AND a.action='intelligence.run_failed' AND a.resource_type='intelligence_run' AND a.outcome='failure'
 AND a.environment=c.environment AND length(a.request_id)>0
 AND NOT EXISTS(SELECT 1 FROM intelligence_run_attempts attempted WHERE attempted.intelligence_run_id=ir.id)
 AND NOT EXISTS(SELECT 1 FROM editorial_artifact_versions output WHERE output.intelligence_run_id=ir.id);
CREATE VIEW content_brief_revision_recovery_eligible AS
SELECT c.id capacity_id,f.intelligence_run_id failed_run_id,f.id failed_reservation_id,x.project_version
FROM editorial_content_brief_revision_capacities c
JOIN editorial_execution_reservations f ON f.envelope_id=c.envelope_id AND f.project_execution_budget_id=c.budget_id
JOIN content_brief_revision_eligible_inputs x ON x.revision_request_id=c.revision_request_id AND x.workspace_id=c.workspace_id AND x.project_id=c.project_id AND x.research_artifact_id=c.research_artifact_id AND x.research_version_id=c.research_version_id AND x.research_approval_id=c.research_approval_id AND x.research_artifact_revision=c.expected_research_artifact_revision AND x.binding_json=c.binding_json
JOIN content_brief_revision_eligible_policy p ON p.provider_id=c.provider_id AND p.provider_model_id=c.provider_model_id AND p.prompt_version_id=c.prompt_version_id AND p.pricing_snapshot_id=c.pricing_snapshot_id AND p.policy_snapshot_json=c.policy_snapshot_json
JOIN editorial_project_execution_budgets b ON b.id=c.budget_id AND b.workspace_id=c.workspace_id AND b.project_id=c.project_id AND b.profile_key=c.profile_key AND b.profile_version=c.profile_version
WHERE b.status='ACTIVE' AND b.currency='USD' AND b.monetary_ceiling_microusd=c.monetary_ceiling_microusd
 AND NOT EXISTS(SELECT 1 FROM artifact_approvals invalid WHERE invalid.workspace_id=c.workspace_id AND invalid.artifact_version_id=c.research_version_id AND invalid.id<>c.research_approval_id)
 AND NOT EXISTS(SELECT 1 FROM editorial_execution_reservations ambiguous WHERE ambiguous.project_execution_budget_id=b.id AND ambiguous.status='AMBIGUOUS')
 AND COALESCE((SELECT SUM(CASE q.status WHEN 'RECONCILED' THEN q.actual_microusd WHEN 'CANCELLED' THEN 0 WHEN 'AMBIGUOUS' THEN MAX(q.reserved_microusd,COALESCE(q.actual_microusd,q.reserved_microusd)) ELSE q.reserved_microusd END) FROM editorial_execution_reservations q WHERE q.project_execution_budget_id=b.id),0)+c.monetary_ceiling_microusd<=b.monetary_ceiling_microusd;
CREATE VIEW content_brief_revision_execution_bindings AS
SELECT c.id capacity_id,COALESCE(r.replacement_envelope_id,c.envelope_id) envelope_id,
 COALESCE(r.recovery_project_version,c.expected_project_version) project_version,r.id recovery_id
FROM editorial_content_brief_revision_capacities c
LEFT JOIN editorial_content_brief_revision_capacity_recoveries r ON r.content_brief_revision_capacity_id=c.id;

CREATE TRIGGER content_brief_revision_capacity_reservation_guard BEFORE INSERT ON editorial_execution_reservations WHEN EXISTS(SELECT 1 FROM editorial_execution_envelopes e WHERE e.id=NEW.envelope_id AND e.profile_key='phase3_content_brief_revision_v1') AND NOT EXISTS(
 SELECT 1 FROM editorial_content_brief_revision_capacities c
 JOIN content_brief_revision_execution_bindings binding ON binding.capacity_id=c.id
 JOIN intelligence_runs ir ON ir.id=NEW.intelligence_run_id
 JOIN editorial_execution_envelopes e ON e.id=binding.envelope_id AND e.workspace_id=c.workspace_id AND e.project_id=c.project_id AND e.project_execution_budget_id=c.budget_id AND e.profile_key=c.profile_key AND e.profile_version=c.profile_version AND e.provider_id=c.provider_id AND e.provider_model_id=c.provider_model_id AND e.stage_key=c.stage_key AND e.maximum_calls=c.maximum_calls AND e.monetary_ceiling_microusd=c.monetary_ceiling_microusd
 JOIN editorial_project_execution_budgets b ON b.id=c.budget_id AND b.workspace_id=c.workspace_id AND b.project_id=c.project_id AND b.profile_key=c.profile_key AND b.profile_version=c.profile_version AND b.monetary_ceiling_microusd=c.monetary_ceiling_microusd
 JOIN content_brief_revision_eligible_inputs x ON x.revision_request_id=c.revision_request_id AND x.workspace_id=c.workspace_id AND x.project_id=c.project_id AND x.research_version_id=c.research_version_id AND x.research_approval_id=c.research_approval_id AND x.research_artifact_revision=c.expected_research_artifact_revision AND x.binding_json=c.binding_json AND x.project_version=binding.project_version
 JOIN content_brief_revision_eligible_policy pol ON pol.provider_id=c.provider_id AND pol.provider_model_id=c.provider_model_id AND pol.prompt_version_id=c.prompt_version_id AND pol.pricing_snapshot_id=c.pricing_snapshot_id AND pol.policy_snapshot_json=c.policy_snapshot_json
 WHERE binding.envelope_id=NEW.envelope_id AND c.budget_id=NEW.project_execution_budget_id AND c.workspace_id=NEW.workspace_id AND c.project_id=NEW.project_id
 AND NEW.step_key='CONTENT_BRIEF' AND NEW.status='RESERVED' AND NEW.reserved_microusd=201920 AND NEW.pricing_snapshot_id=c.pricing_snapshot_id
 AND ir.workspace_id=c.workspace_id AND ir.project_id=c.project_id AND ir.task_type='CONTENT_BRIEF' AND ir.input_artifact_version_id=c.idea_version_id AND ir.prompt_version_id=c.prompt_version_id AND ir.pricing_snapshot_id=c.pricing_snapshot_id AND ir.provider_id=c.provider_id AND ir.provider_model_id=c.provider_model_id AND ir.status='QUEUED' AND ir.creative_regeneration_number=0
 AND json_extract(ir.safe_metadata_json,'$.contentBriefRevisionCapacityId')=c.id
 AND json_extract(ir.safe_metadata_json,'$.contentBriefRevisionRecoveryId') IS binding.recovery_id
 AND NOT EXISTS(SELECT 1 FROM artifact_approvals invalid WHERE invalid.artifact_version_id=c.research_version_id AND invalid.id<>c.research_approval_id)
)
BEGIN SELECT RAISE(ABORT,'content_brief_revision_capacity_invalid'); END;

CREATE TRIGGER content_brief_revision_capacity_budget_immutable BEFORE UPDATE ON editorial_project_execution_budgets
WHEN EXISTS(SELECT 1 FROM editorial_content_brief_revision_capacities c WHERE c.budget_id=OLD.id) AND (NEW.id IS NOT OLD.id OR NEW.workspace_id IS NOT OLD.workspace_id OR NEW.project_id IS NOT OLD.project_id OR NEW.profile_key IS NOT OLD.profile_key OR NEW.profile_version IS NOT OLD.profile_version OR NEW.currency IS NOT OLD.currency OR NEW.monetary_ceiling_microusd IS NOT OLD.monetary_ceiling_microusd OR NEW.authorized_by IS NOT OLD.authorized_by OR NEW.created_at IS NOT OLD.created_at)
BEGIN SELECT RAISE(ABORT,'content brief revision capacity binding is immutable'); END;

CREATE TRIGGER content_brief_revision_capacity_envelope_immutable BEFORE UPDATE ON editorial_execution_envelopes
WHEN (EXISTS(SELECT 1 FROM editorial_content_brief_revision_capacities c WHERE c.envelope_id=OLD.id) OR EXISTS(SELECT 1 FROM editorial_content_brief_revision_capacity_recoveries r WHERE r.replacement_envelope_id=OLD.id)) AND (NEW.id IS NOT OLD.id OR NEW.workspace_id IS NOT OLD.workspace_id OR NEW.project_id IS NOT OLD.project_id OR NEW.profile_key IS NOT OLD.profile_key OR NEW.profile_version IS NOT OLD.profile_version OR NEW.provider_id IS NOT OLD.provider_id OR NEW.provider_model_id IS NOT OLD.provider_model_id OR NEW.currency IS NOT OLD.currency OR NEW.monetary_ceiling_microusd IS NOT OLD.monetary_ceiling_microusd OR NEW.maximum_calls IS NOT OLD.maximum_calls OR NEW.authorized_by IS NOT OLD.authorized_by OR NEW.project_execution_budget_id IS NOT OLD.project_execution_budget_id OR NEW.stage_key IS NOT OLD.stage_key OR NEW.created_at IS NOT OLD.created_at)
BEGIN SELECT RAISE(ABORT,'content brief revision capacity binding is immutable'); END;

CREATE TRIGGER content_brief_revision_capacity_reservation_immutable BEFORE UPDATE ON editorial_execution_reservations
WHEN (EXISTS(SELECT 1 FROM editorial_content_brief_revision_capacities c WHERE c.envelope_id=OLD.envelope_id OR c.envelope_id=NEW.envelope_id) OR EXISTS(SELECT 1 FROM editorial_content_brief_revision_capacity_recoveries r WHERE r.replacement_envelope_id=OLD.envelope_id OR r.replacement_envelope_id=NEW.envelope_id)) AND (NEW.id IS NOT OLD.id OR NEW.envelope_id IS NOT OLD.envelope_id OR NEW.workspace_id IS NOT OLD.workspace_id OR NEW.project_id IS NOT OLD.project_id OR NEW.intelligence_run_id IS NOT OLD.intelligence_run_id OR NEW.step_key IS NOT OLD.step_key OR NEW.pricing_snapshot_id IS NOT OLD.pricing_snapshot_id OR NEW.reserved_microusd IS NOT OLD.reserved_microusd OR NEW.project_execution_budget_id IS NOT OLD.project_execution_budget_id OR NEW.created_at IS NOT OLD.created_at)
BEGIN SELECT RAISE(ABORT,'content brief revision capacity binding is immutable'); END;

-- Dispatch is the linearization point: revalidate inside the state transition itself.
CREATE TRIGGER content_brief_revision_capacity_dispatch_guard BEFORE UPDATE ON editorial_execution_reservations WHEN NEW.status='DISPATCHED' AND EXISTS(SELECT 1 FROM editorial_execution_envelopes e WHERE e.id=NEW.envelope_id AND e.profile_key='phase3_content_brief_revision_v1') AND NOT EXISTS(
 SELECT 1 FROM editorial_content_brief_revision_capacities c
 JOIN content_brief_revision_execution_bindings binding ON binding.capacity_id=c.id
 JOIN intelligence_runs ir ON ir.id=NEW.intelligence_run_id
 JOIN editorial_execution_envelopes e ON e.id=binding.envelope_id AND e.workspace_id=c.workspace_id AND e.project_id=c.project_id AND e.project_execution_budget_id=c.budget_id AND e.profile_key=c.profile_key AND e.profile_version=c.profile_version AND e.provider_id=c.provider_id AND e.provider_model_id=c.provider_model_id AND e.stage_key=c.stage_key AND e.maximum_calls=c.maximum_calls AND e.monetary_ceiling_microusd=c.monetary_ceiling_microusd
 JOIN editorial_project_execution_budgets b ON b.id=c.budget_id AND b.workspace_id=c.workspace_id AND b.project_id=c.project_id AND b.profile_key=c.profile_key AND b.profile_version=c.profile_version AND b.monetary_ceiling_microusd=c.monetary_ceiling_microusd
 JOIN content_brief_revision_eligible_inputs x ON x.revision_request_id=c.revision_request_id AND x.workspace_id=c.workspace_id AND x.project_id=c.project_id AND x.research_version_id=c.research_version_id AND x.research_approval_id=c.research_approval_id AND x.research_artifact_revision=c.expected_research_artifact_revision AND x.binding_json=c.binding_json AND x.project_version=binding.project_version
 JOIN content_brief_revision_eligible_policy pol ON pol.provider_id=c.provider_id AND pol.provider_model_id=c.provider_model_id AND pol.prompt_version_id=c.prompt_version_id AND pol.pricing_snapshot_id=c.pricing_snapshot_id AND pol.policy_snapshot_json=c.policy_snapshot_json
 WHERE binding.envelope_id=NEW.envelope_id AND c.budget_id=NEW.project_execution_budget_id AND c.workspace_id=NEW.workspace_id AND c.project_id=NEW.project_id
 AND OLD.status='RESERVED' AND NEW.step_key='CONTENT_BRIEF' AND NEW.status='DISPATCHED' AND NEW.dispatched_at IS NOT NULL
 AND e.status='CONSUMED' AND b.status='ACTIVE' AND e.currency='USD' AND b.currency='USD'
 AND (SELECT count(*) FROM editorial_execution_reservations used WHERE used.envelope_id=e.id)=1
 AND NOT EXISTS(SELECT 1 FROM intelligence_run_attempts attempted WHERE attempted.intelligence_run_id=ir.id) AND NEW.reserved_microusd=201920 AND NEW.pricing_snapshot_id=c.pricing_snapshot_id
 AND ir.workspace_id=c.workspace_id AND ir.project_id=c.project_id AND ir.task_type='CONTENT_BRIEF' AND ir.input_artifact_version_id=c.idea_version_id AND ir.prompt_version_id=c.prompt_version_id AND ir.pricing_snapshot_id=c.pricing_snapshot_id AND ir.provider_id=c.provider_id AND ir.provider_model_id=c.provider_model_id AND ir.status='QUEUED' AND ir.creative_regeneration_number=0
 AND json_extract(ir.safe_metadata_json,'$.contentBriefRevisionCapacityId')=c.id
 AND json_extract(ir.safe_metadata_json,'$.contentBriefRevisionRecoveryId') IS binding.recovery_id
 AND NOT EXISTS(SELECT 1 FROM artifact_approvals invalid WHERE invalid.artifact_version_id=c.research_version_id AND invalid.id<>c.research_approval_id)
)
BEGIN SELECT RAISE(ABORT,'content_brief_revision_capacity_invalid'); END;

-- Recovery is one append-only authorization continuation, with no second budget.
CREATE TRIGGER content_brief_revision_recovery_scope_guard BEFORE INSERT ON editorial_content_brief_revision_capacity_recoveries WHEN NOT EXISTS(SELECT 1 FROM editorial_content_brief_revision_capacities c WHERE c.id=NEW.content_brief_revision_capacity_id AND c.workspace_id=NEW.workspace_id AND c.project_id=NEW.project_id AND c.revision_request_id=NEW.revision_request_id AND c.research_artifact_id=NEW.research_artifact_id AND c.research_version_id=NEW.research_version_id AND c.research_approval_id=NEW.research_approval_id AND c.budget_id=NEW.budget_id AND c.provider_id=NEW.provider_id AND c.provider_model_id=NEW.provider_model_id AND c.prompt_version_id=NEW.prompt_version_id AND c.pricing_snapshot_id=NEW.pricing_snapshot_id AND c.profile_key=NEW.profile_key AND c.profile_version=NEW.profile_version AND c.stage_key=NEW.stage_key AND c.monetary_ceiling_microusd=NEW.monetary_ceiling_microusd AND c.maximum_calls=NEW.maximum_calls AND c.environment=NEW.environment AND c.envelope_id=NEW.original_envelope_id AND c.expected_project_version=NEW.original_project_version)
BEGIN SELECT RAISE(ABORT,'content_brief_revision_recovery_invalid'); END;
CREATE TRIGGER content_brief_revision_recovery_failure_guard BEFORE INSERT ON editorial_content_brief_revision_capacity_recoveries WHEN NOT EXISTS(SELECT 1 FROM content_brief_revision_zero_provider_failures f WHERE f.capacity_id=NEW.content_brief_revision_capacity_id AND f.failed_run_id=NEW.failed_run_id AND f.failed_reservation_id=NEW.failed_reservation_id)
BEGIN SELECT RAISE(ABORT,'content_brief_revision_recovery_invalid'); END;
CREATE TRIGGER content_brief_revision_recovery_current_guard BEFORE INSERT ON editorial_content_brief_revision_capacity_recoveries WHEN NOT EXISTS(SELECT 1 FROM content_brief_revision_recovery_eligible x WHERE x.capacity_id=NEW.content_brief_revision_capacity_id AND x.failed_run_id=NEW.failed_run_id AND x.failed_reservation_id=NEW.failed_reservation_id AND x.project_version=NEW.recovery_project_version)
BEGIN SELECT RAISE(ABORT,'content_brief_revision_recovery_invalid'); END;
CREATE TRIGGER content_brief_revision_recovery_envelope_guard BEFORE INSERT ON editorial_content_brief_revision_capacity_recoveries WHEN NOT EXISTS(SELECT 1 FROM editorial_execution_envelopes e WHERE e.id=NEW.replacement_envelope_id AND e.workspace_id=NEW.workspace_id AND e.project_id=NEW.project_id AND e.project_execution_budget_id=NEW.budget_id AND e.profile_key=NEW.profile_key AND e.profile_version=1 AND e.stage_key=NEW.stage_key AND e.currency='USD' AND e.provider_id=NEW.provider_id AND e.provider_model_id=NEW.provider_model_id AND e.monetary_ceiling_microusd=201920 AND e.maximum_calls=1 AND e.status='ACTIVE' AND e.version=1 AND e.authorized_by=NEW.actor_id AND e.created_at=NEW.created_at AND NOT EXISTS(SELECT 1 FROM editorial_execution_reservations q WHERE q.envelope_id=e.id))
BEGIN SELECT RAISE(ABORT,'content_brief_revision_recovery_invalid'); END;
CREATE TRIGGER content_brief_revision_recovery_actor_guard BEFORE INSERT ON editorial_content_brief_revision_capacity_recoveries WHEN NOT EXISTS(SELECT 1 FROM users u JOIN user_roles ur ON ur.user_id=u.id AND ur.workspace_id=u.workspace_id JOIN roles role ON role.id=ur.role_id WHERE u.id=NEW.actor_id AND u.workspace_id=NEW.workspace_id AND u.status='active' AND u.deleted_at IS NULL AND role.key=NEW.actor_role AND role.key IN ('owner','admin'))
BEGIN SELECT RAISE(ABORT,'content_brief_revision_recovery_invalid'); END;
CREATE TRIGGER content_brief_revision_recovery_result_guard BEFORE INSERT ON editorial_content_brief_revision_capacity_recoveries WHEN NOT EXISTS(SELECT 1 WHERE json_type(NEW.result_json)='object' AND (SELECT count(*) FROM json_each(NEW.result_json))=20 AND json_type(NEW.result_json,'$.recoveryId')='text' AND json_extract(NEW.result_json,'$.recoveryId') IS NEW.id AND json_type(NEW.result_json,'$.capacityId')='text' AND json_extract(NEW.result_json,'$.capacityId') IS NEW.content_brief_revision_capacity_id AND json_type(NEW.result_json,'$.projectId')='text' AND json_extract(NEW.result_json,'$.projectId') IS NEW.project_id AND json_type(NEW.result_json,'$.revisionRequestId')='text' AND json_extract(NEW.result_json,'$.revisionRequestId') IS NEW.revision_request_id AND json_type(NEW.result_json,'$.researchArtifactId')='text' AND json_extract(NEW.result_json,'$.researchArtifactId') IS NEW.research_artifact_id AND json_type(NEW.result_json,'$.researchVersionId')='text' AND json_extract(NEW.result_json,'$.researchVersionId') IS NEW.research_version_id AND json_type(NEW.result_json,'$.researchApprovalId')='text' AND json_extract(NEW.result_json,'$.researchApprovalId') IS NEW.research_approval_id AND json_type(NEW.result_json,'$.budgetId')='text' AND json_extract(NEW.result_json,'$.budgetId') IS NEW.budget_id AND json_type(NEW.result_json,'$.originalEnvelopeId')='text' AND json_extract(NEW.result_json,'$.originalEnvelopeId') IS NEW.original_envelope_id AND json_type(NEW.result_json,'$.failedReservationId')='text' AND json_extract(NEW.result_json,'$.failedReservationId') IS NEW.failed_reservation_id AND json_type(NEW.result_json,'$.failedRunId')='text' AND json_extract(NEW.result_json,'$.failedRunId') IS NEW.failed_run_id AND json_type(NEW.result_json,'$.replacementEnvelopeId')='text' AND json_extract(NEW.result_json,'$.replacementEnvelopeId') IS NEW.replacement_envelope_id AND json_type(NEW.result_json,'$.originalProjectVersion')='integer' AND json_extract(NEW.result_json,'$.originalProjectVersion') IS NEW.original_project_version AND json_type(NEW.result_json,'$.recoveryProjectVersion')='integer' AND json_extract(NEW.result_json,'$.recoveryProjectVersion') IS NEW.recovery_project_version AND json_type(NEW.result_json,'$.auditEventId')='text' AND json_extract(NEW.result_json,'$.auditEventId') IS NEW.audit_event_id AND json_type(NEW.result_json,'$.profileKey')='text' AND json_extract(NEW.result_json,'$.profileKey') IS NEW.profile_key AND json_type(NEW.result_json,'$.profileVersion')='integer' AND json_extract(NEW.result_json,'$.profileVersion') IS NEW.profile_version AND json_type(NEW.result_json,'$.stageKey')='text' AND json_extract(NEW.result_json,'$.stageKey') IS NEW.stage_key AND json_type(NEW.result_json,'$.monetaryCeilingMicrousd')='integer' AND json_extract(NEW.result_json,'$.monetaryCeilingMicrousd') IS NEW.monetary_ceiling_microusd AND json_type(NEW.result_json,'$.maximumCalls')='integer' AND json_extract(NEW.result_json,'$.maximumCalls') IS NEW.maximum_calls)
BEGIN SELECT RAISE(ABORT,'content_brief_revision_recovery_invalid'); END;
CREATE TRIGGER content_brief_revision_recovery_audit_guard BEFORE INSERT ON editorial_content_brief_revision_capacity_recoveries WHEN NOT EXISTS(SELECT 1 FROM audit_events a WHERE a.id=NEW.audit_event_id AND a.workspace_id=NEW.workspace_id AND a.actor_type='user' AND a.actor_id=NEW.actor_id AND a.actor_role=NEW.actor_role AND a.environment=NEW.environment AND length(a.request_id)>0 AND a.action='editorial.content_brief_revision_capacity_recovered' AND a.resource_type='editorial_content_brief_revision_capacity_recovery' AND a.resource_id=NEW.id AND a.outcome='success' AND json_type(a.metadata_json)='object' AND (SELECT count(*) FROM json_each(a.metadata_json))=28 AND (json_type(a.metadata_json,'$.recoveryId')='text' AND json_extract(a.metadata_json,'$.recoveryId') IS NEW.id) AND (json_type(a.metadata_json,'$.capacityId')='text' AND json_extract(a.metadata_json,'$.capacityId') IS NEW.content_brief_revision_capacity_id) AND (json_type(a.metadata_json,'$.projectId')='text' AND json_extract(a.metadata_json,'$.projectId') IS NEW.project_id) AND (json_type(a.metadata_json,'$.revisionRequestId')='text' AND json_extract(a.metadata_json,'$.revisionRequestId') IS NEW.revision_request_id) AND (json_type(a.metadata_json,'$.researchArtifactId')='text' AND json_extract(a.metadata_json,'$.researchArtifactId') IS NEW.research_artifact_id) AND (json_type(a.metadata_json,'$.researchVersionId')='text' AND json_extract(a.metadata_json,'$.researchVersionId') IS NEW.research_version_id) AND (json_type(a.metadata_json,'$.researchApprovalId')='text' AND json_extract(a.metadata_json,'$.researchApprovalId') IS NEW.research_approval_id) AND (json_type(a.metadata_json,'$.budgetId')='text' AND json_extract(a.metadata_json,'$.budgetId') IS NEW.budget_id) AND (json_type(a.metadata_json,'$.originalEnvelopeId')='text' AND json_extract(a.metadata_json,'$.originalEnvelopeId') IS NEW.original_envelope_id) AND (json_type(a.metadata_json,'$.failedReservationId')='text' AND json_extract(a.metadata_json,'$.failedReservationId') IS NEW.failed_reservation_id) AND (json_type(a.metadata_json,'$.failedRunId')='text' AND json_extract(a.metadata_json,'$.failedRunId') IS NEW.failed_run_id) AND (json_type(a.metadata_json,'$.replacementEnvelopeId')='text' AND json_extract(a.metadata_json,'$.replacementEnvelopeId') IS NEW.replacement_envelope_id) AND (json_type(a.metadata_json,'$.originalProjectVersion')='integer' AND json_extract(a.metadata_json,'$.originalProjectVersion') IS NEW.original_project_version) AND (json_type(a.metadata_json,'$.recoveryProjectVersion')='integer' AND json_extract(a.metadata_json,'$.recoveryProjectVersion') IS NEW.recovery_project_version) AND (json_type(a.metadata_json,'$.auditEventId')='text' AND json_extract(a.metadata_json,'$.auditEventId') IS NEW.audit_event_id) AND (json_type(a.metadata_json,'$.profileKey')='text' AND json_extract(a.metadata_json,'$.profileKey') IS NEW.profile_key) AND (json_type(a.metadata_json,'$.profileVersion')='integer' AND json_extract(a.metadata_json,'$.profileVersion') IS NEW.profile_version) AND (json_type(a.metadata_json,'$.stageKey')='text' AND json_extract(a.metadata_json,'$.stageKey') IS NEW.stage_key) AND (json_type(a.metadata_json,'$.monetaryCeilingMicrousd')='integer' AND json_extract(a.metadata_json,'$.monetaryCeilingMicrousd') IS NEW.monetary_ceiling_microusd) AND (json_type(a.metadata_json,'$.maximumCalls')='integer' AND json_extract(a.metadata_json,'$.maximumCalls') IS NEW.maximum_calls) AND (json_type(a.metadata_json,'$.workspaceId')='text' AND json_extract(a.metadata_json,'$.workspaceId') IS NEW.workspace_id) AND (json_type(a.metadata_json,'$.actorId')='text' AND json_extract(a.metadata_json,'$.actorId') IS NEW.actor_id) AND (json_type(a.metadata_json,'$.actorRole')='text' AND json_extract(a.metadata_json,'$.actorRole') IS NEW.actor_role) AND (json_type(a.metadata_json,'$.environment')='text' AND json_extract(a.metadata_json,'$.environment') IS NEW.environment) AND (json_type(a.metadata_json,'$.providerId')='text' AND json_extract(a.metadata_json,'$.providerId') IS NEW.provider_id) AND (json_type(a.metadata_json,'$.modelId')='text' AND json_extract(a.metadata_json,'$.modelId') IS NEW.provider_model_id) AND (json_type(a.metadata_json,'$.promptVersionId')='text' AND json_extract(a.metadata_json,'$.promptVersionId') IS NEW.prompt_version_id) AND (json_type(a.metadata_json,'$.pricingSnapshotId')='text' AND json_extract(a.metadata_json,'$.pricingSnapshotId') IS NEW.pricing_snapshot_id))
BEGIN SELECT RAISE(ABORT,'content_brief_revision_recovery_invalid'); END;
CREATE TRIGGER content_brief_revision_recovery_no_update BEFORE UPDATE ON editorial_content_brief_revision_capacity_recoveries BEGIN SELECT RAISE(ABORT,'content brief revision recovery is append-only'); END;
CREATE TRIGGER content_brief_revision_recovery_no_delete BEFORE DELETE ON editorial_content_brief_revision_capacity_recoveries BEGIN SELECT RAISE(ABORT,'content brief revision recovery is append-only'); END;
CREATE TRIGGER content_brief_revision_recovery_budget_no_update BEFORE UPDATE ON editorial_project_execution_budgets WHEN EXISTS(SELECT 1 FROM editorial_content_brief_revision_capacity_recoveries r WHERE r.budget_id=OLD.id) BEGIN SELECT RAISE(ABORT,'content brief revision recovery history is immutable'); END;
CREATE TRIGGER content_brief_revision_recovery_budget_no_delete BEFORE DELETE ON editorial_project_execution_budgets WHEN EXISTS(SELECT 1 FROM editorial_content_brief_revision_capacity_recoveries r WHERE r.budget_id=OLD.id) BEGIN SELECT RAISE(ABORT,'content brief revision recovery history is immutable'); END;
CREATE TRIGGER content_brief_revision_recovery_original_envelope_no_update BEFORE UPDATE ON editorial_execution_envelopes WHEN EXISTS(SELECT 1 FROM editorial_content_brief_revision_capacity_recoveries r WHERE r.original_envelope_id=OLD.id) BEGIN SELECT RAISE(ABORT,'content brief revision recovery history is immutable'); END;
CREATE TRIGGER content_brief_revision_recovery_original_envelope_no_delete BEFORE DELETE ON editorial_execution_envelopes WHEN EXISTS(SELECT 1 FROM editorial_content_brief_revision_capacity_recoveries r WHERE r.original_envelope_id=OLD.id) BEGIN SELECT RAISE(ABORT,'content brief revision recovery history is immutable'); END;
CREATE TRIGGER content_brief_revision_recovery_failed_reservation_no_update BEFORE UPDATE ON editorial_execution_reservations WHEN EXISTS(SELECT 1 FROM editorial_content_brief_revision_capacity_recoveries r WHERE r.failed_reservation_id=OLD.id) BEGIN SELECT RAISE(ABORT,'content brief revision recovery history is immutable'); END;
CREATE TRIGGER content_brief_revision_recovery_failed_reservation_no_delete BEFORE DELETE ON editorial_execution_reservations WHEN EXISTS(SELECT 1 FROM editorial_content_brief_revision_capacity_recoveries r WHERE r.failed_reservation_id=OLD.id) BEGIN SELECT RAISE(ABORT,'content brief revision recovery history is immutable'); END;
CREATE TRIGGER content_brief_revision_recovery_failed_run_no_update BEFORE UPDATE ON intelligence_runs WHEN EXISTS(SELECT 1 FROM editorial_content_brief_revision_capacity_recoveries r WHERE r.failed_run_id=OLD.id) BEGIN SELECT RAISE(ABORT,'content brief revision recovery history is immutable'); END;
CREATE TRIGGER content_brief_revision_recovery_failed_run_no_delete BEFORE DELETE ON intelligence_runs WHEN EXISTS(SELECT 1 FROM editorial_content_brief_revision_capacity_recoveries r WHERE r.failed_run_id=OLD.id) BEGIN SELECT RAISE(ABORT,'content brief revision recovery history is immutable'); END;

CREATE TRIGGER content_brief_revision_recovery_reservation_evidence_guard BEFORE INSERT ON editorial_execution_reservations WHEN EXISTS(SELECT 1 FROM editorial_content_brief_revision_capacity_recoveries r WHERE r.replacement_envelope_id=NEW.envelope_id) AND NOT EXISTS(SELECT 1 FROM editorial_content_brief_revision_capacity_recoveries r JOIN content_brief_revision_zero_provider_failures f ON f.capacity_id=r.content_brief_revision_capacity_id AND f.failed_run_id=r.failed_run_id AND f.failed_reservation_id=r.failed_reservation_id WHERE r.replacement_envelope_id=NEW.envelope_id) BEGIN SELECT RAISE(ABORT,'content_brief_revision_recovery_invalid'); END;

CREATE TRIGGER content_brief_revision_recovery_dispatch_evidence_guard BEFORE UPDATE ON editorial_execution_reservations WHEN NEW.status='DISPATCHED' AND EXISTS(SELECT 1 FROM editorial_content_brief_revision_capacity_recoveries r WHERE r.replacement_envelope_id=NEW.envelope_id) AND NOT EXISTS(SELECT 1 FROM editorial_content_brief_revision_capacity_recoveries r JOIN content_brief_revision_zero_provider_failures f ON f.capacity_id=r.content_brief_revision_capacity_id AND f.failed_run_id=r.failed_run_id AND f.failed_reservation_id=r.failed_reservation_id WHERE r.replacement_envelope_id=NEW.envelope_id) BEGIN SELECT RAISE(ABORT,'content_brief_revision_recovery_invalid'); END;
