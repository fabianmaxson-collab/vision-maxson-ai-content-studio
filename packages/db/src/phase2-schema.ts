import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import {
  monetizationObjectives,
  platforms,
  projects,
  projectVariants,
  users,
  workspaces,
  channelProfiles,
} from './schema';

const mutable = {
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  version: integer('version').notNull().default(1),
};
const actorMutable = {
  ...mutable,
  createdBy: text('created_by').references(() => users.id),
  updatedBy: text('updated_by').references(() => users.id),
  deletedAt: text('deleted_at'),
};

export const platformMonetizationPrograms = sqliteTable(
  'platform_monetization_programs',
  {
    id: text('id').primaryKey(),
    platformId: text('platform_id')
      .notNull()
      .references(() => platforms.id),
    key: text('key').notNull(),
    displayName: text('display_name').notNull(),
    status: text('status').notNull().default('active'),
    ...mutable,
  },
  (t) => [uniqueIndex('platform_program_key_uq').on(t.platformId, t.key)],
);
export const platformMonetizationRuleVersions = sqliteTable(
  'platform_monetization_rule_versions',
  {
    id: text('id').primaryKey(),
    programId: text('program_id')
      .notNull()
      .references(() => platformMonetizationPrograms.id),
    ruleVersion: integer('rule_version').notNull(),
    contentFormat: text('content_format').notNull(),
    minimumDurationSeconds: integer('minimum_duration_seconds'),
    maximumDurationSeconds: integer('maximum_duration_seconds'),
    constraintsJson: text('constraints_json').notNull().default('{}'),
    verificationStatus: text('verification_status').notNull().default('unverified'),
    sourceLabel: text('source_label'),
    sourceUrl: text('source_url'),
    verifiedAt: text('verified_at'),
    reviewAfter: text('review_after'),
    effectiveFrom: text('effective_from').notNull(),
    effectiveTo: text('effective_to'),
    createdAt: text('created_at').notNull(),
    createdBy: text('created_by'),
  },
  (t) => [uniqueIndex('platform_rule_version_uq').on(t.programId, t.ruleVersion, t.contentFormat)],
);
export const platformStrategyRuleVersions = sqliteTable(
  'platform_strategy_rule_versions',
  {
    id: text('id').primaryKey(),
    platformId: text('platform_id')
      .notNull()
      .references(() => platforms.id),
    objectiveId: text('objective_id')
      .notNull()
      .references(() => monetizationObjectives.id),
    sourcePlatformRuleId: text('source_platform_rule_id').references(
      () => platformMonetizationRuleVersions.id,
    ),
    strategyVersion: integer('strategy_version').notNull(),
    contentFormat: text('content_format').notNull(),
    priority: integer('priority').notNull(),
    safetyMarginSeconds: integer('safety_margin_seconds'),
    preferredMinSeconds: integer('preferred_min_seconds'),
    preferredMaxSeconds: integer('preferred_max_seconds'),
    rationale: text('rationale').notNull(),
    effectiveFrom: text('effective_from').notNull(),
    effectiveTo: text('effective_to'),
    createdAt: text('created_at').notNull(),
    createdBy: text('created_by'),
  },
  (t) => [
    uniqueIndex('strategy_rule_version_uq').on(
      t.platformId,
      t.objectiveId,
      t.contentFormat,
      t.strategyVersion,
    ),
  ],
);

