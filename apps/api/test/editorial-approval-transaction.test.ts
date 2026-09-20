import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { createApp, type Bindings } from '../src/app';
import { DeterministicPreflightService, exactJsonSnapshotGuard } from '../src/editorial/preflight';
import {
  ApprovalConflictError,
  ApprovalInternalError,
  EditorialRepository,
  type ApprovalAuditContext,
  type EditorialActor,
  type PreflightApprovalEvaluation,
} from '../src/editorial/repository';

const migrations = [
  '0000_phase_1_data_security_core.sql',
  '0001_phase_2_product_channel_monetization.sql',
  '0002_phase_3_editorial_intelligence.sql',
  '0003_editorial_execution_budgets.sql',
  '0004_terminal_pipeline_hardening.sql',
  '0005_deterministic_preflight_provenance.sql',
  '0006_storyboard_v2_contract_hardening.sql',
  '0007_governed_remediation_capacity.sql',
  '0008_remediation_evidence_expression_depth.sql',
  '0009_storyboard_continuity_prompt_v3.sql',
  '0010_governed_chained_remediation_v2.sql',
  '0011_chained_remediation_diagnostic_evidence_compatibility.sql',
  '0012_governed_editorial_revision_requests.sql',
  '0013_governed_imported_research_revision.sql',
  '0014_governed_idea_revision_capacity.sql',
  '0015_governed_content_brief_revision_capacity.sql',
  '0016_governed_production_script_retry_authorization.sql',
] as const;
const migration = (name: string) =>
  readFileSync(new URL(`../../../packages/db/migrations/${name}`, import.meta.url), 'utf8');

class Statement {
  private values: SQLInputValue[] = [];
  constructor(
    private readonly database: DatabaseSync,
    readonly sql: string,
    private readonly recordQuery: () => void,
    private readonly recordBindings: (count: number) => void,
  ) {}
  bind(...values: SQLInputValue[]) {
    this.values = values;
    this.recordBindings(values.length);
    return this;
  }
  first<T>() {
    this.recordQuery();
    return Promise.resolve((this.database.prepare(this.sql).get(...this.values) as T) ?? null);
  }
  all<T>() {
    this.recordQuery();
    return Promise.resolve({ results: this.database.prepare(this.sql).all(...this.values) as T[] });
  }
  get parameterCount() {
    return this.values.length;
  }
  execute() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return { meta: { changes: Number(result.changes) } };
  }
  run() {
    this.recordQuery();
    return Promise.resolve(this.execute());
  }
}

