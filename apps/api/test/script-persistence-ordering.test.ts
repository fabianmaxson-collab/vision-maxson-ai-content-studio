import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { EditorialExecutionService } from '../src/editorial/execution';

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
    const result = this.database.prepare(this.sql).run(...(this.values as []));
    return Promise.resolve({ meta: { changes: Number(result.changes) } });
  }
}

class TransactionalD1 {
  failBatchAfter: number | null = null;
  beforeBatch: (() => void) | null = null;
  lastBatchSize = 0;
  constructor(readonly database: DatabaseSync) {}
  prepare(sql: string) {
    return new SqliteStatement(this.database, sql);
  }
  async batch(statements: SqliteStatement[]) {
    this.lastBatchSize = statements.length;
    this.beforeBatch?.();
    this.beforeBatch = null;
    this.database.exec('BEGIN');
    try {
      for (const [index, statement] of statements.entries()) {
        await statement.run();
        if (this.failBatchAfter === index + 1) throw new Error('injected_terminal_batch_failure');
      }
      this.database.exec('COMMIT');
      return statements.map(() => ({ meta: { changes: 1 } }));
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}

type Persist = (
  projectId: string,
  task: 'SCRIPT_WRITER_SHORT',
  runId: string,
  inputVersionId: string,
  language: string,
  outputSchemaVersion: string,
  lineage: Array<{ sourceVersionId: string; dependencyType: 'GENERATED_FROM' }>,
  output: unknown,
  completion: {
    result: {
      output: unknown;
      providerRequestId: string;
      usage: {
        inputUnits: number;
        outputUnits: number;
        cachedInputUnits: number;
        reasoningOutputUnits: number;
        unitName: 'token';
      };
      safeMetadata: Record<string, unknown>;
    };
    costs: { actualCost: number; actualMicrousd: number; currency: string };
    metadata: Record<string, unknown>;
    governed: boolean;
    scriptSourceBrief: {
      workspaceId: string;
      projectId: string;
      artifactId: string;
      artifactRevision: number;
      versionId: string;
      contentHash: string;
      approvalId: string;
    };
    reservedMicrousd: null;
  },
) => Promise<string>;

const migrationDirectory = new URL('../../../packages/db/migrations/', import.meta.url);
const migrationNames = readdirSync(migrationDirectory)
  .filter((name) => /^\d{4}_.+\.sql$/u.test(name) && Number(name.slice(0, 4)) <= 15)
  .sort();

function seed(database: DatabaseSync) {
  database.exec(`
    INSERT INTO workspaces(id,slug,name,created_at,updated_at,version) VALUES('workspace','w','W','t','t',1);
    INSERT INTO users(id,workspace_id,email,status,created_at,updated_at,version) VALUES('owner','workspace','owner@test','active','t','t',1);
    INSERT INTO content_brands(id,workspace_id,name,normalized_name,primary_language,created_at,updated_at,version) VALUES('brand','workspace','Brand','brand','de','t','t',1);
    INSERT INTO channel_profiles(id,workspace_id,content_brand_id,name,normalized_name,primary_language,created_at,updated_at,version) VALUES('channel','workspace','brand','Channel','channel','de','t','t',1);
    INSERT INTO projects(id,workspace_id,content_brand_id,channel_profile_id,title,format,operating_mode,primary_language,status,created_at,updated_at,version) VALUES('project','workspace','brand','channel','Project','SHORT','ASSISTED','de','ANALYZING','t','t',2);
    INSERT INTO ai_providers(id,key,display_name,status,adapter_version,created_at,updated_at,version) VALUES('provider','openai','OpenAI','configured','1','t','t',1);
    INSERT INTO ai_provider_models(id,provider_id,model_key,display_name,status,capabilities_json,effective_from,created_at,updated_at,version) VALUES('model','provider','gpt-5.6-luna','Luna','available','{}','t','t','t',1);
    INSERT INTO ai_pricing_snapshots(id,provider_model_id,currency,input_unit_price,output_unit_price,unit_name,source_label,verification_status,effective_from,created_at) VALUES('pricing','model','USD',0.0000001,0.0000015,'token','test','externally_verified','t','t');
    INSERT INTO editorial_artifacts(id,workspace_id,project_id,artifact_type,status,current_version_id,created_at,updated_at,version,created_by,updated_by) VALUES
      ('brief','workspace','project','CONTENT_BRIEF','approved',NULL,'t','t',6,'owner','owner'),
      ('script','workspace','project','PRODUCTION_SCRIPT','approved',NULL,'t','t',3,'owner','owner'),
      ('translation','workspace','project','REVIEW_TRANSLATION','approved',NULL,'t','t',3,'owner','owner'),
      ('critique','workspace','project','SCRIPT_CRITIQUE','approved',NULL,'t','t',3,'owner','owner'),
      ('storyboard','workspace','project','STORYBOARD','active',NULL,'t','t',2,'owner','owner');
    INSERT INTO intelligence_runs(id,workspace_id,project_id,task_type,provider_id,provider_model_id,input_artifact_version_id,initiated_by,operating_mode,status,idempotency_key,creative_regeneration_number,safe_metadata_json,pricing_snapshot_id,started_at,created_at,updated_at,version) VALUES
      ('run','workspace','project','SCRIPT_WRITER_SHORT','provider','model','brief_v3','owner','ASSISTED','RUNNING','fresh-simulation-key',0,'{}','pricing','t','t','t',2),
      ('failed_run','workspace','project','SCRIPT_WRITER_SHORT','provider','model','brief_v3','owner','ASSISTED','RUNNING','failed-final-key',0,'{}','pricing','t','t','t',2);
    INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,parent_version_id,language_code,content_text,content_json,source_type,intelligence_run_id,content_hash,created_at,created_by) VALUES
      ('brief_v3','workspace','brief',3,NULL,'de',NULL,'{}','HUMAN_EDITED',NULL,'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','t','owner'),
      ('script_v1','workspace','script',1,NULL,'de','Alt','{"title":"Alt"}','HUMAN_EDITED',NULL,'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','t','owner'),
      ('translation_v1','workspace','translation',1,NULL,'es','Viejo','{}','HUMAN_EDITED',NULL,'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc','t','owner'),
      ('critique_v1','workspace','critique',1,NULL,'de',NULL,'{}','HUMAN_EDITED',NULL,'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd','t','owner'),
      ('storyboard_v1','workspace','storyboard',1,NULL,'de',NULL,'{}','HUMAN_EDITED',NULL,'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee','t','owner');
    UPDATE editorial_artifacts SET current_version_id='brief_v3' WHERE id='brief';
    UPDATE editorial_artifacts SET current_version_id='script_v1' WHERE id='script';
    UPDATE editorial_artifacts SET current_version_id='translation_v1' WHERE id='translation';
    UPDATE editorial_artifacts SET current_version_id='critique_v1' WHERE id='critique';
    UPDATE editorial_artifacts SET current_version_id='storyboard_v1' WHERE id='storyboard';
    INSERT INTO artifact_approvals(id,workspace_id,artifact_version_id,decision,actor_id,actor_role,decided_at) VALUES
      ('brief_approval','workspace','brief_v3','APPROVED','owner','owner','t'),
      ('script_approval','workspace','script_v1','APPROVED','owner','owner','t');
    INSERT INTO artifact_dependencies(id,workspace_id,source_artifact_version_id,dependent_artifact_version_id,dependency_type,validity_status,created_at,updated_at,version) VALUES
      ('dep_translation','workspace','script_v1','translation_v1','GENERATED_FROM','CURRENT','t','t',1),
      ('dep_critique','workspace','script_v1','critique_v1','EVALUATES_SOURCE','CURRENT','t','t',1),
      ('dep_storyboard','workspace','script_v1','storyboard_v1','GENERATED_FROM','CURRENT','t','t',1);
    INSERT INTO intelligence_run_attempts(id,intelligence_run_id,attempt_number,attempt_kind,status,provider_request_id,safe_metadata_json,error_category,safe_error_detail,started_at,completed_at) VALUES
      ('attempt','run',1,'TECHNICAL','RUNNING',NULL,'{}',NULL,NULL,'t',NULL),
      ('failed_attempt','failed_run',1,'TECHNICAL','RUNNING','provider-old','{}',NULL,NULL,'t',NULL);
    INSERT INTO editorial_execution_envelopes(id,workspace_id,project_id,profile_key,profile_version,provider_id,provider_model_id,currency,monetary_ceiling_microusd,maximum_calls,status,authorized_by,created_at,updated_at,version) VALUES('bounded','workspace','project','phase3_short_de_review_es_v1',1,'provider','model','USD',7000,2,'ACTIVE','owner','t','t',1);
    INSERT INTO editorial_execution_reservations(id,envelope_id,workspace_id,project_id,intelligence_run_id,step_key,pricing_snapshot_id,reserved_microusd,actual_microusd,status,created_at,dispatched_at,reconciled_at) VALUES('failed_reservation','bounded','workspace','project','failed_run','SCRIPT_WRITER_SHORT','pricing',2970,NULL,'DISPATCHED','t','t',NULL);
    INSERT INTO audit_events(id,workspace_id,actor_type,actor_id,actor_role,action,resource_type,resource_id,outcome,request_id,environment,metadata_json,occurred_at,ingested_at) VALUES('failed_audit','workspace','user','owner','owner','intelligence.run_failed','intelligence_run','failed_run','failure','failed-request','test','{}','t','t');
    UPDATE intelligence_run_attempts SET status='FAILED_PERMANENT',safe_metadata_json='{"actualMicrousd":715}',error_category='PERMANENT',safe_error_detail='AI execution failed.',completed_at='t' WHERE id='failed_attempt';
    UPDATE editorial_execution_reservations SET actual_microusd=715,status='RECONCILED',reconciled_at='t' WHERE id='failed_reservation';
    UPDATE intelligence_runs SET status='FAILED_PERMANENT',safe_metadata_json='{"actualMicrousd":715}',input_units=1184,output_units=398,actual_cost=0.000715,currency='USD',error_category='PERMANENT',safe_error_detail='AI execution failed.',terminal_audit_event_id='failed_audit',completed_at='t',version=3 WHERE id='failed_run';
  `);
}

function harness() {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys=ON');
  for (const name of migrationNames)
    database.exec(readFileSync(new URL(name, migrationDirectory), 'utf8'));
  seed(database);
  const db = new TransactionalD1(database);
  const service = new EditorialExecutionService(
    db as unknown as D1Database,
    { id: 'owner', workspaceId: 'workspace', roles: ['owner'] },
    { openAIEnabled: false, openAIBaseUrl: 'https://invalid.test', requestId: 'request' },
  );
  return {
    database,
    db,
    service,
    persist: (service as unknown as { persist: Persist }).persist.bind(service),
  };
}

const output = {
  title: 'Neues Skript',
  languageCode: 'de',
  segments: [
    { order: 1, text: 'Erster Satz.' },
    { order: 2, text: 'Zweiter Satz.' },
  ],
};

const completion = {
  result: {
    output,
    providerRequestId: 'provider-new',
    usage: {
      inputUnits: 1184,
      outputUnits: 398,
      cachedInputUnits: 0,
      reasoningOutputUnits: 0,
      unitName: 'token' as const,
    },
    safeMetadata: { responseStatus: 'completed' },
  },
  costs: { actualCost: 0.000715, actualMicrousd: 715, currency: 'USD' },
  metadata: { actualMicrousd: 715 },
  governed: false,
  scriptSourceBrief: {
    workspaceId: 'workspace',
    projectId: 'project',
    artifactId: 'brief',
    artifactRevision: 6,
    versionId: 'brief_v3',
    contentHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    approvalId: 'brief_approval',
  },
  reservedMicrousd: null,
};

const persistScript = (h: ReturnType<typeof harness>, completed: typeof completion = completion) =>
  h.persist(
    'project',
    'SCRIPT_WRITER_SHORT',
    'run',
    'brief_v3',
    'de',
    'script-v1',
    [{ sourceVersionId: 'brief_v3', dependencyType: 'GENERATED_FROM' }],
    output,
    completed,
  );

const rows = (database: DatabaseSync, table: string) =>
  database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();

const snapshot = (database: DatabaseSync) =>
  Object.fromEntries(
    [
      'editorial_artifacts',
      'editorial_artifact_versions',
      'artifact_dependencies',
      'script_segments',
      'intelligence_runs',
      'intelligence_run_attempts',
      'editorial_execution_envelopes',
      'editorial_execution_reservations',
      'audit_events',
    ].map((table) => [table, rows(database, table)]),
  );

describe('Production Script replacement persistence ordering', () => {
  it('reproduces the historical FK failure when invalidation precedes the future version insert', () => {
    const h = harness();
    const before = snapshot(h.database);
    expect(() => {
      h.database.exec('BEGIN');
      try {
        h.database.exec(
          "UPDATE artifact_dependencies SET invalidated_by_version_id='future_script_v2' WHERE id='dep_translation'",
        );
        h.database.exec(
          "INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,parent_version_id,language_code,content_json,source_type,intelligence_run_id,content_hash,created_at,created_by) VALUES('future_script_v2','workspace','script',2,'script_v1','de','{}','AI_GENERATED','run','ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff','t','owner')",
        );
        h.database.exec('COMMIT');
      } catch (error) {
        h.database.exec('ROLLBACK');
        throw error;
      }
    }).toThrow(/FOREIGN KEY constraint failed/u);
    expect(snapshot(h.database)).toEqual(before);
    expect(h.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('inserts Script v2 before FK-backed invalidations and preserves the canonical graph', async () => {
    const h = harness();
    const historicalFailure = h.database
      .prepare("SELECT * FROM intelligence_runs WHERE id='failed_run'")
      .get();
    const historicalReservation = h.database
      .prepare("SELECT * FROM editorial_execution_reservations WHERE id='failed_reservation'")
      .get();

    const versionId = await persistScript(h);

    expect(
      h.database
        .prepare(
          "SELECT current_version_id,status,version FROM editorial_artifacts WHERE id='script'",
        )
        .get(),
    ).toEqual({ current_version_id: versionId, status: 'active', version: 4 });
    expect(
      h.database
        .prepare(
          'SELECT version_number,parent_version_id,source_type,intelligence_run_id FROM editorial_artifact_versions WHERE id=?',
        )
        .get(versionId),
    ).toEqual({
      version_number: 2,
      parent_version_id: 'script_v1',
      source_type: 'AI_GENERATED',
      intelligence_run_id: 'run',
    });
    expect(
      h.database
        .prepare(
          'SELECT source_artifact_version_id,dependency_type,validity_status FROM artifact_dependencies WHERE dependent_artifact_version_id=?',
        )
        .get(versionId),
    ).toEqual({
      source_artifact_version_id: 'brief_v3',
      dependency_type: 'GENERATED_FROM',
      validity_status: 'CURRENT',
    });
    const invalidations = h.database
      .prepare(
        "SELECT id,validity_status,invalidated_by_version_id,invalidated_at,version FROM artifact_dependencies WHERE source_artifact_version_id='script_v1' ORDER BY id",
      )
      .all() as Array<{
      id: string;
      validity_status: string;
      invalidated_by_version_id: string;
      invalidated_at: string;
      version: number;
    }>;
    expect(
      invalidations.map((row) => ({
        id: row.id,
        validity_status: row.validity_status,
        invalidated_by_version_id: row.invalidated_by_version_id,
        version: row.version,
      })),
    ).toEqual([
      {
        id: 'dep_critique',
        validity_status: 'REGENERATION_REQUIRED',
        invalidated_by_version_id: versionId,
        version: 2,
      },
      {
        id: 'dep_storyboard',
        validity_status: 'REAPPROVAL_REQUIRED',
        invalidated_by_version_id: versionId,
        version: 2,
      },
      {
        id: 'dep_translation',
        validity_status: 'REGENERATION_REQUIRED',
        invalidated_by_version_id: versionId,
        version: 2,
      },
    ]);
    expect(invalidations.every((row) => typeof row.invalidated_at === 'string')).toBe(true);
    expect(
      h.database.prepare("SELECT * FROM editorial_artifact_versions WHERE id='script_v1'").get(),
    ).toBeTruthy();
    expect(
      h.database
        .prepare(
          "SELECT COUNT(*) count FROM editorial_artifact_versions WHERE artifact_id='translation'",
        )
        .get(),
    ).toEqual({ count: 1 });
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
          "SELECT COUNT(*) count FROM editorial_artifact_versions WHERE artifact_id='storyboard'",
        )
        .get(),
    ).toEqual({ count: 1 });
    expect(
      h.database.prepare("SELECT * FROM intelligence_runs WHERE id='failed_run'").get(),
    ).toEqual(historicalFailure);
    expect(
      h.database
        .prepare("SELECT * FROM editorial_execution_reservations WHERE id='failed_reservation'")
        .get(),
    ).toEqual(historicalReservation);
    expect(
      h.database
        .prepare(
          "SELECT COUNT(*) count FROM editorial_execution_reservations WHERE envelope_id='bounded'",
        )
        .get(),
    ).toEqual({ count: 1 });
    expect(h.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('rolls back the complete terminal graph after every injected batch-statement failure', async () => {
    const probe = harness();
    await persistScript(probe);
    const statementCount = probe.db.lastBatchSize;
    expect(statementCount).toBeGreaterThanOrEqual(11);
    probe.database.close();

    for (let failAfter = 1; failAfter <= statementCount; failAfter += 1) {
      const h = harness();
      const before = snapshot(h.database);
      h.db.failBatchAfter = failAfter;
      await expect(persistScript(h), `statement ${failAfter}`).rejects.toThrow(
        'injected_terminal_batch_failure',
      );
      expect(snapshot(h.database), `statement ${failAfter}`).toEqual(before);
      expect(h.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      h.database.close();
    }
  });

  it('fails closed for an unexpected CURRENT downstream artifact type', async () => {
    const h = harness();
    h.database.exec(`
      INSERT INTO editorial_artifacts(id,workspace_id,project_id,artifact_type,status,current_version_id,created_at,updated_at,version,created_by,updated_by) VALUES('unexpected','workspace','project','RESEARCH','active',NULL,'t','t',1,'owner','owner');
      INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,language_code,content_json,source_type,content_hash,created_at,created_by) VALUES('unexpected_v','workspace','unexpected',1,'de','{}','HUMAN_EDITED','ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff','t','owner');
      UPDATE editorial_artifacts SET current_version_id='unexpected_v' WHERE id='unexpected';
      INSERT INTO artifact_dependencies(id,workspace_id,source_artifact_version_id,dependent_artifact_version_id,dependency_type,validity_status,created_at,updated_at,version) VALUES('unexpected_dep','workspace','script_v1','unexpected_v','GENERATED_FROM','CURRENT','t','t',1);
    `);
    const before = snapshot(h.database);
    await expect(persistScript(h)).rejects.toThrow(
      'Current downstream dependency set is incompatible with the terminal invalidation plan.',
    );
    expect(snapshot(h.database)).toEqual(before);
  });

  it('preserves already stale links and permits an absent optional downstream type', async () => {
    const h = harness();
    h.database.exec(
      "UPDATE artifact_dependencies SET validity_status='STALE' WHERE id='dep_storyboard'; DELETE FROM artifact_dependencies WHERE id='dep_critique';",
    );
    const versionId = await persistScript(h);
    expect(
      h.database
        .prepare(
          "SELECT validity_status,invalidated_by_version_id,version FROM artifact_dependencies WHERE id='dep_storyboard'",
        )
        .get(),
    ).toEqual({ validity_status: 'STALE', invalidated_by_version_id: null, version: 1 });
    expect(
      h.database
        .prepare(
          "SELECT validity_status,invalidated_by_version_id FROM artifact_dependencies WHERE id='dep_translation'",
        )
        .get(),
    ).toEqual({ validity_status: 'REGENERATION_REQUIRED', invalidated_by_version_id: versionId });
  });

  it('rolls back on stale artifact CAS and concurrent dependent-state drift', async () => {
    for (const mutation of [
      "UPDATE editorial_artifacts SET version=version+1 WHERE id='script'",
      "UPDATE artifact_dependencies SET validity_status='STALE',version=version+1 WHERE id='dep_translation'",
    ]) {
      const h = harness();
      h.db.beforeBatch = () => h.database.exec(mutation);
      await expect(persistScript(h)).rejects.toThrow();
      expect(
        h.database
          .prepare(
            "SELECT COUNT(*) count FROM editorial_artifact_versions WHERE artifact_id='script'",
          )
          .get(),
      ).toEqual({ count: 1 });
      expect(
        h.database
          .prepare("SELECT current_version_id FROM editorial_artifacts WHERE id='script'")
          .get(),
      ).toEqual({ current_version_id: 'script_v1' });
      expect(
        h.database
          .prepare(
            "SELECT COUNT(*) count FROM artifact_dependencies WHERE dependent_artifact_version_id NOT IN ('translation_v1','critique_v1','storyboard_v1')",
          )
          .get(),
      ).toEqual({ count: 0 });
      expect(h.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      h.database.close();
    }
  });
});

describe('Production Script exact dependency semantic guard', () => {
  const assertAtomicSemanticRejection = async (h: ReturnType<typeof harness>) => {
    const before = snapshot(h.database);
    await expect(persistScript(h)).rejects.toThrow();
    expect(snapshot(h.database)).toEqual(before);
    expect(
      h.database
        .prepare(
          "SELECT current_version_id,status,version FROM editorial_artifacts WHERE id='script'",
        )
        .get(),
    ).toEqual({ current_version_id: 'script_v1', status: 'approved', version: 3 });
    expect(
      h.database
        .prepare(
          "SELECT COUNT(*) count FROM editorial_artifact_versions WHERE artifact_id='script'",
        )
        .get(),
    ).toEqual({ count: 1 });
    expect(h.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  };

  it.each([
    [
      'wrong Brief source version',
      "CREATE TRIGGER tamper AFTER INSERT ON artifact_dependencies WHEN NEW.source_artifact_version_id='brief_v3' AND NEW.dependency_type='GENERATED_FROM' BEGIN UPDATE artifact_dependencies SET source_artifact_version_id='translation_v1' WHERE id=NEW.id; END",
    ],
    [
      'wrong lineage dependency type',
      "CREATE TRIGGER tamper AFTER INSERT ON artifact_dependencies WHEN NEW.source_artifact_version_id='brief_v3' AND NEW.dependency_type='GENERATED_FROM' BEGIN UPDATE artifact_dependencies SET dependency_type='EVALUATES_SOURCE' WHERE id=NEW.id; END",
    ],
    [
      'lineage status STALE',
      "CREATE TRIGGER tamper AFTER INSERT ON artifact_dependencies WHEN NEW.source_artifact_version_id='brief_v3' AND NEW.dependency_type='GENERATED_FROM' BEGIN UPDATE artifact_dependencies SET validity_status='STALE' WHERE id=NEW.id; END",
    ],
    [
      'lineage invalidated unexpectedly',
      "CREATE TRIGGER tamper AFTER INSERT ON artifact_dependencies WHEN NEW.source_artifact_version_id='brief_v3' AND NEW.dependency_type='GENERATED_FROM' BEGIN UPDATE artifact_dependencies SET validity_status='STALE',invalidated_at='tampered',invalidated_by_version_id='script_v1' WHERE id=NEW.id; END",
    ],
    [
      'duplicate GENERATED_FROM lineage',
      "CREATE TRIGGER tamper AFTER INSERT ON artifact_dependencies WHEN NEW.source_artifact_version_id='brief_v3' AND NEW.dependency_type='GENERATED_FROM' BEGIN INSERT INTO artifact_dependencies(id,workspace_id,source_artifact_version_id,dependent_artifact_version_id,dependency_type,validity_status,created_at,updated_at,version) VALUES('tamper_extra','workspace','translation_v1',NEW.dependent_artifact_version_id,'GENERATED_FROM','CURRENT','t','t',1); END",
    ],
    [
      'missing lineage',
      "CREATE TRIGGER tamper BEFORE INSERT ON artifact_dependencies WHEN NEW.source_artifact_version_id='brief_v3' AND NEW.dependency_type='GENERATED_FROM' BEGIN SELECT RAISE(IGNORE); END",
    ],
    [
      'extra incoming lineage',
      "CREATE TRIGGER tamper AFTER INSERT ON artifact_dependencies WHEN NEW.source_artifact_version_id='brief_v3' AND NEW.dependency_type='GENERATED_FROM' BEGIN INSERT INTO artifact_dependencies(id,workspace_id,source_artifact_version_id,dependent_artifact_version_id,dependency_type,validity_status,created_at,updated_at,version) VALUES('tamper_extra','workspace','translation_v1',NEW.dependent_artifact_version_id,'USES_RESEARCH','CURRENT','t','t',1); END",
    ],
    [
      'Translation status STALE',
      "CREATE TRIGGER tamper AFTER UPDATE OF validity_status ON artifact_dependencies WHEN NEW.id='dep_translation' AND NEW.invalidated_by_version_id IS NOT NULL BEGIN UPDATE artifact_dependencies SET validity_status='STALE' WHERE id=NEW.id; END",
    ],
    [
      'Translation status REAPPROVAL_REQUIRED',
      "CREATE TRIGGER tamper AFTER UPDATE OF validity_status ON artifact_dependencies WHEN NEW.id='dep_translation' AND NEW.invalidated_by_version_id IS NOT NULL BEGIN UPDATE artifact_dependencies SET validity_status='REAPPROVAL_REQUIRED' WHERE id=NEW.id; END",
    ],
    [
      'Critique status STALE',
      "CREATE TRIGGER tamper AFTER UPDATE OF validity_status ON artifact_dependencies WHEN NEW.id='dep_critique' AND NEW.invalidated_by_version_id IS NOT NULL BEGIN UPDATE artifact_dependencies SET validity_status='STALE' WHERE id=NEW.id; END",
    ],
    [
      'Critique status REAPPROVAL_REQUIRED',
      "CREATE TRIGGER tamper AFTER UPDATE OF validity_status ON artifact_dependencies WHEN NEW.id='dep_critique' AND NEW.invalidated_by_version_id IS NOT NULL BEGIN UPDATE artifact_dependencies SET validity_status='REAPPROVAL_REQUIRED' WHERE id=NEW.id; END",
    ],
    [
      'Storyboard status STALE',
      "CREATE TRIGGER tamper AFTER UPDATE OF validity_status ON artifact_dependencies WHEN NEW.id='dep_storyboard' AND NEW.invalidated_by_version_id IS NOT NULL BEGIN UPDATE artifact_dependencies SET validity_status='STALE' WHERE id=NEW.id; END",
    ],
    [
      'Storyboard status REGENERATION_REQUIRED',
      "CREATE TRIGGER tamper AFTER UPDATE OF validity_status ON artifact_dependencies WHEN NEW.id='dep_storyboard' AND NEW.invalidated_by_version_id IS NOT NULL BEGIN UPDATE artifact_dependencies SET validity_status='REGENERATION_REQUIRED' WHERE id=NEW.id; END",
    ],
    [
      'wrong invalidated_by_version_id',
      "CREATE TRIGGER tamper AFTER UPDATE OF invalidated_by_version_id ON artifact_dependencies WHEN NEW.id='dep_translation' AND NEW.invalidated_by_version_id IS NOT NULL BEGIN UPDATE artifact_dependencies SET invalidated_by_version_id='script_v1' WHERE id=NEW.id; END",
    ],
    [
      'missing invalidated_at',
      "CREATE TRIGGER tamper AFTER UPDATE OF invalidated_at ON artifact_dependencies WHEN NEW.id='dep_translation' AND NEW.invalidated_by_version_id IS NOT NULL BEGIN UPDATE artifact_dependencies SET invalidated_at=NULL WHERE id=NEW.id; END",
    ],
    [
      'wrong downstream target',
      "CREATE TRIGGER tamper AFTER UPDATE OF dependent_artifact_version_id ON artifact_dependencies WHEN NEW.id='dep_translation' AND NEW.invalidated_by_version_id IS NOT NULL BEGIN SELECT 1; END; CREATE TRIGGER retarget AFTER UPDATE OF invalidated_by_version_id ON artifact_dependencies WHEN NEW.id='dep_translation' AND NEW.invalidated_by_version_id IS NOT NULL BEGIN UPDATE artifact_dependencies SET dependent_artifact_version_id='critique_v1' WHERE id=NEW.id; END",
    ],
  ])('rolls back when the final guard observes %s', async (_label, triggerSql) => {
    const h = harness();
    h.database.exec(triggerSql);
    await assertAtomicSemanticRejection(h);
    h.database.close();
  });

  it('rejects a duplicate CURRENT downstream semantic type before persistence', async () => {
    const h = harness();
    h.database.exec(
      "INSERT INTO artifact_dependencies(id,workspace_id,source_artifact_version_id,dependent_artifact_version_id,dependency_type,validity_status,created_at,updated_at,version) VALUES('dep_translation_duplicate','workspace','script_v1','translation_v1','EVALUATES_SOURCE','CURRENT','t','t',1)",
    );
    await assertAtomicSemanticRejection(h);
    h.database.close();
  });

  it('rejects an unexpected downstream dependency type before persistence', async () => {
    const h = harness();
    h.database.exec(
      "UPDATE artifact_dependencies SET dependency_type='EVALUATES_SOURCE' WHERE id='dep_translation'",
    );
    await assertAtomicSemanticRejection(h);
    h.database.close();
  });
});

type ScriptContext = {
  scriptSourceBrief: typeof completion.scriptSourceBrief;
  lineage: Array<{ sourceVersionId: string; dependencyType: string }>;
  approvedArtifacts: Array<{ artifactType: string; versionId: string }>;
};

const loadScriptContext = (h: ReturnType<typeof harness>, inputVersionId: string | null) =>
  (
    h.service as unknown as {
      projectContext(
        projectId: string,
        task: 'SCRIPT_WRITER_SHORT',
        inputVersionId: string | null,
        researchOnly: boolean,
      ): Promise<ScriptContext>;
    }
  ).projectContext('project', 'SCRIPT_WRITER_SHORT', inputVersionId, false);

const addHistoricalBrief = (database: DatabaseSync) =>
  database.exec(
    "INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,parent_version_id,language_code,content_json,source_type,intelligence_run_id,content_hash,created_at,created_by) VALUES('brief_v2','workspace','brief',2,NULL,'de','{}','HUMAN_EDITED',NULL,'fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff2','t','owner')",
  );

const addWrongTypeSources = (database: DatabaseSync) =>
  database.exec(`
    INSERT INTO editorial_artifacts(id,workspace_id,project_id,artifact_type,status,current_version_id,created_at,updated_at,version,created_by,updated_by) VALUES
      ('research','workspace','project','RESEARCH','approved',NULL,'t','t',2,'owner','owner'),
      ('idea','workspace','project','IDEA_CANDIDATE','approved',NULL,'t','t',2,'owner','owner');
    INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,language_code,content_json,source_type,intelligence_run_id,content_hash,created_at,created_by) VALUES
      ('research_v1','workspace','research',1,'de','{}','HUMAN_EDITED',NULL,'fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff3','t','owner'),
      ('idea_v1','workspace','idea',1,'de','{}','HUMAN_EDITED',NULL,'fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff4','t','owner');
    UPDATE editorial_artifacts SET current_version_id='research_v1' WHERE id='research';
    UPDATE editorial_artifacts SET current_version_id='idea_v1' WHERE id='idea';
    INSERT INTO artifact_approvals(id,workspace_id,artifact_version_id,decision,actor_id,actor_role,decided_at) VALUES
      ('research_approval','workspace','research_v1','APPROVED','owner','owner','t'),
      ('idea_approval','workspace','idea_v1','APPROVED','owner','owner','t');
  `);

describe('Production Script authoritative Content Brief binding', () => {
  it('derives one server-side Brief snapshot and uses it for provider context and lineage', async () => {
    const h = harness();
    const context = await loadScriptContext(h, 'brief_v3');
    expect(context.scriptSourceBrief).toEqual(completion.scriptSourceBrief);
    expect(context.lineage).toEqual([
      { sourceVersionId: 'brief_v3', dependencyType: 'GENERATED_FROM' },
    ]);
    expect(
      context.approvedArtifacts.filter((artifact) => artifact.artifactType === 'CONTENT_BRIEF'),
    ).toEqual([expect.objectContaining({ artifactType: 'CONTENT_BRIEF', versionId: 'brief_v3' })]);
  });

  it('permanently rejects the original obsolete-Brief HIGH before provider or canonical writes', async () => {
    const h = harness();
    addHistoricalBrief(h.database);
    const before = snapshot(h.database);
    await expect(loadScriptContext(h, 'brief_v2')).rejects.toThrow(
      'The exact authoritative current approved Content Brief input is required.',
    );
    expect(snapshot(h.database)).toEqual(before);
    expect(
      h.database
        .prepare(
          "SELECT COUNT(*) count FROM editorial_artifact_versions WHERE artifact_id='script'",
        )
        .get(),
    ).toEqual({ count: 1 });
  });

  it.each([
    ['historical Brief', 'brief_v2'],
    ['Research version', 'research_v1'],
    ['Idea version', 'idea_v1'],
    ['Script version', 'script_v1'],
    ['nonexistent version', 'missing'],
  ])('rejects %s as Script input', async (_label, inputVersionId) => {
    const h = harness();
    addHistoricalBrief(h.database);
    addWrongTypeSources(h.database);
    await expect(loadScriptContext(h, inputVersionId)).rejects.toThrow(
      'The exact authoritative current approved Content Brief input is required.',
    );
  });

  it.each([
    [
      'current but unapproved Brief',
      "UPDATE editorial_artifacts SET status='active' WHERE id='brief'",
    ],
    [
      'rejected Brief',
      "UPDATE editorial_artifacts SET status='active' WHERE id='brief'; INSERT INTO artifact_approvals(id,workspace_id,artifact_version_id,decision,actor_id,actor_role,decided_at) VALUES('brief_rejection','workspace','brief_v3','REJECTED','owner','owner','t2')",
    ],
  ])('rejects %s', async (_label, mutation) => {
    const h = harness();
    h.database.exec(mutation);
    await expect(loadScriptContext(h, 'brief_v3')).rejects.toThrow(
      'The exact authoritative current approved Content Brief input is required.',
    );
  });

  it('rejects a current approved Brief from another project', async () => {
    const h = harness();
    h.database.exec(`
      INSERT INTO projects(id,workspace_id,content_brand_id,channel_profile_id,title,format,operating_mode,primary_language,status,created_at,updated_at,version) VALUES('other_project','workspace','brand','channel','Other','SHORT','ASSISTED','de','ANALYZING','t','t',1);
      INSERT INTO editorial_artifacts(id,workspace_id,project_id,artifact_type,status,current_version_id,created_at,updated_at,version,created_by,updated_by) VALUES('other_brief','workspace','other_project','CONTENT_BRIEF','approved',NULL,'t','t',2,'owner','owner');
      INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,language_code,content_json,source_type,intelligence_run_id,content_hash,created_at,created_by) VALUES('other_brief_v1','workspace','other_brief',1,'de','{}','HUMAN_EDITED',NULL,'fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff5','t','owner');
      UPDATE editorial_artifacts SET current_version_id='other_brief_v1' WHERE id='other_brief';
      INSERT INTO artifact_approvals(id,workspace_id,artifact_version_id,decision,actor_id,actor_role,decided_at) VALUES('other_brief_approval','workspace','other_brief_v1','APPROVED','owner','owner','t');
    `);
    await expect(loadScriptContext(h, 'other_brief_v1')).rejects.toThrow(
      'The exact authoritative current approved Content Brief input is required.',
    );
  });

  it('rejects a current approved Brief from another workspace', async () => {
    const h = harness();
    h.database.exec(`
      INSERT INTO workspaces(id,slug,name,created_at,updated_at,version) VALUES('other_workspace','ow','OW','t','t',1);
      INSERT INTO users(id,workspace_id,email,status,created_at,updated_at,version) VALUES('other_owner','other_workspace','other@test','active','t','t',1);
      INSERT INTO content_brands(id,workspace_id,name,normalized_name,primary_language,created_at,updated_at,version) VALUES('other_brand','other_workspace','Other Brand','other-brand','de','t','t',1);
      INSERT INTO channel_profiles(id,workspace_id,content_brand_id,name,normalized_name,primary_language,created_at,updated_at,version) VALUES('other_channel','other_workspace','other_brand','Other Channel','other-channel','de','t','t',1);
      INSERT INTO projects(id,workspace_id,content_brand_id,channel_profile_id,title,format,operating_mode,primary_language,status,created_at,updated_at,version) VALUES('other_workspace_project','other_workspace','other_brand','other_channel','Other','SHORT','ASSISTED','de','ANALYZING','t','t',1);
      INSERT INTO editorial_artifacts(id,workspace_id,project_id,artifact_type,status,current_version_id,created_at,updated_at,version,created_by,updated_by) VALUES('foreign_brief','other_workspace','other_workspace_project','CONTENT_BRIEF','approved',NULL,'t','t',2,'other_owner','other_owner');
      INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,language_code,content_json,source_type,intelligence_run_id,content_hash,created_at,created_by) VALUES('foreign_brief_v1','other_workspace','foreign_brief',1,'de','{}','HUMAN_EDITED',NULL,'fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff6','t','other_owner');
      UPDATE editorial_artifacts SET current_version_id='foreign_brief_v1' WHERE id='foreign_brief';
      INSERT INTO artifact_approvals(id,workspace_id,artifact_version_id,decision,actor_id,actor_role,decided_at) VALUES('foreign_brief_approval','other_workspace','foreign_brief_v1','APPROVED','other_owner','owner','t');
    `);
    await expect(loadScriptContext(h, 'foreign_brief_v1')).rejects.toThrow(
      'The exact authoritative current approved Content Brief input is required.',
    );
  });

  it.each([
    [
      'Brief current pointer drift',
      "INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,parent_version_id,language_code,content_json,source_type,intelligence_run_id,content_hash,created_at,created_by) VALUES('brief_v4','workspace','brief',4,'brief_v3','de','{}','HUMAN_EDITED',NULL,'fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7','t','owner'); UPDATE editorial_artifacts SET current_version_id='brief_v4',version=version+1 WHERE id='brief'",
    ],
    [
      'Brief approval/status drift',
      "UPDATE editorial_artifacts SET status='active' WHERE id='brief'",
    ],
    [
      'Brief artifact revision drift',
      "UPDATE editorial_artifacts SET version=version+1 WHERE id='brief'",
    ],
    [
      'Brief project drift',
      "INSERT INTO projects(id,workspace_id,content_brand_id,channel_profile_id,title,format,operating_mode,primary_language,status,created_at,updated_at,version) VALUES('other_project','workspace','brand','channel','Other','SHORT','ASSISTED','de','ANALYZING','t','t',1); UPDATE editorial_artifacts SET project_id='other_project' WHERE id='brief'",
    ],
  ])('rolls back canonical persistence after %s', async (_label, mutation) => {
    const h = harness();
    h.db.beforeBatch = () => h.database.exec(mutation);
    await expect(persistScript(h)).rejects.toThrow();
    expect(
      h.database
        .prepare(
          "SELECT COUNT(*) count FROM editorial_artifact_versions WHERE artifact_id='script'",
        )
        .get(),
    ).toEqual({ count: 1 });
    expect(
      h.database
        .prepare("SELECT current_version_id,version FROM editorial_artifacts WHERE id='script'")
        .get(),
    ).toEqual({ current_version_id: 'script_v1', version: 3 });
    expect(h.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it.each([
    ['source content hash mismatch', { contentHash: 'f'.repeat(64) }],
    ['source artifact revision mismatch', { artifactRevision: 7 }],
    ['source artifact identity mismatch', { artifactId: 'translation' }],
    ['source workspace mismatch', { workspaceId: 'foreign' }],
    ['source project mismatch', { projectId: 'foreign' }],
  ])('rejects final source snapshot with %s', async (_label, override) => {
    const h = harness();
    await expect(
      persistScript(h, {
        ...completion,
        scriptSourceBrief: { ...completion.scriptSourceBrief, ...override },
      }),
    ).rejects.toThrow();
    expect(
      h.database
        .prepare(
          "SELECT COUNT(*) count FROM editorial_artifact_versions WHERE artifact_id='script'",
        )
        .get(),
    ).toEqual({ count: 1 });
    expect(h.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('blocks provider-context and canonical-lineage divergence', async () => {
    const h = harness();
    addHistoricalBrief(h.database);
    const context = await loadScriptContext(h, 'brief_v3');
    expect(context.scriptSourceBrief.versionId).toBe('brief_v3');
    await expect(
      h.persist(
        'project',
        'SCRIPT_WRITER_SHORT',
        'run',
        'brief_v2',
        'de',
        'script-v1',
        [{ sourceVersionId: 'brief_v2', dependencyType: 'GENERATED_FROM' }],
        output,
        completion,
      ),
    ).rejects.toThrow('Production Script lineage is incompatible');
    expect(
      h.database
        .prepare(
          "SELECT COUNT(*) count FROM editorial_artifact_versions WHERE artifact_id='script'",
        )
        .get(),
    ).toEqual({ count: 1 });
  });
});

describe('Production Script source authorization boundary', () => {
  it('rejects a deleted authoritative Brief before execution authorization', async () => {
    const h = harness();
    h.database.exec("UPDATE editorial_artifacts SET deleted_at='t2' WHERE id='brief'");
    await expect(loadScriptContext(h, 'brief_v3')).rejects.toThrow(
      'The exact authoritative current approved Content Brief input is required.',
    );
  });

  it('atomically rejects source drift before the Run authorization claim', async () => {
    const h = harness();
    const context = await loadScriptContext(h, 'brief_v3');
    const guard = (
      h.service as unknown as {
        scriptSourceBriefGuard(snapshot: typeof completion.scriptSourceBrief): SqliteStatement;
      }
    ).scriptSourceBriefGuard(context.scriptSourceBrief);
    const insertRun = h.db.prepare(
      `INSERT INTO intelligence_runs(id,workspace_id,project_id,task_type,input_artifact_version_id,initiated_by,operating_mode,status,idempotency_key,creative_regeneration_number,safe_metadata_json,created_at,updated_at,version) VALUES('authorization_probe','workspace','project','SCRIPT_WRITER_SHORT','brief_v3','owner','ASSISTED','QUEUED','authorization-probe',0,'{}','t','t',1)`,
    );
    h.db.beforeBatch = () =>
      h.database.exec("UPDATE editorial_artifacts SET version=version+1 WHERE id='brief'");
    await expect(h.db.batch([guard, insertRun])).rejects.toThrow('malformed JSON');
    expect(
      h.database
        .prepare("SELECT COUNT(*) count FROM intelligence_runs WHERE id='authorization_probe'")
        .get(),
    ).toEqual({ count: 0 });
    expect(h.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
});
