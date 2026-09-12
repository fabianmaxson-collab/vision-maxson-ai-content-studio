import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// Migration 0002 is the constraint/index authority; these declarations provide typed access.
export const editorialArtifacts = sqliteTable('editorial_artifacts', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  projectId: text('project_id').notNull(),
  artifactType: text('artifact_type').notNull(),
  currentVersionId: text('current_version_id'),
  status: text('status').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  version: integer('version').notNull(),
  createdBy: text('created_by'),
  updatedBy: text('updated_by'),
  deletedAt: text('deleted_at'),
});
export const editorialArtifactVersions = sqliteTable('editorial_artifact_versions', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  artifactId: text('artifact_id').notNull(),
  versionNumber: integer('version_number').notNull(),
  parentVersionId: text('parent_version_id'),
  languageCode: text('language_code').notNull(),
  contentText: text('content_text'),
  contentJson: text('content_json'),
  sourceType: text('source_type').notNull(),
  intelligenceRunId: text('intelligence_run_id'),
  contentHash: text('content_hash').notNull(),
  wordCount: integer('word_count'),
  narrationRateProfileId: text('narration_rate_profile_id'),
  estimatedDurationSeconds: real('estimated_duration_seconds'),
  sourceScriptVersionId: text('source_script_version_id'),
  createdAt: text('created_at').notNull(),
  createdBy: text('created_by').notNull(),
});
export const artifactDependencies = sqliteTable('artifact_dependencies', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  sourceArtifactVersionId: text('source_artifact_version_id').notNull(),
  dependentArtifactVersionId: text('dependent_artifact_version_id').notNull(),
  dependencyType: text('dependency_type').notNull(),
  validityStatus: text('validity_status').notNull(),
  invalidatedAt: text('invalidated_at'),
  invalidatedByVersionId: text('invalidated_by_version_id'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  version: integer('version').notNull(),
});
export const artifactApprovals = sqliteTable('artifact_approvals', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  artifactVersionId: text('artifact_version_id').notNull(),
  decision: text('decision').notNull(),
  actorId: text('actor_id').notNull(),
  actorRole: text('actor_role').notNull(),
  comment: text('comment'),
  decidedAt: text('decided_at').notNull(),
});
export const artifactStatusEvents = sqliteTable('artifact_status_events', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  artifactId: text('artifact_id').notNull(),
  artifactVersionId: text('artifact_version_id'),
  previousStatus: text('previous_status'),
  nextStatus: text('next_status').notNull(),
  reason: text('reason'),
  actorId: text('actor_id'),
  occurredAt: text('occurred_at').notNull(),
});
export const editorialRevisionRequests = sqliteTable('editorial_revision_requests', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  projectId: text('project_id').notNull(),
  reviewedArtifactId: text('reviewed_artifact_id').notNull(),
  reviewedArtifactVersionId: text('reviewed_artifact_version_id').notNull(),
  reviewedArtifactRevision: integer('reviewed_artifact_revision').notNull(),
  targetStage: text('target_stage').notNull(),
  targetBaselineVersionId: text('target_baseline_version_id').notNull(),
  reasonCode: text('reason_code').notNull(),
  comment: text('comment'),
  status: text('status').notNull(),
  actorId: text('actor_id').notNull(),
  actorRole: text('actor_role').notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  commandHash: text('command_hash').notNull(),
  auditEventId: text('audit_event_id').notNull(),
  createdAt: text('created_at').notNull(),
});
export const editorialRevisionRequestResolutions = sqliteTable(
  'editorial_revision_request_resolutions',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    projectId: text('project_id').notNull(),
    revisionRequestId: text('revision_request_id').notNull(),
    status: text('status').notNull(),
    resolutionArtifactVersionId: text('resolution_artifact_version_id').notNull(),
    resolutionEvidenceJson: text('resolution_evidence_json').notNull(),
    resolvedBy: text('resolved_by').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    commandHash: text('command_hash').notNull(),
    auditEventId: text('audit_event_id').notNull(),
    resolvedAt: text('resolved_at').notNull(),
  },
);
export const editorialResearchRevisionImports = sqliteTable('editorial_research_revision_imports', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  projectId: text('project_id').notNull(),
  revisionRequestId: text('revision_request_id').notNull(),
  researchArtifactId: text('research_artifact_id').notNull(),
  parentResearchVersionId: text('parent_research_version_id').notNull(),
  newResearchVersionId: text('new_research_version_id').notNull(),
  expectedArtifactRevision: integer('expected_artifact_revision').notNull(),
  actorId: text('actor_id').notNull(),
  actorRole: text('actor_role').notNull(),
  auditEventId: text('audit_event_id').notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  commandHash: text('command_hash').notNull(),
  resultJson: text('result_json').notNull(),
  environment: text('environment').notNull(),
  createdAt: text('created_at').notNull(),
});
export const researchSources = sqliteTable('research_sources', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  researchVersionId: text('research_version_id').notNull(),
  sourceType: text('source_type').notNull(),
  title: text('title').notNull(),
  sourceUrl: text('source_url'),
  sourceReference: text('source_reference'),
  sourceKey: text('source_key'),
  sourceFingerprint: text('source_fingerprint'),
  contentHash: text('content_hash'),
  provenanceJson: text('provenance_json'),
  retrievedAt: text('retrieved_at'),
  publishedAt: text('published_at'),
  verificationStatus: text('verification_status').notNull(),
  createdAt: text('created_at').notNull(),
  createdBy: text('created_by').notNull(),
});
export const researchClaims = sqliteTable('research_claims', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  researchVersionId: text('research_version_id').notNull(),
  sourceId: text('source_id'),
  claimText: text('claim_text').notNull(),
  evidenceClass: text('evidence_class').notNull(),
  excerpt: text('excerpt'),
  confidence: real('confidence'),
  createdAt: text('created_at').notNull(),
  createdBy: text('created_by').notNull(),
});
export const ideaCandidates = sqliteTable('idea_candidates', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  projectId: text('project_id').notNull(),
  artifactId: text('artifact_id').notNull(),
  artifactVersionId: text('artifact_version_id').notNull(),
  title: text('title').notNull(),
  angle: text('angle').notNull(),
  hook: text('hook').notNull(),
  rationale: text('rationale').notNull(),
  audienceJson: text('audience_json').notNull(),
  targetFormat: text('target_format').notNull(),
  targetPlatformsJson: text('target_platforms_json').notNull(),
  complexity: text('complexity'),
  monetizationCompatibility: text('monetization_compatibility'),
  risksJson: text('risks_json').notNull(),
  status: text('status').notNull(),
  recommendationRank: integer('recommendation_rank'),
  confidence: real('confidence'),
  evidenceClass: text('evidence_class').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  version: integer('version').notNull(),
  createdBy: text('created_by').notNull(),
  updatedBy: text('updated_by').notNull(),
});
export const ideaScoreComponents = sqliteTable('idea_score_components', {
  id: text('id').primaryKey(),
  ideaCandidateId: text('idea_candidate_id').notNull(),
  dimension: text('dimension').notNull(),
  score: real('score'),
  confidence: real('confidence'),
  evidenceClass: text('evidence_class').notNull(),
  explanation: text('explanation').notNull(),
  createdAt: text('created_at').notNull(),
});
export const scriptSegments = sqliteTable('script_segments', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  scriptVersionId: text('script_version_id').notNull(),
  segmentOrder: integer('segment_order').notNull(),
  contentText: text('content_text').notNull(),
  contentHash: text('content_hash').notNull(),
  wordCount: integer('word_count').notNull(),
  estimatedDurationSeconds: real('estimated_duration_seconds'),
  createdAt: text('created_at').notNull(),
});
export const storyboardScenes = sqliteTable('storyboard_scenes', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  storyboardVersionId: text('storyboard_version_id').notNull(),
  sceneOrder: integer('scene_order').notNull(),
  targetDurationSeconds: real('target_duration_seconds'),
  visualDescription: text('visual_description').notNull(),
  location: text('location').notNull(),
  action: text('action').notNull(),
  cameraFraming: text('camera_framing').notNull(),
  cameraMovement: text('camera_movement'),
  aspectRatio: text('aspect_ratio'),
  safeAreaGuidanceJson: text('safe_area_guidance_json'),
  onScreenTextJson: text('on_screen_text_json'),
  captionsJson: text('captions_json'),
  factualClaimsJson: text('factual_claims_json'),
  mediaReferencesJson: text('media_references_json'),
  audioGuidanceJson: text('audio_guidance_json'),
  continuityKey: text('continuity_key'),
  continuityReferenceKeysJson: text('continuity_reference_keys_json'),
  contractVersion: text('contract_version'),
  mood: text('mood').notNull(),
  continuityNotes: text('continuity_notes').notNull(),
  generationInstructions: text('generation_instructions').notNull(),
  recommendedMediaType: text('recommended_media_type'),
  assetRequirementsJson: text('asset_requirements_json').notNull(),
  transitionNotes: text('transition_notes').notNull(),
  characterVersionRefsJson: text('character_version_refs_json').notNull(),
  createdAt: text('created_at').notNull(),
});
export const sceneScriptSegments = sqliteTable('scene_script_segments', {
  workspaceId: text('workspace_id').notNull(),
  storyboardSceneId: text('storyboard_scene_id').notNull(),
  scriptSegmentId: text('script_segment_id').notNull(),
  segmentOrder: integer('segment_order').notNull(),
  createdAt: text('created_at').notNull(),
});
export const narrationRateProfiles = sqliteTable('narration_rate_profiles', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  name: text('name').notNull(),
  languageCode: text('language_code').notNull(),
  wordsPerMinute: real('words_per_minute').notNull(),
  versionNumber: integer('version_number').notNull(),
  status: text('status').notNull(),
  sourceLabel: text('source_label').notNull(),
  effectiveFrom: text('effective_from').notNull(),
  effectiveTo: text('effective_to'),
  createdAt: text('created_at').notNull(),
  createdBy: text('created_by').notNull(),
});
export const preflightAssessments = sqliteTable('preflight_assessments', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  projectId: text('project_id').notNull(),
  artifactId: text('artifact_id').notNull(),
  artifactVersionId: text('artifact_version_id').notNull(),
  overallResult: text('overall_result').notNull(),
  generationReadiness: text('generation_readiness').notNull(),
  ruleSetVersion: text('rule_set_version').notNull(),
  assessedAt: text('assessed_at').notNull(),
  assessedBy: text('assessed_by').notNull(),
});
export const preflightChecks = sqliteTable('preflight_checks', {
  id: text('id').primaryKey(),
  preflightAssessmentId: text('preflight_assessment_id').notNull(),
  checkKey: text('check_key').notNull(),
  result: text('result').notNull(),
  explanation: text('explanation').notNull(),
  evidenceJson: text('evidence_json').notNull(),
  ruleVersion: text('rule_version'),
  overrideAllowed: integer('override_allowed', { mode: 'boolean' }).notNull(),
  overrideActorId: text('override_actor_id'),
  overrideReason: text('override_reason'),
  createdAt: text('created_at').notNull(),
});
export const aiProviders = sqliteTable('ai_providers', {
  id: text('id').primaryKey(),
  key: text('key').notNull(),
  displayName: text('display_name').notNull(),
  status: text('status').notNull(),
  adapterVersion: text('adapter_version').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  version: integer('version').notNull(),
});
export const aiProviderModels = sqliteTable('ai_provider_models', {
  id: text('id').primaryKey(),
  providerId: text('provider_id').notNull(),
  modelKey: text('model_key').notNull(),
  displayName: text('display_name').notNull(),
  status: text('status').notNull(),
  capabilitiesJson: text('capabilities_json').notNull(),
  effectiveFrom: text('effective_from').notNull(),
  effectiveTo: text('effective_to'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  version: integer('version').notNull(),
});
export const promptDefinitions = sqliteTable('prompt_definitions', {
  id: text('id').primaryKey(),
  key: text('key').notNull(),
  taskType: text('task_type').notNull(),
  description: text('description').notNull(),
  status: text('status').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  version: integer('version').notNull(),
});
export const promptVersions = sqliteTable('prompt_versions', {
  id: text('id').primaryKey(),
  promptDefinitionId: text('prompt_definition_id').notNull(),
  versionNumber: integer('version_number').notNull(),
  templateText: text('template_text').notNull(),
  inputSchemaVersion: text('input_schema_version').notNull(),
  outputSchemaVersion: text('output_schema_version').notNull(),
  status: text('status').notNull(),
  contentHash: text('content_hash').notNull(),
  createdAt: text('created_at').notNull(),
  createdBy: text('created_by'),
});
export const intelligenceRuns = sqliteTable('intelligence_runs', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  projectId: text('project_id').notNull(),
  taskType: text('task_type').notNull(),
  providerId: text('provider_id'),
  providerModelId: text('provider_model_id'),
  promptVersionId: text('prompt_version_id'),
  inputArtifactVersionId: text('input_artifact_version_id'),
  outputArtifactVersionId: text('output_artifact_version_id'),
  initiatedBy: text('initiated_by').notNull(),
  operatingMode: text('operating_mode').notNull(),
  status: text('status').notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  creativeRegenerationNumber: integer('creative_regeneration_number').notNull(),
  safeMetadataJson: text('safe_metadata_json').notNull(),
  inputUnits: integer('input_units'),
  outputUnits: integer('output_units'),
  estimatedCost: real('estimated_cost'),
  actualCost: real('actual_cost'),
  currency: text('currency'),
  pricingSnapshotId: text('pricing_snapshot_id'),
  errorCategory: text('error_category'),
  safeErrorDetail: text('safe_error_detail'),
  terminalAuditEventId: text('terminal_audit_event_id'),
  startedAt: text('started_at'),
  completedAt: text('completed_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  version: integer('version').notNull(),
});
export const intelligenceRunAttempts = sqliteTable('intelligence_run_attempts', {
  id: text('id').primaryKey(),
  intelligenceRunId: text('intelligence_run_id').notNull(),
  attemptNumber: integer('attempt_number').notNull(),
  attemptKind: text('attempt_kind').notNull(),
  status: text('status').notNull(),
  providerRequestId: text('provider_request_id'),
  safeMetadataJson: text('safe_metadata_json').notNull(),
  errorCategory: text('error_category'),
  safeErrorDetail: text('safe_error_detail'),
  startedAt: text('started_at').notNull(),
  completedAt: text('completed_at'),
});
export const aiPricingSnapshots = sqliteTable('ai_pricing_snapshots', {
  id: text('id').primaryKey(),
  providerModelId: text('provider_model_id').notNull(),
  currency: text('currency'),
  inputUnitPrice: real('input_unit_price'),
  outputUnitPrice: real('output_unit_price'),
  unitName: text('unit_name'),
  sourceLabel: text('source_label'),
  sourceUrl: text('source_url'),
  verificationStatus: text('verification_status').notNull(),
  effectiveFrom: text('effective_from').notNull(),
  effectiveTo: text('effective_to'),
  createdAt: text('created_at').notNull(),
  createdBy: text('created_by'),
});

export const editorialExecutionEnvelopes = sqliteTable('editorial_execution_envelopes', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  projectId: text('project_id').notNull(),
  profileKey: text('profile_key').notNull(),
  profileVersion: integer('profile_version').notNull(),
  providerId: text('provider_id').notNull(),
  providerModelId: text('provider_model_id').notNull(),
  currency: text('currency').notNull(),
  monetaryCeilingMicrousd: integer('monetary_ceiling_microusd').notNull(),
  maximumCalls: integer('maximum_calls').notNull(),
  projectExecutionBudgetId: text('project_execution_budget_id'),
  stageKey: text('stage_key'),
  status: text('status').notNull(),
  authorizedBy: text('authorized_by').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  version: integer('version').notNull(),
});
export const editorialExecutionReservations = sqliteTable('editorial_execution_reservations', {
  id: text('id').primaryKey(),
  envelopeId: text('envelope_id').notNull(),
  workspaceId: text('workspace_id').notNull(),
  projectId: text('project_id').notNull(),
  intelligenceRunId: text('intelligence_run_id').notNull(),
  stepKey: text('step_key').notNull(),
  pricingSnapshotId: text('pricing_snapshot_id').notNull(),
  reservedMicrousd: integer('reserved_microusd').notNull(),
  actualMicrousd: integer('actual_microusd'),
  status: text('status').notNull(),
  createdAt: text('created_at').notNull(),
  dispatchedAt: text('dispatched_at'),
  reconciledAt: text('reconciled_at'),
  projectExecutionBudgetId: text('project_execution_budget_id'),
});

