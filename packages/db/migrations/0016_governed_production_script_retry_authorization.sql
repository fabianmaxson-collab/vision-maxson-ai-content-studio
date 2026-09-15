-- Additive, forward-only authorization for one bounded Production Script retry.
-- Historical envelopes, reservations, Runs, artifacts, and approvals are not rewritten.
CREATE TABLE editorial_legacy_remediation_attestations (
  id TEXT PRIMARY KEY NOT NULL,
  incident_code TEXT NOT NULL UNIQUE CHECK(incident_code='canonical_script_legacy_v1'),
  observed_state TEXT NOT NULL CHECK(observed_state='PROVIDER_COMPLETED_NO_DURABLE_SCRIPT_SUCCESSOR'),
  evidence_gap TEXT NOT NULL CHECK(evidence_gap='PERSISTENCE_STAGE_CAUSE_NOT_DURABLY_RECORDED'),
  exception_class TEXT NOT NULL CHECK(exception_class='LEGACY_PRODUCTION_SCRIPT_REMEDIATION_V1'),
  authorization_basis TEXT NOT NULL CHECK(authorization_basis='LEGACY_OWNER_ATTESTED_EXCEPTION'),
  rationale_code TEXT NOT NULL CHECK(rationale_code='OWNER_APPROVED_SINGLE_HISTORICAL_EXCEPTION'),
  schema_capability_version INTEGER NOT NULL CHECK(schema_capability_version=16),
  provider_request_id TEXT NOT NULL,
  input_tokens INTEGER NOT NULL CHECK(input_tokens=1184),
  output_tokens INTEGER NOT NULL CHECK(output_tokens=398),
  cached_tokens INTEGER NOT NULL CHECK(cached_tokens=0),
  reasoning_tokens INTEGER NOT NULL CHECK(reasoning_tokens=0),
  terminal_audit_id TEXT NOT NULL REFERENCES audit_events(id),
  evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json)),
  evidence_bundle_hash TEXT NOT NULL CHECK(length(evidence_bundle_hash)=64),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  revision_request_id TEXT NOT NULL REFERENCES editorial_revision_requests(id),
  expected_project_version INTEGER NOT NULL CHECK(expected_project_version>0),
  required_project_status TEXT NOT NULL DEFAULT 'ANALYZING' CHECK(required_project_status='ANALYZING'),
  failed_run_id TEXT NOT NULL UNIQUE REFERENCES intelligence_runs(id),
  failed_attempt_id TEXT NOT NULL UNIQUE REFERENCES intelligence_run_attempts(id),
  failed_reservation_id TEXT NOT NULL UNIQUE REFERENCES editorial_execution_reservations(id),
  failed_envelope_id TEXT NOT NULL REFERENCES editorial_execution_envelopes(id),
  failed_execution_idempotency_key TEXT NOT NULL CHECK(length(failed_execution_idempotency_key) BETWEEN 1 AND 200),
  failed_actual_microusd INTEGER NOT NULL CHECK(failed_actual_microusd=715),
  brief_artifact_id TEXT NOT NULL REFERENCES editorial_artifacts(id),
  brief_version_id TEXT NOT NULL REFERENCES editorial_artifact_versions(id),
  brief_approval_id TEXT NOT NULL REFERENCES artifact_approvals(id),
  brief_content_hash TEXT NOT NULL CHECK(length(brief_content_hash)=64),
  expected_brief_artifact_revision INTEGER NOT NULL CHECK(expected_brief_artifact_revision>0),
  script_artifact_id TEXT NOT NULL REFERENCES editorial_artifacts(id),
  expected_current_script_version_id TEXT NOT NULL REFERENCES editorial_artifact_versions(id),
  expected_script_artifact_revision INTEGER NOT NULL CHECK(expected_script_artifact_revision>0),
  expected_script_content_hash TEXT NOT NULL CHECK(length(expected_script_content_hash)=64),
  budget_id TEXT NOT NULL UNIQUE REFERENCES editorial_project_execution_budgets(id),
  envelope_id TEXT NOT NULL UNIQUE REFERENCES editorial_execution_envelopes(id),
  economic_profile_key TEXT NOT NULL CHECK(economic_profile_key='phase3_production_script_retry_v1'),
  economic_profile_version INTEGER NOT NULL CHECK(economic_profile_version=1),
  bounded_profile_key TEXT NOT NULL CHECK(bounded_profile_key='phase3_short_de_review_es_v1'),
  bounded_profile_version INTEGER NOT NULL CHECK(bounded_profile_version=1),
  stage_key TEXT NOT NULL CHECK(stage_key='SCRIPT_WRITER_SHORT'),
  monetary_ceiling_microusd INTEGER NOT NULL CHECK(monetary_ceiling_microusd=2970),
  maximum_calls INTEGER NOT NULL CHECK(maximum_calls=1),
  maximum_attempts INTEGER NOT NULL CHECK(maximum_attempts=1),
  sdk_max_retries INTEGER NOT NULL CHECK(sdk_max_retries=0),
  fallback_enabled INTEGER NOT NULL CHECK(fallback_enabled=0),
  creative_regeneration_enabled INTEGER NOT NULL CHECK(creative_regeneration_enabled=0),
  external_tools_enabled INTEGER NOT NULL CHECK(external_tools_enabled=0),
  external_research_enabled INTEGER NOT NULL CHECK(external_research_enabled=0),
  human_approval_required INTEGER NOT NULL CHECK(human_approval_required=1),
  provider_id TEXT NOT NULL REFERENCES ai_providers(id),
  provider_model_id TEXT NOT NULL REFERENCES ai_provider_models(id) CHECK(provider_model_id='model_openai_gpt_5_6_luna_20260903'),
  prompt_version_id TEXT NOT NULL REFERENCES prompt_versions(id) CHECK(prompt_version_id='prompt_version_script_short_v1'),
  pricing_snapshot_id TEXT NOT NULL REFERENCES ai_pricing_snapshots(id) CHECK(pricing_snapshot_id='pricing_model_openai_gpt_5_6_luna_20260903'),
  policy_snapshot_json TEXT NOT NULL CHECK(json_valid(policy_snapshot_json)),
  request_id TEXT NOT NULL CHECK(length(request_id)>0),
  actor_id TEXT NOT NULL REFERENCES users(id),
  actor_role TEXT NOT NULL CHECK(actor_role='owner'),
  environment TEXT NOT NULL CHECK(environment='staging'),
  audit_event_id TEXT NOT NULL UNIQUE REFERENCES audit_events(id),
  idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 200 AND idempotency_key=trim(idempotency_key)),
  command_hash TEXT NOT NULL CHECK(length(command_hash)=64),
  result_json TEXT NOT NULL CHECK(json_valid(result_json) AND length(result_json)<=16384),
  created_at TEXT NOT NULL,
  UNIQUE(workspace_id,idempotency_key),
  UNIQUE(workspace_id,project_id,revision_request_id,stage_key)
);