class AtomicD1 {
  maxBindingsInBatch = 0;
  maxBindingsAnyQuery = 0;
  maxBatchStatements = 0;
  totalQueries = 0;
  batchCalls = 0;
  private beforeNextBatch: (() => void) | null = null;
  constructor(readonly database: DatabaseSync) {}
  prepare(sql: string) {
    return new Statement(
      this.database,
      sql,
      () => {
        this.totalQueries += 1;
        if (this.totalQueries > 250) throw new Error('D1_ERROR: approval query budget exceeded');
      },
      (count) => {
        this.maxBindingsAnyQuery = Math.max(this.maxBindingsAnyQuery, count);
      },
    );
  }
  beforeBatch(hook: () => void) {
    this.beforeNextBatch = hook;
  }
  resetMetrics() {
    this.maxBindingsInBatch = 0;
    this.maxBindingsAnyQuery = 0;
    this.maxBatchStatements = 0;
    this.totalQueries = 0;
    this.batchCalls = 0;
  }
  batch(statements: Statement[]) {
    const hook = this.beforeNextBatch;
    this.beforeNextBatch = null;
    hook?.();
    this.batchCalls += 1;
    this.maxBatchStatements = Math.max(this.maxBatchStatements, statements.length);
    if (statements.length > 150) throw new Error('D1_ERROR: approval batch budget exceeded');
    this.totalQueries += statements.length;
    if (this.totalQueries > 250) throw new Error('D1_ERROR: approval query budget exceeded');
    for (const statement of statements) {
      this.maxBindingsInBatch = Math.max(this.maxBindingsInBatch, statement.parameterCount);
      this.maxBindingsAnyQuery = Math.max(this.maxBindingsAnyQuery, statement.parameterCount);
      if (statement.parameterCount > 100) throw new Error('D1_ERROR: too many SQL variables');
    }
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const results = [];
      for (const statement of statements) results.push(statement.execute());
      this.database.exec('COMMIT');
      return Promise.resolve(results);
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}
class SerializedD1 extends AtomicD1 {
  private tail: Promise<void> = Promise.resolve();
  override batch(statements: Statement[]) {
    const execution = this.tail.then(() => super.batch(statements));
    this.tail = execution.then(
      () => undefined,
      () => undefined,
    );
    return execution;
  }
}

const actor: EditorialActor = { id: 'owner', workspaceId: 'workspace', roles: ['owner'] };
const identity = {
  issuer: 'https://team.cloudflareaccess.com',
  subject: 'owner-subject',
  email: 'owner@example.test',
};
const auditContext = (requestId = 'approval-request'): ApprovalAuditContext => ({
  requestId,
  environment: 'staging',
  accessIssuer: identity.issuer,
  accessSubject: identity.subject,
});

function seededDatabase() {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys=ON');
  for (const name of migrations) database.exec(migration(name));
  database.exec(`
    INSERT INTO workspaces(id,slug,name,created_at,updated_at,version)
      VALUES('workspace','workspace','Workspace','t','t',1);
    INSERT INTO users(id,workspace_id,email,status,created_at,updated_at,version)
      VALUES('owner','workspace','owner@example.test','active','t','t',1);
    INSERT INTO user_roles(workspace_id,user_id,role_id,created_at,created_by)
      VALUES('workspace','owner','role_owner','t','owner');
    INSERT INTO access_identities(id,workspace_id,user_id,issuer,subject,email,last_seen_at,created_at,updated_at,version)
      VALUES('identity-owner','workspace','owner','${identity.issuer}','${identity.subject}','${identity.email}','t','t','t',1);
    INSERT INTO content_brands(id,workspace_id,name,normalized_name,primary_language,created_at,updated_at,version)
      VALUES('brand','workspace','Brand','brand','de','t','t',1);
    INSERT INTO channel_profiles(id,workspace_id,content_brand_id,name,normalized_name,primary_language,created_at,updated_at,version)
      VALUES('channel','workspace','brand','Channel','channel','de','t','t',1);
    INSERT INTO projects(id,workspace_id,content_brand_id,channel_profile_id,title,status,format,operating_mode,primary_language,created_at,updated_at,version)
      VALUES('project','workspace','brand','channel','Project','ANALYZING','SHORT','ASSISTED','de','t','t',2);
    INSERT INTO editorial_artifacts(id,workspace_id,project_id,artifact_type,current_version_id,status,created_at,updated_at,version,created_by,updated_by) VALUES
      ('research','workspace','project','RESEARCH','research-v1','approved','t','t',2,'owner','owner'),
      ('script','workspace','project','PRODUCTION_SCRIPT','script-v3','active','t','t',4,'owner','owner'),
      ('storyboard','workspace','project','STORYBOARD','storyboard-v1','active','t','t',2,'owner','owner'),
      ('preflight','workspace','project','PREFLIGHT','preflight-v1','active','t','t',2,'owner','owner');
    INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,parent_version_id,language_code,content_text,source_type,content_hash,created_at,created_by) VALUES
      ('research-v1','workspace','research',1,NULL,'de','research','HUMAN_EDITED','${'1'.repeat(64)}','t','owner'),
      ('script-v1','workspace','script',1,NULL,'de','script one','HUMAN_EDITED','${'2'.repeat(64)}','t','owner'),
      ('script-v2','workspace','script',2,'script-v1','de','script two','HUMAN_EDITED','${'3'.repeat(64)}','t','owner'),
      ('script-v3','workspace','script',3,'script-v2','de','script three','HUMAN_EDITED','${'4'.repeat(64)}','t','owner'),
      ('storyboard-v1','workspace','storyboard',1,NULL,'de','storyboard','HUMAN_EDITED','${'5'.repeat(64)}','t','owner'),
      ('preflight-v1','workspace','preflight',1,NULL,'de','preflight','DETERMINISTIC','${'6'.repeat(64)}','t','owner');
    INSERT INTO artifact_approvals(id,workspace_id,artifact_version_id,decision,actor_id,actor_role,decided_at)
      VALUES('approval-research','workspace','research-v1','APPROVED','owner','owner','t');
    INSERT INTO preflight_assessments(id,workspace_id,project_id,artifact_id,artifact_version_id,overall_result,generation_readiness,rule_set_version,assessed_at,assessed_by)
      VALUES('assessment','workspace','project','preflight','preflight-v1','PASS','NOT_READY','1','t','owner');
    INSERT INTO audit_events(id,workspace_id,actor_type,actor_id,actor_role,access_issuer,access_subject,action,resource_type,resource_id,outcome,request_id,environment,metadata_json,occurred_at,ingested_at)
      VALUES('revision-audit','workspace','user','owner','owner','${identity.issuer}','${identity.subject}','editorial.revision_requested','editorial_revision_request','revision-open','success','revision-request','staging','{}','t','t');
    INSERT INTO editorial_revision_requests(id,workspace_id,project_id,reviewed_artifact_id,reviewed_artifact_version_id,reviewed_artifact_revision,target_stage,target_baseline_version_id,reason_code,comment,status,actor_id,actor_role,idempotency_key,command_hash,audit_event_id,created_at)
      VALUES('revision-open','workspace','project','storyboard','storyboard-v1',2,'RESEARCH','research-v1','SCRIPT_REVISION_REQUIRED',NULL,'OPEN','owner','owner','revision-key','${'a'.repeat(64)}','revision-audit','t');
  `);
  return database;
}

function fixture(serialized = false) {
  const database = seededDatabase();
  const adapter = serialized ? new SerializedD1(database) : new AtomicD1(database);
  return { database, adapter, d1: adapter as unknown as D1Database };
}
const repository = (db: D1Database, requestId = 'approval-request') =>
  new EditorialRepository(db, actor, auditContext(requestId));
const count = (database: DatabaseSync, table: string, where = '') =>
  Number(database.prepare(`SELECT count(*) count FROM ${table} ${where}`).get()!.count);
const approvalState = (database: DatabaseSync) => ({
  approvals: count(database, 'artifact_approvals', "WHERE artifact_version_id='script-v3'"),
  audits: count(
    database,
    'audit_events',
    "WHERE action='artifact.approval_recorded' AND resource_id='script-v3'",
  ),
  artifact: database
    .prepare(
      "SELECT current_version_id currentVersionId,status,version FROM editorial_artifacts WHERE id='script'",
    )
    .get(),
  resolutions: count(database, 'editorial_revision_request_resolutions'),
});

function bindings(db: D1Database): Bindings {
  return {
    ENVIRONMENT: 'staging',
    RELEASE_VERSION: 'test',
    ACCESS_TEAM_DOMAIN: identity.issuer,
    ACCESS_AUD: '1234567890123456',
    APP_ORIGIN: 'https://staging.vision.directormaxson.com',
    OWNER_BOOTSTRAP_ENABLED: 'false',
    BOOTSTRAP_OWNER_EMAIL: identity.email,
    TOKEN_ENCRYPTION_KEY: 'unused',
    OPENAI_PROVIDER_ENABLED: 'false',
    AI_PROVIDER_CONNECTIVITY_DIAGNOSTIC_ENABLED: 'false',
    DB: db,
    ASSETS: {} as Fetcher,
  };
}

function approvalPost(
  db: D1Database,
  versionId = 'script-v3',
  decision: 'APPROVED' | 'REJECTED' = 'APPROVED',
) {
  return createApp(() => Promise.resolve(identity)).request(
    `/api/v1/editorial-artifact-versions/${versionId}/approve`,
    {
      method: 'POST',
      headers: {
        Origin: 'https://staging.vision.directormaxson.com',
        'Content-Type': 'application/json',
        'Cf-Access-Jwt-Assertion': 'verified-by-test-double',
      },
      body: JSON.stringify({ decision, comment: null }),
    },
    bindings(db),
  );
}

function seedReadyTerminalGraph(database: DatabaseSync) {
  database.exec(`
    UPDATE projects SET status='PREFLIGHT_REVIEW',version=3 WHERE id='project';
    UPDATE editorial_artifacts SET status='approved' WHERE id IN ('script','storyboard');
    INSERT INTO editorial_artifacts(id,workspace_id,project_id,artifact_type,current_version_id,status,created_at,updated_at,version,created_by,updated_by) VALUES
      ('idea-artifact','workspace','project','IDEA_CANDIDATE','idea-v1','approved','t','t',1,'owner','owner'),
      ('brief','workspace','project','CONTENT_BRIEF','brief-v1','approved','t','t',1,'owner','owner'),
      ('critique','workspace','project','SCRIPT_CRITIQUE','critique-v1','approved','t','t',1,'owner','owner');
    INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,parent_version_id,language_code,content_json,source_type,content_hash,created_at,created_by) VALUES
      ('idea-v1','workspace','idea-artifact',1,NULL,'de','{}','HUMAN_EDITED','${'7'.repeat(64)}','t','owner'),
      ('brief-v1','workspace','brief',1,NULL,'de','{"reviewLanguage":"de"}','HUMAN_EDITED','${'8'.repeat(64)}','t','owner'),
      ('critique-v1','workspace','critique',1,NULL,'de','{}','HUMAN_EDITED','${'9'.repeat(64)}','t','owner');
    INSERT INTO idea_candidates(id,workspace_id,project_id,artifact_id,artifact_version_id,title,target_format,status,evidence_class,created_at,updated_at,version,created_by,updated_by)
      VALUES('idea','workspace','project','idea-artifact','idea-v1','Idea','SHORT','SELECTED','UNKNOWN','t','t',1,'owner','owner');
    INSERT INTO artifact_approvals(id,workspace_id,artifact_version_id,decision,actor_id,actor_role,decided_at) VALUES
      ('approval-idea','workspace','idea-v1','APPROVED','owner','owner','t'),
      ('approval-brief','workspace','brief-v1','APPROVED','owner','owner','t'),
      ('approval-script','workspace','script-v3','APPROVED','owner','owner','t'),
      ('approval-critique','workspace','critique-v1','APPROVED','owner','owner','t'),
      ('approval-storyboard','workspace','storyboard-v1','APPROVED','owner','owner','t');
    INSERT INTO preflight_checks(id,preflight_assessment_id,check_key,result,explanation,evidence_json,created_at)
      VALUES('check','assessment','terminal_graph_coherent','PASS','Coherent.','{"hardBlocker":true}','t');
  `);
  const dependencies: Array<[string, string, string]> = [
    ['research-v1', 'idea-v1', 'GENERATED_FROM'],
    ['idea-v1', 'brief-v1', 'GENERATED_FROM'],
    ['research-v1', 'brief-v1', 'USES_RESEARCH'],
    ['brief-v1', 'script-v3', 'GENERATED_FROM'],
    ['script-v3', 'critique-v1', 'EVALUATES_SOURCE'],
    ['script-v3', 'storyboard-v1', 'GENERATED_FROM'],
    ['critique-v1', 'storyboard-v1', 'INFORMED_BY'],
    ['research-v1', 'preflight-v1', 'VALIDATED_BY'],
    ['idea-v1', 'preflight-v1', 'VALIDATED_BY'],
    ['brief-v1', 'preflight-v1', 'VALIDATED_BY'],
    ['script-v3', 'preflight-v1', 'VALIDATED_BY'],
    ['critique-v1', 'preflight-v1', 'VALIDATED_BY'],
    ['storyboard-v1', 'preflight-v1', 'VALIDATED_BY'],
  ];
  const statement = database.prepare(
    `INSERT INTO artifact_dependencies(id,workspace_id,source_artifact_version_id,dependent_artifact_version_id,dependency_type,validity_status,created_at,updated_at,version) VALUES(?,'workspace',?,?,?,'CURRENT','t','t',1)`,
  );
  dependencies.forEach(([source, dependent, type], index) =>
    statement.run(`terminal-dependency-${index}`, source, dependent, type),
  );
}
function storyboardSceneFixture(order: number, scriptSegmentIds: string[]) {
  return {
    order,
    targetDurationSeconds: 60,
    scriptSegmentIds,
    narrationMode: 'AUTHORITATIVE_SCRIPT_SEGMENTS' as const,
    visualDescription: `Scene ${order}`,
    location: 'Berlin',
    action: 'Action',
    cameraFraming: 'Medium shot',
    cameraMovement: 'Slow push',
    mood: 'Focused',
    continuityKey: `scene-${String(order).padStart(2, '0')}`,
    continuityReferenceKeys: [] as string[],
    continuityNotes: 'Continuous.',
    transitionNotes: 'Cut.',
    aspectRatio: '9:16' as const,
    safeAreaGuidance: {
      protectTop: true,
      protectBottom: true,
      protectSides: true,
      notes: 'Centered.',
    },
    onScreenText: [] as never[],
    captions: {
      mode: 'REQUIRED' as const,
      languageCode: 'de',
      sourceScriptSegmentIds: scriptSegmentIds,
      styleGuidance: 'Readable.',
      safeAreaNotes: 'Above UI.',
    },
    factualClaims: [] as never[],
    recommendedMediaType: 'IMAGE' as const,
    assetRequirements: ['Historically plausible'],
    mediaReferences: [] as never[],
    generationInstructions: 'No embedded text.',
    characterVersionIds: [] as string[],
    audioGuidance: {
      ambience: 'Quiet city',
      soundEffects: [] as string[],
      music: { use: 'NONE' as const, guidance: '', rightsStatus: 'UNKNOWN' as const },
    },
  };
}

function upgradeStoryboardToV2(database: DatabaseSync, sceneCount = 1, linksPerScene = 2) {
  const segmentIds = Array.from({ length: linksPerScene }, (_, index) => `segment-${index + 1}`),
    scenes = Array.from({ length: sceneCount }, (_, index) =>
      storyboardSceneFixture(index + 1, segmentIds),
    ),
    content = {
      contractVersion: 'storyboard-output-v2',
      projectFormat: 'SHORT',
      aspectRatio: '9:16',
      scenes,
    };
  database.exec(`
    INSERT INTO intelligence_runs(id,workspace_id,project_id,task_type,prompt_version_id,initiated_by,operating_mode,status,idempotency_key,created_at,updated_at,version)
      VALUES('storyboard-run-v2','workspace','project','STORYBOARD_PLANNER','prompt_version_storyboard_v3','owner','ASSISTED','QUEUED','storyboard-v2-test','t','t',1);
    INSERT INTO audit_events(id,workspace_id,actor_type,actor_id,actor_role,action,resource_type,resource_id,outcome,request_id,environment,metadata_json,occurred_at,ingested_at)
      VALUES('audit-storyboard-run-v2','workspace','user','owner','owner','intelligence.run_completed','intelligence_run','storyboard-run-v2','success','request-storyboard-v2','test','{}','t','t');
    UPDATE intelligence_runs SET status='SUCCEEDED',terminal_audit_event_id='audit-storyboard-run-v2',version=2 WHERE id='storyboard-run-v2';
  `);
  database
    .prepare(
      `INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,parent_version_id,language_code,content_json,source_type,content_hash,intelligence_run_id,created_at,created_by)
      VALUES('storyboard-v2','workspace','storyboard',2,'storyboard-v1','de',?,'AI_GENERATED',?,'storyboard-run-v2','t','owner')`,
    )
    .run(JSON.stringify(content), 'b'.repeat(64));
  database.exec(`
    UPDATE intelligence_runs SET output_artifact_version_id='storyboard-v2' WHERE id='storyboard-run-v2';
    UPDATE editorial_artifacts SET current_version_id='storyboard-v2',status='approved',version=3 WHERE id='storyboard';
    INSERT INTO artifact_approvals(id,workspace_id,artifact_version_id,decision,actor_id,actor_role,decided_at)
      VALUES('approval-storyboard-v2','workspace','storyboard-v2','APPROVED','owner','owner','v2');
    UPDATE artifact_dependencies SET dependent_artifact_version_id='storyboard-v2' WHERE dependent_artifact_version_id='storyboard-v1';
    UPDATE artifact_dependencies SET source_artifact_version_id='storyboard-v2' WHERE source_artifact_version_id='storyboard-v1';
  `);
  const segment =
    database.prepare(`INSERT INTO script_segments(id,workspace_id,script_version_id,segment_order,content_text,content_hash,word_count,estimated_duration_seconds,created_at)
    VALUES(?,'workspace','script-v3',?,?,?,1,1.0,'t')`);
  segmentIds.forEach((segmentId, index) =>
    segment.run(segmentId, index + 1, `Segment ${index + 1}`, String(index % 10).repeat(64)),
  );
  const sceneStatement = database.prepare(`INSERT INTO storyboard_scenes(
      id,workspace_id,storyboard_version_id,scene_order,target_duration_seconds,visual_description,location,action,camera_framing,mood,continuity_notes,generation_instructions,recommended_media_type,asset_requirements_json,transition_notes,character_version_refs_json,created_at,camera_movement,aspect_ratio,safe_area_guidance_json,on_screen_text_json,captions_json,factual_claims_json,media_references_json,audio_guidance_json,continuity_key,continuity_reference_keys_json,contract_version
    ) VALUES(?,'workspace','storyboard-v2',?,?,?,?,?,?,?,?,?,?,?,?,?,'t',?,?,?,?,?,?,?,?,?,?,?)`),
    linkStatement =
      database.prepare(`INSERT INTO scene_script_segments(workspace_id,storyboard_scene_id,script_segment_id,segment_order,created_at)
      VALUES('workspace',?,?,?,'t')`);
  scenes.forEach((scene) => {
    const sceneId = `scene-${scene.order}`;
    sceneStatement.run(
      sceneId,
      scene.order,
      scene.targetDurationSeconds,
      scene.visualDescription,
      scene.location,
      scene.action,
      scene.cameraFraming,
      scene.mood,
      scene.continuityNotes,
      scene.generationInstructions,
      scene.recommendedMediaType,
      JSON.stringify(scene.assetRequirements),
      scene.transitionNotes,
      JSON.stringify(scene.characterVersionIds),
      scene.cameraMovement,
      scene.aspectRatio,
      JSON.stringify(scene.safeAreaGuidance),
      JSON.stringify(scene.onScreenText),
      JSON.stringify(scene.captions),
      JSON.stringify(scene.factualClaims),
      JSON.stringify(scene.mediaReferences),
      JSON.stringify(scene.audioGuidance),
      scene.continuityKey,
      JSON.stringify(scene.continuityReferenceKeys),
      'storyboard-output-v2',
    );
    segmentIds.forEach((segmentId, index) => linkStatement.run(sceneId, segmentId, index + 1));
  });
}

function seedMaximumReadyTerminalGraph(database: DatabaseSync) {
  seedReadyTerminalGraph(database);
  upgradeStoryboardToV2(database, 24, 20);
  const artifact =
      database.prepare(`INSERT INTO editorial_artifacts(id,workspace_id,project_id,artifact_type,current_version_id,status,created_at,updated_at,version,created_by,updated_by)
      VALUES(?,'workspace','project','IDEA_CANDIDATE',?,'active','t','t',1,'owner','owner')`),
    version =
      database.prepare(`INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,language_code,content_json,source_type,content_hash,created_at,created_by)
      VALUES(?,'workspace',?,1,'de','{}','HUMAN_EDITED',?,'t','owner')`),
    candidate =
      database.prepare(`INSERT INTO idea_candidates(id,workspace_id,project_id,artifact_id,artifact_version_id,title,target_format,status,evidence_class,created_at,updated_at,version,created_by,updated_by)
      VALUES(?,'workspace','project',?,?,?,'SHORT','CANDIDATE','UNKNOWN','t','t',1,'owner','owner')`);
  for (let index = 2; index <= 10; index += 1) {
    const artifactId = `idea-artifact-${index}`,
      versionId = `idea-v${index}`;
    artifact.run(artifactId, versionId);
    version.run(versionId, artifactId, String(index % 10).repeat(64));
    candidate.run(`idea-${index}`, artifactId, versionId, `Idea ${index}`);
  }
  database.exec(`
    INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,parent_version_id,language_code,content_json,source_type,content_hash,created_at,created_by)
      VALUES('brief-v2','workspace','brief',2,'brief-v1','de','{"reviewLanguage":"es"}','HUMAN_EDITED','${'c'.repeat(64)}','t','owner');
    UPDATE editorial_artifacts SET current_version_id='brief-v2',status='approved',version=2 WHERE id='brief';
    INSERT INTO artifact_approvals(id,workspace_id,artifact_version_id,decision,actor_id,actor_role,decided_at)
      VALUES('approval-brief-v2','workspace','brief-v2','APPROVED','owner','owner','v2');
    UPDATE artifact_dependencies SET source_artifact_version_id='brief-v2' WHERE source_artifact_version_id='brief-v1';
    UPDATE artifact_dependencies SET dependent_artifact_version_id='brief-v2' WHERE dependent_artifact_version_id='brief-v1';
    INSERT INTO editorial_artifacts(id,workspace_id,project_id,artifact_type,current_version_id,status,created_at,updated_at,version,created_by,updated_by)
      VALUES('translation','workspace','project','REVIEW_TRANSLATION','translation-v1','approved','t','t',1,'owner','owner');
    INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,language_code,content_json,source_type,content_hash,source_script_version_id,created_at,created_by)
      VALUES('translation-v1','workspace','translation',1,'es','{}','HUMAN_EDITED','${'d'.repeat(64)}','script-v3','t','owner');
    INSERT INTO artifact_approvals(id,workspace_id,artifact_version_id,decision,actor_id,actor_role,decided_at)
      VALUES('approval-translation','workspace','translation-v1','APPROVED','owner','owner','t');
    INSERT INTO artifact_dependencies(id,workspace_id,source_artifact_version_id,dependent_artifact_version_id,dependency_type,validity_status,created_at,updated_at,version) VALUES
      ('terminal-dependency-translation','workspace','script-v3','translation-v1','GENERATED_FROM','CURRENT','t','t',1),
      ('terminal-dependency-translation-preflight','workspace','translation-v1','preflight-v1','VALIDATED_BY','CURRENT','t','t',1);
  `);
  const checkStatement =
    database.prepare(`INSERT INTO preflight_checks(id,preflight_assessment_id,check_key,result,explanation,evidence_json,created_at)
    VALUES(?,'assessment',?,'PASS','Pass.','{"hardBlocker":false}','t')`);
  for (let index = 2; index <= 100; index += 1)
    checkStatement.run(`check-${index}`, `check-${index}`);
  expect(count(database, 'editorial_artifacts', "WHERE artifact_type<>'PREFLIGHT'")).toBe(16);
  expect(count(database, 'storyboard_scenes', "WHERE storyboard_version_id='storyboard-v2'")).toBe(
    24,
  );
  expect(count(database, 'scene_script_segments')).toBe(480);
  // Closed terminal-stage source contracts allow eight lineage edges when
  // review translation is required, plus seven VALIDATED_BY edges into Preflight.
  expect(count(database, 'artifact_dependencies')).toBe(15);
  expect(count(database, 'preflight_checks')).toBe(100);
}

function seedMediumReadyTerminalGraph(database: DatabaseSync) {
  seedReadyTerminalGraph(database);
  upgradeStoryboardToV2(database, 8, 10);
  expect(count(database, 'storyboard_scenes', "WHERE storyboard_version_id='storyboard-v2'")).toBe(
    8,
  );
  expect(count(database, 'scene_script_segments')).toBe(80);
}
async function snapshotGuardResult(actual: unknown, expected: unknown) {
  const database = new DatabaseSync(':memory:'),
    adapter = new AtomicD1(database),
    guard = exactJsonSnapshotGuard('SELECT json(?)', [JSON.stringify(actual)], expected, 'test');
  const row = await adapter
    .prepare(`SELECT CASE WHEN ${guard.condition} THEN 1 ELSE 0 END result`)
    .bind(...(guard.values as SQLInputValue[]))
    .first<{ result: number }>();
  return Number(row?.result);
}
type CapturedDependency = {
  id: string;
  sourceVersionId: string;
  dependentVersionId: string;
  dependencyType: string;
  validity: string;
  invalidatedAt: string | null;
  invalidatedByVersionId: string | null;
  version: number;
};
const maximumCanonicalDependencies = [
  ['research-v1', 'idea-v1', 'GENERATED_FROM'],
  ['idea-v1', 'brief-v2', 'GENERATED_FROM'],
  ['research-v1', 'brief-v2', 'USES_RESEARCH'],
  ['brief-v2', 'script-v3', 'GENERATED_FROM'],
  ['script-v3', 'translation-v1', 'GENERATED_FROM'],
  ['script-v3', 'critique-v1', 'EVALUATES_SOURCE'],
  ['script-v3', 'storyboard-v2', 'GENERATED_FROM'],
  ['critique-v1', 'storyboard-v2', 'INFORMED_BY'],
  ['research-v1', 'preflight-v1', 'VALIDATED_BY'],
  ['idea-v1', 'preflight-v1', 'VALIDATED_BY'],
  ['brief-v2', 'preflight-v1', 'VALIDATED_BY'],
  ['script-v3', 'preflight-v1', 'VALIDATED_BY'],
  ['translation-v1', 'preflight-v1', 'VALIDATED_BY'],
  ['critique-v1', 'preflight-v1', 'VALIDATED_BY'],
  ['storyboard-v2', 'preflight-v1', 'VALIDATED_BY'],
] as const;
function capturedDependencies(evaluation: PreflightApprovalEvaluation) {
  const guard = evaluation.stableGuards.find(
    (candidate) => candidate.reason === 'preflight_dependency_snapshot_changed',
  );
  if (!guard) throw new Error('dependency snapshot guard missing');
  const serialized = guard.values[guard.values.length - 1];
  if (typeof serialized !== 'string') throw new Error('dependency snapshot value missing');
  return JSON.parse(serialized) as CapturedDependency[];
}
const dependencyIdentity = (dependency: CapturedDependency) =>
  [dependency.sourceVersionId, dependency.dependentVersionId, dependency.dependencyType].join('|');

async function runPreflightRace(
  mutate: (database: DatabaseSync) => void,
  options: { storyboardV2?: boolean } = {},
) {
  const { database, adapter, d1 } = fixture();
  seedReadyTerminalGraph(database);
  if (options.storyboardV2) upgradeStoryboardToV2(database);
  database.exec(
    "UPDATE preflight_assessments SET generation_readiness='READY_FOR_GENERATION' WHERE id='assessment'",
  );
  const service = new DeterministicPreflightService(d1, actor, 'preflight-race', 'staging'),
    evaluation = await service.readinessForApproval('preflight-v1', 'APPROVED');
  expect(evaluation?.readiness).toBe('READY_FOR_GENERATION');
  adapter.beforeBatch(() => {
    mutate(database);
    database.exec(
      "UPDATE preflight_assessments SET generation_readiness='NOT_READY' WHERE id='assessment'",
    );
  });
  await expect(
    repository(d1).approve('preflight-v1', 'APPROVED', null, evaluation),
  ).rejects.toBeInstanceOf(ApprovalConflictError);
  expect(count(database, 'artifact_approvals', "WHERE artifact_version_id='preflight-v1'")).toBe(0);
  expect(count(database, 'audit_events', "WHERE resource_id='preflight-v1'")).toBe(0);
  expect(
    database.prepare("SELECT status,version FROM editorial_artifacts WHERE id='preflight'").get(),
  ).toEqual({ status: 'active', version: 2 });
  expect(
    database
      .prepare(
        "SELECT generation_readiness readiness FROM preflight_assessments WHERE id='assessment'",
      )
      .get(),
  ).toEqual({ readiness: 'NOT_READY' });
  expect(adapter.maxBindingsAnyQuery).toBeLessThanOrEqual(100);
  expect(adapter.maxBatchStatements).toBeLessThanOrEqual(50);
  expect(adapter.totalQueries).toBeLessThanOrEqual(100);
  return { database, adapter };
}
async function runMaximumDependencyRace(mutate: (database: DatabaseSync) => void) {
  const { database, adapter, d1 } = fixture();
  seedMaximumReadyTerminalGraph(database);
  const service = new DeterministicPreflightService(
      d1,
      actor,
      'maximum-dependency-race',
      'staging',
    ),
    evaluation = await service.readinessForApproval('preflight-v1', 'APPROVED');
  if (!evaluation) throw new Error('maximum dependency evaluation missing');
  expect(evaluation.readiness).toBe('READY_FOR_GENERATION');
  expect(capturedDependencies(evaluation)).toHaveLength(maximumCanonicalDependencies.length);
  const dependencyGuard = evaluation.stableGuards.find(
    (candidate) => candidate.reason === 'preflight_dependency_snapshot_changed',
  );
  if (!dependencyGuard) throw new Error('dependency snapshot guard missing');
  adapter.beforeBatch(() => {
    mutate(database);
    const guardResult = database
      .prepare('SELECT CASE WHEN ' + dependencyGuard.condition + ' THEN 1 ELSE 0 END result')
      .get(...(dependencyGuard.values as SQLInputValue[]));
    expect(Number(guardResult?.result)).toBe(0);
  });
  await expect(
    repository(d1).approve('preflight-v1', 'APPROVED', null, evaluation),
  ).rejects.toBeInstanceOf(ApprovalConflictError);
  expect(count(database, 'artifact_approvals', "WHERE artifact_version_id='preflight-v1'")).toBe(0);
  expect(count(database, 'audit_events', "WHERE resource_id='preflight-v1'")).toBe(0);
  expect(
    database.prepare("SELECT status,version FROM editorial_artifacts WHERE id='preflight'").get(),
  ).toEqual({ status: 'active', version: 2 });
  expect(
    database
      .prepare(
        "SELECT generation_readiness readiness FROM preflight_assessments WHERE id='assessment'",
      )
      .get(),
  ).toEqual({ readiness: 'NOT_READY' });
  expect(adapter.maxBindingsAnyQuery).toBeLessThanOrEqual(100);
  expect(adapter.maxBatchStatements).toBeLessThanOrEqual(150);
  expect(adapter.totalQueries).toBeLessThanOrEqual(250);
  return database;
}
function expectRolledBack(database: DatabaseSync) {
  expect(approvalState(database)).toEqual({
    approvals: 0,
    audits: 0,
    artifact: { currentVersionId: 'script-v3', status: 'active', version: 4 },
    resolutions: 0,
  });
  expect(
    database
      .prepare(
        "SELECT generation_readiness readiness FROM preflight_assessments WHERE id='assessment'",
      )
      .get(),
  ).toEqual({ readiness: 'NOT_READY' });
}

describe('formal editorial approval transaction hardening', () => {
  it('persists approval, exact artifact transition, and request-context audit atomically', async () => {
    const { database, adapter, d1 } = fixture();
    const response = await approvalPost(d1);
    expect(response.status).toBe(201);
    const body: unknown = await response.json();
    if (
      body === null ||
      typeof body !== 'object' ||
      !('approvalId' in body) ||
      typeof body.approvalId !== 'string' ||
      !('auditEventId' in body) ||
      typeof body.auditEventId !== 'string'
    )
      throw new Error('invalid approval response');
    const { approvalId, auditEventId } = body;
    expect(body).toMatchObject({ versionId: 'script-v3', decision: 'APPROVED' });
    expect(approvalState(database)).toEqual({
      approvals: 1,
      audits: 1,
      artifact: { currentVersionId: 'script-v3', status: 'approved', version: 5 },
      resolutions: 0,
    });
    expect(
      database
        .prepare(
          'SELECT actor_id actorId,actor_role actorRole,access_issuer accessIssuer,access_subject accessSubject,request_id requestId,environment,metadata_json metadataJson FROM audit_events WHERE id=?',
        )
        .get(auditEventId),
    ).toMatchObject({
      actorId: 'owner',
      actorRole: 'owner',
      accessIssuer: identity.issuer,
      accessSubject: identity.subject,
      environment: 'staging',
    });
    expect(
      JSON.parse(
        String(
          database
            .prepare('SELECT metadata_json metadataJson FROM audit_events WHERE id=?')
            .get(auditEventId)!.metadataJson,
        ),
      ),
    ).toMatchObject({
      approvalId,
      artifactId: 'script',
      decision: 'APPROVED',
      previousStatus: 'active',
      newStatus: 'approved',
      fromVersion: 4,
      toVersion: 5,
    });
    expect(count(database, 'intelligence_runs')).toBe(0);
    expect(count(database, 'intelligence_run_attempts')).toBe(0);
    expect(count(database, 'editorial_execution_reservations')).toBe(0);
    expect(count(database, 'editorial_revision_request_resolutions')).toBe(0);
    expect(
      database
        .prepare("SELECT status FROM editorial_revision_requests WHERE id='revision-open'")
        .get(),
    ).toEqual({ status: 'OPEN' });
    expect(adapter.maxBindingsAnyQuery).toBeLessThanOrEqual(100);
    expect(adapter.maxBatchStatements).toBeLessThanOrEqual(30);
    expect(adapter.totalQueries).toBe(32);
  });

  it('fails closed when concurrent Script v4 creation makes v3 stale', async () => {
    const { database, adapter, d1 } = fixture();
    adapter.beforeBatch(() => {
      database.exec(`
        INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,parent_version_id,language_code,content_text,source_type,content_hash,created_at,created_by)
          VALUES('script-v4','workspace','script',4,'script-v3','de','script four','HUMAN_EDITED','${'7'.repeat(64)}','t2','owner');
        UPDATE editorial_artifacts SET current_version_id='script-v4',status='active',version=5 WHERE id='script';
      `);
    });
    await expect(repository(d1).approve('script-v3', 'APPROVED', null)).rejects.toThrow(
      'stale_version_cannot_be_approved',
    );
    expect(count(database, 'artifact_approvals', "WHERE artifact_version_id='script-v3'")).toBe(0);
    expect(count(database, 'audit_events', "WHERE action='artifact.approval_recorded'")).toBe(0);
    expect(
      database
        .prepare(
          "SELECT current_version_id currentVersionId,status,version FROM editorial_artifacts WHERE id='script'",
        )
        .get(),
    ).toEqual({ currentVersionId: 'script-v4', status: 'active', version: 5 });
    expect(count(database, 'editorial_artifact_versions', "WHERE artifact_id='script'")).toBe(4);
  });

  it('allows at most one of two simultaneous identical approvals', async () => {
    const { database, d1 } = fixture(true);
    const results = await Promise.allSettled([
      repository(d1, 'duplicate-a').approve('script-v3', 'APPROVED', null),
      repository(d1, 'duplicate-b').approve('script-v3', 'APPROVED', null),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(approvalState(database)).toEqual({
      approvals: 1,
      audits: 1,
      artifact: { currentVersionId: 'script-v3', status: 'approved', version: 5 },
      resolutions: 0,
    });
  });

  it('fails closed when membership is revoked between eligibility read and batch', async () => {
    const { database, adapter, d1 } = fixture();
    adapter.beforeBatch(() =>
      database.exec("DELETE FROM user_roles WHERE workspace_id='workspace' AND user_id='owner'"),
    );
    await expect(repository(d1).approve('script-v3', 'APPROVED', null)).rejects.toThrow(
      'approval_membership_changed',
    );
    expectRolledBack(database);
    expect(
      count(database, 'user_roles', "WHERE workspace_id='workspace' AND user_id='owner'"),
    ).toBe(0);
  });

  it('fails closed when the current pointer changes without a new version', async () => {
    const { database, adapter, d1 } = fixture();
    adapter.beforeBatch(() =>
      database.exec(
        "UPDATE editorial_artifacts SET current_version_id='script-v2',status='active',version=5 WHERE id='script'",
      ),
    );
    await expect(repository(d1).approve('script-v3', 'APPROVED', null)).rejects.toThrow(
      'stale_version_cannot_be_approved',
    );
    expect(count(database, 'artifact_approvals', "WHERE artifact_version_id='script-v3'")).toBe(0);
    expect(count(database, 'audit_events', "WHERE action='artifact.approval_recorded'")).toBe(0);
    expect(
      database
        .prepare(
          "SELECT current_version_id currentVersionId,status,version FROM editorial_artifacts WHERE id='script'",
        )
        .get(),
    ).toEqual({ currentVersionId: 'script-v2', status: 'active', version: 5 });
  });

  it('rolls back approval and artifact update when audit persistence fails', async () => {
    const { database, d1 } = fixture();
    database.exec(`CREATE TRIGGER test_approval_audit_failure BEFORE INSERT ON audit_events
      WHEN NEW.action='artifact.approval_recorded'
      BEGIN SELECT RAISE(ABORT,'test approval audit failure'); END;`);
    await expect(repository(d1).approve('script-v3', 'APPROVED', null)).rejects.toThrow(
      'approval_internal_failure',
    );
    expectRolledBack(database);
  });

  it('rolls back approval and audit when the guarded artifact update fails', async () => {
    const { database, d1 } = fixture();
    database.exec(`CREATE TRIGGER test_approval_artifact_failure BEFORE UPDATE OF status ON editorial_artifacts
      WHEN NEW.id='script' AND NEW.status='approved'
      BEGIN SELECT RAISE(ABORT,'test artifact update failure'); END;`);
    await expect(repository(d1).approve('script-v3', 'APPROVED', null)).rejects.toThrow(
      'approval_internal_failure',
    );
    expectRolledBack(database);
  });

  it('rolls back the entire batch when a final canonical guard detects interference', async () => {
    const { database, d1 } = fixture();
    database.exec(`CREATE TRIGGER test_approval_final_guard AFTER INSERT ON audit_events
      WHEN NEW.action='artifact.approval_recorded'
      BEGIN UPDATE editorial_artifacts SET version=version+1 WHERE id='script'; END;`);
    await expect(repository(d1).approve('script-v3', 'APPROVED', null)).rejects.toThrow(
      'approval_internal_failure',
    );
    expectRolledBack(database);
  });

  it('preserves Preflight-specific readiness and leaves unrelated Preflight untouched', async () => {
    const script = fixture();
    await repository(script.d1).approve('script-v3', 'APPROVED', null, null);
    expect(
      script.database
        .prepare(
          "SELECT generation_readiness readiness FROM preflight_assessments WHERE id='assessment'",
        )
        .get(),
    ).toEqual({ readiness: 'NOT_READY' });

    const preflight = fixture();
    await repository(preflight.d1).approve('preflight-v1', 'APPROVED', null, {
      readiness: 'READY_FOR_GENERATION',
      beforeGuards: [],
      stableGuards: [],
    });
    expect(
      preflight.database
        .prepare(
          "SELECT generation_readiness readiness FROM preflight_assessments WHERE id='assessment'",
        )
        .get(),
    ).toEqual({ readiness: 'READY_FOR_GENERATION' });
    expect(
      preflight.database
        .prepare(
          "SELECT current_version_id currentVersionId,status,version FROM editorial_artifacts WHERE id='preflight'",
        )
        .get(),
    ).toEqual({ currentVersionId: 'preflight-v1', status: 'approved', version: 3 });
  });

  it('applies equivalent atomic guards to the REJECTED path', async () => {
    const { database, d1 } = fixture();
    await repository(d1).approve('script-v3', 'REJECTED', 'Needs revision.');
    expect(approvalState(database)).toEqual({
      approvals: 1,
      audits: 1,
      artifact: { currentVersionId: 'script-v3', status: 'rejected', version: 5 },
      resolutions: 0,
    });
    expect(
      database
        .prepare(
          "SELECT decision,comment FROM artifact_approvals WHERE artifact_version_id='script-v3'",
        )
        .get(),
    ).toEqual({ decision: 'REJECTED', comment: 'Needs revision.' });
  });
  it('enforces workspace isolation before an approval transaction can start', async () => {
    const { database, d1 } = fixture();
    database.exec(`
      INSERT INTO workspaces(id,slug,name,created_at,updated_at,version)
        VALUES('workspace-other','workspace-other','Other','t','t',1);
      INSERT INTO users(id,workspace_id,email,status,created_at,updated_at,version)
        VALUES('outsider','workspace-other','outsider@example.test','active','t','t',1);
      INSERT INTO user_roles(workspace_id,user_id,role_id,created_at,created_by)
        VALUES('workspace-other','outsider','role_owner','t','outsider');
    `);
    const outsider = new EditorialRepository(
      d1,
      { id: 'outsider', workspaceId: 'workspace-other', roles: ['owner'] },
      { ...auditContext('outsider-request'), accessIssuer: null, accessSubject: null },
    );
    await expect(outsider.approve('script-v3', 'APPROVED', null)).rejects.toThrow(
      'artifact_version_not_found',
    );
    expectRolledBack(database);
  });

  it('fails closed when the Access identity changes before the atomic batch', async () => {
    const { database, adapter, d1 } = fixture();
    adapter.beforeBatch(() =>
      database.exec(
        "UPDATE access_identities SET subject='rotated-subject' WHERE id='identity-owner'",
      ),
    );
    const promise = repository(d1).approve('script-v3', 'APPROVED', null);
    await expect(promise).rejects.toBeInstanceOf(ApprovalConflictError);
    await expect(promise).rejects.toThrow('approval_membership_changed');
    expectRolledBack(database);
  });

  it('fails closed when the actor role membership changes before the batch', async () => {
    const { database, adapter, d1 } = fixture();
    adapter.beforeBatch(() =>
      database.exec(
        "UPDATE user_roles SET role_id='role_viewer' WHERE workspace_id='workspace' AND user_id='owner'",
      ),
    );
    await expect(repository(d1).approve('script-v3', 'APPROVED', null)).rejects.toThrow(
      'approval_membership_changed',
    );
    expectRolledBack(database);
  });

  it('supports approved to rejected as a distinct human decision by the same actor', async () => {
    const { database, d1 } = fixture();
    await repository(d1, 'approve-first').approve('script-v3', 'APPROVED', null);
    await repository(d1, 'reject-second').approve('script-v3', 'REJECTED', 'Revise.');
    expect(
      database
        .prepare(
          "SELECT decision FROM artifact_approvals WHERE artifact_version_id='script-v3' ORDER BY decided_at,id",
        )
        .all(),
    ).toEqual([{ decision: 'APPROVED' }, { decision: 'REJECTED' }]);
    expect(approvalState(database)).toEqual({
      approvals: 2,
      audits: 2,
      artifact: { currentVersionId: 'script-v3', status: 'rejected', version: 6 },
      resolutions: 0,
    });
    expect(
      count(
        database,
        'artifact_approvals',
        "WHERE artifact_version_id='script-v3' AND decision='APPROVED'",
      ),
    ).toBe(1);
  });

  it('supports rejected to approved as a distinct human decision by the same actor', async () => {
    const { database, d1 } = fixture();
    await repository(d1, 'reject-first').approve('script-v3', 'REJECTED', 'Revise.');
    await repository(d1, 'approve-second').approve('script-v3', 'APPROVED', null);
    expect(
      database
        .prepare(
          "SELECT decision FROM artifact_approvals WHERE artifact_version_id='script-v3' ORDER BY decided_at,id",
        )
        .all(),
    ).toEqual([{ decision: 'REJECTED' }, { decision: 'APPROVED' }]);
    expect(approvalState(database)).toEqual({
      approvals: 2,
      audits: 2,
      artifact: { currentVersionId: 'script-v3', status: 'approved', version: 6 },
      resolutions: 0,
    });
    expect(
      count(
        database,
        'artifact_approvals',
        "WHERE artifact_version_id='script-v3' AND decision='APPROVED'",
      ),
    ).toBe(1);
  });

  it('rolls back when the approval insert fails unexpectedly', async () => {
    const { database, d1 } = fixture();
    database.exec(`CREATE TRIGGER test_approval_insert_failure BEFORE INSERT ON artifact_approvals
      WHEN NEW.artifact_version_id='script-v3'
      BEGIN SELECT RAISE(ABORT,'opaque storage failure'); END;`);
    const promise = repository(d1).approve('script-v3', 'APPROVED', null);
    await expect(promise).rejects.toBeInstanceOf(ApprovalInternalError);
    await expect(promise).rejects.toThrow('approval_internal_failure');
    expectRolledBack(database);
  });

  it('rolls back approval, artifact, and audit when the Preflight update fails', async () => {
    const { database, d1 } = fixture();
    database.exec(`CREATE TRIGGER test_preflight_update_failure BEFORE UPDATE OF generation_readiness ON preflight_assessments
      WHEN OLD.id='assessment'
      BEGIN SELECT RAISE(ABORT,'opaque preflight failure'); END;`);
    const evaluation: PreflightApprovalEvaluation = {
      readiness: 'READY_FOR_GENERATION',
      beforeGuards: [],
      stableGuards: [],
    };
    await expect(
      repository(d1).approve('preflight-v1', 'APPROVED', null, evaluation),
    ).rejects.toThrow('approval_internal_failure');
    expect(
      database.prepare("SELECT status,version FROM editorial_artifacts WHERE id='preflight'").get(),
    ).toEqual({ status: 'active', version: 2 });
    expect(count(database, 'artifact_approvals', "WHERE artifact_version_id='preflight-v1'")).toBe(
      0,
    );
    expect(count(database, 'audit_events', "WHERE resource_id='preflight-v1'")).toBe(0);
    expect(
      database
        .prepare(
          "SELECT generation_readiness readiness FROM preflight_assessments WHERE id='assessment'",
        )
        .get(),
    ).toEqual({ readiness: 'NOT_READY' });
  });

  it('fails closed when the real Preflight graph changes after readiness evaluation', async () => {
    const { database, adapter, d1 } = fixture();
    seedReadyTerminalGraph(database);
    database.exec(
      "UPDATE preflight_assessments SET generation_readiness='READY_FOR_GENERATION' WHERE id='assessment'",
    );
    const service = new DeterministicPreflightService(
      d1,
      actor,
      'preflight-race-request',
      'staging',
    );
    const evaluation = await service.readinessForApproval('preflight-v1', 'APPROVED');
    expect(evaluation?.readiness).toBe('READY_FOR_GENERATION');
    adapter.beforeBatch(() =>
      database.exec(`
        DELETE FROM artifact_dependencies WHERE id='terminal-dependency-0';
        UPDATE preflight_assessments SET generation_readiness='NOT_READY' WHERE id='assessment';
      `),
    );
    await expect(
      repository(d1).approve('preflight-v1', 'APPROVED', null, evaluation),
    ).rejects.toThrow('preflight_readiness_snapshot_changed');
    expect(
      database.prepare("SELECT status,version FROM editorial_artifacts WHERE id='preflight'").get(),
    ).toEqual({ status: 'active', version: 2 });
    expect(count(database, 'artifact_approvals', "WHERE artifact_version_id='preflight-v1'")).toBe(
      0,
    );
    expect(count(database, 'audit_events', "WHERE resource_id='preflight-v1'")).toBe(0);
    expect(count(database, 'artifact_dependencies', "WHERE id='terminal-dependency-0'")).toBe(0);
    expect(
      database
        .prepare(
          "SELECT generation_readiness readiness FROM preflight_assessments WHERE id='assessment'",
        )
        .get(),
    ).toEqual({ readiness: 'NOT_READY' });
    expect(adapter.maxBindingsInBatch).toBeLessThanOrEqual(100);
    expect(adapter.maxBindingsInBatch).toBe(12);
    expect(adapter.maxBindingsAnyQuery).toBeLessThanOrEqual(100);
    expect(adapter.maxBatchStatements).toBeLessThanOrEqual(50);
    expect(adapter.totalQueries).toBeLessThanOrEqual(100);
  });
  it('maps an unknown D1 failure to a sanitized HTTP 500 instead of a conflict', async () => {
    const { database, d1 } = fixture();
    database.exec(`CREATE TRIGGER test_route_unknown_failure BEFORE INSERT ON audit_events
      WHEN NEW.action='artifact.approval_recorded'
      BEGIN SELECT RAISE(ABORT,'sensitive sqlite implementation detail'); END;`);
    const response = await approvalPost(d1);
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      title: 'Internal Server Error',
      status: 500,
      detail: 'The request could not be completed.',
    });
    expectRolledBack(database);
  });
  it('returns a sanitized HTTP 409 for a deterministic stale-state conflict', async () => {
    const { database, adapter, d1 } = fixture();
    adapter.beforeBatch(() =>
      database.exec(
        "UPDATE editorial_artifacts SET current_version_id='script-v2',status='active',version=5 WHERE id='script'",
      ),
    );
    const response = await approvalPost(d1);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      title: 'Conflict',
      status: 409,
      detail: 'stale_version_cannot_be_approved',
    });
    expect(count(database, 'artifact_approvals', "WHERE artifact_version_id='script-v3'")).toBe(0);
    expect(count(database, 'audit_events', "WHERE resource_id='script-v3'")).toBe(0);
  });

