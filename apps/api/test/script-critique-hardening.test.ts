import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import { requiredScriptCritiqueDimensions, scriptCritiqueSchema } from '@vision-maxson/contracts';
import { OpenAIResponsesAdapter } from '@vision-maxson/providers/openai';
import {
  critiqueSourceSnapshotEvidence,
  EditorialExecutionService,
  scriptCritiquePolicyInstructions,
  scriptCritiqueProviderContext,
  type CritiqueSourceSnapshot,
} from '../src/editorial/execution';

const dimensions = [...requiredScriptCritiqueDimensions];
const output = () => ({
  sourceScriptVersionId: 'script-v3',
  languageCode: 'de',
  strengths: ['Die Dramaturgie ist klar und die Kernaussage bleibt nachvollziehbar.'],
  issues: [
    {
      dimension: 'PACING' as const,
      issue: 'Der zweite Abschnitt ist für das Short-Format zu dicht.',
      severity: 'MEDIUM' as const,
      recommendation: 'Den zweiten Abschnitt um einen Nebensatz kürzen.',
      confidence: 0.9,
      evidenceType: 'RULE_BASED' as const,
      segmentOrders: [2],
    },
  ],
  dimensionsEvaluated: dimensions,
});

const snapshot = (): CritiqueSourceSnapshot => ({
  workspaceId: 'workspace',
  projectId: 'project',
  script: {
    artifactId: 'script',
    artifactRevision: 6,
    artifactStatus: 'approved',
    currentVersionId: 'script-v3',
    versionId: 'script-v3',
    versionNumber: 3,
    contentHash: 'a'.repeat(64),
    languageCode: 'de',
    sourceType: 'HUMAN_EDITED',
    approvalId: 'script-approval',
    positiveApprovalCount: 1,
    contentText: 'Hook\nErklärung',
    contentJson: '{"segments":2}',
    segments: [
      { id: 'segment-1', order: 1, contentHash: '1'.repeat(64), text: 'Hook' },
      { id: 'segment-2', order: 2, contentHash: '2'.repeat(64), text: 'Erklärung' },
    ],
  },
  brief: {
    artifactId: 'brief',
    artifactRevision: 3,
    artifactStatus: 'approved',
    currentVersionId: 'brief-v3',
    versionId: 'brief-v3',
    versionNumber: 3,
    contentHash: 'b'.repeat(64),
    languageCode: 'de',
    sourceType: 'HUMAN_EDITED',
    approvalId: 'brief-approval',
    positiveApprovalCount: 1,
    contentText: 'Brief',
    contentJson: '{"format":"SHORT"}',
  },
  research: {
    artifactId: 'research',
    artifactRevision: 2,
    artifactStatus: 'approved',
    currentVersionId: 'research-v2',
    versionId: 'research-v2',
    versionNumber: 2,
    contentHash: 'c'.repeat(64),
    languageCode: 'de',
    sourceType: 'IMPORTED',
    approvalId: 'research-approval',
    positiveApprovalCount: 1,
    contentText: 'Research',
    contentJson: '{"summary":"Research"}',
  },
});

describe('SCRIPT_CRITIC strict contract and allowlisted context', () => {
  it('accepts meaningful complete structured output and rejects weak or drifting output', () => {
    expect(scriptCritiqueSchema.safeParse(output()).success).toBe(true);
    for (const invalid of [
      { ...output(), strengths: [] },
      { ...output(), dimensionsEvaluated: dimensions.slice(1) },
      { ...output(), dimensionsEvaluated: [dimensions[0], ...dimensions.slice(0, -1)] },
      { ...output(), dimensionsEvaluated: [...dimensions.slice(0, -1), 'UNKNOWN'] },
      { ...output(), extra: true },
      { ...output(), issues: [{ ...output().issues[0], recommendation: '' }] },
      { ...output(), issues: [{ ...output().issues[0], extra: true }] },
    ])
      expect(scriptCritiqueSchema.safeParse(invalid).success).toBe(false);
  });

  it('supplies only exact Script, Brief, Research and explicit project constraints', () => {
    const context = scriptCritiqueProviderContext({
      id: 'project',
      format: 'SHORT',
      primaryLanguage: 'de',
      operatingMode: 'ASSISTED',
      editorialStrategyJson: '{"tone":"precise"}',
      critiqueSource: snapshot(),
      approvedArtifacts: [
        { versionId: 'critique-v1' },
        { versionId: 'translation-v2' },
        { versionId: 'idea-v2' },
        { versionId: 'storyboard-v2' },
        { versionId: 'script-v1' },
        { versionId: 'unrelated-v1' },
      ],
    });
    const serialized = JSON.stringify(context);
    for (const id of ['script-v3', 'brief-v3', 'research-v2']) expect(serialized).toContain(id);
    for (const id of [
      'critique-v1',
      'translation-v2',
      'idea-v2',
      'storyboard-v2',
      'script-v1',
      'unrelated-v1',
    ])
      expect(serialized).not.toContain(id);
    expect(context.translationInputRole).toBe('HUMAN_SUPERVISION_ONLY');
    expect(context.requiredDimensions).toEqual(dimensions);
  });

  it('stores safe evidence without source content and makes the policy explicit', () => {
    const evidence = critiqueSourceSnapshotEvidence(snapshot());
    expect(JSON.stringify(evidence)).not.toContain('Erklärung');
    expect(evidence).toMatchObject({
      translationInputRole: 'HUMAN_SUPERVISION_ONLY',
      script: { versionId: 'script-v3', approvalId: 'script-approval' },
      brief: { versionId: 'brief-v3' },
      research: { versionId: 'research-v2' },
    });
    const policy = scriptCritiquePolicyInstructions.toLowerCase();
    for (const term of [
      'required dimension',
      'prior critiques',
      'translations',
      'external research',
      'segmentorders',
    ])
      expect(policy).toContain(term);
  });
});