CREATE TABLE editorial_production_script_retry_capacities (
  legacy_attestation_id TEXT NOT NULL UNIQUE REFERENCES editorial_legacy_remediation_attestations(id),
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  revision_request_id TEXT NOT NULL REFERENCES editorial_revision_requests(id),
  expected_project_version INTEGER NOT NULL CHECK(expected_project_version>0),
  required_project_status TEXT NOT NULL DEFAULT 'ANALYZING' CHECK(required_project_status='ANALYZING'),
  failed_run_id TEXT NOT NULL UNIQUE REFERENCES intelligence_runs(id),
  failed_attempt_id TEXT NOT NULL UNIQUE REFERENCES intelligence_run_attempts(id),
  failed_reservation_id TEXT NOT NULL UNIQUE REFERENCES editorial_execution_reservations(id),
  failed_envelope_id TEXT NOT NULL REFERENCES editorial_execution_envelopes(id),
  failed_execution_idempotency_key TEXT NOT NULL CHECK(length(failed_execution_idempotency_key) BETWEEN 1 AND 200),
  failed_actual_microusd INTEGER NOT NULL CHECK(failed_actual_microusd>=0),
  brief_artifact_id TEXT NOT NULL REFERENCES editorial_artifacts(id),
  brief_version_id TEXT NOT NULL REFERENCES editorial_artifact_versions(id),
  brief_approval_id TEXT NOT NULL REFERENCES artifact_approvals(id),
  brief_content_hash TEXT NOT NULL CHECK(length(brief_content_hash)=64),
  expected_brief_artifact_revision INTEGER NOT NULL CHECK(expected_brief_artifact_revision>0),
  script_artifact_id TEXT NOT NULL REFERENCES editorial_artifacts(id),
  expected_current_script_version_id TEXT NOT NULL REFERENCES editorial_artifact_versions(id),
  expected_script_artifact_revision INTEGER NOT NULL CHECK(expected_script_artifact_revision>0),
  expected_script_content_hash TEXT NOT NULL CHECK(length(expected_script_content_hash)=64),
  budget_id TEXT NOT NULL UNIQUE REFERENCES editorial_project_execution_budgets(id),
  envelope_id TEXT NOT NULL UNIQUE REFERENCES editorial_execution_envelopes(id),
  economic_profile_key TEXT NOT NULL CHECK(economic_profile_key='phase3_production_script_retry_v1'),
  economic_profile_version INTEGER NOT NULL CHECK(economic_profile_version=1),
  bounded_profile_key TEXT NOT NULL CHECK(bounded_profile_key='phase3_short_de_review_es_v1'),
  bounded_profile_version INTEGER NOT NULL CHECK(bounded_profile_version=1),
  stage_key TEXT NOT NULL CHECK(stage_key='SCRIPT_WRITER_SHORT'),
  monetary_ceiling_microusd INTEGER NOT NULL CHECK(monetary_ceiling_microusd=2970),
  maximum_calls INTEGER NOT NULL CHECK(maximum_calls=1),
  maximum_attempts INTEGER NOT NULL CHECK(maximum_attempts=1),
  sdk_max_retries INTEGER NOT NULL CHECK(sdk_max_retries=0),
  fallback_enabled INTEGER NOT NULL CHECK(fallback_enabled=0),
  creative_regeneration_enabled INTEGER NOT NULL CHECK(creative_regeneration_enabled=0),
  external_tools_enabled INTEGER NOT NULL CHECK(external_tools_enabled=0),
  external_research_enabled INTEGER NOT NULL CHECK(external_research_enabled=0),
  human_approval_required INTEGER NOT NULL CHECK(human_approval_required=1),
  provider_id TEXT NOT NULL REFERENCES ai_providers(id),
  provider_model_id TEXT NOT NULL REFERENCES ai_provider_models(id) CHECK(provider_model_id='model_openai_gpt_5_6_luna_20260903'),
  prompt_version_id TEXT NOT NULL REFERENCES prompt_versions(id) CHECK(prompt_version_id='prompt_version_script_short_v1'),
  pricing_snapshot_id TEXT NOT NULL REFERENCES ai_pricing_snapshots(id) CHECK(pricing_snapshot_id='pricing_model_openai_gpt_5_6_luna_20260903'),
  policy_snapshot_json TEXT NOT NULL CHECK(json_valid(policy_snapshot_json)),
  request_id TEXT NOT NULL CHECK(length(request_id)>0),
  actor_id TEXT NOT NULL REFERENCES users(id),
  actor_role TEXT NOT NULL CHECK(actor_role='owner'),
  environment TEXT NOT NULL CHECK(length(environment) BETWEEN 1 AND 100),
  audit_event_id TEXT NOT NULL UNIQUE REFERENCES audit_events(id),
  idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 200 AND idempotency_key=trim(idempotency_key)),
  command_hash TEXT NOT NULL CHECK(length(command_hash)=64),
  result_json TEXT NOT NULL CHECK(json_valid(result_json) AND length(result_json)<=16384),
  created_at TEXT NOT NULL,
  UNIQUE(workspace_id,idempotency_key),
  UNIQUE(workspace_id,project_id,revision_request_id,stage_key)
);

CREATE VIEW production_script_legacy_incident_base AS
SELECT r.workspace_id,r.project_id,r.id revision_request_id,p.version project_version,
 ba.id brief_artifact_id,bv.id brief_version_id,bap.id brief_approval_id,bv.content_hash brief_content_hash,ba.version brief_artifact_revision,
 sa.id script_artifact_id,sv.id script_version_id,sap.id script_approval_id,sv.content_hash script_content_hash,sa.version script_artifact_revision,
 ir.id failed_run_id,ia.id failed_attempt_id,er.id failed_reservation_id,fe.id failed_envelope_id,
 ir.idempotency_key failed_execution_idempotency_key,er.actual_microusd failed_actual_microusd,ia.provider_request_id,ta.id terminal_audit_id,
 r.status revision_status,r.target_stage,p.status project_status,p.format,p.primary_language,p.operating_mode,p.archived_at,p.deleted_at project_deleted_at,
 bv.source_type brief_source_type,bv.language_code brief_language,ba.status brief_status,ba.deleted_at brief_deleted_at,
 sa.status script_status,sa.deleted_at script_deleted_at,ir.status run_status,ir.output_artifact_version_id,ir.completed_at,
 ir.error_category run_error_category,ir.safe_metadata_json run_metadata,ir.input_units,ir.output_units,ir.actual_cost,ir.currency,
 ir.provider_id,ir.provider_model_id,ir.prompt_version_id,ir.pricing_snapshot_id,ir.version run_version,ir.task_type,ir.safe_error_detail run_error_detail,
 ia.status attempt_status,ia.error_category attempt_error_category,ia.safe_metadata_json attempt_metadata,ia.safe_error_detail attempt_error_detail,ia.started_at,ia.completed_at attempt_completed_at,
 er.status reservation_status,er.step_key reservation_step_key,er.pricing_snapshot_id reservation_pricing_snapshot_id,er.reserved_microusd,er.dispatched_at,er.reconciled_at,fe.profile_key,fe.profile_version,fe.project_execution_budget_id,
 fe.status envelope_status,fe.maximum_calls,fe.stage_key,fe.provider_id envelope_provider_id,fe.provider_model_id envelope_model_id,
 fe.version envelope_version,fe.currency envelope_currency,fe.monetary_ceiling_microusd envelope_ceiling,fe.authorized_by envelope_authorized_by,fe.created_at envelope_created_at,fe.updated_at envelope_updated_at,
 ta.action terminal_action,ta.resource_type terminal_resource_type,ta.resource_id terminal_resource_id,ta.outcome terminal_outcome,ta.environment terminal_environment,ta.request_id terminal_request_id,ta.metadata_json terminal_metadata