export const voiceProfiles = sqliteTable(
  'voice_profiles',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    name: text('name').notNull(),
    primaryLanguage: text('primary_language').notNull(),
    provider: text('provider'),
    providerVoiceRef: text('provider_voice_ref'),
    configurationJson: text('configuration_json').notNull().default('{}'),
    status: text('status').notNull().default('active'),
    ...actorMutable,
  },
  (t) => [
    uniqueIndex('voice_profiles_name_uq')
      .on(t.workspaceId, t.name)
      .where(sql`deleted_at IS NULL`),
  ],
);
export const characterProfiles = sqliteTable(
  'character_profiles',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    status: text('status').notNull().default('active'),
    ...actorMutable,
  },
  (t) => [
    uniqueIndex('character_profiles_name_uq')
      .on(t.workspaceId, t.name)
      .where(sql`deleted_at IS NULL`),
  ],
);
export const characterProfileVersions = sqliteTable(
  'character_profile_versions',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    characterProfileId: text('character_profile_id')
      .notNull()
      .references(() => characterProfiles.id),
    versionNumber: integer('version_number').notNull(),
    definitionJson: text('definition_json').notNull(),
    createdAt: text('created_at').notNull(),
    createdBy: text('created_by').references(() => users.id),
  },
  (t) => [uniqueIndex('character_profile_versions_uq').on(t.characterProfileId, t.versionNumber)],
);
export const channelProfilePlatforms = sqliteTable(
  'channel_profile_platforms',
  {
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    channelProfileId: text('channel_profile_id')
      .notNull()
      .references(() => channelProfiles.id),
    platformId: text('platform_id')
      .notNull()
      .references(() => platforms.id),
    priority: integer('priority').notNull(),
    preferencesJson: text('preferences_json').notNull().default('{}'),
    createdAt: text('created_at').notNull(),
    createdBy: text('created_by').references(() => users.id),
  },
  (t) => [primaryKey({ columns: [t.channelProfileId, t.platformId] })],
);
export const channelProfileCharacters = sqliteTable(
  'channel_profile_characters',
  {
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    channelProfileId: text('channel_profile_id')
      .notNull()
      .references(() => channelProfiles.id),
    characterProfileId: text('character_profile_id')
      .notNull()
      .references(() => characterProfiles.id),
    createdAt: text('created_at').notNull(),
    createdBy: text('created_by').references(() => users.id),
  },
  (t) => [primaryKey({ columns: [t.channelProfileId, t.characterProfileId] })],
);
export const channelBibles = sqliteTable(
  'channel_bibles',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    channelProfileId: text('channel_profile_id')
      .notNull()
      .references(() => channelProfiles.id),
    status: text('status').notNull().default('draft'),
    contentJson: text('content_json').notNull().default('{}'),
    ...actorMutable,
  },
  (t) => [
    uniqueIndex('channel_bibles_current_uq')
      .on(t.channelProfileId)
      .where(sql`deleted_at IS NULL`),
  ],
);
export const socialAccounts = sqliteTable(
  'social_accounts',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    channelProfileId: text('channel_profile_id')
      .notNull()
      .references(() => channelProfiles.id),
    platformId: text('platform_id')
      .notNull()
      .references(() => platforms.id),
    displayName: text('display_name').notNull(),
    handle: text('handle'),
    externalAccountId: text('external_account_id'),
    connectionStatus: text('connection_status').notNull().default('not_connected'),
    connectionMethod: text('connection_method').notNull().default('manual_reference'),
    capabilitiesJson: text('capabilities_json').notNull().default('{}'),
    lastConnectionCheckAt: text('last_connection_check_at'),
    ...actorMutable,
  },
  (t) => [
    uniqueIndex('social_accounts_external_uq')
      .on(t.workspaceId, t.platformId, t.externalAccountId)
      .where(sql`external_account_id IS NOT NULL AND deleted_at IS NULL`),
    index('social_accounts_channel_idx')
      .on(t.workspaceId, t.channelProfileId, t.platformId)
      .where(sql`deleted_at IS NULL`),
  ],
);
export const socialAccountMonetizationStatuses = sqliteTable(
  'social_account_monetization_statuses',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    socialAccountId: text('social_account_id')
      .notNull()
      .references(() => socialAccounts.id),
    programId: text('program_id')
      .notNull()
      .references(() => platformMonetizationPrograms.id),
    status: text('status').notNull(),
    region: text('region'),
    sourceType: text('source_type').notNull(),
    evidenceJson: text('evidence_json').notNull().default('{}'),
    effectiveFrom: text('effective_from').notNull(),
    effectiveTo: text('effective_to'),
    reviewedAt: text('reviewed_at'),
    createdAt: text('created_at').notNull(),
    createdBy: text('created_by').references(() => users.id),
  },
  (t) => [
    uniqueIndex('social_account_monetization_current_uq')
      .on(t.socialAccountId, t.programId)
      .where(sql`effective_to IS NULL`),
  ],
);

