import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

const timestamps = {
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  version: integer('version').notNull().default(1),
};
export const workspaces = sqliteTable(
  'workspaces',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    ...timestamps,
    deletedAt: text('deleted_at'),
  },
  (t) => [uniqueIndex('workspaces_slug_uq').on(t.slug)],
);
export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    email: text('email').notNull(),
    displayName: text('display_name'),
    status: text('status', { enum: ['active', 'disabled'] })
      .notNull()
      .default('active'),
    ...timestamps,
    createdBy: text('created_by'),
    updatedBy: text('updated_by'),
    deletedAt: text('deleted_at'),
  },
  (t) => [
    uniqueIndex('users_workspace_email_uq').on(t.workspaceId, t.email),
    index('users_workspace_idx').on(t.workspaceId),
  ],
);
export const roles = sqliteTable(
  'roles',
  {
    id: text('id').primaryKey(),
    key: text('key', { enum: ['owner', 'admin', 'operator', 'viewer'] }).notNull(),
    description: text('description').notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex('roles_key_uq').on(t.key)],
);
export const userRoles = sqliteTable(
  'user_roles',
  {
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    roleId: text('role_id')
      .notNull()
      .references(() => roles.id),
    createdAt: text('created_at').notNull(),
    createdBy: text('created_by'),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.userId, t.roleId] }),
    index('user_roles_user_idx').on(t.workspaceId, t.userId),
  ],
);
export const accessIdentities = sqliteTable(
  'access_identities',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    issuer: text('issuer').notNull(),
    subject: text('subject').notNull(),
    email: text('email').notNull(),
    lastSeenAt: text('last_seen_at').notNull(),
    ...timestamps,
    deletedAt: text('deleted_at'),
  },
  (t) => [
    uniqueIndex('access_identity_issuer_subject_uq').on(t.issuer, t.subject),
    index('access_identity_user_idx').on(t.workspaceId, t.userId),
  ],
);
export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    accessSubject: text('access_subject').notNull(),
    expiresAt: text('expires_at').notNull(),
    revokedAt: text('revoked_at'),
    ...timestamps,
  },
  (t) => [index('sessions_user_idx').on(t.workspaceId, t.userId)],
);
export const applicationSettings = sqliteTable(
  'application_settings',
  {
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    key: text('key').notNull(),
    valueJson: text('value_json').notNull(),
    isPublic: integer('is_public', { mode: 'boolean' }).notNull().default(false),
    ...timestamps,
    createdBy: text('created_by'),
    updatedBy: text('updated_by'),
    deletedAt: text('deleted_at'),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.key] })],
);
export const featureFlags = sqliteTable(
  'feature_flags',
  {
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    key: text('key').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
    ...timestamps,
    createdBy: text('created_by'),
    updatedBy: text('updated_by'),
    deletedAt: text('deleted_at'),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.key] })],
);
export const auditEvents = sqliteTable(
  'audit_events',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    actorType: text('actor_type').notNull(),
    actorId: text('actor_id'),
    actorRole: text('actor_role'),
    accessIssuer: text('access_issuer'),
    accessSubject: text('access_subject'),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id'),
    outcome: text('outcome').notNull(),
    reason: text('reason'),
    requestId: text('request_id').notNull(),
    environment: text('environment').notNull(),
    metadataJson: text('metadata_json').notNull().default('{}'),
    beforeHash: text('before_hash'),
    afterHash: text('after_hash'),
    occurredAt: text('occurred_at').notNull(),
    ingestedAt: text('ingested_at').notNull(),
  },
  (t) => [
    index('audit_workspace_time_idx').on(t.workspaceId, t.occurredAt),
    index('audit_action_idx').on(t.workspaceId, t.action),
  ],
);