const migrations = readdirSync(new URL('../../../packages/db/migrations/', import.meta.url))
  .filter((name) => /^\d{4}_.+\.sql$/u.test(name) && Number(name.slice(0, 4)) <= 16)
  .sort();

class Statement {
  private values: SQLInputValue[] = [];
  constructor(
    private readonly database: DatabaseSync,
    readonly sql: string,
  ) {}
  bind(...values: SQLInputValue[]) {
    this.values = values;
    return this;
  }
  first<T>() {
    return Promise.resolve((this.database.prepare(this.sql).get(...this.values) as T) ?? null);
  }
  all<T>() {
    return Promise.resolve({ results: this.database.prepare(this.sql).all(...this.values) as T[] });
  }
  run() {
    const r = this.database.prepare(this.sql).run(...this.values);
    return Promise.resolve({ meta: { changes: Number(r.changes) } });
  }
  execute() {
    return this.database.prepare(this.sql).run(...this.values);
  }
  get bindingCount() {
    return this.values.length;
  }
}

class MeasuredD1 {
  beforeMatchingBatch: ((statements: Statement[]) => void) | null = null;
  preparedQueries = 0;
  maxBindings = 0;
  maxBatchStatements = 0;
  lastBatch: Statement[] = [];
  constructor(readonly database: DatabaseSync) {}
  prepare(sql: string) {
    this.preparedQueries += 1;
    return new Statement(this.database, sql);
  }
  batch(statements: Statement[]) {
    this.lastBatch = statements;
    this.maxBatchStatements = Math.max(this.maxBatchStatements, statements.length);
    this.maxBindings = Math.max(this.maxBindings, ...statements.map((s) => s.bindingCount));
    this.beforeMatchingBatch?.(statements);
    this.database.exec('BEGIN IMMEDIATE');
    try {
      for (const statement of statements) statement.execute();
      this.database.exec('COMMIT');
      return Promise.resolve(statements.map(() => ({ meta: { changes: 1 } })));
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}

function seed(dependents = 1) {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys=ON');
  for (const migration of migrations)
    database.exec(
      readFileSync(
        new URL(`../../../packages/db/migrations/${migration}`, import.meta.url),
        'utf8',
      ),
    );
  database.exec(`
    INSERT INTO workspaces(id,slug,name,created_at,updated_at,version) VALUES('workspace','w','W','t','t',1);
    INSERT INTO users(id,workspace_id,email,status,created_at,updated_at,version) VALUES('owner','workspace','owner@test','active','t','t',1);
    INSERT INTO content_brands(id,workspace_id,name,normalized_name,primary_language,created_at,updated_at,version) VALUES('brand','workspace','Brand','brand','de','t','t',1);
    INSERT INTO channel_profiles(id,workspace_id,content_brand_id,name,normalized_name,primary_language,editorial_strategy_json,created_at,updated_at,version) VALUES('channel','workspace','brand','Channel','channel','de','{"tone":"precise"}','t','t',1);
    INSERT INTO projects(id,workspace_id,content_brand_id,channel_profile_id,title,format,operating_mode,primary_language,status,created_at,updated_at,version) VALUES('project','workspace','brand','channel','P','SHORT','ASSISTED','de','ANALYZING','t','t',2);
    INSERT INTO ai_providers(id,key,display_name,status,adapter_version,created_at,updated_at,version) VALUES('provider','openai','OpenAI','configured','1','t','t',1);
    INSERT INTO ai_provider_models(id,provider_id,model_key,display_name,status,capabilities_json,effective_from,created_at,updated_at,version) VALUES('model','provider','gpt-5.6-sol','Sol','available','{"qualityTier":"HIGH","costRank":3,"capabilities":["STRUCTURED_OUTPUT","CRITIQUE"]}','t','t','t',2);
    INSERT INTO ai_pricing_snapshots(id,provider_model_id,currency,input_unit_price,output_unit_price,unit_name,source_label,verification_status,effective_from,created_at) VALUES('pricing','model','USD',0.000004,0.00002,'token','test','externally_verified','t','t');
    INSERT INTO editorial_project_execution_budgets(id,workspace_id,project_id,profile_key,profile_version,currency,monetary_ceiling_microusd,status,authorized_by,created_at,updated_at,version) VALUES('budget','workspace','project','phase3_terminal_graph_v1',1,'USD',403840,'ACTIVE','owner','t','t',1);
    INSERT INTO editorial_execution_envelopes(id,workspace_id,project_id,profile_key,profile_version,provider_id,provider_model_id,currency,monetary_ceiling_microusd,maximum_calls,status,authorized_by,created_at,updated_at,version,project_execution_budget_id,stage_key) VALUES('envelope','workspace','project','phase3_terminal_graph_v1',1,'provider','model','USD',403840,1,'ACTIVE','owner','t','t',1,'budget','SCRIPT_CRITIC');
    INSERT INTO intelligence_runs(id,workspace_id,project_id,task_type,provider_id,provider_model_id,input_artifact_version_id,initiated_by,operating_mode,status,idempotency_key,creative_regeneration_number,safe_metadata_json,pricing_snapshot_id,created_at,updated_at,version) VALUES('historical-run','workspace','project','SCRIPT_CRITIC','provider','model','script-v1','owner','ASSISTED','RUNNING','historical-critic',0,'{}','pricing','t','t',1);
    INSERT INTO editorial_artifacts(id,workspace_id,project_id,artifact_type,status,current_version_id,created_at,updated_at,version,created_by,updated_by) VALUES
      ('research','workspace','project','RESEARCH','approved','research-v2','t','t',2,'owner','owner'),
      ('brief','workspace','project','CONTENT_BRIEF','approved','brief-v3','t','t',3,'owner','owner'),
      ('script','workspace','project','PRODUCTION_SCRIPT','approved','script-v3','t','t',6,'owner','owner'),
      ('translation','workspace','project','REVIEW_TRANSLATION','approved','translation-v2','t','t',2,'owner','owner'),
      ('critique','workspace','project','SCRIPT_CRITIQUE','approved','critique-v1','t','t',3,'owner','owner');
    INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,parent_version_id,language_code,content_text,content_json,source_type,intelligence_run_id,content_hash,created_at,created_by) VALUES
      ('research-v2','workspace','research',2,NULL,'de','Research','{"summary":"Research"}','IMPORTED',NULL,'${'c'.repeat(64)}','t','owner'),
      ('brief-v3','workspace','brief',3,NULL,'de','Brief','{"format":"SHORT"}','HUMAN_EDITED',NULL,'${'b'.repeat(64)}','t','owner'),
      ('script-v1','workspace','script',1,NULL,'de','Old','{}','HUMAN_EDITED',NULL,'${'9'.repeat(64)}','t','owner'),
      ('script-v3','workspace','script',3,'script-v1','de','Hook\nErklärung','{"segments":2}','HUMAN_EDITED',NULL,'${'a'.repeat(64)}','t','owner'),
      ('translation-v2','workspace','translation',2,NULL,'es','Traducción','{}','HUMAN_EDITED',NULL,'${'d'.repeat(64)}','t','owner'),
      ('critique-v1','workspace','critique',1,NULL,'de',NULL,'{}','AI_GENERATED','historical-run','${'e'.repeat(64)}','t','owner');
    INSERT INTO artifact_approvals(id,workspace_id,artifact_version_id,decision,actor_id,actor_role,decided_at) VALUES
      ('research-approval','workspace','research-v2','APPROVED','owner','owner','t'),
      ('brief-approval','workspace','brief-v3','APPROVED','owner','owner','t'),
      ('script-approval','workspace','script-v3','APPROVED','owner','owner','t'),
      ('translation-approval','workspace','translation-v2','APPROVED','owner','owner','t'),
      ('critique-approval','workspace','critique-v1','APPROVED','owner','owner','t');
    INSERT INTO script_segments(id,workspace_id,script_version_id,segment_order,content_text,content_hash,word_count,created_at) VALUES
      ('segment-1','workspace','script-v3',1,'Hook','${'1'.repeat(64)}',1,'t'),
      ('segment-2','workspace','script-v3',2,'Erklärung','${'2'.repeat(64)}',1,'t');
    INSERT INTO artifact_dependencies(id,workspace_id,source_artifact_version_id,dependent_artifact_version_id,dependency_type,validity_status,created_at,updated_at,version,invalidated_at,invalidated_by_version_id) VALUES
      ('dep-research-brief','workspace','research-v2','brief-v3','USES_RESEARCH','CURRENT','t','t',1,NULL,NULL),
      ('dep-brief-script','workspace','brief-v3','script-v3','GENERATED_FROM','CURRENT','t','t',1,NULL,NULL),
      ('dep-old-script-critique','workspace','script-v1','critique-v1','EVALUATES_SOURCE','REGENERATION_REQUIRED','t','t',2,'t','script-v3');
    INSERT INTO prompt_versions(id,prompt_definition_id,version_number,template_text,input_schema_version,output_schema_version,status,content_hash,created_at) VALUES('critic-prompt','prompt_script_critic',1,'Critique {{context_json}}','script-critique-input-v1','script-critique-output-v1','active','${'f'.repeat(64)}','t');
  `);
  for (let index = 0; index < dependents; index += 1) {
    const project = `downstream-project-${index}`;
    const artifact = `downstream-artifact-${index}`;
    const version = `downstream-version-${index}`;
    const type = index === 0 ? 'PREFLIGHT' : 'STORYBOARD';
    const sourceType = type === 'PREFLIGHT' ? 'DETERMINISTIC' : 'HUMAN_EDITED';
    database
      .prepare(
        "INSERT INTO projects(id,workspace_id,content_brand_id,channel_profile_id,title,format,operating_mode,primary_language,status,created_at,updated_at,version) VALUES(?,'workspace','brand','channel',?,'SHORT','ASSISTED','de','ANALYZING','t','t',1)",
      )
      .run(project, project);
    database
      .prepare(
        "INSERT INTO editorial_artifacts(id,workspace_id,project_id,artifact_type,status,current_version_id,created_at,updated_at,version,created_by,updated_by) VALUES(?,?,?,?,'active',?,'t','t',1,'owner','owner')",
      )
      .run(artifact, 'workspace', project, type, version);
    database
      .prepare(
        "INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,language_code,content_json,source_type,content_hash,created_at,created_by) VALUES(?,?,?,1,'de','{}',?,?,'t','owner')",
      )
      .run(version, 'workspace', artifact, sourceType, `${index}`.padStart(64, '7').slice(-64));
    database
      .prepare(
        "INSERT INTO artifact_dependencies(id,workspace_id,source_artifact_version_id,dependent_artifact_version_id,dependency_type,validity_status,created_at,updated_at,version) VALUES(?,'workspace','critique-v1',?,'INFORMED_BY','CURRENT','t','t',1)",
      )
      .run(`fanout-${index}`, version);
    if (type === 'PREFLIGHT')
      database
        .prepare(
          "INSERT INTO preflight_assessments(id,workspace_id,project_id,artifact_id,artifact_version_id,overall_result,generation_readiness,rule_set_version,assessed_at,assessed_by) VALUES('assessment','workspace',?,?,?,'PASS','READY_FOR_GENERATION','v','t','owner')",
        )
        .run(project, artifact, version);
  }
  database.exec(`
    INSERT INTO projects(id,workspace_id,content_brand_id,channel_profile_id,title,format,operating_mode,primary_language,status,created_at,updated_at,version) VALUES('unrelated-project','workspace','brand','channel','U','SHORT','ASSISTED','de','ANALYZING','t','t',1);
    INSERT INTO editorial_artifacts(id,workspace_id,project_id,artifact_type,status,current_version_id,created_at,updated_at,version,created_by,updated_by) VALUES('unrelated-artifact','workspace','unrelated-project','STORYBOARD','active','unrelated-version','t','t',1,'owner','owner');
    INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,language_code,content_json,source_type,content_hash,created_at,created_by) VALUES('unrelated-version','workspace','unrelated-artifact',1,'de','{}','HUMAN_EDITED','${'8'.repeat(64)}','t','owner');
    INSERT INTO artifact_dependencies(id,workspace_id,source_artifact_version_id,dependent_artifact_version_id,dependency_type,validity_status,created_at,updated_at,version) VALUES('unrelated-dep','workspace','script-v3','unrelated-version','GENERATED_FROM','CURRENT','t','t',1);
    INSERT INTO projects(id,workspace_id,content_brand_id,channel_profile_id,title,format,operating_mode,primary_language,status,created_at,updated_at,version) VALUES('unrelated-preflight-project','workspace','brand','channel','UP','SHORT','ASSISTED','de','ANALYZING','t','t',1);
    INSERT INTO editorial_artifacts(id,workspace_id,project_id,artifact_type,status,current_version_id,created_at,updated_at,version,created_by,updated_by) VALUES('unrelated-preflight-artifact','workspace','unrelated-preflight-project','PREFLIGHT','active','unrelated-preflight-version','t','t',1,'owner','owner');
    INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,language_code,content_json,source_type,content_hash,created_at,created_by) VALUES('unrelated-preflight-version','workspace','unrelated-preflight-artifact',1,'de','{}','DETERMINISTIC','7777777777777777777777777777777777777777777777777777777777777777','t','owner');
    INSERT INTO preflight_assessments(id,workspace_id,project_id,artifact_id,artifact_version_id,overall_result,generation_readiness,rule_set_version,assessed_at,assessed_by) VALUES('unrelated-assessment','workspace','unrelated-preflight-project','unrelated-preflight-artifact','unrelated-preflight-version','PASS','READY_FOR_GENERATION','v','t','owner');
  `);
  const d1 = new MeasuredD1(database);
  const service = new EditorialExecutionService(
    d1 as unknown as D1Database,
    { id: 'owner', workspaceId: 'workspace', roles: ['owner'] },
    {
      openAIEnabled: true,
      openAIApiKey: 'local',
      openAIBaseUrl: 'https://invalid.test',
      requestId: 'request',
      environment: 'test',
    },
  );
  return { database, d1, service };
}

const command = {
  mode: 'LOCKED' as const,
  preferredProviderKey: 'openai',
  preferredModelKey: 'gpt-5.6-sol',
  inputArtifactVersionId: 'script-v3',
  creativeRegeneration: false,
};
const providerResult = () => ({
  output: output(),
  usage: {
    inputUnits: 100,
    outputUnits: 100,
    cachedInputUnits: 0,
    reasoningOutputUnits: 20,
    unitName: 'token' as const,
  },
  providerRequestId: 'provider-request',
  safeMetadata: { responseStatus: 'completed' },
});

type DriftMutation = (database: DatabaseSync) => void;

function dropVersionImmutability(database: DatabaseSync) {
  database.exec('DROP TRIGGER editorial_versions_no_update');
}

function dropApprovalImmutability(database: DatabaseSync) {
  database.exec(
    'DROP TRIGGER artifact_approvals_no_update; DROP TRIGGER artifact_approvals_no_delete',
  );
}

function addAlternateSource(
  database: DatabaseSync,
  artifactType: 'CONTENT_BRIEF' | 'RESEARCH',
  artifactId: string,
  versionId: string,
) {
  database
    .prepare(
      "INSERT INTO editorial_artifacts(id,workspace_id,project_id,artifact_type,status,current_version_id,created_at,updated_at,version,created_by,updated_by) VALUES(?,'workspace','project',?,'approved',?,'t','t',1,'owner','owner')",
    )
    .run(artifactId, artifactType, versionId);
  database
    .prepare(
      "INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,language_code,content_text,content_json,source_type,content_hash,created_at,created_by) VALUES(?,'workspace',?,1,'de','alternate','{}','HUMAN_EDITED',?,'t','owner')",
    )
    .run(versionId, artifactId, artifactType === 'CONTENT_BRIEF' ? '4'.repeat(64) : '5'.repeat(64));
  database
    .prepare(
      "INSERT INTO artifact_approvals(id,workspace_id,artifact_version_id,decision,actor_id,actor_role,decided_at) VALUES(?,'workspace',?,'APPROVED','owner','owner','t')",
    )
    .run(`${versionId}-approval`, versionId);
}

const sourceDriftCases: ReadonlyArray<{ name: string; mutate: DriftMutation }> = [
  {
    name: 'A Script v4 becomes current',
    mutate: (db) => {
      db.exec(
        `INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,parent_version_id,language_code,content_text,content_json,source_type,content_hash,created_at,created_by) VALUES('script-v4','workspace','script',4,'script-v3','de','new','{}','HUMAN_EDITED','${'6'.repeat(64)}','t','owner'); UPDATE editorial_artifacts SET current_version_id='script-v4',version=7 WHERE id='script'`,
      );
    },
  },
  {
    name: 'B Script artifact status changes',
    mutate: (db) => db.exec("UPDATE editorial_artifacts SET status='active' WHERE id='script'"),
  },
  {
    name: 'C Script artifact revision changes',
    mutate: (db) => db.exec("UPDATE editorial_artifacts SET version=7 WHERE id='script'"),
  },
  {
    name: 'D Script v3 hash changes',
    mutate: (db) => {
      dropVersionImmutability(db);
      db.exec(
        `UPDATE editorial_artifact_versions SET content_hash='${'7'.repeat(64)}' WHERE id='script-v3'`,
      );
    },
  },
  {
    name: 'E Script approval is removed',
    mutate: (db) => {
      dropApprovalImmutability(db);
      db.exec("DELETE FROM artifact_approvals WHERE id='script-approval'");
    },
  },
  {
    name: 'F Script approval identity is replaced at count one',
    mutate: (db) => {
      dropApprovalImmutability(db);
      db.exec(
        "DELETE FROM artifact_approvals WHERE id='script-approval'; INSERT INTO artifact_approvals(id,workspace_id,artifact_version_id,decision,actor_id,actor_role,decided_at) VALUES('script-approval-replacement','workspace','script-v3','APPROVED','owner','owner','t2')",
      );
    },
  },
  {
    name: 'G Script language changes',
    mutate: (db) => {
      dropVersionImmutability(db);
      db.exec("UPDATE editorial_artifact_versions SET language_code='en' WHERE id='script-v3'");
    },
  },
  {
    name: 'H Script source type changes',
    mutate: (db) => {
      dropVersionImmutability(db);
      db.exec("UPDATE editorial_artifact_versions SET source_type='IMPORTED' WHERE id='script-v3'");
    },
  },
  {
    name: 'I Script segment text changes',
    mutate: (db) =>
      db.exec("UPDATE script_segments SET content_text='changed' WHERE id='segment-1'"),
  },
  {
    name: 'J Script segment count changes',
    mutate: (db) =>
      db.exec(
        `INSERT INTO script_segments(id,workspace_id,script_version_id,segment_order,content_text,content_hash,word_count,created_at) VALUES('segment-3','workspace','script-v3',3,'extra','${'3'.repeat(64)}',1,'t')`,
      ),
  },
  {
    name: 'K Brief current version changes',
    mutate: (db) => {
      db.exec(
        `INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,parent_version_id,language_code,content_text,content_json,source_type,content_hash,created_at,created_by) VALUES('brief-v4','workspace','brief',4,'brief-v3','de','new brief','{}','HUMAN_EDITED','${'4'.repeat(64)}','t','owner'); UPDATE editorial_artifacts SET current_version_id='brief-v4',version=4 WHERE id='brief'`,
      );
    },
  },
  {
    name: 'L1 Brief status changes',
    mutate: (db) => db.exec("UPDATE editorial_artifacts SET status='active' WHERE id='brief'"),
  },
  {
    name: 'L2 Brief revision changes',
    mutate: (db) => db.exec("UPDATE editorial_artifacts SET version=4 WHERE id='brief'"),
  },
  {
    name: 'L3 Brief hash changes',
    mutate: (db) => {
      dropVersionImmutability(db);
      db.exec(
        `UPDATE editorial_artifact_versions SET content_hash='${'7'.repeat(64)}' WHERE id='brief-v3'`,
      );
    },
  },
  {
    name: 'L4 Brief approval changes',
    mutate: (db) => {
      dropApprovalImmutability(db);
      db.exec(
        "DELETE FROM artifact_approvals WHERE id='brief-approval'; INSERT INTO artifact_approvals(id,workspace_id,artifact_version_id,decision,actor_id,actor_role,decided_at) VALUES('brief-approval-replacement','workspace','brief-v3','APPROVED','owner','owner','t2')",
      );
    },
  },
  {
    name: 'M Research current version changes',
    mutate: (db) => {
      db.exec(
        `INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,parent_version_id,language_code,content_text,content_json,source_type,content_hash,created_at,created_by) VALUES('research-v3','workspace','research',3,'research-v2','de','new research','{}','IMPORTED','${'5'.repeat(64)}','t','owner'); UPDATE editorial_artifacts SET current_version_id='research-v3',version=3 WHERE id='research'`,
      );
    },
  },
  {
    name: 'N1 Research status changes',
    mutate: (db) => db.exec("UPDATE editorial_artifacts SET status='active' WHERE id='research'"),
  },
  {
    name: 'N2 Research revision changes',
    mutate: (db) => db.exec("UPDATE editorial_artifacts SET version=3 WHERE id='research'"),
  },
  {
    name: 'N3 Research hash changes',
    mutate: (db) => {
      dropVersionImmutability(db);
      db.exec(
        `UPDATE editorial_artifact_versions SET content_hash='${'7'.repeat(64)}' WHERE id='research-v2'`,
      );
    },
  },
  {
    name: 'N4 Research approval changes',
    mutate: (db) => {
      dropApprovalImmutability(db);
      db.exec(
        "DELETE FROM artifact_approvals WHERE id='research-approval'; INSERT INTO artifact_approvals(id,workspace_id,artifact_version_id,decision,actor_id,actor_role,decided_at) VALUES('research-approval-replacement','workspace','research-v2','APPROVED','owner','owner','t2')",
      );
    },
  },
  {
    name: 'O Brief to Script lineage is replaced',
    mutate: (db) => {
      addAlternateSource(db, 'CONTENT_BRIEF', 'alternate-brief', 'alternate-brief-v1');
      db.exec(
        "UPDATE artifact_dependencies SET validity_status='STALE' WHERE id='dep-brief-script'; INSERT INTO artifact_dependencies(id,workspace_id,source_artifact_version_id,dependent_artifact_version_id,dependency_type,validity_status,created_at,updated_at,version) VALUES('alternate-brief-script','workspace','alternate-brief-v1','script-v3','GENERATED_FROM','CURRENT','t','t',1)",
      );
    },
  },
  {
    name: 'P Research to Brief lineage is replaced',
    mutate: (db) => {
      addAlternateSource(db, 'RESEARCH', 'alternate-research', 'alternate-research-v1');
      db.exec(
        "UPDATE artifact_dependencies SET validity_status='STALE' WHERE id='dep-research-brief'; INSERT INTO artifact_dependencies(id,workspace_id,source_artifact_version_id,dependent_artifact_version_id,dependency_type,validity_status,created_at,updated_at,version) VALUES('alternate-research-brief','workspace','alternate-research-v1','brief-v3','USES_RESEARCH','CURRENT','t','t',1)",
      );
    },
  },
  {
    name: 'Q alternate current Brief to Script lineage is added',
    mutate: (db) => {
      addAlternateSource(db, 'CONTENT_BRIEF', 'alternate-brief', 'alternate-brief-v1');
      db.exec(
        "INSERT INTO artifact_dependencies(id,workspace_id,source_artifact_version_id,dependent_artifact_version_id,dependency_type,validity_status,created_at,updated_at,version) VALUES('alternate-brief-script','workspace','alternate-brief-v1','script-v3','GENERATED_FROM','CURRENT','t','t',1)",
      );
    },
  },
  {
    name: 'R alternate current Research to Brief lineage is added',
    mutate: (db) => {
      addAlternateSource(db, 'RESEARCH', 'alternate-research', 'alternate-research-v1');
      db.exec(
        "INSERT INTO artifact_dependencies(id,workspace_id,source_artifact_version_id,dependent_artifact_version_id,dependency_type,validity_status,created_at,updated_at,version) VALUES('alternate-research-brief','workspace','alternate-research-v1','brief-v3','USES_RESEARCH','CURRENT','t','t',1)",
      );
    },
  },
];

async function expectCritiqueDriftFailure(name: string, mutate: DriftMutation) {
  const h = seed(0);
  const provider = vi
    .spyOn(OpenAIResponsesAdapter.prototype, 'execute')
    .mockResolvedValue(providerResult());
  let injected = 0;
  h.d1.beforeMatchingBatch = (statements) => {
    if (
      injected === 0 &&
      statements[0]?.sql.includes('critique_source_authorization_changed') &&
      statements.some((statement) =>
        statement.sql.includes('INSERT INTO editorial_artifact_versions'),
      )
    ) {
      injected += 1;
      mutate(h.database);
    }
  };
  try {
    const key = `critic-drift-${name.replaceAll(/[^a-z0-9]+/giu, '-').toLowerCase()}`;
    await expect(h.service.execute('project', 'SCRIPT_CRITIC', command, key)).rejects.toThrow();
    expect(injected).toBe(1);
    expect(provider).toHaveBeenCalledTimes(1);
    const run = h.database
      .prepare(
        'SELECT id,status,input_units inputUnits,output_units outputUnits,actual_cost actualCost,output_artifact_version_id outputVersionId FROM intelligence_runs WHERE idempotency_key=?',
      )
      .get(key) as Record<string, unknown>;
    expect(run).toMatchObject({
      status: 'FAILED_PERMANENT',
      inputUnits: 100,
      outputUnits: 100,
      actualCost: 0.0024,
      outputVersionId: null,
    });
    expect(
      h.database
        .prepare(
          'SELECT status,provider_request_id providerRequestId FROM intelligence_run_attempts WHERE intelligence_run_id=?',
        )
        .get(String(run.id)),
    ).toEqual({ status: 'FAILED_PERMANENT', providerRequestId: 'provider-request' });
    expect(
      h.database
        .prepare(
          'SELECT status,actual_microusd actualMicrousd FROM editorial_execution_reservations WHERE intelligence_run_id=?',
        )
        .get(String(run.id)),
    ).toEqual({ status: 'RECONCILED', actualMicrousd: 2400 });
    expect(
      h.database
        .prepare(
          "SELECT COUNT(*) count FROM editorial_artifact_versions WHERE artifact_id='critique'",
        )
        .get(),
    ).toEqual({ count: 1 });
    expect(
      h.database
        .prepare(
          "SELECT current_version_id currentVersionId FROM editorial_artifacts WHERE id='critique'",
        )
        .get(),
    ).toEqual({ currentVersionId: 'critique-v1' });
    expect(
      h.database
        .prepare(
          "SELECT COUNT(*) count FROM audit_events WHERE action='intelligence.run_completed' AND resource_id=?",
        )
        .get(String(run.id)),
    ).toEqual({ count: 0 });
    expect(
      h.database
        .prepare(
          "SELECT COUNT(*) count FROM audit_events WHERE action='intelligence.run_failed' AND resource_id=?",
        )
        .get(String(run.id)),
    ).toEqual({ count: 1 });
    const replay = await h.service.execute('project', 'SCRIPT_CRITIC', command, key);
    expect(replay.idempotentReplay).toBe(true);
    expect(provider).toHaveBeenCalledTimes(1);
  } finally {
    provider.mockRestore();
    h.database.close();
  }
}
describe('SCRIPT_CRITIC public execution and persistence', () => {
  it.each(sourceDriftCases)(
    'fails closed after provider success when $name',
    async ({ name, mutate }) => {
      await expectCritiqueDriftFailure(name, mutate);
    },
  );
  it.each([0, 1, 300])(
    'replaces historical Critique and invalidates %i dependents with fixed D1 scale',
    async (dependentCount) => {
      const h = seed(dependentCount);
      const provider = vi
        .spyOn(OpenAIResponsesAdapter.prototype, 'execute')
        .mockImplementation((request) => {
          const material = JSON.stringify(request);
          for (const id of ['script-v3', 'brief-v3', 'research-v2']) expect(material).toContain(id);
          for (const id of ['critique-v1', 'translation-v2']) expect(material).not.toContain(id);
          return Promise.resolve(providerResult());
        });
      try {
        const result = await h.service.execute(
          'project',
          'SCRIPT_CRITIC',
          command,
          `critic-${dependentCount}`,
        );
        expect(result.run.status).toBe('SUCCEEDED');
        expect(provider).toHaveBeenCalledTimes(1);
        const current = h.database
          .prepare(
            "SELECT current_version_id currentVersionId,status,version FROM editorial_artifacts WHERE id='critique'",
          )
          .get() as { currentVersionId: string; status: string; version: number };
        expect(current).toMatchObject({ status: 'active', version: 4 });
        expect(current.currentVersionId).not.toBe('critique-v1');
        expect(
          h.database
            .prepare(
              'SELECT version_number versionNumber,parent_version_id parentVersionId,source_type sourceType,language_code languageCode FROM editorial_artifact_versions WHERE id=?',
            )
            .get(current.currentVersionId),
        ).toEqual({
          versionNumber: 2,
          parentVersionId: 'critique-v1',
          sourceType: 'AI_GENERATED',
          languageCode: 'de',
        });
        expect(
          h.database
            .prepare(
              "SELECT COUNT(*) count FROM artifact_approvals WHERE artifact_version_id=? AND decision='APPROVED'",
            )
            .get(current.currentVersionId),
        ).toEqual({ count: 0 });
        expect(
          h.database
            .prepare(
              "SELECT version_number versionNumber,content_json contentJson,content_hash contentHash FROM editorial_artifact_versions WHERE id='critique-v1'",
            )
            .get(),
        ).toEqual({
          versionNumber: 1,
          contentJson: '{}',
          contentHash: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
        });
        expect(
          h.database
            .prepare(
              "SELECT COUNT(*) count FROM artifact_approvals WHERE artifact_version_id='critique-v1' AND decision='APPROVED'",
            )
            .get(),
        ).toEqual({ count: 1 });
        expect(
          h.database
            .prepare(
              "SELECT COUNT(*) count FROM artifact_dependencies WHERE source_artifact_version_id='script-v3' AND dependent_artifact_version_id=? AND dependency_type='EVALUATES_SOURCE' AND validity_status='CURRENT'",
            )
            .get(current.currentVersionId),
        ).toEqual({ count: 1 });
        expect(
          h.database
            .prepare(
              "SELECT COUNT(*) count FROM artifact_dependencies WHERE source_artifact_version_id='critique-v1' AND validity_status='REAPPROVAL_REQUIRED' AND invalidated_by_version_id=? AND version=2",
            )
            .get(current.currentVersionId),
        ).toEqual({ count: dependentCount });
        expect(
          h.database
            .prepare(
              "SELECT COUNT(*) count FROM artifact_dependencies WHERE source_artifact_version_id=? AND dependent_artifact_version_id IN (SELECT dependent_artifact_version_id FROM artifact_dependencies WHERE source_artifact_version_id='critique-v1')",
            )
            .get(current.currentVersionId),
        ).toEqual({ count: 0 });
        expect(
          h.database
            .prepare(
              "SELECT COUNT(*) count FROM intelligence_runs WHERE task_type='STORYBOARD_PLANNER'",
            )
            .get(),
        ).toEqual({ count: 0 });
        expect(
          h.database
            .prepare(
              "SELECT validity_status validity FROM artifact_dependencies WHERE id='unrelated-dep'",
            )
            .get(),
        ).toEqual({ validity: 'CURRENT' });
        expect(
          h.database
            .prepare(
              "SELECT generation_readiness readiness FROM preflight_assessments WHERE id='unrelated-assessment'",
            )
            .get(),
        ).toEqual({ readiness: 'READY_FOR_GENERATION' });
        if (dependentCount > 0)
          expect(
            h.database
              .prepare(
                "SELECT generation_readiness readiness FROM preflight_assessments WHERE id='assessment'",
              )
              .get(),
          ).toEqual({ readiness: 'NOT_READY' });
        expect(h.d1.maxBindings).toBe(48);
        expect(h.d1.maxBatchStatements).toBe(11);
        expect(h.d1.preparedQueries).toBe(34);
        const replay = await h.service.execute(
          'project',
          'SCRIPT_CRITIC',
          command,
          `critic-${dependentCount}`,
        );
        expect(replay.idempotentReplay).toBe(true);
        expect(provider).toHaveBeenCalledTimes(1);
        await expect(
          h.service.execute(
            'project',
            'SCRIPT_CRITIC',
            { ...command, creativeRegeneration: true },
            `critic-${dependentCount}`,
          ),
        ).rejects.toThrow(/different command/u);
        expect(provider).toHaveBeenCalledTimes(1);
        expect(h.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      } finally {
        provider.mockRestore();
        h.database.close();
      }
    },
  );

  it('terminalizes provider success plus post-dispatch source drift without persisting Critique', async () => {
    const h = seed(1);
    const provider = vi
      .spyOn(OpenAIResponsesAdapter.prototype, 'execute')
      .mockResolvedValue(providerResult());
    let injected = 0;
    h.d1.beforeMatchingBatch = (statements) => {
      if (
        injected === 0 &&
        statements[0]?.sql.includes('critique_source_authorization_changed') &&
        statements.some((s) => s.sql.includes('INSERT INTO editorial_artifact_versions'))
      ) {
        injected += 1;
        h.database.exec("UPDATE editorial_artifacts SET version=7 WHERE id='script'");
      }
    };
    try {
      await expect(
        h.service.execute('project', 'SCRIPT_CRITIC', command, 'critic-stale'),
      ).rejects.toThrow();
      expect(injected).toBe(1);
      expect(provider).toHaveBeenCalledTimes(1);
      const run = h.database
        .prepare(
          "SELECT id,status,input_units inputUnits,output_units outputUnits,actual_cost actualCost,output_artifact_version_id outputVersionId FROM intelligence_runs WHERE idempotency_key='critic-stale'",
        )
        .get() as Record<string, unknown>;
      expect(run).toMatchObject({
        status: 'FAILED_PERMANENT',
        inputUnits: 100,
        outputUnits: 100,
        actualCost: 0.0024,
        outputVersionId: null,
      });
      expect(
        h.database
          .prepare(
            'SELECT status,provider_request_id providerRequestId FROM intelligence_run_attempts WHERE intelligence_run_id=?',
          )
          .get(String(run.id)),
      ).toEqual({ status: 'FAILED_PERMANENT', providerRequestId: 'provider-request' });
      expect(
        h.database
          .prepare(
            'SELECT status,actual_microusd actualMicrousd FROM editorial_execution_reservations WHERE intelligence_run_id=?',
          )
          .get(String(run.id)),
      ).toEqual({ status: 'RECONCILED', actualMicrousd: 2400 });
      expect(
        h.database
          .prepare(
            "SELECT COUNT(*) count FROM editorial_artifact_versions WHERE artifact_id='critique'",
          )
          .get(),
      ).toEqual({ count: 1 });
      expect(
        h.database
          .prepare(
            "SELECT COUNT(*) count FROM audit_events WHERE action='intelligence.run_failed' AND resource_id=?",
          )
          .get(String(run.id)),
      ).toEqual({ count: 1 });
      const replay = await h.service.execute('project', 'SCRIPT_CRITIC', command, 'critic-stale');
      expect(replay.idempotentReplay).toBe(true);
      expect(provider).toHaveBeenCalledTimes(1);
    } finally {
      provider.mockRestore();
      h.database.close();
    }
  });

  it.each([
    ['empty strengths', { ...output(), strengths: [] }],
    ['wrong source Script', { ...output(), sourceScriptVersionId: 'script-v1' }],
    ['wrong language', { ...output(), languageCode: 'en' }],
    [
      'out-of-range segment reference',
      { ...output(), issues: [{ ...output().issues[0], segmentOrders: [3] }] },
    ],
    [
      'duplicate segment reference',
      { ...output(), issues: [{ ...output().issues[0], segmentOrders: [2, 2] }] },
    ],
  ])(
    'rejects %s after one provider dispatch without creating Critique',
    async (caseName, invalidOutput) => {
      const h = seed(0);
      const provider = vi
        .spyOn(OpenAIResponsesAdapter.prototype, 'execute')
        .mockResolvedValue({ ...providerResult(), output: invalidOutput });
      const key = `critic-invalid-${caseName.replaceAll(/[^a-z0-9]+/giu, '-').toLowerCase()}`;
      try {
        await expect(h.service.execute('project', 'SCRIPT_CRITIC', command, key)).rejects.toThrow(
          /(?:invalid|validation)/u,
        );
        expect(provider).toHaveBeenCalledTimes(1);
        expect(
          h.database
            .prepare(
              "SELECT COUNT(*) count FROM editorial_artifact_versions WHERE artifact_id='critique'",
            )
            .get(),
        ).toEqual({ count: 1 });
        expect(
          h.database
            .prepare('SELECT status FROM intelligence_runs WHERE idempotency_key=?')
            .get(key),
        ).toEqual({ status: 'FAILED_PERMANENT' });
      } finally {
        provider.mockRestore();
        h.database.close();
      }
    },
  );
});