export const projectObjectives = sqliteTable(
  'project_objectives',
  {
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    objectiveId: text('objective_id')
      .notNull()
      .references(() => monetizationObjectives.id),
    isPrimary: integer('is_primary', { mode: 'boolean' }).notNull().default(false),
    priority: integer('priority').notNull(),
    createdAt: text('created_at').notNull(),
    createdBy: text('created_by').references(() => users.id),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.objectiveId] }),
    uniqueIndex('project_primary_objective_uq')
      .on(t.projectId)
      .where(sql`is_primary=1`),
  ],
);
export const projectTargets = sqliteTable(
  'project_targets',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    platformId: text('platform_id')
      .notNull()
      .references(() => platforms.id),
    socialAccountId: text('social_account_id').references(() => socialAccounts.id),
    priority: integer('priority').notNull(),
    readinessStatus: text('readiness_status').notNull().default('not_connected'),
    ...actorMutable,
  },
  (t) => [
    uniqueIndex('project_target_platform_uq')
      .on(t.projectId, t.platformId)
      .where(sql`social_account_id IS NULL AND deleted_at IS NULL`),
    uniqueIndex('project_target_account_uq')
      .on(t.projectId, t.socialAccountId)
      .where(sql`social_account_id IS NOT NULL AND deleted_at IS NULL`),
  ],
);
export const languageVariants = sqliteTable(
  'language_variants',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    projectVariantId: text('project_variant_id')
      .notNull()
      .references(() => projectVariants.id),
    languageCode: text('language_code').notNull(),
    voiceProfileId: text('voice_profile_id').references(() => voiceProfiles.id),
    status: text('status').notNull().default('defined'),
    ...actorMutable,
  },
  (t) => [
    uniqueIndex('language_variants_uq')
      .on(t.projectVariantId, t.languageCode)
      .where(sql`deleted_at IS NULL`),
  ],
);
export const projectParameters = sqliteTable(
  'project_parameters',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    scopeType: text('scope_type').notNull(),
    scopeId: text('scope_id').notNull(),
    parameterKey: text('parameter_key').notNull(),
    policyMode: text('policy_mode').notNull(),
    requestedValueJson: text('requested_value_json'),
    effectiveValueJson: text('effective_value_json'),
    recommendationJson: text('recommendation_json'),
    recommendationSource: text('recommendation_source'),
    recommendationRuleVersion: text('recommendation_rule_version'),
    deviationReason: text('deviation_reason'),
    ...actorMutable,
  },
  (t) => [
    uniqueIndex('project_parameters_scope_uq')
      .on(t.scopeType, t.scopeId, t.parameterKey)
      .where(sql`deleted_at IS NULL`),
  ],
);
export const projectParameterRevisions = sqliteTable(
  'project_parameter_revisions',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    projectParameterId: text('project_parameter_id')
      .notNull()
      .references(() => projectParameters.id),
    revisionNumber: integer('revision_number').notNull(),
    snapshotJson: text('snapshot_json').notNull(),
    changedAt: text('changed_at').notNull(),
    changedBy: text('changed_by').references(() => users.id),
  },
  (t) => [uniqueIndex('project_parameter_revisions_uq').on(t.projectParameterId, t.revisionNumber)],
);
export const projectDependencies = sqliteTable(
  'project_dependencies',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    parentProjectId: text('parent_project_id')
      .notNull()
      .references(() => projects.id),
    childProjectId: text('child_project_id')
      .notNull()
      .references(() => projects.id),
    relationshipType: text('relationship_type').notNull(),
    createdAt: text('created_at').notNull(),
    createdBy: text('created_by').references(() => users.id),
  },
  (t) => [
    uniqueIndex('project_dependencies_uq').on(
      t.parentProjectId,
      t.childProjectId,
      t.relationshipType,
    ),
  ],
);
export const monetizationEligibilityAssessments = sqliteTable(
  'monetization_eligibility_assessments',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    projectTargetId: text('project_target_id')
      .notNull()
      .references(() => projectTargets.id),
    platformRuleId: text('platform_rule_id').references(() => platformMonetizationRuleVersions.id),
    strategyRuleId: text('strategy_rule_id').references(() => platformStrategyRuleVersions.id),
    publishable: integer('publishable', { mode: 'boolean' }).notNull(),
    programRuleMatch: integer('program_rule_match', { mode: 'boolean' }),
    accountEligible: integer('account_eligible', { mode: 'boolean' }),
    monetizationEligible: integer('monetization_eligible', { mode: 'boolean' }),
    reasonsJson: text('reasons_json').notNull().default('[]'),
    inputsJson: text('inputs_json').notNull().default('{}'),
    evaluatedAt: text('evaluated_at').notNull(),
    createdBy: text('created_by').references(() => users.id),
  },
  (t) => [index('eligibility_project_idx').on(t.workspaceId, t.projectId, t.evaluatedAt)],
);
export const opportunityAssessments = sqliteTable('opportunity_assessments', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id),
  projectTargetId: text('project_target_id').references(() => projectTargets.id),
  score: real('score'),
  expectedRevenue: real('expected_revenue'),
  inputsJson: text('inputs_json').notNull().default('{}'),
  explanationJson: text('explanation_json').notNull().default('{}'),
  modelVersion: text('model_version').notNull(),
  assessedAt: text('assessed_at').notNull(),
  createdBy: text('created_by').references(() => users.id),
});
