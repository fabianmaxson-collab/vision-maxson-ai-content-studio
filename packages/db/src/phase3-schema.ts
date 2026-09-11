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
