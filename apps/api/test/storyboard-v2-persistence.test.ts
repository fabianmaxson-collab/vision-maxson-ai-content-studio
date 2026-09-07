import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { storyboardOutputV2Schema } from '@vision-maxson/contracts';
import { describe, expect, it } from 'vitest';
import { EditorialExecutionService } from '../src/editorial/execution';

const migrationNames = [
  '0000_phase_1_data_security_core.sql',
  '0001_phase_2_product_channel_monetization.sql',
  '0002_phase_3_editorial_intelligence.sql',
  '0003_editorial_execution_budgets.sql',
  '0004_terminal_pipeline_hardening.sql',
  '0005_deterministic_preflight_provenance.sql',
  '0006_storyboard_v2_contract_hardening.sql',
] as const;

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

class TransactionalD1 {
  failBatchAfter: number | null = null;
  constructor(readonly database: DatabaseSync) {}
  prepare(sql: string) {
    return new SqliteStatement(this.database, sql);
  }
  async batch(statements: SqliteStatement[]) {
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
  task: 'STORYBOARD_PLANNER',
  runId: string,
  inputVersionId: string,
  language: string,
  outputSchemaVersion: string,
  lineage: Array<{
    sourceVersionId: string;
    dependencyType: 'GENERATED_FROM' | 'INFORMED_BY';
  }>,
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
    costs: { actualCost: number; currency: string };
    metadata: Record<string, unknown>;
    governed: boolean;
    reservedMicrousd: null;
  },
) => Promise<string>;

const sql = (name: (typeof migrationNames)[number]) =>
  readFileSync(new URL(`../../../packages/db/migrations/${name}`, import.meta.url), 'utf8');

function harness() {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys=ON');
  for (const migration of migrationNames) database.exec(sql(migration));
  database.exec(`
    INSERT INTO workspaces(id,slug,name,created_at,updated_at,version) VALUES('workspace','w','W','t','t',1);
    INSERT INTO users(id,workspace_id,email,status,created_at,updated_at,version) VALUES('owner','workspace','owner@test','active','t','t',1);
    INSERT INTO content_brands(id,workspace_id,name,normalized_name,primary_language,created_at,updated_at,version) VALUES('brand','workspace','B','b','de','t','t',1);
    INSERT INTO channel_profiles(id,workspace_id,content_brand_id,name,normalized_name,primary_language,created_at,updated_at,version) VALUES('channel','workspace','brand','C','c','de','t','t',1);
    INSERT INTO projects(id,workspace_id,content_brand_id,channel_profile_id,title,format,operating_mode,primary_language,status,created_at,updated_at,version) VALUES
      ('project','workspace','brand','channel','P','SHORT','ASSISTED','de','ANALYZING','t','t',1),
      ('other_project','workspace','brand','channel','Other','SHORT','ASSISTED','de','ANALYZING','t','t',1);
    INSERT INTO editorial_artifacts(id,workspace_id,project_id,artifact_type,status,current_version_id,created_at,updated_at,version,created_by,updated_by) VALUES
      ('script','workspace','project','PRODUCTION_SCRIPT','approved','script_v','t','t',1,'owner','owner'),
      ('critique','workspace','project','SCRIPT_CRITIQUE','approved','critique_v','t','t',1,'owner','owner'),
      ('other_script','workspace','other_project','PRODUCTION_SCRIPT','approved','other_script_v','t','t',1,'owner','owner');
    INSERT INTO intelligence_runs(id,workspace_id,project_id,task_type,initiated_by,operating_mode,status,idempotency_key,created_at,updated_at,version) VALUES('run','workspace','project','STORYBOARD_PLANNER','owner','ASSISTED','RUNNING','storyboard-test','t','t',1);
    INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,language_code,content_json,source_type,content_hash,created_at,created_by) VALUES
      ('script_v','workspace','script',1,'de','{}','HUMAN_EDITED','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','t','owner'),
      ('critique_v','workspace','critique',1,'de','{}','HUMAN_EDITED','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','t','owner'),
      ('other_script_v','workspace','other_script',1,'de','{}','HUMAN_EDITED','cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc','t','owner');
    INSERT INTO script_segments(id,workspace_id,script_version_id,segment_order,content_text,content_hash,word_count,created_at) VALUES
      ('segment_1','workspace','script_v',1,'Erster Satz.','dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',2,'t'),
      ('segment_2','workspace','script_v',2,'Zweiter Satz.','eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',2,'t'),
      ('other_segment','workspace','other_script_v',1,'Fremder Satz.','ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',2,'t');
    INSERT INTO intelligence_run_attempts(id,intelligence_run_id,attempt_number,attempt_kind,status,started_at) VALUES('attempt','run',1,'TECHNICAL','RUNNING','t');
  `);
  const db = new TransactionalD1(database);
  const service = new EditorialExecutionService(
    db as unknown as D1Database,
    { id: 'owner', workspaceId: 'workspace', roles: ['owner'] },
    {
      openAIEnabled: false,
      openAIBaseUrl: 'https://invalid.test',
      requestId: 'request',
      environment: 'test',
    },
  );
  return {
    database,
    db,
    persist: (service as unknown as { persist: Persist }).persist.bind(service),
  };
}