export const editorialProjectExecutionBudgets = sqliteTable('editorial_project_execution_budgets', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  projectId: text('project_id').notNull(),
  profileKey: text('profile_key').notNull(),
  profileVersion: integer('profile_version').notNull(),
  currency: text('currency').notNull(),
  monetaryCeilingMicrousd: integer('monetary_ceiling_microusd').notNull(),
  status: text('status').notNull(),
  authorizedBy: text('authorized_by').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  version: integer('version').notNull(),
});

export const editorialExecutionRemediations = sqliteTable('editorial_execution_remediations', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  projectId: text('project_id').notNull(),
  originalProjectExecutionBudgetId: text('original_project_execution_budget_id').notNull(),
  expectedOriginalBudgetVersion: integer('expected_original_budget_version').notNull(),
  historicalReservationId: text('historical_reservation_id').notNull(),
  historicalRunId: text('historical_run_id').notNull(),
  historicalEnvelopeId: text('historical_envelope_id').notNull(),
  remediationProjectExecutionBudgetId: text('remediation_project_execution_budget_id').notNull(),
  remediationEnvelopeId: text('remediation_envelope_id').notNull(),
  profileKey: text('profile_key').notNull(),
  profileVersion: integer('profile_version').notNull(),
  stageKey: text('stage_key').notNull(),
  providerId: text('provider_id').notNull(),
  providerModelId: text('provider_model_id').notNull(),
  additionalExposureMicrousd: integer('additional_exposure_microusd').notNull(),
  maximumCalls: integer('maximum_calls').notNull(),
  maximumAttempts: integer('maximum_attempts').notNull(),
  sdkMaxRetries: integer('sdk_max_retries').notNull(),
  fallbackEnabled: integer('fallback_enabled', { mode: 'boolean' }).notNull(),
  creativeRegenerationEnabled: integer('creative_regeneration_enabled', {
    mode: 'boolean',
  }).notNull(),
  externalResearchEnabled: integer('external_research_enabled', { mode: 'boolean' }).notNull(),
  humanApprovalRequired: integer('human_approval_required', { mode: 'boolean' }).notNull(),
  reasonCategory: text('reason_category').notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  commandHash: text('command_hash').notNull(),
  auditEventId: text('audit_event_id').notNull(),
  authorizedBy: text('authorized_by').notNull(),
  createdAt: text('created_at').notNull(),
});

