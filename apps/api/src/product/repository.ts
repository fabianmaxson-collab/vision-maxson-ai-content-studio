import {
  canTransitionProject,
  evaluateEligibility,
  newId,
  projectStatuses,
  type ProjectStatus,
} from '@vision-maxson/domain';

export interface Actor {
  id: string;
  workspaceId: string;
  email: string;
  roles: string[];
}

export interface ProjectTransitionAuditContext {
  requestId: string;
  environment: string;
  accessIssuer: string;
  accessSubject: string;
}
const now = () => new Date().toISOString();
const normalize = (value: string) => value.trim().toLocaleLowerCase('en-US');

export class ProductRepository {
  constructor(
    private readonly db: D1Database,
    private readonly actor: Actor,
  ) {}

  async listCatalogs() {
    const [platforms, objectives, strategies] = await Promise.all([
      this.db
        .prepare(
          `SELECT id,key,display_name AS displayName,capabilities_json AS capabilitiesJson FROM platforms WHERE status='active' ORDER BY display_name`,
        )
        .all(),
      this.db
        .prepare(
          `SELECT id,key,display_name AS displayName,description FROM monetization_objectives WHERE status='active' ORDER BY display_name`,
        )
        .all(),
      this.db
        .prepare(
          `SELECT s.id,p.key AS platform,o.key AS objective,s.content_format AS contentFormat,s.priority,s.safety_margin_seconds AS safetyMarginSeconds,s.preferred_min_seconds AS preferredMinSeconds,s.preferred_max_seconds AS preferredMaxSeconds,s.rationale,s.strategy_version AS strategyVersion,s.source_platform_rule_id AS sourcePlatformRuleId FROM platform_strategy_rule_versions s JOIN platforms p ON p.id=s.platform_id JOIN monetization_objectives o ON o.id=s.objective_id WHERE s.effective_to IS NULL ORDER BY s.content_format,s.priority`,
        )
        .all(),
    ]);
    return {
      platforms: platforms.results,
      objectives: objectives.results,
      strategyDefaults: strategies.results,
    };
  }

  async listBrands() {
    return (
      await this.db
        .prepare(
          `SELECT id,name,description,niche,primary_language AS primaryLanguage,status,version,updated_at AS updatedAt FROM content_brands WHERE workspace_id=? AND deleted_at IS NULL ORDER BY updated_at DESC,id`,
        )
        .bind(this.actor.workspaceId)
        .all()
    ).results;
  }
  async createBrand(input: {
    name: string;
    description: string;
    niche: string;
    primaryLanguage: string;
    targetAudience: unknown;
    visualStyle: unknown;
    defaultVoiceProfileId: string | null;
  }) {
    if (input.defaultVoiceProfileId) {
      const voice = await this.db
        .prepare(
          `SELECT id FROM voice_profiles WHERE id=? AND workspace_id=? AND deleted_at IS NULL`,
        )
        .bind(input.defaultVoiceProfileId, this.actor.workspaceId)
        .first();
      if (!voice) throw new Error('voice_profile_not_found');
    }
    const id = newId('brand'),
      at = now();
    await this.db
      .prepare(
        `INSERT INTO content_brands(id,workspace_id,name,normalized_name,description,niche,primary_language,target_audience_json,visual_style_json,default_voice_profile_id,status,created_at,updated_at,version,created_by,updated_by) VALUES(?,?,?,?,?,?,?,?,?,?,'draft',?,?,1,?,?)`,
      )
      .bind(
        id,
        this.actor.workspaceId,
        input.name,
        normalize(input.name),
        input.description,
        input.niche,
        input.primaryLanguage,
        JSON.stringify(input.targetAudience),
        JSON.stringify(input.visualStyle),
        input.defaultVoiceProfileId,
        at,
        at,
        this.actor.id,
        this.actor.id,
      )
      .run();
    return { id, version: 1 };
  }
  async archiveBrand(id: string, version: number) {
    const at = now();
    return this.db
      .prepare(
        `UPDATE content_brands SET status='archived',deleted_at=?,updated_at=?,updated_by=?,version=version+1 WHERE id=? AND workspace_id=? AND deleted_at IS NULL AND version=?`,
      )
      .bind(at, at, this.actor.id, id, this.actor.workspaceId, version)
      .run();
  }