FROM editorial_revision_requests r
JOIN projects p ON p.id=r.project_id AND p.workspace_id=r.workspace_id
JOIN editorial_artifacts ba ON ba.workspace_id=r.workspace_id AND ba.project_id=r.project_id AND ba.artifact_type='CONTENT_BRIEF'
JOIN editorial_artifact_versions bv ON bv.id=ba.current_version_id AND bv.artifact_id=ba.id AND bv.workspace_id=r.workspace_id
JOIN artifact_approvals bap ON bap.workspace_id=r.workspace_id AND bap.artifact_version_id=bv.id AND bap.decision='APPROVED'
JOIN editorial_artifacts sa ON sa.workspace_id=r.workspace_id AND sa.project_id=r.project_id AND sa.artifact_type='PRODUCTION_SCRIPT'
JOIN editorial_artifact_versions sv ON sv.id=sa.current_version_id AND sv.artifact_id=sa.id AND sv.workspace_id=r.workspace_id
JOIN artifact_approvals sap ON sap.workspace_id=r.workspace_id AND sap.artifact_version_id=sv.id AND sap.decision='APPROVED'
JOIN intelligence_runs ir ON ir.workspace_id=r.workspace_id AND ir.project_id=r.project_id AND ir.task_type='SCRIPT_WRITER_SHORT' AND ir.input_artifact_version_id=bv.id
JOIN intelligence_run_attempts ia ON ia.intelligence_run_id=ir.id
JOIN editorial_execution_reservations er ON er.intelligence_run_id=ir.id AND er.workspace_id=r.workspace_id AND er.project_id=r.project_id
JOIN editorial_execution_envelopes fe ON fe.id=er.envelope_id AND fe.workspace_id=r.workspace_id AND fe.project_id=r.project_id
JOIN audit_events ta ON ta.id=ir.terminal_audit_event_id AND ta.workspace_id=r.workspace_id
WHERE r.workspace_id='workspace_primary' AND p.id='project_2135b883-8499-48e9-a4a7-bb04b970d72a'
 AND r.id='revision_request_ed5a2ca2-403d-44da-9003-41b81487c6d2'
 AND ba.id='artifact_9cb2f14a-987e-46d7-b9ac-865c22b314d4' AND bv.id='artifact_version_c6c3cb0f-9650-4058-a11f-b06f52c95d85'
 AND sa.id='artifact_f14775ef-f2ae-41d7-b399-0efa5d597ffd' AND sv.id='artifact_version_4e08bbb7-07bb-4ebe-ac77-96affcdb08f5'
 AND ir.id='intelligence_run_2ddcc4a7-06c2-404e-99cf-3ed8a0a59346' AND ia.id='attempt_1edfe3ea-09ec-4926-a81e-23d0e4408813'
 AND er.id='execution_reservation_8ebcfa3b-540f-4bff-be0a-d159d5ad1143' AND fe.id='execution_envelope_d4dd3732-c5e7-4fd1-b9d8-5eae7f503789'
LIMIT -1;

CREATE VIEW production_script_legacy_editorial_state AS
SELECT b.* FROM production_script_legacy_incident_base b
WHERE revision_status='OPEN' AND target_stage='RESEARCH'
 AND NOT EXISTS(SELECT 1 FROM editorial_revision_request_resolutions x WHERE x.revision_request_id=b.revision_request_id)
 AND project_version=2 AND project_status='ANALYZING' AND format='SHORT' AND primary_language='de' AND operating_mode='ASSISTED'
 AND archived_at IS NULL AND project_deleted_at IS NULL
 AND brief_status='approved' AND brief_deleted_at IS NULL AND brief_source_type='HUMAN_EDITED' AND brief_language='de'
 AND brief_content_hash='57ee67a4b1473112bcee01630355bc9f0643ef44f5a1cf16e17cb4776b6877ec'
 AND script_status='approved' AND script_deleted_at IS NULL
 AND (SELECT count(*) FROM artifact_approvals x WHERE x.artifact_version_id=brief_version_id)=1
 AND (SELECT count(*) FROM artifact_approvals x WHERE x.artifact_version_id=script_version_id)=1
 AND NOT EXISTS(SELECT 1 FROM editorial_artifact_versions x WHERE x.artifact_id=script_artifact_id AND x.version_number>(SELECT version_number FROM editorial_artifact_versions WHERE id=script_version_id))
LIMIT -1;

CREATE VIEW production_script_legacy_history AS
SELECT * FROM production_script_legacy_editorial_state
WHERE run_status='FAILED_PERMANENT' AND output_artifact_version_id IS NULL AND completed_at IS NOT NULL
 AND attempt_status='FAILED_PERMANENT' AND provider_request_id='resp_07402c20ff2047dc016aa6936d768487d2aa67ca718ca2746f'
 AND (SELECT count(*) FROM intelligence_run_attempts x WHERE x.intelligence_run_id=failed_run_id)=1
 AND reservation_status='RECONCILED' AND reservation_step_key='SCRIPT_WRITER_SHORT' AND reservation_pricing_snapshot_id=pricing_snapshot_id
 AND dispatched_at IS NOT NULL AND reconciled_at IS NOT NULL
 AND profile_key='phase3_short_de_review_es_v1' AND profile_version=1 AND project_execution_budget_id IS NULL
 AND envelope_status='ACTIVE' AND maximum_calls=2 AND stage_key IS NULL
 AND (SELECT count(*) FROM editorial_execution_reservations x WHERE x.envelope_id=failed_envelope_id)=1
 AND terminal_action='intelligence.run_failed' AND terminal_resource_type='intelligence_run' AND terminal_resource_id=failed_run_id AND terminal_outcome='failure'
 AND NOT EXISTS(SELECT 1 FROM editorial_artifact_versions x WHERE x.intelligence_run_id=failed_run_id)