const scene = (scriptSegmentIds: string[] = ['segment_1', 'segment_2']) => ({
  order: 1,
  targetDurationSeconds: 15,
  scriptSegmentIds,
  narrationMode: 'AUTHORITATIVE_SCRIPT_SEGMENTS' as const,
  visualDescription: 'Eine vertikale historische Szene.',
  location: 'Berlin',
  action: 'Die Kamera folgt der Hauptfigur.',
  cameraFraming: 'Medium shot',
  cameraMovement: 'Langsame Fahrt',
  mood: 'Nachdenklich',
  continuityKey: 'main-character',
  continuityReferenceKeys: [] as string[],
  continuityNotes: 'Identische Kleidung.',
  transitionNotes: 'Harter Schnitt.',
  aspectRatio: '9:16' as const,
  safeAreaGuidance: {
    protectTop: true,
    protectBottom: true,
    protectSides: true,
    notes: 'Text in der Mitte halten.',
  },
  onScreenText: [] as never[],
  captions: {
    mode: 'BURNED_IN' as const,
    languageCode: 'de',
    sourceScriptSegmentIds: scriptSegmentIds,
    styleGuidance: 'Gut lesbar.',
    safeAreaNotes: 'Untertitel oberhalb der UI.',
  },
  factualClaims: [] as never[],
  recommendedMediaType: 'IMAGE' as const,
  assetRequirements: ['Historisch plausibel'],
  mediaReferences: [] as never[],
  generationInstructions: 'Keine eingebettete Schrift erzeugen.',
  characterVersionIds: [] as string[],
  audioGuidance: {
    ambience: 'Leise Stadtgeräusche',
    soundEffects: [] as string[],
    music: { use: 'NONE' as const, guidance: null, rightsStatus: 'UNKNOWN' as const },
  },
});

const output = (scriptSegmentIds?: string[]) => ({
  contractVersion: 'storyboard-output-v2' as const,
  projectFormat: 'SHORT' as const,
  aspectRatio: '9:16' as const,
  scenes: [scene(scriptSegmentIds)],
});

const completion = (value: unknown) => ({
  result: {
    output: value,
    providerRequestId: 'provider-request',
    usage: {
      inputUnits: 10,
      outputUnits: 20,
      cachedInputUnits: 0,
      reasoningOutputUnits: 0,
      unitName: 'token' as const,
    },
    safeMetadata: {},
  },
  costs: { actualCost: 0.01, currency: 'USD' },
  metadata: {},
  governed: false,
  reservedMicrousd: null,
});

const graphCounts = (database: DatabaseSync) => ({
  artifacts: database
    .prepare("SELECT COUNT(*) count FROM editorial_artifacts WHERE artifact_type='STORYBOARD'")
    .get(),
  versions: database
    .prepare(
      "SELECT COUNT(*) count FROM editorial_artifact_versions v JOIN editorial_artifacts a ON a.id=v.artifact_id WHERE a.artifact_type='STORYBOARD'",
    )
    .get(),
  scenes: database.prepare('SELECT COUNT(*) count FROM storyboard_scenes').get(),
  links: database.prepare('SELECT COUNT(*) count FROM scene_script_segments').get(),
  dependencies: database.prepare('SELECT COUNT(*) count FROM artifact_dependencies').get(),
  successAudits: database
    .prepare("SELECT COUNT(*) count FROM audit_events WHERE action='intelligence.run_completed'")
    .get(),
});