  async listChannels(brandId?: string) {
    const sql = `SELECT c.id,c.content_brand_id AS contentBrandId,c.name,c.primary_language AS primaryLanguage,c.readiness_status AS readinessStatus,c.version,c.updated_at AS updatedAt FROM channel_profiles c JOIN content_brands b ON b.id=c.content_brand_id AND b.workspace_id=c.workspace_id AND b.deleted_at IS NULL WHERE c.workspace_id=? AND c.deleted_at IS NULL${brandId ? ' AND c.content_brand_id=?' : ''} ORDER BY c.updated_at DESC,c.id`;
    const statement = this.db.prepare(sql);
    return (
      await (
        brandId
          ? statement.bind(this.actor.workspaceId, brandId)
          : statement.bind(this.actor.workspaceId)
      ).all()
    ).results;
  }
  async createChannel(
    brandId: string,
    input: {
      name: string;
      primaryLanguage: string;
      secondaryLanguages: string[];
      narrativeTone: string;
      shortDurationMinSeconds: number | null;
      shortDurationMaxSeconds: number | null;
      strategy: unknown;
    },
  ) {
    const brand = await this.db
      .prepare(`SELECT id FROM content_brands WHERE id=? AND workspace_id=? AND deleted_at IS NULL`)
      .bind(brandId, this.actor.workspaceId)
      .first();
    if (!brand) throw new Error('brand_not_found');
    const id = newId('channel'),
      at = now();
    await this.db
      .prepare(
        `INSERT INTO channel_profiles(id,workspace_id,content_brand_id,name,normalized_name,primary_language,secondary_languages_json,narrative_tone,editorial_strategy_json,short_duration_min_seconds,short_duration_max_seconds,readiness_status,created_at,updated_at,version,created_by,updated_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,'draft',?,?,1,?,?)`,
      )
      .bind(
        id,
        this.actor.workspaceId,
        brandId,
        input.name,
        normalize(input.name),
        input.primaryLanguage,
        JSON.stringify(input.secondaryLanguages),
        input.narrativeTone,
        JSON.stringify(input.strategy),
        input.shortDurationMinSeconds,
        input.shortDurationMaxSeconds,
        at,
        at,
        this.actor.id,
        this.actor.id,
      )
      .run();
    return { id, version: 1 };
  }

  async listVoiceProfiles() {
    return (
      await this.db
        .prepare(
          `SELECT id,name,primary_language AS primaryLanguage,status,version FROM voice_profiles WHERE workspace_id=? AND deleted_at IS NULL ORDER BY name`,
        )
        .bind(this.actor.workspaceId)
        .all()
    ).results;
  }
  async createVoiceProfile(input: {
    name: string;
    primaryLanguage: string;
    configuration: unknown;
  }) {
    const id = newId('voice'),
      at = now();
    await this.db
      .prepare(
        `INSERT INTO voice_profiles(id,workspace_id,name,primary_language,configuration_json,status,created_at,updated_at,version,created_by,updated_by) VALUES(?,?,?,?,?,'active',?,?,1,?,?)`,
      )
      .bind(
        id,
        this.actor.workspaceId,
        input.name,
        input.primaryLanguage,
        JSON.stringify(input.configuration),
        at,
        at,
        this.actor.id,
        this.actor.id,
      )
      .run();
    return { id, version: 1 };
  }
  async listCharacterProfiles() {
    return (
      await this.db
        .prepare(
          `SELECT id,name,description,status,version FROM character_profiles WHERE workspace_id=? AND deleted_at IS NULL ORDER BY name`,
        )
        .bind(this.actor.workspaceId)
        .all()
    ).results;
  }
  async createCharacterProfile(input: { name: string; description: string }) {
    const id = newId('character'),
      at = now();
    await this.db
      .prepare(
        `INSERT INTO character_profiles(id,workspace_id,name,description,status,created_at,updated_at,version,created_by,updated_by) VALUES(?,?,?,?,'active',?,?,1,?,?)`,
      )
      .bind(
        id,
        this.actor.workspaceId,
        input.name,
        input.description,
        at,
        at,
        this.actor.id,
        this.actor.id,
      )
      .run();
    return { id, version: 1 };
  }
  async createCharacterVersion(profileId: string, definition: unknown) {
    const profile = await this.db
      .prepare(
        `SELECT id FROM character_profiles WHERE id=? AND workspace_id=? AND deleted_at IS NULL`,
      )
      .bind(profileId, this.actor.workspaceId)
      .first();
    if (!profile) throw new Error('character_not_found');
    const row = await this.db
        .prepare(
          `SELECT coalesce(max(version_number),0)+1 AS next FROM character_profile_versions WHERE character_profile_id=?`,
        )
        .bind(profileId)
        .first<{ next: number }>(),
      versionNumber = row?.next ?? 1,
      id = newId('character_version');
    await this.db
      .prepare(
        `INSERT INTO character_profile_versions(id,workspace_id,character_profile_id,version_number,definition_json,created_at,created_by) VALUES(?,?,?,?,?,?,?)`,
      )
      .bind(
        id,
        this.actor.workspaceId,
        profileId,
        versionNumber,
        JSON.stringify(definition),
        now(),
        this.actor.id,
      )
      .run();
    return { id, versionNumber };
  }