LIMIT -1;

CREATE VIEW production_script_legacy_economics AS
SELECT * FROM production_script_legacy_history
WHERE run_error_category='PERMANENT' AND attempt_error_category='PERMANENT'
 AND json_type(run_metadata,'$.validationDiagnostic') IS NULL AND json_type(attempt_metadata,'$.validationDiagnostic') IS NULL
 AND failed_execution_idempotency_key='phase3-canonical-production-script-brief-v3-v1-8b6c4a21-437d-4d93-b18a-2ce91f0bde74'
 AND provider_id='provider_openai' AND provider_model_id='model_openai_gpt_5_6_luna_20260903'
 AND envelope_provider_id=provider_id AND envelope_model_id=provider_model_id AND pricing_snapshot_id IS NOT NULL
 AND currency='USD' AND envelope_currency='USD' AND failed_actual_microusd=715 AND reserved_microusd=2970
 AND input_units=1184 AND output_units=398 AND actual_cost=0.000715
 AND json_extract(run_metadata,'$.responseStatus')='completed' AND json_extract(attempt_metadata,'$.responseStatus')='completed'
 AND json_extract(run_metadata,'$.actualMicrousd')=715 AND json_extract(attempt_metadata,'$.actualMicrousd')=715
 AND json_extract(run_metadata,'$.cachedInputUnits')=0 AND json_extract(run_metadata,'$.reasoningOutputUnits')=0
 AND json_extract(attempt_metadata,'$.cachedInputUnits')=0 AND json_extract(attempt_metadata,'$.reasoningOutputUnits')=0
 AND json_type(run_metadata,'$.persistenceFailure') IS NULL AND json_type(attempt_metadata,'$.persistenceFailure') IS NULL
 AND terminal_environment='staging' AND terminal_audit_id='audit_86f12b5c-13a3-4463-aac2-af4a3fa956e7'
 AND EXISTS(SELECT 1 FROM ai_providers hp JOIN ai_provider_models hm ON hm.provider_id=hp.id WHERE hp.id=provider_id AND hp.key='openai' AND hm.id=provider_model_id AND hm.model_key='gpt-5.6-luna')
LIMIT -1;

CREATE VIEW production_script_legacy_lineage AS
SELECT l.* FROM production_script_legacy_economics l
WHERE EXISTS(SELECT 1 FROM research_claims rc WHERE rc.workspace_id=l.workspace_id AND rc.research_version_id='artifact_version_9760e58c-4562-4fe2-a854-b6ff16881126')
 AND NOT EXISTS(SELECT 1 FROM research_claims rc LEFT JOIN research_sources rs ON rs.id=rc.source_id AND rs.research_version_id=rc.research_version_id WHERE rc.workspace_id=l.workspace_id AND rc.research_version_id='artifact_version_9760e58c-4562-4fe2-a854-b6ff16881126' AND (rs.id IS NULL OR rs.verification_status NOT IN ('owner_approved','externally_verified')))
 AND EXISTS(SELECT 1 FROM editorial_artifacts ra JOIN editorial_artifact_versions rv ON rv.id=ra.current_version_id AND rv.artifact_id=ra.id WHERE ra.workspace_id=l.workspace_id AND ra.project_id=l.project_id AND ra.artifact_type='RESEARCH' AND ra.status='approved' AND ra.deleted_at IS NULL AND rv.id='artifact_version_9760e58c-4562-4fe2-a854-b6ff16881126' AND EXISTS(SELECT 1 FROM artifact_approvals ap WHERE ap.workspace_id=l.workspace_id AND ap.artifact_version_id=rv.id AND ap.decision='APPROVED'))
 AND (SELECT count(*) FROM idea_candidates i WHERE i.workspace_id=l.workspace_id AND i.project_id=l.project_id AND i.status='SELECTED')=1
 AND EXISTS(SELECT 1 FROM idea_candidates i JOIN editorial_artifacts a ON a.id=i.artifact_id WHERE i.workspace_id=l.workspace_id AND i.project_id=l.project_id AND i.status='SELECTED' AND i.artifact_version_id='artifact_version_2b4a5d83-78ad-4997-9710-b1090aab994d' AND a.current_version_id=i.artifact_version_id AND a.status='approved' AND a.deleted_at IS NULL AND EXISTS(SELECT 1 FROM artifact_approvals ap WHERE ap.workspace_id=l.workspace_id AND ap.artifact_version_id=i.artifact_version_id AND ap.decision='APPROVED'))
 AND (SELECT count(*) FROM artifact_dependencies d WHERE d.workspace_id=l.workspace_id AND d.dependent_artifact_version_id=l.brief_version_id)=2
 AND EXISTS(SELECT 1 FROM artifact_dependencies d WHERE d.workspace_id=l.workspace_id AND d.source_artifact_version_id='artifact_version_2b4a5d83-78ad-4997-9710-b1090aab994d' AND d.dependent_artifact_version_id=l.brief_version_id AND d.dependency_type='GENERATED_FROM' AND d.validity_status='CURRENT' AND d.invalidated_at IS NULL AND d.invalidated_by_version_id IS NULL)
 AND EXISTS(SELECT 1 FROM artifact_dependencies d WHERE d.workspace_id=l.workspace_id AND d.source_artifact_version_id='artifact_version_9760e58c-4562-4fe2-a854-b6ff16881126' AND d.dependent_artifact_version_id=l.brief_version_id AND d.dependency_type='USES_RESEARCH' AND d.validity_status='CURRENT' AND d.invalidated_at IS NULL AND d.invalidated_by_version_id IS NULL)
 AND EXISTS(SELECT 1 FROM artifact_dependencies d WHERE d.workspace_id=l.workspace_id AND d.source_artifact_version_id='artifact_version_9760e58c-4562-4fe2-a854-b6ff16881126' AND d.dependent_artifact_version_id='artifact_version_2b4a5d83-78ad-4997-9710-b1090aab994d' AND d.dependency_type='GENERATED_FROM' AND d.validity_status='CURRENT' AND d.invalidated_at IS NULL AND d.invalidated_by_version_id IS NULL)
LIMIT -1;

