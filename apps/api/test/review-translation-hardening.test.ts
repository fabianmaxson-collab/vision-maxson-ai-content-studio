import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import { reviewTranslationOutputSchema } from '@vision-maxson/contracts';
import { OpenAIResponsesAdapter } from '@vision-maxson/providers/openai';
import {
  EditorialExecutionService,
  reviewTranslationPolicyInstructions,
  translationSourceGuardStatement,
  translationSourceSnapshotEvidence,
  validateReviewTranslationOutput,
  type TranslationSourceSnapshot,
} from '../src/editorial/execution';

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
  execute() {
    return this.database.prepare(this.sql).run(...this.values);
  }
}

class AtomicD1 {
  constructor(readonly database: DatabaseSync) {}
  prepare(sql: string) {
    return new Statement(this.database, sql);
  }
  batch(statements: Statement[]) {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      for (const statement of statements) statement.execute();
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}

const sourceTexts = [
  'Ariane 5 startete am 4. Juni 1996 zu ihrem ersten Flug.',
  'Bei H0 zündete das Vulcain-Triebwerk planmäßig und lieferte Schub.',
  'Das SRI übernahm die inertiale Navigation während des Aufstiegs.',
  'Eine 64-Bit-Zahl wurde in einen vorzeichenbehafteten 16-Bit-Wert umgewandelt.',
  'Flight 501 endete kurz nach dem Start durch den Überlauf.',
  'Gérard Le Lann beschrieb die organisatorischen Lehren aus dem Unfall.',
  'Die redundanten Einheiten arbeiteten mit derselben Software und denselben Daten.',
  'Der Fehler löste eine Kette von Diagnosemeldungen und Steuerbefehlen aus.',
  'Die Untersuchung führte zu strengeren Prüfungen und unabhängiger Validierung.',
] as const;

const translatedTexts = [
  'Ariane 5 despegó el 4 de junio de 1996 en su primer vuelo.',
  'En H0, el motor Vulcain se encendió según lo previsto y produjo empuje.',
  'El SRI asumió la navegación inercial durante el ascenso.',
  'Un número de 64 bits se convirtió en un valor con signo de 16 bits.',
  'El vuelo 501 terminó poco después del despegue debido al desbordamiento.',
  'Gérard Le Lann describió las lecciones organizativas derivadas del accidente.',
  'Las unidades redundantes funcionaban con el mismo software y los mismos datos.',
  'El error desencadenó una cadena de mensajes de diagnóstico y órdenes de control.',
  'La investigación condujo a pruebas más estrictas y a una validación independiente.',
] as const;

const sourceSnapshot = (): TranslationSourceSnapshot => ({
  workspaceId: 'workspace',
  projectId: 'project',
  artifactId: 'script',
  artifactRevision: 6,
  artifactStatus: 'approved',
  currentVersionId: 'script-v3',
  versionId: 'script-v3',
  versionNumber: 3,
  contentHash: 'a'.repeat(64),
  languageCode: 'de',
  sourceType: 'HUMAN_EDITED',
  approvalId: 'approval-v3',
  positiveApprovalCount: 1,
  segments: sourceTexts.map((text, index) => ({
    id: `segment-${index + 1}`,
    order: index + 1,
    contentHash: String(index + 1)
      .repeat(64)
      .slice(0, 64),
    text,
  })),
});

const validOutput = (): {
  sourceScriptVersionId: string;
  languageCode: 'es';
  segments: Array<{ order: number; text: string }>;
} => ({
  sourceScriptVersionId: 'script-v3',
  languageCode: 'es' as const,
  segments: translatedTexts.map((text, index) => ({ order: index + 1, text })),
});

function validate(payload: unknown, source = sourceSnapshot()) {
  const parsed = reviewTranslationOutputSchema.parse(payload);
  return validateReviewTranslationOutput(parsed, source);
}

function seededDatabase() {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE editorial_artifacts(
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, project_id TEXT NOT NULL,
      artifact_type TEXT NOT NULL, current_version_id TEXT, version INTEGER NOT NULL,
      status TEXT NOT NULL, deleted_at TEXT
    );
    CREATE TABLE editorial_artifact_versions(
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, artifact_id TEXT NOT NULL,
      version_number INTEGER NOT NULL, content_hash TEXT NOT NULL,
      language_code TEXT NOT NULL, source_type TEXT NOT NULL
    );
    CREATE TABLE artifact_approvals(
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL,
      artifact_version_id TEXT NOT NULL, decision TEXT NOT NULL
    );
    CREATE TABLE script_segments(
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, script_version_id TEXT NOT NULL,
      segment_order INTEGER NOT NULL, content_hash TEXT NOT NULL, content_text TEXT NOT NULL
    );
    CREATE TABLE translation_commits(id TEXT PRIMARY KEY);
    CREATE TABLE intelligence_runs(id TEXT PRIMARY KEY, status TEXT NOT NULL);
    CREATE TABLE intelligence_run_attempts(intelligence_run_id TEXT PRIMARY KEY, status TEXT NOT NULL);
    CREATE TABLE editorial_execution_reservations(intelligence_run_id TEXT PRIMARY KEY, status TEXT NOT NULL);
    INSERT INTO editorial_artifacts VALUES('script','workspace','project','PRODUCTION_SCRIPT','script-v3',6,'approved',NULL);
    INSERT INTO editorial_artifact_versions VALUES('script-v3','workspace','script',3,'${'a'.repeat(64)}','de','HUMAN_EDITED');
    INSERT INTO artifact_approvals VALUES('approval-v3','workspace','script-v3','APPROVED');
    INSERT INTO intelligence_runs VALUES('run','RUNNING');
    INSERT INTO intelligence_run_attempts VALUES('run','RUNNING');
    INSERT INTO editorial_execution_reservations VALUES('run','DISPATCHED');
  `);
  for (const segment of sourceSnapshot().segments)
    database
      .prepare('INSERT INTO script_segments VALUES(?,?,?,?,?,?)')
      .run(segment.id, 'workspace', 'script-v3', segment.order, segment.contentHash, segment.text);
  return { database, d1: new AtomicD1(database) };
}

function finalPersistenceAttempt(mutate?: (database: DatabaseSync) => void) {
  const { database, d1 } = seededDatabase();
  mutate?.(database);
  const guard = translationSourceGuardStatement(
    d1 as unknown as D1Database,
    sourceSnapshot(),
  ) as unknown as Statement;
  const statements = [
    guard,
    d1.prepare("INSERT INTO translation_commits VALUES('translation-v2')"),
    d1.prepare(
      "UPDATE intelligence_run_attempts SET status='SUCCEEDED' WHERE intelligence_run_id='run'",
    ),
    d1.prepare(
      "UPDATE editorial_execution_reservations SET status='RECONCILED' WHERE intelligence_run_id='run'",
    ),
    d1.prepare("UPDATE intelligence_runs SET status='SUCCEEDED' WHERE id='run'"),
  ];
  let error: unknown;
  try {
    d1.batch(statements);
  } catch (caught) {
    error = caught;
  }
  return { database, error };
}

function expectFailedClosed(database: DatabaseSync, error: unknown) {
  expect(error).toBeDefined();
  expect(database.prepare('SELECT COUNT(*) count FROM translation_commits').get()).toEqual({
    count: 0,
  });
  expect(database.prepare("SELECT status FROM intelligence_runs WHERE id='run'").get()).toEqual({
    status: 'RUNNING',
  });
  expect(
    database
      .prepare("SELECT status FROM intelligence_run_attempts WHERE intelligence_run_id='run'")
      .get(),
  ).toEqual({ status: 'RUNNING' });
  expect(
    database
      .prepare(
        "SELECT status FROM editorial_execution_reservations WHERE intelligence_run_id='run'",
      )
      .get(),
  ).toEqual({ status: 'DISPATCHED' });
}

describe('REVIEW_TRANSLATION_ES structured semantics', () => {
  it('accepts the exact nine-segment Spanish translation', () =>
    expect(() => validate(validOutput())).not.toThrow());

  it.each([
    ['8 segments', () => ({ ...validOutput(), segments: validOutput().segments.slice(0, 8) })],
    [
      '10 segments',
      () => ({
        ...validOutput(),
        segments: [
          ...validOutput().segments,
          { order: 10, text: 'Segmento adicional no autorizado.' },
        ],
      }),
    ],
    ['wrong source version', () => ({ ...validOutput(), sourceScriptVersionId: 'script-v2' })],
    ['wrong language', () => ({ ...validOutput(), languageCode: 'de' })],
  ])('rejects %s against the authoritative source', (_name, fixture) =>
    expect(() => validate(fixture())).toThrow(),
  );

  it.each([
    [
      'duplicate order',
      () => ({
        ...validOutput(),
        segments: validOutput().segments.map((item, index) =>
          index === 8 ? { ...item, order: 8 } : item,
        ),
      }),
    ],
    [
      'missing order',
      () => ({
        ...validOutput(),
        segments: validOutput().segments.map((item, index) =>
          index === 4 ? { ...item, order: 6 } : item,
        ),
      }),
    ],
    [
      'reordered output',
      () => ({ ...validOutput(), segments: [...validOutput().segments].reverse() }),
    ],
    [
      'empty text',
      () => ({
        ...validOutput(),
        segments: validOutput().segments.map((item, index) =>
          index === 2 ? { ...item, text: '' } : item,
        ),
      }),
    ],
    ['extra field', () => ({ ...validOutput(), extra: true })],
    [
      'freeform blob',
      () => ({
        sourceScriptVersionId: 'script-v3',
        languageCode: 'es',
        faithfulTranslation: 'texto',
      }),
    ],
  ])('rejects malformed structured output: %s', (_name, fixture) =>
    expect(() => validate(fixture())).toThrow(),
  );

  it.each([
    [
      'H0',
      1,
      'En el momento inicial, el motor Vulcain se encendió según lo previsto y produjo empuje.',
    ],
    ['SRI', 2, 'El sistema asumió la navegación inercial durante todo el ascenso.'],
    ['Flight 501', 4, 'La misión terminó poco después del despegue debido al desbordamiento.'],
    ['date', 0, 'Ariane 5 despegó durante su primer vuelo y comenzó el ascenso previsto.'],
    [
      'Gérard Le Lann',
      5,
      'El especialista describió las lecciones organizativas derivadas del accidente.',
    ],
  ])('detects omitted high-value term %s', (_term, index, replacement) => {
    const output = validOutput();
    output.segments[index] = { ...output.segments[index]!, text: replacement };
    expect(() => validate(output)).toThrow('omitted required source term');
  });

  it.each([
    ['punctuation-only source copy', 7, `${sourceTexts[7]} !!!`],
    [
      'whitespace and dash-only source copy',
      7,
      sourceTexts[7].replaceAll(' ', '   ').replace('-', '—'),
    ],
    ['mostly German with one Spanish word', 7, `${sourceTexts[7]} control`],
    [
      'mostly German with a few Spanish substitutions',
      7,
      'Der error löste una Kette von Diagnosemeldungen und Steuerbefehlen aus.',
    ],
  ])('rejects %s', (_label, index, replacement) => {
    const output = validOutput();
    output.segments[index] = { ...output.segments[index]!, text: replacement };
    expect(() => validate(output)).toThrow('leaves the German source untranslated');
  });

  it('accepts a complete Spanish translation that preserves technical names and numbers', () => {
    expect(() => validate(validOutput())).not.toThrow();
  });

  it.each([
    ['generic short sentence', 6, 'Este segmento ofrece un resumen general del problema.'],
    ['major clause removed', 7, 'El error desencadenó una cadena.'],
    ['technical detail omitted', 3, 'Un número de 64 bits se convirtió en 16 bits.'],
    ['only an anchor remains', 1, 'H0 y Vulcain fueron importantes.'],
  ])('rejects substantive compression: %s', (_label, index, replacement) => {
    const output = validOutput();
    output.segments[index] = { ...output.segments[index]!, text: replacement };
    expect(() => validate(output)).toThrow();
  });

  it('rejects generic Spanish repeated across all materially different segments', () => {
    const output = validOutput();
    output.segments = output.segments.map((segment) => ({
      ...segment,
      text: 'Este segmento explica el acontecimiento histórico con detalles generales y contexto suficiente.',
    }));
    expect(() => validate(output)).toThrow();
  });

  it('rejects generic Spanish repeated across several materially different segments', () => {
    const output = validOutput();
    const repeated =
      'Este pasaje describe el problema con información general y una explicación completa.';
    for (const index of [6, 7, 8])
      output.segments[index] = { ...output.segments[index]!, text: repeated };
    expect(() => validate(output)).toThrow('repeats generic content');
  });

  it('allows repeated technical terminology in otherwise distinct translations', () => {
    const output = validOutput();
    output.segments[6] = {
      ...output.segments[6]!,
      text: `${translatedTexts[6]} El sistema Ariane mantuvo redundancia.`,
    };
    output.segments[7] = {
      ...output.segments[7]!,
      text: `${translatedTexts[7]} El sistema Ariane registró el fallo.`,
    };
    expect(() => validate(output)).not.toThrow();
  });

  it.each([
    ['Ariane 5', 0, 'El cohete despegó el 4 de junio de 1996 en su primer vuelo.'],
    ['4 June 1996', 0, 'Ariane 5 despegó durante su primer vuelo y comenzó el ascenso previsto.'],
    [
      'H0',
      1,
      'En el momento inicial, el motor Vulcain se encendió según lo previsto y produjo empuje.',
    ],
    ['Vulcain', 1, 'En H0, el motor principal se encendió según lo previsto y produjo empuje.'],
    ['SRI', 2, 'El sistema asumió la navegación inercial durante todo el ascenso.'],
    ['64-bit', 3, 'Un número amplio se convirtió en un valor con signo de 16 bits.'],
    ['16-bit', 3, 'Un número de 64 bits se convirtió en un valor con signo más pequeño.'],
    ['Flight 501', 4, 'La misión terminó poco después del despegue debido al desbordamiento.'],
    [
      'Gérard Le Lann',
      5,
      'El especialista describió las lecciones organizativas derivadas del accidente.',
    ],
  ])('rejects omission of authoritative anchor %s', (_label, index, replacement) => {
    const output = validOutput();
    output.segments[index] = { ...output.segments[index]!, text: replacement };
    expect(() => validate(output)).toThrow('omitted required source term');
  });

  it.each(['Ariane 5', 'Ariane-5', 'Ariane5'])('accepts authoritative Ariane form %s', (form) => {
    const source = sourceSnapshot();
    source.segments[0] = {
      ...source.segments[0]!,
      text: `${form} startete am 4. Juni 1996 zu ihrem ersten Flug.`,
    };
    expect(() => validate(validOutput(), source)).not.toThrow();
  });

  it('rejects two source segments collapsed into one translated segment', () => {
    const collapsed = validOutput();
    collapsed.segments = collapsed.segments.slice(0, 8);
    collapsed.segments[7] = {
      order: 8,
      text: `${translatedTexts[7]} ${translatedTexts[8]}`,
    };
    expect(() => validate(collapsed)).toThrow('exact source segment structure');
  });

  it('rejects obvious summaries and unchanged German source segments', () => {
    const summary = validOutput();
    summary.segments[6] = { ...summary.segments[6]!, text: 'Resumen breve.' };
    expect(() => validate(summary)).toThrow('obvious segment summary');
    const untranslated = validOutput();
    untranslated.segments[7] = { ...untranslated.segments[7]!, text: sourceTexts[7] };
    expect(() => validate(untranslated)).toThrow('leaves the German source untranslated');
  });

  it('aligns the prompt with structured, one-to-one, non-summarizing output', () => {
    const normalizedPrompt = reviewTranslationPolicyInstructions.toLowerCase();
    for (const requirement of [
      'every source segment exactly once',
      'boundaries and order',
      'do not summarize',
      'add facts',
      'omit facts',
      'preserve names, dates, acronyms',
      'spanish only inside each translated segment text',
      'do not modify or replace the german source',
      'invent explanations',
      'editorial tone',
    ])
      expect(normalizedPrompt).toContain(requirement);
  });

  it('stores only safe source evidence without segment text', () => {
    const evidence = translationSourceSnapshotEvidence(sourceSnapshot());
    expect(evidence.segments).toHaveLength(9);
    expect(JSON.stringify(evidence)).not.toContain(sourceTexts[0]);
    expect(evidence).toMatchObject({
      versionId: 'script-v3',
      approvalId: 'approval-v3',
      artifactRevision: 6,
      positiveApprovalCount: 1,
    });
  });
});

describe('REVIEW_TRANSLATION_ES final source guard', () => {
  it('accepts the unchanged exact source and commits the terminal batch atomically', () => {
    const { database, error } = finalPersistenceAttempt();
    expect(error).toBeUndefined();
    expect(database.prepare('SELECT COUNT(*) count FROM translation_commits').get()).toEqual({
      count: 1,
    });
    expect(database.prepare("SELECT status FROM intelligence_runs WHERE id='run'").get()).toEqual({
      status: 'SUCCEEDED',
    });
  });

  it.each([
    [
      'a newer Script becomes current',
      (db: DatabaseSync) =>
        db.exec("UPDATE editorial_artifacts SET current_version_id='script-v4' WHERE id='script'"),
    ],
    [
      'artifact approval status changes',
      (db: DatabaseSync) =>
        db.exec("UPDATE editorial_artifacts SET status='active' WHERE id='script'"),
    ],
    [
      'artifact revision changes',
      (db: DatabaseSync) => db.exec("UPDATE editorial_artifacts SET version=7 WHERE id='script'"),
    ],
    [
      'source hash changes',
      (db: DatabaseSync) =>
        db.exec(
          `UPDATE editorial_artifact_versions SET content_hash='${'f'.repeat(64)}' WHERE id='script-v3'`,
        ),
    ],
    [
      'approval is removed',
      (db: DatabaseSync) => db.exec("DELETE FROM artifact_approvals WHERE id='approval-v3'"),
    ],
    [
      'source language changes',
      (db: DatabaseSync) =>
        db.exec("UPDATE editorial_artifact_versions SET language_code='es' WHERE id='script-v3'"),
    ],
    [
      'source type changes',
      (db: DatabaseSync) =>
        db.exec(
          "UPDATE editorial_artifact_versions SET source_type='AI_GENERATED' WHERE id='script-v3'",
        ),
    ],
    [
      'source segment content changes',
      (db: DatabaseSync) =>
        db.exec("UPDATE script_segments SET content_text='changed' WHERE id='segment-9'"),
    ],
  ])('fails closed when %s after dispatch', (_name, mutate) => {
    const { database, error } = finalPersistenceAttempt(mutate);
    expectFailedClosed(database, error);
  });
});

const migrationDirectory = new URL('../../../packages/db/migrations/', import.meta.url);
const migrationNames = readdirSync(migrationDirectory)
  .filter((name) => /^\d{4}_.+\.sql$/u.test(name) && Number(name.slice(0, 4)) <= 16)
  .sort();

class RealStatement {
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
    const result = this.database.prepare(this.sql).run(...this.values);
    return Promise.resolve({ meta: { changes: Number(result.changes) } });
  }
  get bindingCount() {
    return this.values.length;
  }
}

class RealD1 {
  beforeBatch: (() => void) | null = null;
  beforeMatchingBatch: ((statements: RealStatement[]) => void) | null = null;
  failBatchAfter: number | null = null;
  preparedQueries = 0;
  maxBindings = 0;
  maxBatchStatements = 0;
  lastBatch: RealStatement[] = [];
  constructor(readonly database: DatabaseSync) {}
  prepare(sql: string) {
    this.preparedQueries += 1;
    return new RealStatement(this.database, sql);
  }
  async batch(statements: RealStatement[]) {
    this.lastBatch = statements;
    this.maxBatchStatements = Math.max(this.maxBatchStatements, statements.length);
    this.maxBindings = Math.max(
      this.maxBindings,
      ...statements.map((statement) => statement.bindingCount),
    );
    this.beforeBatch?.();
    this.beforeBatch = null;
    this.beforeMatchingBatch?.(statements);
    this.database.exec('BEGIN IMMEDIATE');
    try {
      for (const [index, statement] of statements.entries()) {
        await statement.run();
        if (this.failBatchAfter === index + 1)
          throw new Error(`injected_batch_failure_${index + 1}`);
      }
      this.database.exec('COMMIT');
      return statements.map(() => ({ meta: { changes: 1 } }));
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}

type TranslationPersist = (
  projectId: string,
  task: 'REVIEW_TRANSLATION_ES',
  runId: string,
  inputVersionId: string,
  language: string,
  outputSchemaVersion: string,
  lineage: Array<{ sourceVersionId: string; dependencyType: 'GENERATED_FROM' }>,
  output: ReturnType<typeof validOutput>,
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
    scriptSourceBrief: null;
    translationSource: TranslationSourceSnapshot;
    reservedMicrousd: number;
  },
) => Promise<string>;

function realHarness(dependentCount = 0) {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys=ON');
  for (const migration of migrationNames)
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
    INSERT INTO channel_profiles(id,workspace_id,content_brand_id,name,normalized_name,primary_language,created_at,updated_at,version) VALUES('channel','workspace','brand','Channel','channel','de','t','t',1);
    INSERT INTO projects(id,workspace_id,content_brand_id,channel_profile_id,title,format,operating_mode,primary_language,status,created_at,updated_at,version) VALUES('project','workspace','brand','channel','P','SHORT','ASSISTED','de','ANALYZING','t','t',2);
    INSERT INTO ai_providers(id,key,display_name,status,adapter_version,created_at,updated_at,version) VALUES('provider','openai','OpenAI','configured','1','t','t',1);
    INSERT INTO ai_provider_models(id,provider_id,model_key,display_name,status,capabilities_json,effective_from,created_at,updated_at,version) VALUES('model','provider','gpt-5.6-luna','Luna','available','{"qualityTier":"ECONOMY","costRank":1,"capabilities":["MULTILINGUAL_TEXT","STRUCTURED_OUTPUT","SCRIPT_GENERATION","TRANSLATION"]}','t','t','t',1);
    INSERT INTO ai_pricing_snapshots(id,provider_model_id,currency,input_unit_price,output_unit_price,unit_name,source_label,verification_status,effective_from,created_at) VALUES('pricing','model','USD',0.0000002,0.0000012,'token','test','externally_verified','t','t');
    INSERT INTO editorial_artifacts(id,workspace_id,project_id,artifact_type,status,current_version_id,created_at,updated_at,version,created_by,updated_by) VALUES
      ('script','workspace','project','PRODUCTION_SCRIPT','approved',NULL,'t','t',6,'owner','owner'),
      ('translation','workspace','project','REVIEW_TRANSLATION','approved',NULL,'t','t',2,'owner','owner');
    INSERT INTO intelligence_runs(id,workspace_id,project_id,task_type,provider_id,provider_model_id,input_artifact_version_id,initiated_by,operating_mode,status,idempotency_key,creative_regeneration_number,safe_metadata_json,pricing_snapshot_id,started_at,created_at,updated_at,version) VALUES
      ('run','workspace','project','REVIEW_TRANSLATION_ES','provider','model','script-v3','owner','ASSISTED','RUNNING','translation-real-path',0,'{}','pricing','t','t','t',2);
    INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,parent_version_id,language_code,content_text,content_json,source_type,intelligence_run_id,content_hash,created_at,created_by) VALUES
      ('script-v3','workspace','script',3,NULL,'de','source','{}','HUMAN_EDITED',NULL,'${'a'.repeat(64)}','t','owner'),
      ('translation-v1','workspace','translation',1,NULL,'es','old','{}','HUMAN_EDITED',NULL,'${'b'.repeat(64)}','t','owner');
    UPDATE editorial_artifacts SET current_version_id='script-v3' WHERE id='script';
    UPDATE editorial_artifacts SET current_version_id='translation-v1' WHERE id='translation';
    INSERT INTO artifact_approvals(id,workspace_id,artifact_version_id,decision,actor_id,actor_role,decided_at) VALUES('approval-v3','workspace','script-v3','APPROVED','owner','owner','t');
    INSERT INTO intelligence_run_attempts(id,intelligence_run_id,attempt_number,attempt_kind,status,started_at) VALUES('attempt','run',1,'TECHNICAL','RUNNING','t');
    INSERT INTO editorial_execution_envelopes(id,workspace_id,project_id,profile_key,profile_version,provider_id,provider_model_id,currency,monetary_ceiling_microusd,maximum_calls,status,authorized_by,created_at,updated_at,version) VALUES('envelope','workspace','project','phase3_short_de_review_es_v1',1,'provider','model','USD',7000,2,'ACTIVE','owner','t','t',1);
    INSERT INTO editorial_execution_reservations(id,envelope_id,workspace_id,project_id,intelligence_run_id,step_key,pricing_snapshot_id,reserved_microusd,status,created_at,dispatched_at) VALUES('reservation','envelope','workspace','project','run','REVIEW_TRANSLATION_ES','pricing',3277,'DISPATCHED','t','t');
  `);
  for (const segment of sourceSnapshot().segments)
    database
      .prepare(
        'INSERT INTO script_segments(id,workspace_id,script_version_id,segment_order,content_text,content_hash,word_count,created_at) VALUES(?,?,?,?,?,?,?,?)',
      )
      .run(
        segment.id,
        'workspace',
        'script-v3',
        segment.order,
        segment.text,
        segment.contentHash,
        segment.text.split(/\s+/u).length,
        't',
      );
  for (let index = 0; index < dependentCount; index += 1) {
    const artifact = `dependent-${index}`;
    const version = `dependent-version-${index}`;
    const dependentProject = `dependent-project-${index}`;
    database
      .prepare(
        "INSERT INTO projects(id,workspace_id,content_brand_id,channel_profile_id,title,format,operating_mode,primary_language,status,created_at,updated_at,version) VALUES(?,'workspace','brand','channel',?,'SHORT','ASSISTED','de','ANALYZING','t','t',1)",
      )
      .run(dependentProject, dependentProject);
    database
      .prepare(
        "INSERT INTO editorial_artifacts(id,workspace_id,project_id,artifact_type,status,current_version_id,created_at,updated_at,version,created_by,updated_by) VALUES(?,?,?,'STORYBOARD','active',?,'t','t',1,'owner','owner')",
      )
      .run(artifact, 'workspace', dependentProject, version);
    database
      .prepare(
        "INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,language_code,content_json,source_type,content_hash,created_at,created_by) VALUES(?,?,?,1,'de','{}','HUMAN_EDITED',?,'t','owner')",
      )
      .run(version, 'workspace', artifact, `${index}`.padStart(64, 'c').slice(-64));
    database
      .prepare(
        "INSERT INTO artifact_dependencies(id,workspace_id,source_artifact_version_id,dependent_artifact_version_id,dependency_type,validity_status,created_at,updated_at,version) VALUES(?, 'workspace','translation-v1',?,'GENERATED_FROM','CURRENT','t','t',1)",
      )
      .run(`dep-${index}`, version);
  }
  const db = new RealD1(database);
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
    persist: (service as unknown as { persist: TranslationPersist }).persist.bind(service),
  };
}