// Phase 2 system catalogs are global; all user-created records remain workspace-scoped.
export const platforms = sqliteTable(
  'platforms',
  {
    id: text('id').primaryKey(),
    key: text('key').notNull(),
    displayName: text('display_name').notNull(),
    status: text('status', { enum: ['active', 'inactive'] })
      .notNull()
      .default('active'),
    capabilitiesJson: text('capabilities_json').notNull().default('{}'),
    catalogVersion: integer('catalog_version').notNull().default(1),
    ...timestamps,
  },
  (t) => [uniqueIndex('platforms_key_uq').on(t.key)],
);
export const monetizationObjectives = sqliteTable(
  'monetization_objectives',
  {
    id: text('id').primaryKey(),
    key: text('key').notNull(),
    displayName: text('display_name').notNull(),
    description: text('description').notNull(),
    status: text('status', { enum: ['active', 'inactive'] })
      .notNull()
      .default('active'),
    ...timestamps,
  },
  (t) => [uniqueIndex('monetization_objectives_key_uq').on(t.key)],
);
export const contentBrands = sqliteTable(
  'content_brands',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    name: text('name').notNull(),
    normalizedName: text('normalized_name').notNull(),
    description: text('description').notNull().default(''),
    niche: text('niche').notNull().default(''),
    primaryLanguage: text('primary_language').notNull(),
    targetAudienceJson: text('target_audience_json').notNull().default('{}'),
    visualStyleJson: text('visual_style_json').notNull().default('{}'),
    defaultVoiceProfileId: text('default_voice_profile_id'),
    status: text('status', { enum: ['draft', 'active', 'archived'] })
      .notNull()
      .default('draft'),
    ...timestamps,
    createdBy: text('created_by'),
    updatedBy: text('updated_by'),
    deletedAt: text('deleted_at'),
  },
  (t) => [
    index('content_brands_workspace_idx').on(t.workspaceId),
    uniqueIndex('content_brands_name_schema_uq').on(t.workspaceId, t.normalizedName),
  ],
);
export const channelProfiles = sqliteTable(
  'channel_profiles',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    contentBrandId: text('content_brand_id')
      .notNull()
      .references(() => contentBrands.id),
    name: text('name').notNull(),
    normalizedName: text('normalized_name').notNull(),
    primaryLanguage: text('primary_language').notNull(),
    secondaryLanguagesJson: text('secondary_languages_json').notNull().default('[]'),
    narrativeTone: text('narrative_tone').notNull().default(''),
    editorialStrategyJson: text('editorial_strategy_json').notNull().default('{}'),
    shortDurationMinSeconds: integer('short_duration_min_seconds'),
    shortDurationMaxSeconds: integer('short_duration_max_seconds'),
    defaultVoiceProfileId: text('default_voice_profile_id'),
    readinessStatus: text('readiness_status', { enum: ['draft', 'configured', 'production_ready'] })
      .notNull()
      .default('draft'),
    ...timestamps,
    createdBy: text('created_by'),
    updatedBy: text('updated_by'),
    deletedAt: text('deleted_at'),
  },
  (t) => [index('channel_profiles_workspace_brand_idx').on(t.workspaceId, t.contentBrandId)],
);
export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    contentBrandId: text('content_brand_id')
      .notNull()
      .references(() => contentBrands.id),
    channelProfileId: text('channel_profile_id')
      .notNull()
      .references(() => channelProfiles.id),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    format: text('format', { enum: ['SHORT', 'LONG_FORM'] }).notNull(),
    operatingMode: text('operating_mode', { enum: ['MANUAL', 'ASSISTED', 'AUTONOMOUS'] })
      .notNull()
      .default('ASSISTED'),
    status: text('status').notNull().default('DRAFT'),
    primaryLanguage: text('primary_language').notNull(),
    readinessStatus: text('readiness_status', { enum: ['configuring', 'ready'] })
      .notNull()
      .default('configuring'),
    archivedAt: text('archived_at'),
    ...timestamps,
    createdBy: text('created_by'),
    updatedBy: text('updated_by'),
    deletedAt: text('deleted_at'),
  },
  (t) => [index('projects_workspace_status_idx').on(t.workspaceId, t.status)],
);
export const projectVariants = sqliteTable(
  'project_variants',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    projectTargetId: text('project_target_id'),
    platformId: text('platform_id'),
    variantKind: text('variant_kind', { enum: ['MASTER', 'PLATFORM'] }).notNull(),
    sourceVariantId: text('source_variant_id'),
    status: text('status').notNull().default('defined'),
    aspectRatio: text('aspect_ratio'),
    width: integer('width'),
    height: integer('height'),
    durationSeconds: integer('duration_seconds'),
    adaptationReason: text('adaptation_reason'),
    ...timestamps,
    createdBy: text('created_by'),
    updatedBy: text('updated_by'),
    deletedAt: text('deleted_at'),
  },
  (t) => [index('project_variants_project_idx').on(t.workspaceId, t.projectId)],
);