async function persistStoryboard(h: ReturnType<typeof harness>, value: ReturnType<typeof output>) {
  return h.persist(
    'project',
    'STORYBOARD_PLANNER',
    'run',
    'script_v',
    'de',
    'storyboard-output-v2',
    [
      { sourceVersionId: 'script_v', dependencyType: 'GENERATED_FROM' },
      { sourceVersionId: 'critique_v', dependencyType: 'INFORMED_BY' },
    ],
    value,
    completion(value),
  );
}

describe('Storyboard V2 terminal persistence', () => {
  it('persists the complete graph, exact ordered segment links, lineage, run and audit atomically', async () => {
    const h = harness();
    const versionId = await persistStoryboard(h, output());

    expect(graphCounts(h.database)).toEqual({
      artifacts: { count: 1 },
      versions: { count: 1 },
      scenes: { count: 1 },
      links: { count: 2 },
      dependencies: { count: 2 },
      successAudits: { count: 1 },
    });
    expect(
      h.database
        .prepare(
          'SELECT script_segment_id segmentId,segment_order segmentOrder FROM scene_script_segments ORDER BY segment_order',
        )
        .all(),
    ).toEqual([
      { segmentId: 'segment_1', segmentOrder: 1 },
      { segmentId: 'segment_2', segmentOrder: 2 },
    ]);
    expect(
      h.database
        .prepare(
          'SELECT dependency_type dependencyType,source_artifact_version_id sourceVersionId FROM artifact_dependencies ORDER BY dependency_type',
        )
        .all(),
    ).toEqual([
      { dependencyType: 'GENERATED_FROM', sourceVersionId: 'script_v' },
      { dependencyType: 'INFORMED_BY', sourceVersionId: 'critique_v' },
    ]);
    expect(
      h.database
        .prepare('SELECT status,output_artifact_version_id outputVersionId FROM intelligence_runs')
        .get(),
    ).toEqual({ status: 'SUCCEEDED', outputVersionId: versionId });
    expect(h.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it.each([
    ['unknown', ['missing_segment']],
    ['wrong script', ['other_segment']],
  ])('rejects a %s segment without any successful Storyboard persistence', async (_label, ids) => {
    const h = harness();
    const before = graphCounts(h.database);

    await expect(persistStoryboard(h, output(ids))).rejects.toThrow(
      'Storyboard segment linkage is invalid.',
    );

    expect(graphCounts(h.database)).toEqual(before);
    expect(h.database.prepare('SELECT status FROM intelligence_runs').get()).toEqual({
      status: 'RUNNING',
    });
    expect(h.database.prepare('SELECT status FROM intelligence_run_attempts').get()).toEqual({
      status: 'RUNNING',
    });
  });

  it('rejects duplicate links at the strict provider-contract boundary before persistence', () => {
    const h = harness();
    const before = graphCounts(h.database);

    expect(storyboardOutputV2Schema.safeParse(output(['segment_1', 'segment_1'])).success).toBe(
      false,
    );
    expect(graphCounts(h.database)).toEqual(before);
  });

  it('rolls back every graph and success-state write when the terminal batch fails', async () => {
    const h = harness();
    const before = graphCounts(h.database);
    h.db.failBatchAfter = 5;

    await expect(persistStoryboard(h, output())).rejects.toThrow('injected_terminal_batch_failure');

    expect(graphCounts(h.database)).toEqual(before);
    expect(h.database.prepare('SELECT status FROM intelligence_runs').get()).toEqual({
      status: 'RUNNING',
    });
    expect(h.database.prepare('SELECT status FROM intelligence_run_attempts').get()).toEqual({
      status: 'RUNNING',
    });
    expect(h.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
});