const realCompletion = () => ({
  result: {
    output: validOutput(),
    providerRequestId: 'provider-request',
    usage: {
      inputUnits: 3302,
      outputUnits: 1000,
      cachedInputUnits: 0,
      reasoningOutputUnits: 0,
      unitName: 'token' as const,
    },
    safeMetadata: { provider: 'openai' },
  },
  costs: { actualCost: 0.003, actualMicrousd: 3000, currency: 'USD' },
  metadata: { commandHash: 'hash' },
  governed: true,
  scriptSourceBrief: null,
  translationSource: sourceSnapshot(),
  reservedMicrousd: 3277,
});

const persistRealTranslation = (h: ReturnType<typeof realHarness>) =>
  h.persist(
    'project',
    'REVIEW_TRANSLATION_ES',
    'run',
    'script-v3',
    'de',
    'review-translation-output-v1',
    [{ sourceVersionId: 'script-v3', dependencyType: 'GENERATED_FROM' }],
    validOutput(),
    realCompletion(),
  );

const realState = (database: DatabaseSync) => ({
  translationVersions: database
    .prepare(
      "SELECT COUNT(*) count FROM editorial_artifact_versions WHERE artifact_id='translation'",
    )
    .get(),
  current: database
    .prepare(
      "SELECT current_version_id currentVersionId,status,version FROM editorial_artifacts WHERE id='translation'",
    )
    .get(),
  lineage: database
    .prepare(
      "SELECT COUNT(*) count FROM artifact_dependencies WHERE dependent_artifact_version_id NOT LIKE 'dependent-version-%'",
    )
    .get(),
  run: database
    .prepare(
      "SELECT status,output_artifact_version_id outputVersionId FROM intelligence_runs WHERE id='run'",
    )
    .get(),
  attempt: database
    .prepare(
      "SELECT status,provider_request_id providerRequestId FROM intelligence_run_attempts WHERE id='attempt'",
    )
    .get(),
  reservation: database
    .prepare(
      "SELECT status,actual_microusd actualMicrousd FROM editorial_execution_reservations WHERE id='reservation'",
    )
    .get(),
  successAudits: database
    .prepare("SELECT COUNT(*) count FROM audit_events WHERE action='intelligence.run_completed'")
    .get(),
});