CREATE VIEW production_script_legacy_incident_live AS
SELECT workspace_id,project_id,revision_request_id,project_version,brief_artifact_id,brief_version_id,brief_approval_id,brief_content_hash,brief_artifact_revision,
 script_artifact_id,script_version_id,script_approval_id,script_content_hash,script_artifact_revision,failed_run_id,failed_attempt_id,failed_reservation_id,failed_envelope_id,
 failed_execution_idempotency_key,failed_actual_microusd,provider_request_id,terminal_audit_id,
 json_object('editorial',json_array(revision_request_id,revision_status,project_id,project_version,project_status,brief_artifact_id,brief_artifact_revision,brief_version_id,brief_content_hash,brief_approval_id,script_artifact_id,script_artifact_revision,script_version_id,script_content_hash,script_approval_id),
 'run',json_array(failed_run_id,run_version,task_type,provider_id,provider_model_id,prompt_version_id,pricing_snapshot_id,input_units,output_units,actual_cost,currency,run_error_category,run_error_detail,run_metadata,completed_at),
 'attempt',json_array(failed_attempt_id,provider_request_id,attempt_error_category,attempt_error_detail,attempt_metadata,started_at,attempt_completed_at),
 'reservation',json_array(failed_reservation_id,reservation_step_key,reservation_pricing_snapshot_id,reserved_microusd,failed_actual_microusd,dispatched_at,reconciled_at),
 'envelope',json_array(failed_envelope_id,envelope_version,envelope_currency,envelope_ceiling,envelope_authorized_by,envelope_created_at,envelope_updated_at),
 'audit',json_array(terminal_audit_id,terminal_request_id,terminal_environment,terminal_metadata)) evidence_json
FROM production_script_legacy_lineage
LIMIT -1;

-- No producer currently supplies authoritative structured persistence-cause evidence.
-- Automatic remediation stays closed; it never falls back to the legacy exception.
CREATE VIEW production_script_retry_eligible_failures AS SELECT * FROM production_script_legacy_incident_live WHERE 0;

CREATE VIEW production_script_retry_eligible_policy AS
SELECT p.id provider_id,m.id provider_model_id,pv.id prompt_version_id,ps.id pricing_snapshot_id,
 json_object(
  'catalog',json_array(p.id,p.key,p.status,p.version,p.adapter_version,m.id,m.model_key,m.status,m.version,m.capabilities_json,m.effective_from,m.effective_to,pd.id,pd.key,pd.task_type,pd.status,pd.version,pv.id,pv.status,pv.content_hash,pv.template_text,pv.input_schema_version,pv.output_schema_version,ps.id,ps.currency,ps.unit_name,ps.verification_status,ps.input_unit_price,ps.output_unit_price,ps.effective_from,ps.effective_to),
  'execution',json_array(p.id,p.key,m.id,m.model_key,pv.id,ps.id,pd.task_type,'none',1,1,0,0,2970,0,0,0,1,768,8192,45000,'phase3_short_de_review_es_v1',1,'LOCKED')
 ) policy_snapshot_json
FROM ai_providers p
JOIN ai_provider_models m ON m.provider_id=p.id
JOIN ai_pricing_snapshots ps ON ps.provider_model_id=m.id
JOIN prompt_versions pv ON pv.id='prompt_version_script_short_v1'
JOIN prompt_definitions pd ON pd.id=pv.prompt_definition_id
WHERE p.id='provider_openai' AND p.key='openai' AND p.status='configured'
 AND m.id='model_openai_gpt_5_6_luna_20260903' AND m.model_key='gpt-5.6-luna' AND m.status='available'
 AND EXISTS(SELECT 1 FROM json_each(m.capabilities_json,'$.capabilities') WHERE value='SCRIPT_GENERATION')
 AND EXISTS(SELECT 1 FROM json_each(m.capabilities_json,'$.capabilities') WHERE value='STRUCTURED_OUTPUT')
 AND EXISTS(SELECT 1 FROM json_each(m.capabilities_json,'$.capabilities') WHERE value='MULTILINGUAL_TEXT')
 AND m.effective_to IS NULL AND julianday(m.effective_from)<=julianday('now')
 AND ps.id='pricing_model_openai_gpt_5_6_luna_20260903' AND ps.currency='USD' AND ps.unit_name='token'
 AND ps.verification_status='externally_verified' AND ps.input_unit_price=0.0000002 AND ps.output_unit_price=0.0000012
 AND ps.effective_to IS NULL AND julianday(ps.effective_from)<=julianday('now')
 AND pd.key='script_writer_short' AND pd.task_type='SCRIPT_WRITER_SHORT' AND pd.status='active' AND pv.status='active';

-- Authorization eligibility excludes an existing capacity. Execution eligibility starts
-- from the immutable receipt and re-proves the same historical and editorial snapshot.
CREATE VIEW production_script_retry_execution_eligible AS
SELECT c.id capacity_id,c.workspace_id,c.project_id,c.revision_request_id,c.brief_version_id,
 c.failed_run_id,c.failed_attempt_id,c.failed_reservation_id,c.expected_current_script_version_id
FROM editorial_production_script_retry_capacities c
JOIN editorial_legacy_remediation_attestations att ON att.id=c.legacy_attestation_id AND att.workspace_id=c.workspace_id AND att.project_id=c.project_id
JOIN production_script_legacy_incident_live live ON live.workspace_id=c.workspace_id AND live.project_id=c.project_id AND live.revision_request_id=c.revision_request_id
 AND live.failed_run_id=c.failed_run_id AND live.failed_attempt_id=c.failed_attempt_id AND live.failed_reservation_id=c.failed_reservation_id
 AND live.brief_version_id=c.brief_version_id AND live.script_version_id=c.expected_current_script_version_id AND live.evidence_json=att.evidence_json
JOIN production_script_retry_eligible_policy pol ON pol.provider_id=c.provider_id AND pol.provider_model_id=c.provider_model_id
 AND pol.prompt_version_id=c.prompt_version_id AND pol.pricing_snapshot_id=c.pricing_snapshot_id AND pol.policy_snapshot_json=c.policy_snapshot_json
WHERE att.policy_snapshot_json=c.policy_snapshot_json AND att.evidence_bundle_hash IS NOT NULL
LIMIT -1;
CREATE TRIGGER production_script_retry_capacity_scope_guard BEFORE INSERT ON editorial_production_script_retry_capacities
WHEN NOT EXISTS(SELECT 1 FROM production_script_legacy_incident_live x WHERE
 x.workspace_id=NEW.workspace_id AND x.project_id=NEW.project_id AND x.revision_request_id=NEW.revision_request_id
 AND x.project_version=NEW.expected_project_version AND x.failed_run_id=NEW.failed_run_id AND x.failed_attempt_id=NEW.failed_attempt_id
 AND x.failed_reservation_id=NEW.failed_reservation_id AND x.failed_envelope_id=NEW.failed_envelope_id
 AND x.failed_execution_idempotency_key=NEW.failed_execution_idempotency_key AND x.failed_actual_microusd=NEW.failed_actual_microusd
 AND x.brief_artifact_id=NEW.brief_artifact_id AND x.brief_version_id=NEW.brief_version_id AND x.brief_approval_id=NEW.brief_approval_id
 AND x.brief_content_hash=NEW.brief_content_hash AND x.brief_artifact_revision=NEW.expected_brief_artifact_revision
 AND x.script_artifact_id=NEW.script_artifact_id AND x.script_version_id=NEW.expected_current_script_version_id
 AND x.script_content_hash=NEW.expected_script_content_hash AND x.script_artifact_revision=NEW.expected_script_artifact_revision)