  async listSocialAccounts() {
    return (
      await this.db
        .prepare(
          `SELECT a.id,a.display_name AS displayName,a.handle,a.connection_status AS connectionStatus,a.connection_method AS connectionMethod,p.display_name AS platform,c.name AS channelName,a.version FROM social_accounts a JOIN platforms p ON p.id=a.platform_id JOIN channel_profiles c ON c.id=a.channel_profile_id WHERE a.workspace_id=? AND a.deleted_at IS NULL ORDER BY a.updated_at DESC,a.id`,
        )
        .bind(this.actor.workspaceId)
        .all()
    ).results;
  }
  async createSocialAccount(input: {
    channelProfileId: string;
    platformId: string;
    displayName: string;
    handle: string | null;
    externalAccountId: string | null;
  }) {
    const valid = await this.db
      .prepare(
        `SELECT c.id FROM channel_profiles c JOIN platforms p ON p.id=? AND p.status='active' WHERE c.id=? AND c.workspace_id=? AND c.deleted_at IS NULL`,
      )
      .bind(input.platformId, input.channelProfileId, this.actor.workspaceId)
      .first();
    if (!valid) throw new Error('relationship_not_found');
    const id = newId('social'),
      at = now();
    await this.db
      .prepare(
        `INSERT INTO social_accounts(id,workspace_id,channel_profile_id,platform_id,display_name,handle,external_account_id,connection_status,connection_method,created_at,updated_at,version,created_by,updated_by) VALUES(?,?,?,?,?,?,?,'not_connected','manual_reference',?,?,1,?,?)`,
      )
      .bind(
        id,
        this.actor.workspaceId,
        input.channelProfileId,
        input.platformId,
        input.displayName,
        input.handle,
        input.externalAccountId,
        at,
        at,
        this.actor.id,
        this.actor.id,
      )
      .run();
    return { id, connectionStatus: 'not_connected', version: 1 };
  }

