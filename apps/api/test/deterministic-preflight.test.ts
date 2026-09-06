import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  DeterministicPreflightService,
  deterministicPreflightSchemaReady,
  sourceTypeSupportsDeterministic,
} from '../src/editorial/preflight';

const preflight = readFileSync(new URL('../src/editorial/preflight.ts', import.meta.url), 'utf8');
const routes = readFileSync(new URL('../src/editorial/routes.ts', import.meta.url), 'utf8');
const execution = readFileSync(new URL('../src/editorial/execution.ts', import.meta.url), 'utf8');
const repository = readFileSync(new URL('../src/editorial/repository.ts', import.meta.url), 'utf8');
const migrations = [
  '0000_phase_1_data_security_core.sql',
  '0001_phase_2_product_channel_monetization.sql',
  '0002_phase_3_editorial_intelligence.sql',
  '0003_editorial_execution_budgets.sql',
  '0004_terminal_pipeline_hardening.sql',
];
const migrationSql = (name: string) =>
  readFileSync(new URL(`../../../packages/db/migrations/${name}`, import.meta.url), 'utf8');

class SqliteStatement {
  private values: unknown[] = [];
  constructor(
    private readonly database: DatabaseSync,
    private readonly sql: string,
  ) {}
  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }
  first<T>() {
    return Promise.resolve(
      (this.database.prepare(this.sql).get(...(this.values as [])) as T) ?? null,
    );
  }
  all<T>() {
    return Promise.resolve({
      results: this.database.prepare(this.sql).all(...(this.values as [])) as T[],
    });
  }
  run() {
    this.database.prepare(this.sql).run(...(this.values as []));
    return Promise.resolve({ meta: { changes: 1 } });
  }
}