export const editorialChainedExecutionRemediations = sqliteTable(
  'editorial_chained_execution_remediations',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    projectId: text('project_id').notNull(),
    parentRemediationId: text('parent_remediation_id').notNull(),
    remediationGeneration: integer('remediation_generation').notNull(),
    historicalReservationId: text('historical_reservation_id').notNull(),
    historicalRunId: text('historical_run_id').notNull(),
    historicalEnvelopeId: text('historical_envelope_id').notNull(),
    remediationProjectExecutionBudgetId: text('remediation_project_execution_budget_id').notNull(),
    remediationEnvelopeId: text('remediation_envelope_id').notNull(),
    profileKey: text('profile_key').notNull(),
    profileVersion: integer('profile_version').notNull(),
    stageKey: text('stage_key').notNull(),
    providerId: text('provider_id').notNull(),
    providerModelId: text('provider_model_id').notNull(),
    additionalExposureMicrousd: integer('additional_exposure_microusd').notNull(),
    maximumCalls: integer('maximum_calls').notNull(),
    maximumAttempts: integer('maximum_attempts').notNull(),
    sdkMaxRetries: integer('sdk_max_retries').notNull(),
    fallbackEnabled: integer('fallback_enabled', { mode: 'boolean' }).notNull(),
    creativeRegenerationEnabled: integer('creative_regeneration_enabled', {
      mode: 'boolean',
    }).notNull(),
    externalResearchEnabled: integer('external_research_enabled', { mode: 'boolean' }).notNull(),
    humanApprovalRequired: integer('human_approval_required', { mode: 'boolean' }).notNull(),
    failureCategory: text('failure_category').notNull(),
    diagnosticCategory: text('diagnostic_category').notNull(),
    reasonCategory: text('reason_category').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    commandHash: text('command_hash').notNull(),
    auditEventId: text('audit_event_id').notNull(),
    authorizedBy: text('authorized_by').notNull(),
    createdAt: text('created_at').notNull(),
  },
);

export const editorialIdeaRevisionCapacities = sqliteTable('editorial_idea_revision_capacities', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  projectId: text('project_id').notNull(),
  revisionRequestId: text('revision_request_id').notNull(),
  researchArtifactId: text('research_artifact_id').notNull(),
  researchVersionId: text('research_version_id').notNull(),
  researchApprovalId: text('research_approval_id').notNull(),
  expectedResearchArtifactRevision: integer('expected_research_artifact_revision').notNull(),
  expectedProjectVersion: integer('expected_project_version').notNull(),
  budgetId: text('budget_id').notNull(),
  envelopeId: text('envelope_id').notNull(),
  stageKey: text('stage_key').notNull(),
  profileKey: text('profile_key').notNull(),
  profileVersion: integer('profile_version').notNull(),
  providerId: text('provider_id').notNull(),
  providerModelId: text('provider_model_id').notNull(),
  promptVersionId: text('prompt_version_id').notNull(),
  pricingSnapshotId: text('pricing_snapshot_id').notNull(),
  monetaryCeilingMicrousd: integer('monetary_ceiling_microusd').notNull(),
  maximumCalls: integer('maximum_calls').notNull(),
  maximumAttempts: integer('maximum_attempts').notNull(),
  sdkMaxRetries: integer('sdk_max_retries').notNull(),
  fallbackEnabled: integer('fallback_enabled').notNull(),
  externalToolsEnabled: integer('external_tools_enabled').notNull(),
  creativeRegenerationEnabled: integer('creative_regeneration_enabled').notNull(),
  humanSelectionRequired: integer('human_selection_required').notNull(),
  humanApprovalRequired: integer('human_approval_required').notNull(),
  actorId: text('actor_id').notNull(),
  actorRole: text('actor_role').notNull(),
  environment: text('environment').notNull(),
  auditEventId: text('audit_event_id').notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  commandHash: text('command_hash').notNull(),
  resultJson: text('result_json').notNull(),
  createdAt: text('created_at').notNull(),
});

export const editorialIdeaRevisionCapacityRecoveries = sqliteTable(
  'editorial_idea_revision_capacity_recoveries',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    projectId: text('project_id').notNull(),
    ideaRevisionCapacityId: text('idea_revision_capacity_id').notNull(),
    revisionRequestId: text('revision_request_id').notNull(),
    researchArtifactId: text('research_artifact_id').notNull(),
    researchVersionId: text('research_version_id').notNull(),
    researchApprovalId: text('research_approval_id').notNull(),
    budgetId: text('budget_id').notNull(),
    originalEnvelopeId: text('original_envelope_id').notNull(),
    failedReservationId: text('failed_reservation_id').notNull(),
    failedRunId: text('failed_run_id').notNull(),
    replacementEnvelopeId: text('replacement_envelope_id').notNull(),
    originalProjectVersion: integer('original_project_version').notNull(),
    recoveryProjectVersion: integer('recovery_project_version').notNull(),
    providerId: text('provider_id').notNull(),
    providerModelId: text('provider_model_id').notNull(),
    promptVersionId: text('prompt_version_id').notNull(),
    pricingSnapshotId: text('pricing_snapshot_id').notNull(),
    profileKey: text('profile_key').notNull(),
    profileVersion: integer('profile_version').notNull(),
    stageKey: text('stage_key').notNull(),
    monetaryCeilingMicrousd: integer('monetary_ceiling_microusd').notNull(),
    maximumCalls: integer('maximum_calls').notNull(),
    actorId: text('actor_id').notNull(),
    actorRole: text('actor_role').notNull(),
    environment: text('environment').notNull(),
    auditEventId: text('audit_event_id').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    commandHash: text('command_hash').notNull(),
    resultJson: text('result_json').notNull(),
    createdAt: text('created_at').notNull(),
  },
);