  async listProjects() {
    return (
      await this.db
        .prepare(
          `SELECT p.id,p.title,p.format,p.operating_mode AS operatingMode,p.status,p.readiness_status AS readinessStatus,p.primary_language AS primaryLanguage,p.version,p.updated_at AS updatedAt,b.name AS brandName,c.name AS channelName FROM projects p JOIN content_brands b ON b.id=p.content_brand_id JOIN channel_profiles c ON c.id=p.channel_profile_id WHERE p.workspace_id=? AND p.deleted_at IS NULL ORDER BY p.updated_at DESC,p.id`,
        )
        .bind(this.actor.workspaceId)
        .all()
    ).results;
  }
  async getProject(id: string) {
    const project = await this.db
      .prepare(
        `SELECT id,title,description,format,operating_mode AS operatingMode,status,readiness_status AS readinessStatus,primary_language AS primaryLanguage,version,archived_at AS archivedAt FROM projects WHERE id=? AND workspace_id=? AND deleted_at IS NULL`,
      )
      .bind(id, this.actor.workspaceId)
      .first();
    if (!project) return null;
    const [targets, variants, objectives] = await Promise.all([
      this.db
        .prepare(
          `SELECT t.id,p.key AS platform,t.social_account_id AS socialAccountId,t.readiness_status AS readinessStatus,t.priority FROM project_targets t JOIN platforms p ON p.id=t.platform_id WHERE t.project_id=? AND t.workspace_id=? AND t.deleted_at IS NULL ORDER BY t.priority`,
        )
        .bind(id, this.actor.workspaceId)
        .all(),
      this.db
        .prepare(
          `SELECT id,variant_kind AS variantKind,source_variant_id AS sourceVariantId,platform_id AS platformId,status,adaptation_reason AS adaptationReason FROM project_variants WHERE project_id=? AND workspace_id=? AND deleted_at IS NULL`,
        )
        .bind(id, this.actor.workspaceId)
        .all(),
      this.db
        .prepare(
          `SELECT o.key,o.display_name AS displayName,po.is_primary AS isPrimary FROM project_objectives po JOIN monetization_objectives o ON o.id=po.objective_id WHERE po.project_id=? AND po.workspace_id=? ORDER BY po.priority`,
        )
        .bind(id, this.actor.workspaceId)
        .all(),
    ]);
    return {
      project,
      targets: targets.results,
      variants: variants.results,
      objectives: objectives.results,
    };
  }
  async transitionProject(
    id: string,
    targetStatus: string,
    expectedVersion: number,
    auditContext: ProjectTransitionAuditContext,
  ) {
    if (!projectStatuses.includes(targetStatus as ProjectStatus)) {
      throw new Error('project_status_invalid');
    }

    const project = await this.db
      .prepare(
        `SELECT status,version,readiness_status AS readinessStatus FROM projects WHERE id=? AND workspace_id=? AND deleted_at IS NULL`,
      )
      .bind(id, this.actor.workspaceId)
      .first<{ status: ProjectStatus; version: number; readinessStatus: string }>();
    if (!project) throw new Error('project_not_found');
    if (project.version !== expectedVersion) throw new Error('project_transition_conflict');

    const nextStatus = targetStatus as ProjectStatus;
    if (!canTransitionProject(project.status, nextStatus)) {
      throw new Error('project_transition_invalid');
    }

    const auditEventId = newId('audit');
    const at = now();
    const actorRole = this.actor.roles[0] ?? 'owner';
    const metadata = JSON.stringify({
      fromStatus: project.status,
      toStatus: nextStatus,
      fromVersion: expectedVersion,
      toVersion: expectedVersion + 1,
    });
    const results = await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO audit_events(id,workspace_id,actor_type,actor_id,actor_role,access_issuer,access_subject,action,resource_type,resource_id,outcome,request_id,environment,metadata_json,occurred_at,ingested_at) SELECT ?,workspace_id,'user',?,?,?,?,'project.lifecycle_transitioned','project',id,'success',?,?,?,?,? FROM projects WHERE id=? AND workspace_id=? AND deleted_at IS NULL AND status=? AND version=?`,
        )
        .bind(
          auditEventId,
          this.actor.id,
          actorRole,
          auditContext.accessIssuer,
          auditContext.accessSubject,
          auditContext.requestId,
          auditContext.environment,
          metadata,
          at,
          at,
          id,
          this.actor.workspaceId,
          project.status,
          expectedVersion,
        ),
      this.db
        .prepare(
          `UPDATE projects SET status=?,updated_at=?,updated_by=?,version=version+1 WHERE id=? AND workspace_id=? AND deleted_at IS NULL AND status=? AND version=?`,
        )
        .bind(
          nextStatus,
          at,
          this.actor.id,
          id,
          this.actor.workspaceId,
          project.status,
          expectedVersion,
        ),
    ]);
    if (results[0]?.meta.changes !== 1 || results[1]?.meta.changes !== 1) {
      throw new Error('project_transition_conflict');
    }
    return {
      id,
      previousStatus: project.status,
      status: nextStatus,
      readinessStatus: project.readinessStatus,
      version: expectedVersion + 1,
      auditEventId,
    };
  }

  async evaluateProject(id: string) {
    const project = await this.db
      .prepare(`SELECT id FROM projects WHERE id=? AND workspace_id=? AND deleted_at IS NULL`)
      .bind(id, this.actor.workspaceId)
      .first();
    if (!project) return null;
    const targets = await this.db
      .prepare(
        `SELECT t.id,p.key AS platform,(SELECT CASE WHEN s.status IN ('eligible','enrolled') THEN 1 WHEN s.status IN ('not_eligible','suspended','restricted','not_applicable') THEN 0 ELSE NULL END FROM social_account_monetization_statuses s WHERE s.social_account_id=t.social_account_id AND s.effective_to IS NULL ORDER BY s.effective_from DESC LIMIT 1) AS accountEligible FROM project_targets t JOIN platforms p ON p.id=t.platform_id WHERE t.project_id=? AND t.workspace_id=? AND t.deleted_at IS NULL ORDER BY t.priority`,
      )
      .bind(id, this.actor.workspaceId)
      .all<{ id: string; platform: string; accountEligible: number | null }>();
    return {
      items: targets.results.map((t) => ({
        ...t,
        ...evaluateEligibility({
          publishable: true,
          programRuleMatch: null,
          accountEligible: t.accountEligible === null ? null : t.accountEligible === 1,
        }),
        explanation:
          'Program-rule match is unknown until duration and a verified active rule are available.',
      })),
    };
  }
  async opportunity(id: string) {
    const project = await this.db
      .prepare(`SELECT id FROM projects WHERE id=? AND workspace_id=? AND deleted_at IS NULL`)
      .bind(id, this.actor.workspaceId)
      .first();
    return project
      ? {
          score: null,
          expectedRevenue: null,
          inputs: {
            accountPerformance: { value: null, provenance: 'unknown' },
            revenueRate: { value: null, provenance: 'unknown' },
          },
          explanation: 'Critical observed or approved inputs are unavailable.',
        }
      : null;
  }
  async deriveShort(
    parentId: string,
    input: {
      title: string;
      primaryLanguage: string;
      objectiveIds: string[];
      targetPlatformIds: string[];
    },
  ) {
    const parent = await this.db
      .prepare(
        `SELECT content_brand_id AS contentBrandId,channel_profile_id AS channelProfileId,format FROM projects WHERE id=? AND workspace_id=? AND deleted_at IS NULL`,
      )
      .bind(parentId, this.actor.workspaceId)
      .first<{ contentBrandId: string; channelProfileId: string; format: string }>();
    if (!parent || parent.format !== 'LONG_FORM')
      throw new Error('only_long_form_can_derive_short');
    const child = await this.createProject({
      ...input,
      contentBrandId: parent.contentBrandId,
      channelProfileId: parent.channelProfileId,
      description: `Derived from ${parentId}`,
      format: 'SHORT',
      operatingMode: 'ASSISTED',
    });
    await this.db
      .prepare(
        `INSERT INTO project_dependencies(id,workspace_id,parent_project_id,child_project_id,relationship_type,created_at,created_by) VALUES(?,?,?,?,'LONG_FORM_TO_SHORT',?,?)`,
      )
      .bind(newId('dependency'), this.actor.workspaceId, parentId, child.id, now(), this.actor.id)
      .run();
    return child;
  }
  async createProject(input: {
    contentBrandId: string;
    channelProfileId: string;
    title: string;
    description: string;
    format: 'SHORT' | 'LONG_FORM';
    primaryLanguage: string;
    objectiveIds: string[];
    targetPlatformIds: string[];
    operatingMode: 'MANUAL' | 'ASSISTED' | 'AUTONOMOUS';
  }) {
    const relation = await this.db
      .prepare(
        `SELECT c.id FROM channel_profiles c JOIN content_brands b ON b.id=c.content_brand_id AND b.workspace_id=c.workspace_id WHERE b.id=? AND c.id=? AND c.workspace_id=? AND b.deleted_at IS NULL AND c.deleted_at IS NULL`,
      )
      .bind(input.contentBrandId, input.channelProfileId, this.actor.workspaceId)
      .first();
    if (!relation) throw new Error('relationship_not_found');
    const catalogChecks = await Promise.all([
      ...input.objectiveIds.map((id) =>
        this.db
          .prepare(`SELECT id FROM monetization_objectives WHERE id=? AND status='active'`)
          .bind(id)
          .first(),
      ),
      ...input.targetPlatformIds.map((id) =>
        this.db
          .prepare(
            `SELECT id,capabilities_json AS capabilitiesJson FROM platforms WHERE id=? AND status='active'`,
          )
          .bind(id)
          .first<{ id: string; capabilitiesJson: string }>(),
      ),
    ]);
    if (catalogChecks.some((value) => !value)) throw new Error('catalog_item_not_found');
    const platforms = catalogChecks.slice(input.objectiveIds.length) as Array<{
      id: string;
      capabilitiesJson: string;
    }>;
    if (
      platforms.some((platform) => {
        const capabilities = JSON.parse(platform.capabilitiesJson) as {
          short?: boolean;
          longForm?: boolean;
        };
        return input.format === 'SHORT' ? !capabilities.short : !capabilities.longForm;
      })
    )
      throw new Error('platform_format_not_publishable');
    const projectId = newId('project'),
      masterId = newId('variant'),
      at = now();
    const statements = [
      this.db
        .prepare(
          `INSERT INTO projects(id,workspace_id,content_brand_id,channel_profile_id,title,description,format,operating_mode,status,primary_language,readiness_status,created_at,updated_at,version,created_by,updated_by) VALUES(?,?,?,?,?,?,?,?,'DRAFT',?,'ready',?,?,1,?,?)`,
        )
        .bind(
          projectId,
          this.actor.workspaceId,
          input.contentBrandId,
          input.channelProfileId,
          input.title,
          input.description,
          input.format,
          input.operatingMode,
          input.primaryLanguage,
          at,
          at,
          this.actor.id,
          this.actor.id,
        ),
      this.db
        .prepare(
          `INSERT INTO project_variants(id,workspace_id,project_id,variant_kind,status,created_at,updated_at,version,created_by,updated_by) VALUES(?,?,?,'MASTER','defined',?,?,1,?,?)`,
        )
        .bind(masterId, this.actor.workspaceId, projectId, at, at, this.actor.id, this.actor.id),
    ];
    input.objectiveIds.forEach((objectiveId, i) =>
      statements.push(
        this.db
          .prepare(
            `INSERT INTO project_objectives(workspace_id,project_id,objective_id,is_primary,priority,created_at,created_by) SELECT ?,?,id,?,?,?,? FROM monetization_objectives WHERE id=? AND status='active'`,
          )
          .bind(
            this.actor.workspaceId,
            projectId,
            i === 0 ? 1 : 0,
            i + 1,
            at,
            this.actor.id,
            objectiveId,
          ),
      ),
    );
    input.targetPlatformIds.forEach((platformId, i) =>
      statements.push(
        this.db
          .prepare(
            `INSERT INTO project_targets(id,workspace_id,project_id,platform_id,priority,readiness_status,created_at,updated_at,version,created_by,updated_by) SELECT ?,?,?,id,?,'account_unknown',?,?,1,?,? FROM platforms WHERE id=? AND status='active'`,
          )
          .bind(
            newId('target'),
            this.actor.workspaceId,
            projectId,
            i + 1,
            at,
            at,
            this.actor.id,
            this.actor.id,
            platformId,
          ),
      ),
    );
    await this.db.batch(statements);
    return {
      id: projectId,
      masterVariantId: masterId,
      status: 'DRAFT',
      operatingMode: input.operatingMode,
      version: 1,
    };
  }
  async archiveProject(id: string, version: number) {
    const at = now();
    return this.db
      .prepare(
        `UPDATE projects SET archived_at=?,deleted_at=?,updated_at=?,updated_by=?,version=version+1 WHERE id=? AND workspace_id=? AND deleted_at IS NULL AND version=?`,
      )
      .bind(at, at, at, this.actor.id, id, this.actor.workspaceId, version)
      .run();
  }
}