BEGIN SELECT RAISE(ABORT,'production_script_retry_capacity_invalid'); END;

CREATE TRIGGER production_script_retry_capacity_policy_guard BEFORE INSERT ON editorial_production_script_retry_capacities
WHEN NOT EXISTS(SELECT 1 FROM production_script_retry_eligible_policy x WHERE x.provider_id=NEW.provider_id AND x.provider_model_id=NEW.provider_model_id AND x.prompt_version_id=NEW.prompt_version_id AND x.pricing_snapshot_id=NEW.pricing_snapshot_id AND x.policy_snapshot_json=NEW.policy_snapshot_json)
BEGIN SELECT RAISE(ABORT,'production_script_retry_capacity_invalid'); END;

CREATE TRIGGER production_script_retry_capacity_actor_guard BEFORE INSERT ON editorial_production_script_retry_capacities
WHEN NOT EXISTS(SELECT 1 FROM users u JOIN user_roles ur ON ur.user_id=u.id AND ur.workspace_id=u.workspace_id JOIN roles role ON role.id=ur.role_id WHERE u.id=NEW.actor_id AND u.workspace_id=NEW.workspace_id AND u.status='active' AND u.deleted_at IS NULL AND role.key='owner' AND NEW.actor_role='owner')
BEGIN SELECT RAISE(ABORT,'production_script_retry_capacity_invalid'); END;

CREATE TRIGGER production_script_retry_capacity_budget_guard BEFORE INSERT ON editorial_production_script_retry_capacities
WHEN NOT EXISTS(SELECT 1 FROM editorial_project_execution_budgets b JOIN editorial_execution_envelopes e ON e.project_execution_budget_id=b.id
 WHERE b.id=NEW.budget_id AND e.id=NEW.envelope_id AND b.workspace_id=NEW.workspace_id AND e.workspace_id=NEW.workspace_id
 AND b.project_id=NEW.project_id AND e.project_id=NEW.project_id AND b.profile_key=NEW.economic_profile_key AND e.profile_key=NEW.economic_profile_key
 AND b.profile_version=1 AND e.profile_version=1 AND b.status='ACTIVE' AND e.status='ACTIVE' AND b.version=1 AND e.version=1
 AND b.currency='USD' AND e.currency='USD' AND b.monetary_ceiling_microusd=2970 AND e.monetary_ceiling_microusd=2970
 AND e.maximum_calls=1 AND e.stage_key='SCRIPT_WRITER_SHORT' AND e.provider_id=NEW.provider_id AND e.provider_model_id=NEW.provider_model_id
 AND b.authorized_by=NEW.actor_id AND e.authorized_by=NEW.actor_id
 AND NOT EXISTS(SELECT 1 FROM editorial_execution_reservations q WHERE q.envelope_id=e.id OR q.project_execution_budget_id=b.id))
BEGIN SELECT RAISE(ABORT,'production_script_retry_capacity_invalid'); END;

CREATE TRIGGER production_script_retry_capacity_result_guard BEFORE INSERT ON editorial_production_script_retry_capacities
WHEN json_extract(NEW.result_json,'$.capacityId') IS NOT NEW.id
 OR json_extract(NEW.result_json,'$.projectId') IS NOT NEW.project_id
 OR json_extract(NEW.result_json,'$.revisionRequestId') IS NOT NEW.revision_request_id
 OR json_extract(NEW.result_json,'$.budgetId') IS NOT NEW.budget_id
 OR json_extract(NEW.result_json,'$.envelopeId') IS NOT NEW.envelope_id
 OR json_extract(NEW.result_json,'$.auditEventId') IS NOT NEW.audit_event_id
 OR json_extract(NEW.result_json,'$.failedRunId') IS NOT NEW.failed_run_id
 OR json_extract(NEW.result_json,'$.briefVersionId') IS NOT NEW.brief_version_id
 OR json_extract(NEW.result_json,'$.profileKey') IS NOT NEW.economic_profile_key
 OR json_extract(NEW.result_json,'$.monetaryCeilingMicrousd') IS NOT 2970
 OR json_extract(NEW.result_json,'$.maximumCalls') IS NOT 1
BEGIN SELECT RAISE(ABORT,'production_script_retry_receipt_invalid'); END;

CREATE TRIGGER production_script_retry_capacity_audit_guard BEFORE INSERT ON editorial_production_script_retry_capacities
WHEN NOT EXISTS(SELECT 1 FROM audit_events a WHERE a.id=NEW.audit_event_id AND a.workspace_id=NEW.workspace_id
 AND a.actor_type='user' AND a.actor_id=NEW.actor_id AND a.actor_role='owner' AND a.environment=NEW.environment
 AND a.request_id=NEW.request_id AND a.action='editorial.legacy_remediation_attested'
 AND a.resource_type='editorial_legacy_remediation_attestation' AND a.resource_id=NEW.legacy_attestation_id AND a.outcome='success'
 AND json_extract(a.metadata_json,'$.capacityId') IS NEW.id AND json_extract(a.metadata_json,'$.failedRunId') IS NEW.failed_run_id
 AND json_extract(a.metadata_json,'$.revisionRequestId') IS NEW.revision_request_id AND json_extract(a.metadata_json,'$.briefVersionId') IS NEW.brief_version_id
 AND json_extract(a.metadata_json,'$.budgetId') IS NEW.budget_id AND json_extract(a.metadata_json,'$.envelopeId') IS NEW.envelope_id)
BEGIN SELECT RAISE(ABORT,'production_script_retry_audit_invalid'); END;

CREATE TRIGGER production_script_retry_capacity_no_update BEFORE UPDATE ON editorial_production_script_retry_capacities
BEGIN SELECT RAISE(ABORT,'production script retry capacity is append-only'); END;
CREATE TRIGGER production_script_retry_capacity_no_delete BEFORE DELETE ON editorial_production_script_retry_capacities
BEGIN SELECT RAISE(ABORT,'production script retry capacity is append-only'); END;