describe('REVIEW_TRANSLATION_ES real terminal persistence', () => {
  it('persists the real version, pointer, lineage, terminal attempt, reservation, audit and Run', async () => {
    const h = realHarness();
    const versionId = await persistRealTranslation(h);
    expect(realState(h.database)).toEqual({
      translationVersions: { count: 2 },
      current: { currentVersionId: versionId, status: 'active', version: 3 },
      lineage: { count: 1 },
      run: { status: 'SUCCEEDED', outputVersionId: versionId },
      attempt: { status: 'SUCCEEDED', providerRequestId: 'provider-request' },
      reservation: { status: 'RECONCILED', actualMicrousd: 3000 },
      successAudits: { count: 1 },
    });
    const persisted = h.database
      .prepare(
        'SELECT language_code languageCode,source_type sourceType,source_script_version_id sourceScriptVersionId,content_json contentJson FROM editorial_artifact_versions WHERE id=?',
      )
      .get(versionId) as Record<string, unknown>;
    expect(persisted).toMatchObject({
      languageCode: 'es',
      sourceType: 'AI_GENERATED',
      sourceScriptVersionId: 'script-v3',
    });
    expect(JSON.parse(String(persisted.contentJson))).toEqual(validOutput());
    expect(h.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it.each([
    [
      'new current Script',
      (db: DatabaseSync) =>
        db.exec(
          "UPDATE editorial_artifacts SET current_version_id='translation-v1' WHERE id='script'",
        ),
    ],
    [
      'artifact status',
      (db: DatabaseSync) =>
        db.exec("UPDATE editorial_artifacts SET status='active' WHERE id='script'"),
    ],
    [
      'artifact revision',
      (db: DatabaseSync) => db.exec("UPDATE editorial_artifacts SET version=7 WHERE id='script'"),
    ],
    [
      'content hash',
      (db: DatabaseSync) =>
        db.exec(
          `UPDATE editorial_artifact_versions SET content_hash='${'f'.repeat(64)}' WHERE id='script-v3'`,
        ),
    ],
    [
      'approval removed',
      (db: DatabaseSync) => db.exec("DELETE FROM artifact_approvals WHERE id='approval-v3'"),
    ],
    [
      'approval replaced',
      (db: DatabaseSync) =>
        db.exec(
          "DELETE FROM artifact_approvals WHERE id='approval-v3'; INSERT INTO artifact_approvals(id,workspace_id,artifact_version_id,decision,actor_id,actor_role,decided_at) VALUES('replacement','workspace','script-v3','APPROVED','owner','owner','t2')",
        ),
    ],
    [
      'language',
      (db: DatabaseSync) =>
        db.exec("UPDATE editorial_artifact_versions SET language_code='es' WHERE id='script-v3'"),
    ],
    [
      'source type',
      (db: DatabaseSync) =>
        db.exec(
          "UPDATE editorial_artifact_versions SET source_type='IMPORTED' WHERE id='script-v3'",
        ),
    ],
    [
      'segment text',
      (db: DatabaseSync) =>
        db.exec("UPDATE script_segments SET content_text='changed' WHERE id='segment-9'"),
    ],
    [
      'segment order',
      (db: DatabaseSync) =>
        db.exec("UPDATE script_segments SET segment_order=99 WHERE id='segment-1'"),
    ],
    [
      'segment removed',
      (db: DatabaseSync) => db.exec("DELETE FROM script_segments WHERE id='segment-9'"),
    ],
    [
      'segment added',
      (db: DatabaseSync) =>
        db.exec(
          `INSERT INTO script_segments(id,workspace_id,script_version_id,segment_order,content_text,content_hash,word_count,created_at) VALUES('extra','workspace','script-v3',10,'extra','${'e'.repeat(64)}',1,'t')`,
        ),
    ],
  ])('fails closed on real persistence after %s drift', async (_label, mutate) => {
    const h = realHarness();
    const before = realState(h.database);
    h.db.beforeBatch = () => mutate(h.database);
    await expect(persistRealTranslation(h)).rejects.toThrow();
    expect(realState(h.database)).toEqual(before);
    expect(
      h.database
        .prepare(
          "SELECT COUNT(*) count FROM audit_events WHERE action='intelligence.run_completed'",
        )
        .get(),
    ).toEqual({ count: 0 });
  });

  it('invalidates unbounded legitimate fanout with two set-based statements and fixed query budget', async () => {
    const h = realHarness(300);
    await persistRealTranslation(h);
    expect(
      h.database
        .prepare(
          "SELECT COUNT(*) count FROM artifact_dependencies WHERE source_artifact_version_id='translation-v1' AND validity_status='REAPPROVAL_REQUIRED'",
        )
        .get(),
    ).toEqual({ count: 300 });
    expect(h.db.lastBatch.length).toBeLessThanOrEqual(12);
    expect(h.db.preparedQueries).toBeLessThanOrEqual(32);
    expect(h.db.maxBindings).toBeLessThanOrEqual(16);
  });

  it('rolls back every real persistence statement when any batch position fails', async () => {
    const probe = realHarness();
    await persistRealTranslation(probe);
    const batchSize = probe.db.lastBatch.length;
    for (let position = 1; position <= batchSize; position += 1) {
      const h = realHarness(3);
      const before = realState(h.database);
      h.db.failBatchAfter = position;
      await expect(persistRealTranslation(h)).rejects.toThrow(`injected_batch_failure_${position}`);
      expect(realState(h.database)).toEqual(before);
    }
  });
});

function publicExecuteHarness(dependentCount = 0) {
  const h = realHarness(dependentCount);
  h.database.exec(`
    DELETE FROM editorial_execution_reservations;
    DELETE FROM intelligence_run_attempts;
    DELETE FROM intelligence_runs;
    INSERT INTO editorial_artifacts(id,workspace_id,project_id,artifact_type,status,current_version_id,created_at,updated_at,version,created_by,updated_by)
      VALUES('brief','workspace','project','CONTENT_BRIEF','approved','brief-v1','t','t',2,'owner','owner');
    INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,language_code,content_json,source_type,content_hash,created_at,created_by)
      VALUES('brief-v1','workspace','brief',1,'de','{"format":"SHORT","productionLanguage":"de","reviewLanguage":"es"}','HUMAN_EDITED','${'d'.repeat(64)}','t','owner');
    INSERT INTO artifact_approvals(id,workspace_id,artifact_version_id,decision,actor_id,actor_role,decided_at)
      VALUES('brief-approval','workspace','brief-v1','APPROVED','owner','owner','t');
    INSERT INTO prompt_versions(id,prompt_definition_id,version_number,template_text,input_schema_version,output_schema_version,status,content_hash,created_at)
      VALUES('translation-prompt','prompt_review_translation_es',1,'Translate {{context_json}}','translation-input-v1','review-translation-output-v1','active','${'f'.repeat(64)}','t');
  `);
  h.db.preparedQueries = 0;
  h.db.maxBindings = 0;
  h.db.maxBatchStatements = 0;
  return h;
}

function seedFanoutMatrix(h: ReturnType<typeof realHarness>) {
  h.database.exec(`
    INSERT INTO projects(id,workspace_id,content_brand_id,channel_profile_id,title,format,operating_mode,primary_language,status,created_at,updated_at,version)
      VALUES('preflight-project','workspace','brand','channel','Preflight','SHORT','ASSISTED','de','PREFLIGHT_REVIEW','t','t',1);
    INSERT INTO editorial_artifacts(id,workspace_id,project_id,artifact_type,status,current_version_id,created_at,updated_at,version,created_by,updated_by)
      VALUES('preflight','workspace','preflight-project','PREFLIGHT','approved','preflight-v1','t','t',1,'owner','owner');
    INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,language_code,content_json,source_type,content_hash,created_at,created_by)
      VALUES('preflight-v1','workspace','preflight',1,'de','{}','DETERMINISTIC','${'1'.repeat(64)}','t','owner');
    INSERT INTO artifact_dependencies(id,workspace_id,source_artifact_version_id,dependent_artifact_version_id,dependency_type,validity_status,created_at,updated_at,version)
      VALUES('preflight-dependency','workspace','translation-v1','preflight-v1','VALIDATED_BY','CURRENT','t','t',1);
    INSERT INTO preflight_assessments(id,workspace_id,project_id,artifact_id,artifact_version_id,overall_result,generation_readiness,rule_set_version,assessed_at,assessed_by)
      VALUES('preflight-assessment','workspace','preflight-project','preflight','preflight-v1','PASS','READY_FOR_GENERATION','phase3-v1','t','owner');

    INSERT INTO projects(id,workspace_id,content_brand_id,channel_profile_id,title,format,operating_mode,primary_language,status,created_at,updated_at,version)
      VALUES('unrelated-project','workspace','brand','channel','Unrelated','SHORT','ASSISTED','de','ANALYZING','t','t',1);
    INSERT INTO editorial_artifacts(id,workspace_id,project_id,artifact_type,status,current_version_id,created_at,updated_at,version,created_by,updated_by)
      VALUES('unrelated','workspace','unrelated-project','STORYBOARD','active','unrelated-v1','t','t',4,'owner','owner');
    INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,language_code,content_json,source_type,content_hash,created_at,created_by)
      VALUES('unrelated-v1','workspace','unrelated',1,'de','{}','HUMAN_EDITED','${'2'.repeat(64)}','t','owner');
    INSERT INTO artifact_dependencies(id,workspace_id,source_artifact_version_id,dependent_artifact_version_id,dependency_type,validity_status,created_at,updated_at,version)
      VALUES('unrelated-dependency','workspace','script-v3','unrelated-v1','GENERATED_FROM','CURRENT','t','t',7);

    INSERT INTO projects(id,workspace_id,content_brand_id,channel_profile_id,title,format,operating_mode,primary_language,status,created_at,updated_at,version)
      VALUES('unrelated-preflight-project','workspace','brand','channel','Unrelated preflight','SHORT','ASSISTED','de','PREFLIGHT_REVIEW','t','t',1);
    INSERT INTO editorial_artifacts(id,workspace_id,project_id,artifact_type,status,current_version_id,created_at,updated_at,version,created_by,updated_by)
      VALUES('unrelated-preflight','workspace','unrelated-preflight-project','PREFLIGHT','approved','unrelated-preflight-v1','t','t',1,'owner','owner');
    INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,language_code,content_json,source_type,content_hash,created_at,created_by)
      VALUES('unrelated-preflight-v1','workspace','unrelated-preflight',1,'de','{}','DETERMINISTIC','${'3'.repeat(64)}','t','owner');
    INSERT INTO artifact_dependencies(id,workspace_id,source_artifact_version_id,dependent_artifact_version_id,dependency_type,validity_status,created_at,updated_at,version)
      VALUES('unrelated-preflight-dependency','workspace','script-v3','unrelated-preflight-v1','VALIDATED_BY','CURRENT','t','t',9);
    INSERT INTO preflight_assessments(id,workspace_id,project_id,artifact_id,artifact_version_id,overall_result,generation_readiness,rule_set_version,assessed_at,assessed_by)
      VALUES('unrelated-preflight-assessment','workspace','unrelated-preflight-project','unrelated-preflight','unrelated-preflight-v1','PASS','READY_FOR_GENERATION','phase3-v1','t','owner');
  `);
}

describe('REVIEW_TRANSLATION_ES T6 evidence closure', () => {
  it('terminalizes provider success plus stale-source persistence failure through public execute without redispatch', async () => {
    const h = publicExecuteHarness();
    const provider = vi.spyOn(OpenAIResponsesAdapter.prototype, 'execute').mockResolvedValue({
      output: validOutput(),
      usage: {
        inputUnits: 100,
        outputUnits: 100,
        cachedInputUnits: 0,
        reasoningOutputUnits: 0,
        unitName: 'token',
      },
      providerRequestId: 'provider-request-public-failure',
      safeMetadata: { responseStatus: 'completed' },
    });
    let sourceDriftInjected = 0;
    h.db.beforeMatchingBatch = (statements) => {
      if (
        sourceDriftInjected === 0 &&
        statements[0]?.sql.includes('translation_source_authorization_changed') &&
        statements.some((statement) =>
          statement.sql.includes('INSERT INTO editorial_artifact_versions'),
        )
      ) {
        sourceDriftInjected += 1;
        h.database.exec("UPDATE editorial_artifacts SET status='active' WHERE id='script'");
      }
    };
    const service = new EditorialExecutionService(
      h.db as unknown as D1Database,
      { id: 'owner', workspaceId: 'workspace', roles: ['owner'] },
      {
        openAIEnabled: true,
        openAIApiKey: 'local-fixture',
        openAIBaseUrl: 'https://invalid.test',
        requestId: 'translation-public-failure-request',
        environment: 'test',
      },
    );
    const command = {
      mode: 'LOCKED' as const,
      preferredProviderKey: 'openai',
      preferredModelKey: 'gpt-5.6-luna',
      inputArtifactVersionId: 'script-v3',
      creativeRegeneration: false,
    };
    try {
      await expect(
        service.execute('project', 'REVIEW_TRANSLATION_ES', command, 'translation-public-failure'),
      ).rejects.toThrow();
      const failureQueries = h.db.preparedQueries;
      expect(sourceDriftInjected).toBe(1);
      expect(provider).toHaveBeenCalledTimes(1);
      expect(h.db.maxBatchStatements).toBeLessThanOrEqual(11);
      expect(h.db.maxBindings).toBeLessThanOrEqual(16);
      expect(failureQueries).toBe(34);

      const run = h.database
        .prepare(
          "SELECT id,status,input_units inputUnits,output_units outputUnits,actual_cost actualCost,currency,output_artifact_version_id outputVersionId FROM intelligence_runs WHERE idempotency_key='translation-public-failure'",
        )
        .get()!;
      const runId = String(run.id);
      expect(run).toMatchObject({
        status: 'FAILED_PERMANENT',
        inputUnits: 100,
        outputUnits: 100,
        actualCost: 0.00014,
        currency: 'USD',
        outputVersionId: null,
      });
      expect(
        h.database
          .prepare(
            'SELECT status,provider_request_id providerRequestId FROM intelligence_run_attempts WHERE intelligence_run_id=?',
          )
          .get(runId),
      ).toEqual({
        status: 'FAILED_PERMANENT',
        providerRequestId: 'provider-request-public-failure',
      });
      expect(
        h.database
          .prepare(
            'SELECT status,reserved_microusd reservedMicrousd,actual_microusd actualMicrousd FROM editorial_execution_reservations WHERE intelligence_run_id=?',
          )
          .get(runId),
      ).toEqual({
        status: 'RECONCILED',
        reservedMicrousd: 3277,
        actualMicrousd: 140,
      });
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
            "SELECT current_version_id currentVersionId FROM editorial_artifacts WHERE id='translation'",
          )
          .get(),
      ).toEqual({ currentVersionId: 'translation-v1' });
      expect(
        h.database
          .prepare(
            "SELECT COUNT(*) count FROM artifact_dependencies WHERE source_artifact_version_id='script-v3'",
          )
          .get(),
      ).toEqual({ count: 0 });
      expect(
        h.database
          .prepare(
            "SELECT COUNT(*) count FROM audit_events WHERE action='intelligence.run_completed'",
          )
          .get(),
      ).toEqual({ count: 0 });
      expect(
        h.database
          .prepare(
            "SELECT COUNT(*) count FROM audit_events WHERE action='intelligence.run_failed' AND outcome='failure' AND resource_id=?",
          )
          .get(runId),
      ).toEqual({ count: 1 });

      const replay = await service.execute(
        'project',
        'REVIEW_TRANSLATION_ES',
        command,
        'translation-public-failure',
      );
      expect(replay.idempotentReplay).toBe(true);
      expect(replay.run).toMatchObject({ id: runId, status: 'FAILED_PERMANENT' });
      expect(provider).toHaveBeenCalledTimes(1);
      expect(h.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      provider.mockRestore();
      h.database.close();
    }
  });

  it.each([0, 1, 300])(
    'measures 30 total public success queries independently of %i dependents',
    async (dependentCount) => {
      const h = publicExecuteHarness(dependentCount);
      const provider = vi.spyOn(OpenAIResponsesAdapter.prototype, 'execute').mockResolvedValue({
        output: validOutput(),
        usage: {
          inputUnits: 100,
          outputUnits: 100,
          cachedInputUnits: 0,
          reasoningOutputUnits: 0,
          unitName: 'token',
        },
        providerRequestId: 'provider-success-' + dependentCount,
        safeMetadata: { responseStatus: 'completed' },
      });
      try {
        const service = new EditorialExecutionService(
          h.db as unknown as D1Database,
          { id: 'owner', workspaceId: 'workspace', roles: ['owner'] },
          {
            openAIEnabled: true,
            openAIApiKey: 'local-fixture',
            openAIBaseUrl: 'https://invalid.test',
            environment: 'test',
          },
        );
        const result = await service.execute(
          'project',
          'REVIEW_TRANSLATION_ES',
          {
            mode: 'LOCKED',
            preferredProviderKey: 'openai',
            preferredModelKey: 'gpt-5.6-luna',
            inputArtifactVersionId: 'script-v3',
            creativeRegeneration: false,
          },
          'translation-public-success-' + dependentCount,
        );
        expect(result.run).toMatchObject({ status: 'SUCCEEDED' });
        expect(provider).toHaveBeenCalledTimes(1);
        expect(h.db.preparedQueries).toBe(30);
        expect(h.db.maxBatchStatements).toBeLessThanOrEqual(11);
        expect(h.db.maxBindings).toBeLessThanOrEqual(16);
        expect(h.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      } finally {
        provider.mockRestore();
        h.database.close();
      }
    },
  );

  it.each([0, 1, 300])(
    'keeps the real persistence query budget cardinality-independent for %i dependents',
    async (dependentCount) => {
      const h = realHarness(dependentCount);
      try {
        await persistRealTranslation(h);
        expect(h.db.preparedQueries).toBe(12);
        expect(h.db.maxBatchStatements).toBeLessThanOrEqual(11);
        expect(h.db.maxBindings).toBeLessThanOrEqual(16);
        expect(h.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      } finally {
        h.database.close();
      }
    },
  );

  it('invalidates 300 intended dependents and Preflight readiness without touching unrelated state', async () => {
    const h = realHarness(300);
    seedFanoutMatrix(h);
    const unrelatedBefore = h.database
      .prepare(
        "SELECT source_artifact_version_id sourceVersionId,dependent_artifact_version_id dependentVersionId,dependency_type dependencyType,validity_status validityStatus,invalidated_at invalidatedAt,invalidated_by_version_id invalidatedByVersionId,version FROM artifact_dependencies WHERE id='unrelated-dependency'",
      )
      .get();
    const unrelatedPreflightBefore = h.database
      .prepare(
        "SELECT generation_readiness generationReadiness FROM preflight_assessments WHERE id='unrelated-preflight-assessment'",
      )
      .get();
    try {
      await persistRealTranslation(h);
      expect(
        h.database
          .prepare(
            "SELECT COUNT(*) count FROM artifact_dependencies WHERE source_artifact_version_id='translation-v1' AND dependent_artifact_version_id LIKE 'dependent-version-%' AND validity_status='REAPPROVAL_REQUIRED'",
          )
          .get(),
      ).toEqual({ count: 300 });
      const preflightDependency = h.database
        .prepare(
          "SELECT validity_status validityStatus,invalidated_by_version_id invalidatedByVersionId FROM artifact_dependencies WHERE id='preflight-dependency'",
        )
        .get() as { validityStatus: string; invalidatedByVersionId: string };
      expect(preflightDependency.validityStatus).toBe('REAPPROVAL_REQUIRED');
      expect(preflightDependency.invalidatedByVersionId).toMatch(/^artifact_version_/u);
      expect(
        h.database
          .prepare(
            "SELECT generation_readiness generationReadiness FROM preflight_assessments WHERE id='preflight-assessment'",
          )
          .get(),
      ).toEqual({ generationReadiness: 'NOT_READY' });
      expect(
        h.database
          .prepare(
            "SELECT source_artifact_version_id sourceVersionId,dependent_artifact_version_id dependentVersionId,dependency_type dependencyType,validity_status validityStatus,invalidated_at invalidatedAt,invalidated_by_version_id invalidatedByVersionId,version FROM artifact_dependencies WHERE id='unrelated-dependency'",
          )
          .get(),
      ).toEqual(unrelatedBefore);
      expect(
        h.database
          .prepare(
            "SELECT generation_readiness generationReadiness FROM preflight_assessments WHERE id='unrelated-preflight-assessment'",
          )
          .get(),
      ).toEqual(unrelatedPreflightBefore);
      expect(h.db.preparedQueries).toBe(12);
      expect(h.db.maxBatchStatements).toBeLessThanOrEqual(11);
      expect(h.db.maxBindings).toBeLessThanOrEqual(16);
      expect(h.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      h.database.close();
    }
  });
});