  it('preserves distinct same-decision approvals from different actors', async () => {
    const { database, d1 } = fixture();
    database.exec(`
      INSERT INTO users(id,workspace_id,email,status,created_at,updated_at,version)
        VALUES('reviewer','workspace','reviewer@example.test','active','t','t',1);
      INSERT INTO user_roles(workspace_id,user_id,role_id,created_at,created_by)
        VALUES('workspace','reviewer','role_operator','t','owner');
    `);
    await repository(d1, 'owner-approval').approve('script-v3', 'APPROVED', null);
    const reviewer = new EditorialRepository(
      d1,
      { id: 'reviewer', workspaceId: 'workspace', roles: ['operator'] },
      { ...auditContext('reviewer-approval'), accessIssuer: null, accessSubject: null },
    );
    await reviewer.approve('script-v3', 'APPROVED', null);
    expect(
      count(
        database,
        'artifact_approvals',
        "WHERE artifact_version_id='script-v3' AND decision='APPROVED'",
      ),
    ).toBe(2);
    expect(approvalState(database)).toEqual({
      approvals: 2,
      audits: 2,
      artifact: { currentVersionId: 'script-v3', status: 'approved', version: 6 },
      resolutions: 0,
    });
  });
  it('compares compact snapshots with typed numeric, text, null, and structural semantics', async () => {
    expect(await snapshotGuardResult({ value: 60.0 }, { value: 60 })).toBe(1);
    expect(await snapshotGuardResult({ value: '60' }, { value: 60 })).toBe(0);
    expect(await snapshotGuardResult({ value: null }, { value: null })).toBe(1);
    expect(await snapshotGuardResult({ value: null }, { value: 0 })).toBe(0);
    expect(
      await snapshotGuardResult(
        { object: { second: [true, null, 60.0], first: 'value' } },
        { object: { first: 'value', second: [true, null, 60] } },
      ),
    ).toBe(1);
  });