CREATE TRIGGER production_script_retry_reservation_guard BEFORE INSERT ON editorial_execution_reservations
WHEN EXISTS(SELECT 1 FROM editorial_execution_envelopes e WHERE e.id=NEW.envelope_id AND e.profile_key='phase3_production_script_retry_v1')
 AND NOT EXISTS(SELECT 1 FROM editorial_production_script_retry_capacities c
 JOIN editorial_execution_envelopes e ON e.id=c.envelope_id AND e.project_execution_budget_id=c.budget_id
 JOIN editorial_project_execution_budgets b ON b.id=c.budget_id
 JOIN intelligence_runs ir ON ir.id=NEW.intelligence_run_id
 WHERE c.envelope_id=NEW.envelope_id AND c.budget_id=NEW.project_execution_budget_id AND c.workspace_id=NEW.workspace_id AND c.project_id=NEW.project_id
 AND e.status='ACTIVE' AND e.maximum_calls=1 AND e.stage_key='SCRIPT_WRITER_SHORT' AND e.monetary_ceiling_microusd=2970
 AND b.status='ACTIVE' AND b.monetary_ceiling_microusd=2970
 AND NEW.step_key='SCRIPT_WRITER_SHORT' AND NEW.status='RESERVED' AND NEW.reserved_microusd=2970 AND NEW.pricing_snapshot_id=c.pricing_snapshot_id
 AND ir.workspace_id=c.workspace_id AND ir.project_id=c.project_id AND ir.task_type='SCRIPT_WRITER_SHORT'
 AND ir.input_artifact_version_id=c.brief_version_id AND ir.provider_id=c.provider_id AND ir.provider_model_id=c.provider_model_id
 AND ir.prompt_version_id=c.prompt_version_id AND ir.pricing_snapshot_id=c.pricing_snapshot_id AND ir.status='QUEUED'
 AND ir.idempotency_key<>c.failed_execution_idempotency_key
 AND NOT EXISTS(SELECT 1 FROM editorial_execution_reservations used WHERE used.envelope_id=e.id))
BEGIN SELECT RAISE(ABORT,'production_script_retry_reservation_invalid'); END;

CREATE TRIGGER production_script_retry_capacity_budget_immutable BEFORE UPDATE ON editorial_project_execution_budgets
WHEN EXISTS(SELECT 1 FROM editorial_production_script_retry_capacities c WHERE c.budget_id=OLD.id)
 AND (NEW.id IS NOT OLD.id OR NEW.workspace_id IS NOT OLD.workspace_id OR NEW.project_id IS NOT OLD.project_id OR NEW.profile_key IS NOT OLD.profile_key OR NEW.profile_version IS NOT OLD.profile_version OR NEW.currency IS NOT OLD.currency OR NEW.monetary_ceiling_microusd IS NOT OLD.monetary_ceiling_microusd OR NEW.authorized_by IS NOT OLD.authorized_by)
BEGIN SELECT RAISE(ABORT,'production script retry economic binding is immutable'); END;

CREATE TRIGGER production_script_retry_capacity_envelope_immutable BEFORE UPDATE ON editorial_execution_envelopes
WHEN EXISTS(SELECT 1 FROM editorial_production_script_retry_capacities c WHERE c.envelope_id=OLD.id)
 AND (NEW.id IS NOT OLD.id OR NEW.workspace_id IS NOT OLD.workspace_id OR NEW.project_id IS NOT OLD.project_id OR NEW.profile_key IS NOT OLD.profile_key OR NEW.profile_version IS NOT OLD.profile_version OR NEW.provider_id IS NOT OLD.provider_id OR NEW.provider_model_id IS NOT OLD.provider_model_id OR NEW.currency IS NOT OLD.currency OR NEW.monetary_ceiling_microusd IS NOT OLD.monetary_ceiling_microusd OR NEW.maximum_calls IS NOT OLD.maximum_calls OR NEW.authorized_by IS NOT OLD.authorized_by OR NEW.project_execution_budget_id IS NOT OLD.project_execution_budget_id OR NEW.stage_key IS NOT OLD.stage_key)
BEGIN SELECT RAISE(ABORT,'production script retry economic binding is immutable'); END;

CREATE TRIGGER production_script_retry_attestation_binding BEFORE INSERT ON editorial_production_script_retry_capacities
WHEN NOT EXISTS(SELECT 1 FROM editorial_legacy_remediation_attestations a WHERE a.id=NEW.legacy_attestation_id
 AND a.workspace_id IS NEW.workspace_id AND a.project_id IS NEW.project_id AND a.revision_request_id IS NEW.revision_request_id
 AND a.expected_project_version IS NEW.expected_project_version AND a.required_project_status IS NEW.required_project_status
 AND a.failed_run_id IS NEW.failed_run_id AND a.failed_attempt_id IS NEW.failed_attempt_id AND a.failed_reservation_id IS NEW.failed_reservation_id
 AND a.failed_envelope_id IS NEW.failed_envelope_id AND a.failed_execution_idempotency_key IS NEW.failed_execution_idempotency_key
 AND a.failed_actual_microusd IS NEW.failed_actual_microusd)
BEGIN SELECT RAISE(ABORT,'legacy_attestation_binding_invalid'); END;
CREATE TRIGGER production_script_retry_attestation_editorial_binding BEFORE INSERT ON editorial_production_script_retry_capacities
WHEN NOT EXISTS(SELECT 1 FROM editorial_legacy_remediation_attestations a WHERE a.id=NEW.legacy_attestation_id
 AND a.brief_artifact_id IS NEW.brief_artifact_id AND a.brief_version_id IS NEW.brief_version_id AND a.brief_approval_id IS NEW.brief_approval_id
 AND a.brief_content_hash IS NEW.brief_content_hash AND a.expected_brief_artifact_revision IS NEW.expected_brief_artifact_revision
 AND a.script_artifact_id IS NEW.script_artifact_id AND a.expected_current_script_version_id IS NEW.expected_current_script_version_id
 AND a.expected_script_artifact_revision IS NEW.expected_script_artifact_revision AND a.expected_script_content_hash IS NEW.expected_script_content_hash)