const ideaRevisionDdl: ReadonlyArray<readonly [string, string, string]> = [
  [
    'table',
    'editorial_idea_revision_capacities',
    '3f9f9ced02d374f6417ab6e58bc351fb96bc6f5220c662c2808a1fce405e75af',
  ],
  [
    'view',
    'idea_revision_eligible_research',
    'b14075e4b71509d6c889c9f9e9a401163fff37d946df07a1bed3a85f3fd87d7d',
  ],
  [
    'view',
    'idea_revision_eligible_policy',
    '82b1a7dd144d27b0929381e5763f1085ca270039c696bb454bfd8b07df5aad3d',
  ],
  [
    'trigger',
    'idea_revision_capacity_scope_guard',
    'ca879b71c3a745e300e36bdbdc2e60e47a7b5959c1a7811aafe88af21d74ef1d',
  ],
  [
    'trigger',
    'idea_revision_capacity_policy_guard',
    '3d442ed408cfcfc64b9fefe60df5645f344fdff8fea4e88b5067cdc0f7d205c3',
  ],
  [
    'trigger',
    'idea_revision_capacity_actor_guard',
    '52db03060d42acbcb8e574951803b2fa7fc36777198e65d3bc1c28fcee814456',
  ],
  [
    'trigger',
    'idea_revision_capacity_budget_guard',
    'b36e7d57530a1eb39e16c76a0c2c85c07b70a6589e14ce2659b4d265818e9102',
  ],
  [
    'trigger',
    'idea_revision_capacity_result_guard',
    '0ba2196f4eb6e199e8c3c7e4a70b4e200ed1ea9806e0300c381cf6b4e1f01ce3',
  ],
  [
    'trigger',
    'idea_revision_capacity_audit_guard',
    'ff4687c29d596548a9c57ca2bcd2f8f1725eb8ddd06243336d0fdb8f91124879',
  ],
  [
    'trigger',
    'idea_revision_capacity_no_update',
    '5b466a31324ed7d17e0f3b69ad5fc431b38b2356461360ff8bba7424ff00d0d8',
  ],
  [
    'trigger',
    'idea_revision_capacity_no_delete',
    'edfe07585f4bd14606c6dcc5a4b08aac2bb5b4db5010aaa0feedf34823e26c6e',
  ],
  [
    'table',
    'editorial_idea_revision_capacity_recoveries',
    'c0414b6c571733b5f9a1f295ebaf89464fee751fd26f6d0aaedcde0d2a5c65d0',
  ],
  [
    'view',
    'idea_revision_zero_provider_failures',
    'bc49e43ca5c6690ab1204e87fcf991b528cb3224a02f26801235c40089bf3bbb',
  ],
  [
    'view',
    'idea_revision_recovery_eligible',
    '60a23c457f14d282987376688dae1a7c627896f69df5e786bfa9e0c77dea619f',
  ],
  [
    'view',
    'idea_revision_execution_bindings',
    '86071d1f0379554ba104af992ac0b44c6f9f49ab76902dfefb3d2591ea4aa502',
  ],
  [
    'trigger',
    'idea_revision_capacity_reservation_guard',
    '19a058d79e9819aabdc60e3918facbb8e74a7bec40022f101c222345e2c07769',
  ],
  [
    'trigger',
    'idea_revision_capacity_budget_immutable',
    '90bffa027cdb6b749aa2363ad7c052cf286c419ca4f029204cf92beb3618527d',
  ],
  [
    'trigger',
    'idea_revision_capacity_envelope_immutable',
    '2df04c35f59c014f0134c6b6d5d3f719a8ff230323044f7c32a1da95d7cf59a0',
  ],
  [
    'trigger',
    'idea_revision_capacity_reservation_immutable',
    'f6158485c9e461c76d8aff7d2e770edcaf992fc0f9186b412845ccfdc36b5772',
  ],
  [
    'trigger',
    'idea_revision_capacity_dispatch_guard',
    'ae1963dd42e80312524860d968de3226956108ca9dc10c74e5caab942e68cd90',
  ],
  [
    'trigger',
    'idea_revision_recovery_scope_guard',
    '6c46578709fd240b44cf648ef1d8232a4e9dc11fff9d33b8009ae23866803ec7',
  ],
  [
    'trigger',
    'idea_revision_recovery_failure_guard',
    'e61470c0adb209478f179faf8e9cf7b8862759ed91eda2ac41de0e7db4603396',
  ],
  [
    'trigger',
    'idea_revision_recovery_current_guard',
    'e805152326657d373406e12d6fa4b5a91905526349fe89b70e0e432466839580',
  ],
  [
    'trigger',
    'idea_revision_recovery_envelope_guard',
    '03fadc1d09028fc98dcfdcc399d62e61d7f7ab657668fa9c525840e29093f4f3',
  ],
  [
    'trigger',
    'idea_revision_recovery_actor_guard',
    'a37d1375810a5e64475062e24c52b94ebed099b4fa339b386599c2be1986ec40',
  ],
  [
    'trigger',
    'idea_revision_recovery_result_guard',
    '1b5357f26d1b329eb5b71bfa11b4abb33495a2916b74a267e67fc79dc76ba318',
  ],
  [
    'trigger',
    'idea_revision_recovery_audit_guard',
    'cc3b1503789fd670581bef50fe5a88ca7682321ea5ec30fee04980bf801aa40c',
  ],
  [
    'trigger',
    'idea_revision_recovery_no_update',
    '89f40fa7c943e78dcf5753bdc5f7f133a5e686f41567d48e01f83a48b6976c6c',
  ],
  [
    'trigger',
    'idea_revision_recovery_no_delete',
    'fa4f61ba40e68eb8da9b3c28e5baaee7b6f20f149afd473b6a65266137877ad3',
  ],
  [
    'trigger',
    'idea_revision_recovery_budget_no_update',
    'de2b8bfed296414c96f8417c18cc6856c64583ee36463226c75736f40a515603',
  ],
  [
    'trigger',
    'idea_revision_recovery_budget_no_delete',
    '2cde4988061dcbd9babb2269b059a575028f0dbb6fe29b2870926bd6682cefba',
  ],
  [
    'trigger',
    'idea_revision_recovery_original_envelope_no_update',
    'a3547315b64458218e52917fb60dfb49569771708fc6656941e9f980993b6cd3',
  ],
  [
    'trigger',
    'idea_revision_recovery_original_envelope_no_delete',
    '578fb5c27bb232b19c2c176f5bb962144197205947b6cdef12db2977e2d35165',
  ],
  [
    'trigger',
    'idea_revision_recovery_failed_reservation_no_update',
    '8d01eec75f17ce925566820723cae499b9e25d46816334c27aa93a95bd24a616',
  ],
  [
    'trigger',
    'idea_revision_recovery_failed_reservation_no_delete',
    '29b6e86a42c5fbbe7e5cf9ea27202348bfa43d13818ec1321f9f11b7c5525307',
  ],
  [
    'trigger',
    'idea_revision_recovery_failed_run_no_update',
    'cf0aa7bd377000384ef1eb0ed8b8ec5e911b4f261f9d6c0890e70609a90831fe',
  ],
  [
    'trigger',
    'idea_revision_recovery_failed_run_no_delete',
    '854c95737058b7aa514cba91030bf26b2ef5b4e727dd2e6d212256b48acd4e1d',
  ],
  [
    'trigger',
    'idea_revision_recovery_reservation_evidence_guard',
    '18116a4b45a03cb48934f8bdd7d743306f11554caa4bca09366d88e3c834dd95',
  ],
  [
    'trigger',
    'idea_revision_recovery_dispatch_evidence_guard',
    '3a5871fa69a23be8b92fca4a7858f3fefb8ed15ac958ebf34d17d3da81ca1771',
  ],
];
const ideaRevisionColumns: Readonly<Record<string, string>> = {
  id: 'TEXT',
  workspace_id: 'TEXT',
  project_id: 'TEXT',
  revision_request_id: 'TEXT',
  research_artifact_id: 'TEXT',
  research_version_id: 'TEXT',
  research_approval_id: 'TEXT',
  expected_research_artifact_revision: 'INTEGER',
  expected_project_version: 'INTEGER',
  budget_id: 'TEXT',
  envelope_id: 'TEXT',
  stage_key: 'TEXT',
  profile_key: 'TEXT',
  profile_version: 'INTEGER',
  provider_id: 'TEXT',
  provider_model_id: 'TEXT',
  prompt_version_id: 'TEXT',
  pricing_snapshot_id: 'TEXT',
  monetary_ceiling_microusd: 'INTEGER',
  maximum_calls: 'INTEGER',
  maximum_attempts: 'INTEGER',
  sdk_max_retries: 'INTEGER',
  fallback_enabled: 'INTEGER',
  external_tools_enabled: 'INTEGER',
  creative_regeneration_enabled: 'INTEGER',
  human_selection_required: 'INTEGER',
  human_approval_required: 'INTEGER',
  actor_id: 'TEXT',
  actor_role: 'TEXT',
  environment: 'TEXT',
  audit_event_id: 'TEXT',
  idempotency_key: 'TEXT',
  command_hash: 'TEXT',
  result_json: 'TEXT',
  created_at: 'TEXT',
};