class CapabilityD1 {
  batchCalls = 0;
  prepareCalls: string[] = [];
  constructor(readonly database: DatabaseSync) {}
  prepare(sql: string) {
    this.prepareCalls.push(sql);
    return new SqliteStatement(this.database, sql);
  }
  async batch(statements: SqliteStatement[]) {
    this.batchCalls += 1;
    this.database.exec('BEGIN');
    try {
      for (const statement of statements) await statement.run();
      this.database.exec('COMMIT');
      return statements.map(() => ({ meta: { changes: 1 } }));
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}

function schema(version: 4 | 5) {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys=ON');
  for (const migration of migrations) database.exec(migrationSql(migration));
  if (version === 5) database.exec(migrationSql('0005_deterministic_preflight_provenance.sql'));
  return new CapabilityD1(database);
}

const counts = (database: DatabaseSync) => ({
  artifacts: database.prepare('SELECT COUNT(*) count FROM editorial_artifacts').get(),
  versions: database.prepare('SELECT COUNT(*) count FROM editorial_artifact_versions').get(),
  assessments: database.prepare('SELECT COUNT(*) count FROM preflight_assessments').get(),
  checks: database.prepare('SELECT COUNT(*) count FROM preflight_checks').get(),
  dependencies: database.prepare('SELECT COUNT(*) count FROM artifact_dependencies').get(),
  audits: database.prepare('SELECT COUNT(*) count FROM audit_events').get(),
  runs: database.prepare('SELECT COUNT(*) count FROM intelligence_runs').get(),
  attempts: database.prepare('SELECT COUNT(*) count FROM intelligence_run_attempts').get(),
  reservations: database
    .prepare('SELECT COUNT(*) count FROM editorial_execution_reservations')
    .get(),
  budgets: database.prepare('SELECT COUNT(*) count FROM editorial_project_execution_budgets').get(),
  envelopes: database.prepare('SELECT COUNT(*) count FROM editorial_execution_envelopes').get(),
});

const service = (db: CapabilityD1) =>
  new DeterministicPreflightService(
    db as unknown as D1Database,
    { id: 'owner', workspaceId: 'workspace', roles: ['owner'] },
    'request',
    'test',
  );

function seedCoherentTerminalGraph(database: DatabaseSync) {
  database.exec(`
    INSERT INTO workspaces(id,slug,name,created_at,updated_at,version) VALUES('workspace','w','W','t','t',1);
    INSERT INTO users(id,workspace_id,email,status,created_at,updated_at,version) VALUES('owner','workspace','owner@test','active','t','t',1);
    INSERT INTO content_brands(id,workspace_id,name,normalized_name,primary_language,created_at,updated_at,version) VALUES('brand','workspace','B','b','de','t','t',1);
    INSERT INTO channel_profiles(id,workspace_id,content_brand_id,name,normalized_name,primary_language,created_at,updated_at,version) VALUES('channel','workspace','brand','C','c','de','t','t',1);
    INSERT INTO projects(id,workspace_id,content_brand_id,channel_profile_id,title,format,operating_mode,primary_language,status,created_at,updated_at,version) VALUES('project','workspace','brand','channel','P','SHORT','ASSISTED','de','PREFLIGHT_REVIEW','t','t',1);
  `);
  const types = [
    ['RESEARCH', 'de', null],
    ['IDEA_CANDIDATE', 'de', null],
    ['CONTENT_BRIEF', 'de', null],
    ['PRODUCTION_SCRIPT', 'de', null],
    ['REVIEW_TRANSLATION', 'es', 'v_PRODUCTION_SCRIPT'],
    ['SCRIPT_CRITIQUE', 'de', null],
    ['STORYBOARD', 'de', null],
  ] as const;
  for (const [type, language, sourceScript] of types) {
    database
      .prepare(
        `INSERT INTO editorial_artifacts(id,workspace_id,project_id,artifact_type,status,current_version_id,created_at,updated_at,version,created_by,updated_by) VALUES(?, 'workspace','project',?,'approved',?,'t','t',1,'owner','owner')`,
      )
      .run(`a_${type}`, type, `v_${type}`);
    database
      .prepare(
        `INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,language_code,content_json,source_type,content_hash,source_script_version_id,created_at,created_by) VALUES(?,'workspace',?,1,?,?,'HUMAN_EDITED',?,?, 't','owner')`,
      )
      .run(
        `v_${type}`,
        `a_${type}`,
        language,
        type === 'CONTENT_BRIEF' ? '{"reviewLanguage":"es"}' : '{}',
        type.charCodeAt(0).toString(16).padStart(2, '0').repeat(32),
        sourceScript,
      );
    database
      .prepare(
        `INSERT INTO artifact_approvals(id,workspace_id,artifact_version_id,decision,actor_id,actor_role,decided_at) VALUES(?,'workspace',?,'APPROVED','owner','owner','t')`,
      )
      .run(`approval_${type}`, `v_${type}`);
  }
  database.exec(`
    INSERT INTO idea_candidates(id,workspace_id,project_id,artifact_id,artifact_version_id,title,target_format,status,evidence_class,created_at,updated_at,version,created_by,updated_by)
    VALUES('idea','workspace','project','a_IDEA_CANDIDATE','v_IDEA_CANDIDATE','Idea','SHORT','SELECTED','UNKNOWN','t','t',1,'owner','owner');
  `);
  const dependencies: Array<[string, string, string]> = [
    ['v_RESEARCH', 'v_IDEA_CANDIDATE', 'GENERATED_FROM'],
    ['v_IDEA_CANDIDATE', 'v_CONTENT_BRIEF', 'GENERATED_FROM'],
    ['v_RESEARCH', 'v_CONTENT_BRIEF', 'USES_RESEARCH'],
    ['v_CONTENT_BRIEF', 'v_PRODUCTION_SCRIPT', 'GENERATED_FROM'],
    ['v_PRODUCTION_SCRIPT', 'v_REVIEW_TRANSLATION', 'GENERATED_FROM'],
    ['v_PRODUCTION_SCRIPT', 'v_SCRIPT_CRITIQUE', 'EVALUATES_SOURCE'],
    ['v_PRODUCTION_SCRIPT', 'v_STORYBOARD', 'GENERATED_FROM'],
    ['v_SCRIPT_CRITIQUE', 'v_STORYBOARD', 'INFORMED_BY'],
  ];
  dependencies.forEach(([source, dependent, type], index) =>
    database
      .prepare(
        `INSERT INTO artifact_dependencies(id,workspace_id,source_artifact_version_id,dependent_artifact_version_id,dependency_type,validity_status,created_at,updated_at,version) VALUES(?,'workspace',?,?,?,'CURRENT','t','t',1)`,
      )
      .run(`dependency_${index}`, source, dependent, type),
  );
}

describe('deterministic Preflight wiring', () => {
  it('uses canonical graph evaluation and deterministic provenance', () => {
    expect(preflight).toContain('evaluateTerminalGraph(g)');
    expect(preflight).toContain("'DETERMINISTIC'");
    expect(preflight).toContain("'VALIDATED_BY'");
  });
  it('persists snapshot, assessment, checks, dependencies and audit in one batch', () => {
    expect(preflight).toContain('await this.db.batch(s)');
    expect(preflight).toContain('editorial.preflight_calculated');
    expect(preflight).toMatch(/generationReadiness:\s*'NOT_READY'/u);
  });
  it('is snapshot-idempotent', () => {
    expect(preflight).toContain('v.content_hash=?');
    expect(preflight).toMatch(/idempotentReplay:\s*true/u);
  });
  it('exposes only editorial write route with a controlled 422 error', () => {
    expect(routes).toContain("'/projects/:projectId/preflight'");
    expect(routes).toContain("requirePermission('editorial:write')");
    expect(routes).toMatch(/return problem\(\s*c,\s*422,/u);
  });
  it('re-evaluates approval and revokes readiness on upstream replacement', () => {
    expect(preflight).toContain('deriveGenerationReadiness(g)');
    expect(repository).toContain("generation_readiness='NOT_READY'");
  });
  it('fails provider-backed preflight before execution setup', () => {
    const guard = execution.indexOf("task === 'PREFLIGHT_ANALYSIS'");
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(execution.indexOf('terminalSchemaReady()'));
    expect(guard).toBeLessThan(execution.indexOf('new OpenAIResponsesAdapter'));
  });
  it('fails closed on schema 0004 before any Preflight persistence', async () => {
    const db = schema(4);
    const before = counts(db.database);

    await expect(service(db).calculate('project')).rejects.toThrow(
      'deterministic_preflight_schema_unavailable',
    );

    expect(counts(db.database)).toEqual(before);
    expect(db.batchCalls).toBe(0);
    expect(db.prepareCalls).toHaveLength(1);
    expect(db.prepareCalls[0]).toContain("name='editorial_artifact_versions'");
  });
  it('recognizes schema 0005 and continues past the capability gate', async () => {
    const db = schema(5);

    expect(await deterministicPreflightSchemaReady(db as unknown as D1Database)).toBe(true);
    await expect(service(db).calculate('missing-project')).rejects.toThrow('project_not_found');

    expect(db.prepareCalls.length).toBeGreaterThan(2);
    expect(db.batchCalls).toBe(0);
    const definition = db.database
      .prepare("SELECT sql FROM sqlite_master WHERE name='editorial_artifact_versions'")
      .get() as { sql: string };
    expect(definition.sql).toContain("'DETERMINISTIC'");
  });
  it('persists schema-0005 Preflight atomically and replays the same snapshot', async () => {
    const db = schema(5);
    seedCoherentTerminalGraph(db.database);

    const created = await service(db).calculate('project');
    expect(created).toMatchObject({
      overallResult: 'PASS',
      generationReadiness: 'NOT_READY',
      idempotentReplay: false,
    });
    if (typeof created.versionId !== 'string') throw new Error('missing Preflight version');
    const versionId = created.versionId;
    const afterCreate = counts(db.database);
    expect(
      db.database
        .prepare(
          `SELECT source_type sourceType,intelligence_run_id intelligenceRunId FROM editorial_artifact_versions WHERE id=?`,
        )
        .get(versionId),
    ).toEqual({ sourceType: 'DETERMINISTIC', intelligenceRunId: null });
    expect(
      db.database
        .prepare(
          `SELECT COUNT(*) count FROM artifact_dependencies WHERE dependent_artifact_version_id=? AND dependency_type='VALIDATED_BY'`,
        )
        .get(versionId),
    ).toEqual({ count: 7 });
    expect(
      db.database
        .prepare(
          `SELECT COUNT(*) count FROM audit_events WHERE action='editorial.preflight_calculated' AND resource_id=?`,
        )
        .get(versionId),
    ).toEqual({ count: 1 });

    const replay = await service(db).calculate('project');
    expect(replay).toMatchObject({
      versionId,
      idempotentReplay: true,
    });
    expect(counts(db.database)).toEqual(afterCreate);
    expect(db.batchCalls).toBe(1);
  });
  it('treats absent, malformed, generic, and ambiguous contracts as unavailable', () => {
    expect(sourceTypeSupportsDeterministic(null)).toBe(false);
    expect(
      sourceTypeSupportsDeterministic('CREATE TABLE editorial_artifact_versions(id TEXT)'),
    ).toBe(false);
    expect(
      sourceTypeSupportsDeterministic(
        "CREATE TABLE editorial_artifact_versions(source_type TEXT, note TEXT DEFAULT 'DETERMINISTIC')",
      ),
    ).toBe(false);
    expect(
      sourceTypeSupportsDeterministic(
        "CREATE TABLE editorial_artifact_versions(source_type TEXT CHECK(source_type IN ('AI_GENERATED','HUMAN_EDITED','IMPORTED','DETERMINISTIC')), backup TEXT CHECK(source_type IN ('DETERMINISTIC')))",
      ),
    ).toBe(false);
  });
});