BEGIN SELECT RAISE(ABORT,'legacy_attestation_binding_invalid'); END;
CREATE TRIGGER production_script_retry_attestation_policy_binding BEFORE INSERT ON editorial_production_script_retry_capacities
WHEN NOT EXISTS(SELECT 1 FROM editorial_legacy_remediation_attestations a WHERE a.id=NEW.legacy_attestation_id
 AND a.budget_id IS NEW.budget_id AND a.envelope_id IS NEW.envelope_id AND a.economic_profile_key IS NEW.economic_profile_key
 AND a.economic_profile_version IS NEW.economic_profile_version AND a.bounded_profile_key IS NEW.bounded_profile_key
 AND a.bounded_profile_version IS NEW.bounded_profile_version AND a.stage_key IS NEW.stage_key
 AND a.monetary_ceiling_microusd IS NEW.monetary_ceiling_microusd AND a.maximum_calls IS NEW.maximum_calls
 AND a.maximum_attempts IS NEW.maximum_attempts AND a.sdk_max_retries IS NEW.sdk_max_retries AND a.fallback_enabled IS NEW.fallback_enabled
 AND a.creative_regeneration_enabled IS NEW.creative_regeneration_enabled AND a.external_tools_enabled IS NEW.external_tools_enabled
 AND a.external_research_enabled IS NEW.external_research_enabled AND a.human_approval_required IS NEW.human_approval_required
 AND a.provider_id IS NEW.provider_id AND a.provider_model_id IS NEW.provider_model_id AND a.prompt_version_id IS NEW.prompt_version_id
 AND a.pricing_snapshot_id IS NEW.pricing_snapshot_id AND a.policy_snapshot_json IS NEW.policy_snapshot_json)
BEGIN SELECT RAISE(ABORT,'legacy_attestation_binding_invalid'); END;
CREATE TRIGGER production_script_retry_attestation_request_binding BEFORE INSERT ON editorial_production_script_retry_capacities
WHEN NOT EXISTS(SELECT 1 FROM editorial_legacy_remediation_attestations a WHERE a.id=NEW.legacy_attestation_id
 AND a.request_id IS NEW.request_id AND a.actor_id IS NEW.actor_id AND a.actor_role IS NEW.actor_role AND a.environment IS NEW.environment
 AND a.audit_event_id IS NEW.audit_event_id AND a.idempotency_key IS NEW.idempotency_key AND a.command_hash IS NEW.command_hash
 AND a.result_json IS NEW.result_json AND a.created_at IS NEW.created_at)
BEGIN SELECT RAISE(ABORT,'legacy_attestation_binding_invalid'); END;
CREATE TRIGGER legacy_remediation_attestation_guard BEFORE INSERT ON editorial_legacy_remediation_attestations
WHEN NOT EXISTS(SELECT 1 FROM production_script_legacy_incident_live x JOIN production_script_retry_eligible_policy pol
 ON pol.policy_snapshot_json=NEW.policy_snapshot_json
 JOIN users u ON u.id=NEW.actor_id AND u.workspace_id=NEW.workspace_id AND u.status='active' AND u.deleted_at IS NULL
 JOIN user_roles ur ON ur.user_id=u.id AND ur.workspace_id=u.workspace_id JOIN roles ro ON ro.id=ur.role_id AND ro.key='owner'
 WHERE x.evidence_json=NEW.evidence_json AND x.workspace_id=NEW.workspace_id AND x.project_id=NEW.project_id AND x.revision_request_id=NEW.revision_request_id
 AND x.failed_run_id=NEW.failed_run_id AND x.failed_attempt_id=NEW.failed_attempt_id AND x.failed_reservation_id=NEW.failed_reservation_id
 AND x.provider_request_id=NEW.provider_request_id AND x.terminal_audit_id=NEW.terminal_audit_id
 AND NEW.environment='staging' AND NEW.idempotency_key<>x.failed_execution_idempotency_key
 AND NOT EXISTS(SELECT 1 FROM editorial_production_script_retry_capacities c WHERE c.project_id=NEW.project_id AND c.workspace_id=NEW.workspace_id)
 AND (SELECT count(*) FROM editorial_project_execution_budgets b WHERE b.project_id=NEW.project_id AND b.workspace_id=NEW.workspace_id AND b.profile_key='phase3_production_script_retry_v1')=1
 AND (SELECT count(*) FROM editorial_execution_envelopes e WHERE e.project_id=NEW.project_id AND e.workspace_id=NEW.workspace_id AND e.profile_key='phase3_production_script_retry_v1')=1)
BEGIN SELECT RAISE(ABORT,'legacy_attestation_ineligible'); END;
CREATE TRIGGER legacy_remediation_attestation_no_update BEFORE UPDATE ON editorial_legacy_remediation_attestations
BEGIN SELECT RAISE(ABORT,'legacy attestation is append-only'); END;
CREATE TRIGGER legacy_remediation_attestation_no_delete BEFORE DELETE ON editorial_legacy_remediation_attestations
BEGIN SELECT RAISE(ABORT,'legacy attestation is append-only'); END;
CREATE TABLE editorial_legacy_remediation_claims (
 id TEXT PRIMARY KEY NOT NULL,
 attestation_id TEXT NOT NULL UNIQUE REFERENCES editorial_legacy_remediation_attestations(id),
 capacity_id TEXT NOT NULL UNIQUE REFERENCES editorial_production_script_retry_capacities(id),
 run_id TEXT NOT NULL UNIQUE REFERENCES intelligence_runs(id),
 reservation_id TEXT NOT NULL UNIQUE REFERENCES editorial_execution_reservations(id),
 audit_id TEXT NOT NULL UNIQUE REFERENCES audit_events(id),
 claimed_at TEXT NOT NULL
);
CREATE TRIGGER legacy_remediation_claim_guard BEFORE INSERT ON editorial_legacy_remediation_claims
WHEN NOT EXISTS(SELECT 1 FROM production_script_retry_execution_eligible x JOIN editorial_production_script_retry_capacities c ON c.id=x.capacity_id
 JOIN intelligence_runs ir ON ir.id=NEW.run_id AND ir.workspace_id=c.workspace_id AND ir.project_id=c.project_id AND ir.status='QUEUED' AND ir.input_artifact_version_id=c.brief_version_id
 JOIN editorial_execution_reservations r ON r.id=NEW.reservation_id AND r.intelligence_run_id=ir.id AND r.envelope_id=c.envelope_id AND r.project_execution_budget_id=c.budget_id AND r.status='RESERVED' AND r.reserved_microusd=2970
 JOIN audit_events a ON a.id=NEW.audit_id AND a.action='editorial.legacy_remediation_claimed' AND a.resource_id=c.id
 WHERE c.id=NEW.capacity_id AND c.legacy_attestation_id=NEW.attestation_id AND json_extract(a.metadata_json,'$.runId')=ir.id AND json_extract(a.metadata_json,'$.reservationId')=r.id)
BEGIN SELECT RAISE(ABORT,'legacy_claim_invalid'); END;
CREATE TRIGGER legacy_remediation_claim_no_update BEFORE UPDATE ON editorial_legacy_remediation_claims
BEGIN SELECT RAISE(ABORT,'legacy claim is append-only'); END;
CREATE TRIGGER legacy_remediation_claim_no_delete BEFORE DELETE ON editorial_legacy_remediation_claims
BEGIN SELECT RAISE(ABORT,'legacy claim is append-only'); END;