const ideaRevisionRecoveryColumns: Readonly<Record<string, string>> = {
  id: 'TEXT',
  workspace_id: 'TEXT',
  project_id: 'TEXT',
  idea_revision_capacity_id: 'TEXT',
  revision_request_id: 'TEXT',
  research_artifact_id: 'TEXT',
  research_version_id: 'TEXT',
  research_approval_id: 'TEXT',
  budget_id: 'TEXT',
  original_envelope_id: 'TEXT',
  failed_reservation_id: 'TEXT',
  failed_run_id: 'TEXT',
  replacement_envelope_id: 'TEXT',
  original_project_version: 'INTEGER',
  recovery_project_version: 'INTEGER',
  provider_id: 'TEXT',
  provider_model_id: 'TEXT',
  prompt_version_id: 'TEXT',
  pricing_snapshot_id: 'TEXT',
  profile_key: 'TEXT',
  profile_version: 'INTEGER',
  stage_key: 'TEXT',
  monetary_ceiling_microusd: 'INTEGER',
  maximum_calls: 'INTEGER',
  actor_id: 'TEXT',
  actor_role: 'TEXT',
  environment: 'TEXT',
  audit_event_id: 'TEXT',
  idempotency_key: 'TEXT',
  command_hash: 'TEXT',
  result_json: 'TEXT',
  created_at: 'TEXT',
};
export type IdeaRevisionSchemaObject = { type: string; name: string; sql: string };
// Token normalization ignores formatting/comments but preserves literals and SQL structure.
// These fingerprints pin the complete reviewed 0014 predicates, including dispatch guards.
function normalizeIdeaRevisionDdl(sql: string) {
  const tokens =
    sql.match(
      /--[^\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"|[A-Za-z_][A-Za-z0-9_]*|[0-9]+(?:\.[0-9]+)?|[^\s]/gu,
    ) ?? [];
  const significant = tokens
    .filter((t) => !t.startsWith('--') && !t.startsWith('/*'))
    .map((t) => (t.startsWith("'") || t.startsWith('"') ? t : t.toLowerCase()));
  while (significant.at(-1) === ';') significant.pop();
  return significant.join(' ');
}
async function ideaRevisionDdlHash(sql: string) {
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(normalizeIdeaRevisionDdl(sql)),
  );
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export async function verifiedIdeaRevisionSchema(
  db: D1Database,
): Promise<IdeaRevisionSchemaObject[] | null> {
  try {
    const objects = (
      await db
        .prepare(
          "SELECT type,name,sql FROM sqlite_master WHERE name IN ('editorial_idea_revision_capacities','editorial_idea_revision_capacity_recoveries') OR name LIKE 'idea_revision_%'",
        )
        .all<IdeaRevisionSchemaObject>()
    ).results;
    const proof: IdeaRevisionSchemaObject[] = [];
    for (const [type, name, hash] of ideaRevisionDdl) {
      const object = objects.find((o) => o.type === type && o.name === name);
      if (!object?.sql || (await ideaRevisionDdlHash(object.sql)) !== hash) return null;
      proof.push(object);
    }
    const columns = (
      await db
        .prepare("PRAGMA table_info('editorial_idea_revision_capacities')")
        .all<{ name: string; type: string; notnull: number; pk: number }>()
    ).results;
    for (const [name, type] of Object.entries(ideaRevisionColumns)) {
      if (
        !columns.some(
          (c) =>
            c.name === name && c.type === type && c.notnull === 1 && (name !== 'id' || c.pk === 1),
        )
      )
        return null;
    }
    const indexes = (
      await db
        .prepare("PRAGMA index_list('editorial_idea_revision_capacities')")
        .all<{ name: string; unique: number; partial: number }>()
    ).results;
    const unique: string[] = [];
    for (const index of indexes.filter((i) => i.unique === 1 && i.partial === 0)) {
      const info = (
        await db
          .prepare('SELECT name FROM pragma_index_info(?) ORDER BY seqno')
          .bind(index.name)
          .all<{ name: string }>()
      ).results;
      unique.push(info.map((c) => c.name).join(','));
    }
    for (const key of [
      'id',
      'budget_id',
      'envelope_id',
      'audit_event_id',
      'workspace_id,idempotency_key',
      'workspace_id,project_id,revision_request_id,research_version_id,stage_key',
    ]) {
      if (!unique.includes(key)) return null;
    }

    const recoveryColumns = (
      await db
        .prepare("PRAGMA table_info('editorial_idea_revision_capacity_recoveries')")
        .all<{ name: string; type: string; notnull: number; pk: number }>()
    ).results;
    for (const [name, type] of Object.entries(ideaRevisionRecoveryColumns)) {
      if (
        !recoveryColumns.some(
          (c) =>
            c.name === name && c.type === type && c.notnull === 1 && (name !== 'id' || c.pk === 1),
        )
      )
        return null;
    }
    const recoveryIndexes = (
      await db
        .prepare("PRAGMA index_list('editorial_idea_revision_capacity_recoveries')")
        .all<{ name: string; unique: number; partial: number }>()
    ).results;
    const recoveryUnique: string[] = [];
    for (const idx of recoveryIndexes.filter((i) => i.unique === 1 && i.partial === 0)) {
      const info = (
        await db
          .prepare('SELECT name FROM pragma_index_info(?) ORDER BY seqno')
          .bind(idx.name)
          .all<{ name: string }>()
      ).results;
      recoveryUnique.push(info.map((c) => c.name).join(','));
    }
    for (const key of [
      'id',
      'idea_revision_capacity_id',
      'replacement_envelope_id',
      'failed_run_id',
      'failed_reservation_id',
      'audit_event_id',
      'workspace_id,idempotency_key',
    ])
      if (!recoveryUnique.includes(key)) return null;
    for (const [view, expected] of [
      ['idea_revision_zero_provider_failures', 'capacity_id,failed_reservation_id,failed_run_id'],
      [
        'idea_revision_recovery_eligible',
        'capacity_id,failed_run_id,failed_reservation_id,project_version',
      ],
      ['idea_revision_execution_bindings', 'capacity_id,envelope_id,project_version,recovery_id'],

      [
        'idea_revision_eligible_research',
        'revision_request_id,workspace_id,project_id,research_artifact_id,research_version_id,research_artifact_revision,project_version,research_approval_id',
      ],
      [
        'idea_revision_eligible_policy',
        'provider_id,provider_model_id,prompt_version_id,pricing_snapshot_id',
      ],
    ]) {
      const info = (
        await db
          .prepare('SELECT name FROM pragma_table_info(?) ORDER BY cid')
          .bind(view!)
          .all<{ name: string }>()
      ).results;
      if (info.map((c) => c.name).join(',') !== expected) return null;
    }
    return proof;
  } catch {
    return null;
  }
}
export async function ideaRevisionSchemaReady(db: D1Database) {
  return (await verifiedIdeaRevisionSchema(db)) !== null;
}

// Independent Brief capability proof; the reviewed Idea proof above is unchanged.
const contentBriefRevisionDdl: ReadonlyArray<readonly [string, string, string]> = [
  [
    'trigger',
    'content_brief_revision_capacity_actor_guard',
    'cbeb9004fce6fe1396516dbb6a7607e3b9dc4f16247855c88ed0ded4a3b73176',
  ],
  [
    'trigger',
    'content_brief_revision_capacity_audit_guard',
    '39429d2ed23de4453065b3bde626f4574dcb4b4df6e7024d56f6ff410b8ab821',
  ],
  [
    'trigger',
    'content_brief_revision_capacity_budget_guard',
    '158fda3728647a29c5bd8444e2b6f70991013c88ed8ffbcae3a372a60f38560c',
  ],
  [
    'trigger',
    'content_brief_revision_capacity_budget_immutable',
    'f1b67e8b7687679acef74361ef46837110c432ae8be94cfc3a96ef97fd13ee84',
  ],
  [
    'trigger',
    'content_brief_revision_capacity_dispatch_guard',
    '43527634dadaf10c75ca09b2e987427079fb7ea7388eb015906b2a54f88edda9',
  ],
  [
    'trigger',
    'content_brief_revision_capacity_envelope_immutable',
    'd20f73f460f50d7a438377dce3bbe9dcb2c1f430d2b7542eefad6aac48417cef',
  ],
  [
    'trigger',
    'content_brief_revision_capacity_no_delete',
    'dddde353ab3247e472cd8a58fc169dfeccf2ee777f6b92283d28a012a7c0ac8d',
  ],
  [
    'trigger',
    'content_brief_revision_capacity_no_update',
    '49d30022ac2f8f5a2f8ff6a69b084d0bd76e6cf1e5425dab7dd9ae386c1d553f',
  ],
  [
    'trigger',
    'content_brief_revision_capacity_policy_guard',
    '50f6ea8bbba5341f0b9df5d14d96af981b9657a4759c208b58dfccc2758e2c55',
  ],
  [
    'trigger',
    'content_brief_revision_capacity_reservation_guard',
    'b3c5055e3b2ddb3a83dabed147a7d96fe55ad90ee630e2b86278d35be93526bd',
  ],
  [
    'trigger',
    'content_brief_revision_capacity_reservation_immutable',
    '80fcf4cb3e1958eed1653b2f5e544388e8ee140448459818cc0a3e15cf5e6ded',
  ],
  [
    'trigger',
    'content_brief_revision_capacity_result_guard',
    'ce782e162fe212be6b2452f6ffd14d6a6349fcc5753063875f30b10b45aab315',
  ],
  [
    'trigger',
    'content_brief_revision_capacity_scope_guard',
    '50c4a3a35adbb007a06a579a043ca92fcda1e4b0ac7233ca4acb20a4023c136a',
  ],
  [
    'view',
    'content_brief_revision_eligible_inputs',
    '4c008d43d3b542b3555d31ca48c2d7b117025b6adc66be9c6743c1637055c8ff',
  ],
  [
    'view',
    'content_brief_revision_eligible_policy',
    '4daed9e706dbe50af8f94eab452f93ecc400169cc0f2f0a637810d7870827f46',
  ],
  [
    'view',
    'content_brief_revision_execution_bindings',
    '462d9d8b263dba5b3ac7dd1023d383fdc7ae8a9f91eb16c75fbe971cf62c0eb1',
  ],
  [
    'trigger',
    'content_brief_revision_recovery_actor_guard',
    '801c441921e901979f26baf54650f9002446f89a6dce66cf129742ce7c29560d',
  ],
  [
    'trigger',
    'content_brief_revision_recovery_audit_guard',
    'f4c03bda87b9676c616d15f2ee880d838f68b3c04cd1cadcbe7d7a11026a6584',
  ],
  [
    'trigger',
    'content_brief_revision_recovery_budget_no_delete',
    '23a1754f1e5898357678950e7d04e8e38747054dbeec89732f7ccbcad857a3ed',
  ],
  [
    'trigger',
    'content_brief_revision_recovery_budget_no_update',
    '587f31c21e92b4851be41170c0c2ff1b935281aaeeec734b9e40d4ceb9866684',
  ],
  [
    'trigger',
    'content_brief_revision_recovery_current_guard',
    '419c34008566b9b7454ac5ebb824968fbee28637a2a262e4149ca43cdd779c52',
  ],
  [
    'trigger',
    'content_brief_revision_recovery_dispatch_evidence_guard',
    'c14ceb9e15d91ded0712ce6143b110754882790dc2c9d97d02927719fb4d2a54',
  ],
  [
    'view',
    'content_brief_revision_recovery_eligible',
    'deccc8959f6fb2238c9b46bed3ac2c1c164fe0b785205cdc6116c29e70235b2d',
  ],
  [
    'trigger',
    'content_brief_revision_recovery_envelope_guard',
    '08aa61a16ca1f4c8af41d0ccc0a30299ccfa675c6c341360f087a6aec8b52603',
  ],
  [
    'trigger',
    'content_brief_revision_recovery_failed_reservation_no_delete',
    'ce26fec9fd0e8a970814884c8d828d5e69e17b2d79802aef70c7f24d4e6541c1',
  ],
  [
    'trigger',
    'content_brief_revision_recovery_failed_reservation_no_update',
    '5110cf9a208f72890229dc0a0c45a3ab2d751fefb9729a3af746fcad5f33c63d',
  ],
  [
    'trigger',
    'content_brief_revision_recovery_failed_run_no_delete',
    'b1a45422f08ad7b6c33e742daeb561b5df8d189b554b5dc9cb2daf4b2b23dd79',
  ],
  [
    'trigger',
    'content_brief_revision_recovery_failed_run_no_update',
    'a03b705fb28c312ab59ae1311904391d3fa6eeddd1d969e9c6d6dda6290ed7f5',
  ],
  [
    'trigger',
    'content_brief_revision_recovery_failure_guard',
    'a16304d036985dec4e26cbe6a9f22085b4f09869320882803cfdb2bcb18553c3',
  ],
  [
    'trigger',
    'content_brief_revision_recovery_no_delete',
    'fdb25702c252dfce7243d56629534735da2e1752a5e04e373ee2ee99a4611589',
  ],
  [
    'trigger',
    'content_brief_revision_recovery_no_update',
    '0d73e6f559130a9f729cbba8e3927ad71c08b837fb5159be0708ac1f63e0e748',
  ],
  [
    'trigger',
    'content_brief_revision_recovery_original_envelope_no_delete',
    'fe5a6e6ed00feeaf3612f22ee5e779704623d89ed6754598786c7c1471413032',
  ],
  [
    'trigger',
    'content_brief_revision_recovery_original_envelope_no_update',
    '904608b1beaf06a54ab678677166d6840d3e1b62b23e4a9c7ff175fe2843c25e',
  ],
  [
    'trigger',
    'content_brief_revision_recovery_reservation_evidence_guard',
    '4046d77e7af7e12f2849391813b7f8762eb19bd2df4f7ca30699213eec052a3b',
  ],
  [
    'trigger',
    'content_brief_revision_recovery_result_guard',
    '62539b8bb89c31f624a3f3cba0ae639fb990398c65f1132ec58456f6f23ccdb6',
  ],
  [
    'trigger',
    'content_brief_revision_recovery_scope_guard',
    'd34541d816a5cc054c0cf46f966dfce61a6a9ff09463eac66e87d320e57319be',
  ],
  [
    'view',
    'content_brief_revision_zero_provider_failures',
    'a7d6b2938f7452238f6fbe9e261a2a242affca2ec1ff8111d7b5eb28a955d046',
  ],
  [
    'table',
    'editorial_content_brief_revision_capacities',
    '5e3e81f72adcde7f4b53462f12fbcda200ffdd78662f94a5adb80f3311aaf751',
  ],
  [
    'table',
    'editorial_content_brief_revision_capacity_recoveries',
    '7585360f8d175d4b5842ec1499d950659fe4d8746b77b235e88fd35db2b40d83',
  ],
];
const contentBriefRevisionStructures = {
  content_brief_revision_eligible_inputs: {
    columns: [
      [0, 'revision_request_id', 'TEXT', 0, null, 0],
      [1, 'workspace_id', 'TEXT', 0, null, 0],
      [2, 'project_id', 'TEXT', 0, null, 0],
      [3, 'research_artifact_id', 'TEXT', 0, null, 0],
      [4, 'research_version_id', 'TEXT', 0, null, 0],
      [5, 'research_artifact_revision', 'INTEGER', 0, null, 0],
      [6, 'project_version', 'INTEGER', 0, null, 0],
      [7, 'research_approval_id', 'TEXT', 0, null, 0],
      [8, 'research_content_hash', 'TEXT', 0, null, 0],
      [9, 'idea_candidate_id', 'TEXT', 0, null, 0],
      [10, 'expected_idea_candidate_revision', 'INTEGER', 0, null, 0],
      [11, 'idea_artifact_id', 'TEXT', 0, null, 0],
      [12, 'idea_version_id', 'TEXT', 0, null, 0],
      [13, 'idea_approval_id', 'TEXT', 0, null, 0],
      [14, 'idea_content_hash', 'TEXT', 0, null, 0],
      [15, 'expected_idea_artifact_revision', 'INTEGER', 0, null, 0],
      [16, 'brief_artifact_id', 'TEXT', 0, null, 0],
      [17, 'expected_current_brief_version_id', 'TEXT', 0, null, 0],
      [18, 'expected_brief_artifact_revision', 'INTEGER', 0, null, 0],
      [19, 'binding_json', '', 0, null, 0],
    ],
    foreignKeys: [],
    unique: [],
  },
  content_brief_revision_eligible_policy: {
    columns: [
      [0, 'provider_id', 'TEXT', 0, null, 0],
      [1, 'provider_model_id', 'TEXT', 0, null, 0],
      [2, 'prompt_version_id', 'TEXT', 0, null, 0],
      [3, 'pricing_snapshot_id', 'TEXT', 0, null, 0],
      [4, 'policy_snapshot_json', '', 0, null, 0],
    ],
    foreignKeys: [],
    unique: [],
  },
  content_brief_revision_execution_bindings: {
    columns: [
      [0, 'capacity_id', 'TEXT', 0, null, 0],
      [1, 'envelope_id', '', 0, null, 0],
      [2, 'project_version', '', 0, null, 0],
      [3, 'recovery_id', 'TEXT', 0, null, 0],
    ],
    foreignKeys: [],
    unique: [],
  },
  content_brief_revision_recovery_eligible: {
    columns: [
      [0, 'capacity_id', 'TEXT', 0, null, 0],
      [1, 'failed_run_id', 'TEXT', 0, null, 0],
      [2, 'failed_reservation_id', 'TEXT', 0, null, 0],
      [3, 'project_version', 'INTEGER', 0, null, 0],
    ],
    foreignKeys: [],
    unique: [],
  },
  content_brief_revision_zero_provider_failures: {
    columns: [
      [0, 'capacity_id', 'TEXT', 0, null, 0],
      [1, 'failed_reservation_id', 'TEXT', 0, null, 0],
      [2, 'failed_run_id', 'TEXT', 0, null, 0],
    ],
    foreignKeys: [],
    unique: [],
  },
  editorial_content_brief_revision_capacities: {
    columns: [
      [0, 'id', 'TEXT', 1, null, 1],
      [1, 'workspace_id', 'TEXT', 1, null, 0],
      [2, 'project_id', 'TEXT', 1, null, 0],
      [3, 'revision_request_id', 'TEXT', 1, null, 0],
      [4, 'research_artifact_id', 'TEXT', 1, null, 0],
      [5, 'research_version_id', 'TEXT', 1, null, 0],
      [6, 'research_approval_id', 'TEXT', 1, null, 0],
      [7, 'expected_research_artifact_revision', 'INTEGER', 1, null, 0],
      [8, 'expected_project_version', 'INTEGER', 1, null, 0],
      [9, 'research_content_hash', 'TEXT', 1, null, 0],
      [10, 'idea_candidate_id', 'TEXT', 1, null, 0],
      [11, 'expected_idea_candidate_revision', 'INTEGER', 1, null, 0],
      [12, 'idea_artifact_id', 'TEXT', 1, null, 0],
      [13, 'idea_version_id', 'TEXT', 1, null, 0],
      [14, 'idea_approval_id', 'TEXT', 1, null, 0],
      [15, 'idea_content_hash', 'TEXT', 1, null, 0],
      [16, 'expected_idea_artifact_revision', 'INTEGER', 1, null, 0],
      [17, 'brief_artifact_id', 'TEXT', 1, null, 0],
      [18, 'expected_current_brief_version_id', 'TEXT', 1, null, 0],
      [19, 'expected_brief_artifact_revision', 'INTEGER', 1, null, 0],
      [20, 'required_project_status', 'TEXT', 1, "'ANALYZING'", 0],
      [21, 'binding_json', 'TEXT', 1, null, 0],
      [22, 'policy_snapshot_json', 'TEXT', 1, null, 0],
      [23, 'request_id', 'TEXT', 1, null, 0],
      [24, 'budget_id', 'TEXT', 1, null, 0],
      [25, 'envelope_id', 'TEXT', 1, null, 0],
      [26, 'stage_key', 'TEXT', 1, null, 0],
      [27, 'profile_key', 'TEXT', 1, null, 0],
      [28, 'profile_version', 'INTEGER', 1, null, 0],
      [29, 'provider_id', 'TEXT', 1, null, 0],
      [30, 'provider_model_id', 'TEXT', 1, null, 0],
      [31, 'prompt_version_id', 'TEXT', 1, null, 0],
      [32, 'pricing_snapshot_id', 'TEXT', 1, null, 0],
      [33, 'monetary_ceiling_microusd', 'INTEGER', 1, null, 0],
      [34, 'maximum_calls', 'INTEGER', 1, null, 0],
      [35, 'maximum_attempts', 'INTEGER', 1, '1', 0],
      [36, 'sdk_max_retries', 'INTEGER', 1, '0', 0],
      [37, 'fallback_enabled', 'INTEGER', 1, '0', 0],
      [38, 'external_tools_enabled', 'INTEGER', 1, '0', 0],
      [39, 'creative_regeneration_enabled', 'INTEGER', 1, '0', 0],
      [40, 'human_selection_required', 'INTEGER', 1, '1', 0],
      [41, 'human_approval_required', 'INTEGER', 1, '1', 0],
      [42, 'actor_id', 'TEXT', 1, null, 0],
      [43, 'actor_role', 'TEXT', 1, null, 0],
      [44, 'environment', 'TEXT', 1, null, 0],
      [45, 'audit_event_id', 'TEXT', 1, null, 0],
      [46, 'idempotency_key', 'TEXT', 1, null, 0],
      [47, 'command_hash', 'TEXT', 1, null, 0],
      [48, 'result_json', 'TEXT', 1, null, 0],
      [49, 'created_at', 'TEXT', 1, null, 0],
    ],
    foreignKeys: [
      [0, 0, 'audit_events', 'audit_event_id', 'id', 'NO ACTION', 'NO ACTION', 'NONE'],
      [1, 0, 'users', 'actor_id', 'id', 'NO ACTION', 'NO ACTION', 'NONE'],
      [2, 0, 'ai_pricing_snapshots', 'pricing_snapshot_id', 'id', 'NO ACTION', 'NO ACTION', 'NONE'],
      [3, 0, 'prompt_versions', 'prompt_version_id', 'id', 'NO ACTION', 'NO ACTION', 'NONE'],
      [4, 0, 'ai_provider_models', 'provider_model_id', 'id', 'NO ACTION', 'NO ACTION', 'NONE'],
      [5, 0, 'ai_providers', 'provider_id', 'id', 'NO ACTION', 'NO ACTION', 'NONE'],
      [
        6,
        0,
        'editorial_execution_envelopes',
        'envelope_id',
        'id',
        'NO ACTION',
        'NO ACTION',
        'NONE',
      ],
      [
        7,
        0,
        'editorial_project_execution_budgets',
        'budget_id',
        'id',
        'NO ACTION',
        'NO ACTION',
        'NONE',
      ],
      [
        8,
        0,
        'editorial_artifact_versions',
        'expected_current_brief_version_id',
        'id',
        'NO ACTION',
        'NO ACTION',
        'NONE',
      ],
      [9, 0, 'editorial_artifacts', 'brief_artifact_id', 'id', 'NO ACTION', 'NO ACTION', 'NONE'],
      [10, 0, 'artifact_approvals', 'idea_approval_id', 'id', 'NO ACTION', 'NO ACTION', 'NONE'],
      [
        11,
        0,
        'editorial_artifact_versions',
        'idea_version_id',
        'id',
        'NO ACTION',
        'NO ACTION',
        'NONE',
      ],
      [12, 0, 'editorial_artifacts', 'idea_artifact_id', 'id', 'NO ACTION', 'NO ACTION', 'NONE'],
      [13, 0, 'idea_candidates', 'idea_candidate_id', 'id', 'NO ACTION', 'NO ACTION', 'NONE'],
      [14, 0, 'artifact_approvals', 'research_approval_id', 'id', 'NO ACTION', 'NO ACTION', 'NONE'],
      [
        15,
        0,
        'editorial_artifact_versions',
        'research_version_id',
        'id',
        'NO ACTION',
        'NO ACTION',
        'NONE',
      ],
      [
        16,
        0,
        'editorial_artifacts',
        'research_artifact_id',
        'id',
        'NO ACTION',
        'NO ACTION',
        'NONE',
      ],
      [
        17,
        0,
        'editorial_revision_requests',
        'revision_request_id',
        'id',
        'NO ACTION',
        'NO ACTION',
        'NONE',
      ],
      [18, 0, 'projects', 'project_id', 'id', 'NO ACTION', 'NO ACTION', 'NONE'],
      [19, 0, 'workspaces', 'workspace_id', 'id', 'NO ACTION', 'NO ACTION', 'NONE'],
    ],
    unique: [
      'audit_event_id',
      'budget_id',
      'envelope_id',
      'id',
      'workspace_id,idempotency_key',
      'workspace_id,project_id,revision_request_id,stage_key',
    ],
  },
  editorial_content_brief_revision_capacity_recoveries: {
    columns: [
      [0, 'id', 'TEXT', 1, null, 1],
      [1, 'workspace_id', 'TEXT', 1, null, 0],
      [2, 'project_id', 'TEXT', 1, null, 0],
      [3, 'content_brief_revision_capacity_id', 'TEXT', 1, null, 0],
      [4, 'revision_request_id', 'TEXT', 1, null, 0],
      [5, 'research_artifact_id', 'TEXT', 1, null, 0],
      [6, 'research_version_id', 'TEXT', 1, null, 0],
      [7, 'research_approval_id', 'TEXT', 1, null, 0],
      [8, 'budget_id', 'TEXT', 1, null, 0],
      [9, 'original_envelope_id', 'TEXT', 1, null, 0],
      [10, 'failed_reservation_id', 'TEXT', 1, null, 0],
      [11, 'failed_run_id', 'TEXT', 1, null, 0],
      [12, 'replacement_envelope_id', 'TEXT', 1, null, 0],
      [13, 'original_project_version', 'INTEGER', 1, null, 0],
      [14, 'recovery_project_version', 'INTEGER', 1, null, 0],
      [15, 'provider_id', 'TEXT', 1, null, 0],
      [16, 'provider_model_id', 'TEXT', 1, null, 0],
      [17, 'prompt_version_id', 'TEXT', 1, null, 0],
      [18, 'pricing_snapshot_id', 'TEXT', 1, null, 0],
      [19, 'profile_key', 'TEXT', 1, null, 0],
      [20, 'profile_version', 'INTEGER', 1, null, 0],
      [21, 'stage_key', 'TEXT', 1, null, 0],
      [22, 'monetary_ceiling_microusd', 'INTEGER', 1, null, 0],
      [23, 'maximum_calls', 'INTEGER', 1, null, 0],
      [24, 'actor_id', 'TEXT', 1, null, 0],
      [25, 'actor_role', 'TEXT', 1, null, 0],
      [26, 'environment', 'TEXT', 1, null, 0],
      [27, 'audit_event_id', 'TEXT', 1, null, 0],
      [28, 'idempotency_key', 'TEXT', 1, null, 0],
      [29, 'command_hash', 'TEXT', 1, null, 0],
      [30, 'result_json', 'TEXT', 1, null, 0],
      [31, 'created_at', 'TEXT', 1, null, 0],
    ],
    foreignKeys: [
      [0, 0, 'audit_events', 'audit_event_id', 'id', 'NO ACTION', 'NO ACTION', 'NONE'],
      [1, 0, 'users', 'actor_id', 'id', 'NO ACTION', 'NO ACTION', 'NONE'],
      [2, 0, 'ai_pricing_snapshots', 'pricing_snapshot_id', 'id', 'NO ACTION', 'NO ACTION', 'NONE'],
      [3, 0, 'prompt_versions', 'prompt_version_id', 'id', 'NO ACTION', 'NO ACTION', 'NONE'],
      [4, 0, 'ai_provider_models', 'provider_model_id', 'id', 'NO ACTION', 'NO ACTION', 'NONE'],
      [5, 0, 'ai_providers', 'provider_id', 'id', 'NO ACTION', 'NO ACTION', 'NONE'],
      [
        6,
        0,
        'editorial_execution_envelopes',
        'replacement_envelope_id',
        'id',
        'NO ACTION',
        'NO ACTION',
        'NONE',
      ],
      [7, 0, 'intelligence_runs', 'failed_run_id', 'id', 'NO ACTION', 'NO ACTION', 'NONE'],
      [
        8,
        0,
        'editorial_execution_reservations',
        'failed_reservation_id',
        'id',
        'NO ACTION',
        'NO ACTION',
        'NONE',
      ],
      [
        9,
        0,
        'editorial_execution_envelopes',
        'original_envelope_id',
        'id',
        'NO ACTION',
        'NO ACTION',
        'NONE',
      ],
      [
        10,
        0,
        'editorial_project_execution_budgets',
        'budget_id',
        'id',
        'NO ACTION',
        'NO ACTION',
        'NONE',
      ],
      [11, 0, 'artifact_approvals', 'research_approval_id', 'id', 'NO ACTION', 'NO ACTION', 'NONE'],
      [
        12,
        0,
        'editorial_artifact_versions',
        'research_version_id',
        'id',
        'NO ACTION',
        'NO ACTION',
        'NONE',
      ],
      [
        13,
        0,
        'editorial_artifacts',
        'research_artifact_id',
        'id',
        'NO ACTION',
        'NO ACTION',
        'NONE',
      ],
      [
        14,
        0,
        'editorial_revision_requests',
        'revision_request_id',
        'id',
        'NO ACTION',
        'NO ACTION',
        'NONE',
      ],
      [
        15,
        0,
        'editorial_content_brief_revision_capacities',
        'content_brief_revision_capacity_id',
        'id',
        'NO ACTION',
        'NO ACTION',
        'NONE',
      ],
      [16, 0, 'projects', 'project_id', 'id', 'NO ACTION', 'NO ACTION', 'NONE'],
      [17, 0, 'workspaces', 'workspace_id', 'id', 'NO ACTION', 'NO ACTION', 'NONE'],
    ],
    unique: [
      'audit_event_id',
      'content_brief_revision_capacity_id',
      'failed_reservation_id',
      'failed_run_id',
      'id',
      'replacement_envelope_id',
      'workspace_id,idempotency_key',
    ],
  },
} as const;
export async function verifiedContentBriefRevisionSchema(
  db: D1Database,
): Promise<IdeaRevisionSchemaObject[] | null> {
  try {
    const objects = (
      await db
        .prepare(
          "SELECT type,name,sql FROM sqlite_master WHERE name LIKE 'content_brief_revision_%' OR name IN ('editorial_content_brief_revision_capacities','editorial_content_brief_revision_capacity_recoveries')",
        )
        .all<IdeaRevisionSchemaObject>()
    ).results;
    if (objects.length !== 39) return null;
    for (const [type, name, hash] of contentBriefRevisionDdl) {
      const o = objects.find((x) => x.name === name && x.type === type);
      if (!o?.sql || (await ideaRevisionDdlHash(o.sql)) !== hash) return null;
    }
    for (const [name, expected] of Object.entries(contentBriefRevisionStructures)) {
      const cols = (
        await db.prepare(`PRAGMA table_info('${name}')`).all<{
          cid: number;
          name: string;
          type: string;
          notnull: number;
          dflt_value: string | null;
          pk: number;
        }>()
      ).results.map((c) => [c.cid, c.name, c.type, c.notnull, c.dflt_value, c.pk]);
      const fks = (
        await db.prepare(`PRAGMA foreign_key_list('${name}')`).all<{
          id: number;
          seq: number;
          table: string;
          from: string;
          to: string;
          on_update: string;
          on_delete: string;
          match: string;
        }>()
      ).results.map((c) => [c.id, c.seq, c.table, c.from, c.to, c.on_update, c.on_delete, c.match]);
      const unique: string[] = [];
      for (const i of (
        await db
          .prepare(`PRAGMA index_list('${name}')`)
          .all<{ name: string; unique: number; partial: number }>()
      ).results) {
        if (i.unique === 1 && i.partial === 0) {
          if (!/^[A-Za-z0-9_]+$/u.test(i.name)) return null;
          unique.push(
            (await db.prepare(`PRAGMA index_info('${i.name}')`).all<{ name: string }>()).results
              .map((c) => c.name)
              .join(','),
          );
        }
      }
      if (
        JSON.stringify(cols) !== JSON.stringify(expected.columns) ||
        JSON.stringify(fks) !== JSON.stringify(expected.foreignKeys) ||
        JSON.stringify(unique.sort()) !== JSON.stringify(expected.unique)
      )
        return null;
    }
    return objects;
  } catch {
    return null;
  }
}
export async function contentBriefRevisionSchemaReady(db: D1Database) {
  return (await verifiedContentBriefRevisionSchema(db)) !== null;
}