  it('rejects missing, extra, duplicate, and same-count-different compact snapshot rows', async () => {
    const expected = [
      { id: 'a', revision: 1, status: 'CURRENT', invalidatedBy: null },
      { id: 'b', revision: 2, status: 'CURRENT', invalidatedBy: null },
    ];
    expect(await snapshotGuardResult(expected, expected)).toBe(1);
    expect(await snapshotGuardResult(expected.slice(0, 1), expected)).toBe(0);
    expect(await snapshotGuardResult([...expected, { ...expected[1], id: 'c' }], expected)).toBe(0);
    expect(await snapshotGuardResult([expected[0], expected[0]], expected)).toBe(0);
    expect(
      await snapshotGuardResult([expected[0], { ...expected[1], revision: 3 }], expected),
    ).toBe(0);
    expect(
      await snapshotGuardResult([expected[0], { ...expected[1], status: 'STALE' }], expected),
    ).toBe(0);
    expect(
      await snapshotGuardResult(
        [expected[0], { ...expected[1], invalidatedBy: 'replacement' }],
        expected,
      ),
    ).toBe(0);
  });

  it('approves a legitimate medium terminal graph within the permanent D1 budget', async () => {
    const { database, adapter, d1 } = fixture();
    seedMediumReadyTerminalGraph(database);
    const response = await approvalPost(d1, 'preflight-v1');
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      versionId: 'preflight-v1',
      decision: 'APPROVED',
    });
    expect(adapter.maxBindingsAnyQuery).toBeLessThanOrEqual(100);
    expect(adapter.maxBatchStatements).toBeLessThanOrEqual(50);
    expect(adapter.totalQueries).toBeLessThanOrEqual(100);
  });
  it('approves the legitimate maximum canonical terminal graph within the D1 budget', async () => {
    const { database, adapter, d1 } = fixture();
    seedMaximumReadyTerminalGraph(database);
    const service = new DeterministicPreflightService(d1, actor, 'maximum-snapshot', 'staging'),
      evaluation = await service.readinessForApproval('preflight-v1', 'APPROVED');
    if (!evaluation) throw new Error('maximum dependency evaluation missing');
    const dependencies = capturedDependencies(evaluation);
    expect(evaluation.readiness).toBe('READY_FOR_GENERATION');
    expect(dependencies).toHaveLength(maximumCanonicalDependencies.length);
    expect(dependencies.map(dependencyIdentity).sort()).toEqual(
      maximumCanonicalDependencies
        .map(([source, dependent, type]) => [source, dependent, type].join('|'))
        .sort(),
    );
    adapter.resetMetrics();
    const response = await approvalPost(d1, 'preflight-v1');
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      versionId: 'preflight-v1',
      decision: 'APPROVED',
    });
    expect(
      database
        .prepare(
          "SELECT generation_readiness readiness FROM preflight_assessments WHERE id='assessment'",
        )
        .get(),
    ).toEqual({ readiness: 'READY_FOR_GENERATION' });
    expect(adapter.maxBindingsAnyQuery).toBe(12);
    expect(adapter.maxBatchStatements).toBe(38);
    expect(adapter.totalQueries).toBe(57);
  }, 15_000);

  it.each([
    {
      name: 'missing canonical dependency',
      mutate: (database: DatabaseSync) =>
        database.exec("DELETE FROM artifact_dependencies WHERE id='terminal-dependency-0'"),
    },
    {
      name: 'extra canonical-scope dependency',
      mutate: (database: DatabaseSync) =>
        database.exec(
          "INSERT INTO artifact_dependencies(id,workspace_id,source_artifact_version_id,dependent_artifact_version_id,dependency_type,validity_status,created_at,updated_at,version) VALUES('dependency-extra','workspace','research-v1','script-v3','INFORMED_BY','CURRENT','t2','t2',1)",
        ),
    },
    {
      name: 'changed dependency revision',
      mutate: (database: DatabaseSync) =>
        database.exec(
          "UPDATE artifact_dependencies SET version=2 WHERE id='terminal-dependency-0'",
        ),
    },
    {
      name: 'changed dependency validity',
      mutate: (database: DatabaseSync) =>
        database.exec(
          "UPDATE artifact_dependencies SET validity_status='STALE',invalidated_at='t2' WHERE id='terminal-dependency-0'",
        ),
    },
    {
      name: 'changed invalidated-by version',
      mutate: (database: DatabaseSync) =>
        database.exec(
          "UPDATE artifact_dependencies SET invalidated_by_version_id='script-v2' WHERE id='terminal-dependency-0'",
        ),
    },
    {
      name: 'same cardinality with different dependency contents',
      mutate: (database: DatabaseSync) => {
        database.exec("DELETE FROM artifact_dependencies WHERE id='terminal-dependency-0'");
        database.exec(
          "INSERT INTO artifact_dependencies(id,workspace_id,source_artifact_version_id,dependent_artifact_version_id,dependency_type,validity_status,created_at,updated_at,version) VALUES('dependency-replacement','workspace','research-v1','idea-v1','INFORMED_BY','CURRENT','t2','t2',1)",
        );
      },
    },
  ])(
    'fails closed at maximum scale for $name',
    async ({ mutate }) => {
      await runMaximumDependencyRace(mutate);
    },
    15_000,
  );

  it('fails closed when a terminal artifact is replaced after READY evaluation', async () => {
    const { database } = await runPreflightRace((db) =>
      db.exec(`
        INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,parent_version_id,language_code,content_json,source_type,content_hash,created_at,created_by)
          VALUES('critique-v2','workspace','critique',2,'critique-v1','de','{}','HUMAN_EDITED','${'e'.repeat(64)}','t2','owner');
        UPDATE editorial_artifacts SET current_version_id='critique-v2',status='active',version=2 WHERE id='critique';
        UPDATE artifact_dependencies SET validity_status='REAPPROVAL_REQUIRED',invalidated_at='t2',invalidated_by_version_id='critique-v2',version=version+1 WHERE source_artifact_version_id='critique-v1' OR dependent_artifact_version_id='critique-v1';
      `),
    );
    expect(
      database
        .prepare(
          "SELECT current_version_id currentVersionId FROM editorial_artifacts WHERE id='critique'",
        )
        .get(),
    ).toEqual({ currentVersionId: 'critique-v2' });
  });

  it('fails closed when an upstream approval decision changes after READY evaluation', async () => {
    const { database } = await runPreflightRace((db) =>
      db.exec(`
        INSERT INTO artifact_approvals(id,workspace_id,artifact_version_id,decision,actor_id,actor_role,decided_at)
          VALUES('approval-brief-rejected','workspace','brief-v1','REJECTED','owner','owner','z');
        UPDATE editorial_artifacts SET status='rejected',version=version+1 WHERE id='brief';
      `),
    );
    expect(count(database, 'artifact_approvals', "WHERE artifact_version_id='brief-v1'")).toBe(2);
  });

  it('fails closed when a Preflight check result changes after READY evaluation', async () => {
    const { database } = await runPreflightRace((db) =>
      db.exec("UPDATE preflight_checks SET result='BLOCKED' WHERE id='check'"),
    );
    expect(database.prepare("SELECT result FROM preflight_checks WHERE id='check'").get()).toEqual({
      result: 'BLOCKED',
    });
  });

  it('fails closed when assessment overall_result changes after READY evaluation', async () => {
    const { database } = await runPreflightRace((db) =>
      db.exec("UPDATE preflight_assessments SET overall_result='BLOCKED' WHERE id='assessment'"),
    );
    expect(
      database
        .prepare(
          "SELECT overall_result overallResult FROM preflight_assessments WHERE id='assessment'",
        )
        .get(),
    ).toEqual({ overallResult: 'BLOCKED' });
  });

  it('fails closed when a normalized Storyboard scene changes after READY evaluation', async () => {
    const { database } = await runPreflightRace(
      (db) => db.exec("UPDATE storyboard_scenes SET camera_movement='Changed' WHERE id='scene-1'"),
      { storyboardV2: true },
    );
    expect(
      database
        .prepare("SELECT camera_movement movement FROM storyboard_scenes WHERE id='scene-1'")
        .get(),
    ).toEqual({
      movement: 'Changed',
    });
  });

  it('fails closed when the Storyboard prompt/schema contract changes after READY evaluation', async () => {
    const { database } = await runPreflightRace(
      (db) =>
        db.exec(`
          INSERT INTO prompt_versions(id,prompt_definition_id,version_number,template_text,input_schema_version,output_schema_version,status,content_hash,created_at)
            VALUES('prompt-version-race','prompt_storyboard_planner',99,'Race','storyboard-input-v1','storyboard-output-v1','active','${'f'.repeat(64)}','t');
          UPDATE intelligence_runs SET prompt_version_id='prompt-version-race' WHERE id='storyboard-run-v2';
        `),
      { storyboardV2: true },
    );
    expect(
      database
        .prepare(
          "SELECT prompt_version_id promptVersionId FROM intelligence_runs WHERE id='storyboard-run-v2'",
        )
        .get(),
    ).toEqual({ promptVersionId: 'prompt-version-race' });
  });

  it('fails closed when ordered Storyboard segment linkage changes after READY evaluation', async () => {
    const { database } = await runPreflightRace(
      (db) =>
        db.exec(
          "UPDATE scene_script_segments SET segment_order=20 WHERE storyboard_scene_id='scene-1' AND script_segment_id='segment-1'",
        ),
      { storyboardV2: true },
    );
    expect(
      database
        .prepare(
          "SELECT segment_order segmentOrder FROM scene_script_segments WHERE storyboard_scene_id='scene-1' AND script_segment_id='segment-1'",
        )
        .get(),
    ).toEqual({ segmentOrder: 20 });
  });

  it('fails closed when an ordered Storyboard segment link disappears after READY evaluation', async () => {
    const { database } = await runPreflightRace(
      (db) =>
        db.exec(
          "DELETE FROM scene_script_segments WHERE storyboard_scene_id='scene-1' AND script_segment_id='segment-1'",
        ),
      { storyboardV2: true },
    );
    expect(
      count(
        database,
        'scene_script_segments',
        "WHERE storyboard_scene_id='scene-1' AND script_segment_id='segment-1'",
      ),
    ).toBe(0);
  });

  it('fails closed when ordered Storyboard segment links acquire duplicate order values', async () => {
    const { database } = await runPreflightRace(
      (db) =>
        db.exec(
          "UPDATE scene_script_segments SET segment_order=1 WHERE storyboard_scene_id='scene-1' AND script_segment_id='segment-2'",
        ),
      { storyboardV2: true },
    );
    expect(
      count(
        database,
        'scene_script_segments',
        "WHERE storyboard_scene_id='scene-1' AND segment_order=1",
      ),
    ).toBe(2);
  });
  it('fails closed when the Access issuer changes before the atomic batch', async () => {
    const { database, adapter, d1 } = fixture();
    adapter.beforeBatch(() =>
      database.exec(
        "UPDATE access_identities SET issuer='https://rotated.example' WHERE id='identity-owner'",
      ),
    );
    await expect(repository(d1).approve('script-v3', 'APPROVED', null)).rejects.toThrow(
      'approval_membership_changed',
    );
    expectRolledBack(database);
  });

  it('fails closed when the actor is reassigned to another workspace before the batch', async () => {
    const { database, adapter, d1 } = fixture();
    database.exec(
      "INSERT INTO workspaces(id,slug,name,created_at,updated_at,version) VALUES('workspace-new','workspace-new','New','t','t',1)",
    );
    adapter.beforeBatch(() =>
      database.exec(`
        DELETE FROM access_identities WHERE id='identity-owner';
        DELETE FROM user_roles WHERE workspace_id='workspace' AND user_id='owner';
        UPDATE users SET workspace_id='workspace-new' WHERE id='owner';
        INSERT INTO user_roles(workspace_id,user_id,role_id,created_at,created_by) VALUES('workspace-new','owner','role_owner','t','owner');
        INSERT INTO access_identities(id,workspace_id,user_id,issuer,subject,email,last_seen_at,created_at,updated_at,version)
          VALUES('identity-owner-new','workspace-new','owner','${identity.issuer}','${identity.subject}','${identity.email}','t','t','t',1);
      `),
    );
    await expect(repository(d1).approve('script-v3', 'APPROVED', null)).rejects.toThrow(
      'approval_membership_changed',
    );
    expectRolledBack(database);
    expect(
      database.prepare("SELECT workspace_id workspaceId FROM users WHERE id='owner'").get(),
    ).toEqual({
      workspaceId: 'workspace-new',
    });
  });

  it('serializes opposite approval decisions into one coherent winner and one stale loser', async () => {
    const { database, d1 } = fixture(true);
    const results = await Promise.allSettled([
      repository(d1, 'race-approved').approve('script-v3', 'APPROVED', null),
      repository(d1, 'race-rejected').approve('script-v3', 'REJECTED', 'Revise.'),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const decision = database
      .prepare("SELECT decision FROM artifact_approvals WHERE artifact_version_id='script-v3'")
      .get() as { decision: string };
    expect(count(database, 'artifact_approvals', "WHERE artifact_version_id='script-v3'")).toBe(1);
    expect(
      count(
        database,
        'audit_events',
        "WHERE resource_id='script-v3' AND action='artifact.approval_recorded'",
      ),
    ).toBe(1);
    expect(
      database.prepare("SELECT status,version FROM editorial_artifacts WHERE id='script'").get(),
    ).toEqual({ status: decision.decision === 'APPROVED' ? 'approved' : 'rejected', version: 5 });
  });

  it('fails closed on a pure artifact revision race without pointer mutation', async () => {
    const { database, adapter, d1 } = fixture();
    adapter.beforeBatch(() =>
      database.exec("UPDATE editorial_artifacts SET version=5 WHERE id='script'"),
    );
    await expect(repository(d1).approve('script-v3', 'APPROVED', null)).rejects.toThrow(
      'stale_version_cannot_be_approved',
    );
    expect(count(database, 'artifact_approvals', "WHERE artifact_version_id='script-v3'")).toBe(0);
    expect(count(database, 'audit_events', "WHERE resource_id='script-v3'")).toBe(0);
    expect(
      database.prepare("SELECT version,status FROM editorial_artifacts WHERE id='script'").get(),
    ).toEqual({
      version: 5,
      status: 'active',
    });
  });

  it('preserves total and positive approval counts across APPROVED, REJECTED, APPROVED actors', async () => {
    const { database, d1 } = fixture();
    database.exec(`
      INSERT INTO users(id,workspace_id,email,status,created_at,updated_at,version)
        VALUES('reviewer','workspace','reviewer@example.test','active','t','t',1);
      INSERT INTO user_roles(workspace_id,user_id,role_id,created_at,created_by)
        VALUES('workspace','reviewer','role_operator','t','owner');
    `);
    await repository(d1, 'sequence-1').approve('script-v3', 'APPROVED', null);
    await repository(d1, 'sequence-2').approve('script-v3', 'REJECTED', 'Revise.');
    const reviewer = new EditorialRepository(
      d1,
      { id: 'reviewer', workspaceId: 'workspace', roles: ['operator'] },
      { ...auditContext('sequence-3'), accessIssuer: null, accessSubject: null },
    );
    await reviewer.approve('script-v3', 'APPROVED', null);
    expect(count(database, 'artifact_approvals', "WHERE artifact_version_id='script-v3'")).toBe(3);
    expect(
      count(
        database,
        'artifact_approvals',
        "WHERE artifact_version_id='script-v3' AND decision='APPROVED'",
      ),
    ).toBe(2);
    expect(
      database.prepare("SELECT status,version FROM editorial_artifacts WHERE id='script'").get(),
    ).toEqual({
      status: 'approved',
      version: 7,
    });
  });

  it('rolls back approval-side writes when a compact final snapshot guard detects drift', async () => {
    const { database, d1 } = fixture();
    seedReadyTerminalGraph(database);
    database.exec(
      "UPDATE preflight_assessments SET generation_readiness='READY_FOR_GENERATION' WHERE id='assessment'",
    );
    const service = new DeterministicPreflightService(d1, actor, 'compact-final-guard', 'staging'),
      evaluation = await service.readinessForApproval('preflight-v1', 'APPROVED');
    database.exec(`CREATE TRIGGER test_compact_final_guard AFTER INSERT ON audit_events
      WHEN NEW.action='artifact.approval_recorded'
      BEGIN UPDATE artifact_dependencies SET version=version+1 WHERE id='terminal-dependency-0'; END;`);
    await expect(
      repository(d1).approve('preflight-v1', 'APPROVED', null, evaluation),
    ).rejects.toThrow('approval_internal_failure');
    expect(count(database, 'artifact_approvals', "WHERE artifact_version_id='preflight-v1'")).toBe(
      0,
    );
    expect(count(database, 'audit_events', "WHERE resource_id='preflight-v1'")).toBe(0);
    expect(
      database
        .prepare("SELECT version FROM artifact_dependencies WHERE id='terminal-dependency-0'")
        .get(),
    ).toEqual({
      version: 1,
    });
  });
});
