import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { projectExecutionBudgetRolloverSchema } from '@vision-maxson/contracts';
import {
  ProjectBudgetRolloverError,
  ProjectBudgetRolloverService,
  type ProjectBudgetRolloverPolicy,
} from '../src/editorial/budget-rollover';

const migrationSql = (name: string) =>
  readFileSync(new URL(`../../../packages/db/migrations/${name}`, import.meta.url), 'utf8');
const migrations = [
  '0000_phase_1_data_security_core.sql',
  '0001_phase_2_product_channel_monetization.sql',
  '0002_phase_3_editorial_intelligence.sql',
  '0003_editorial_execution_budgets.sql',
  '0004_terminal_pipeline_hardening.sql',
] as const;
const currentMigrations = [
  ...migrations,
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
const routes = readFileSync(new URL('../src/editorial/routes.ts', import.meta.url), 'utf8');
const serviceSource = readFileSync(
  new URL('../src/editorial/budget-rollover.ts', import.meta.url),
  'utf8',
);

type Sabotage =
  | 'none'
  | 'successor'
  | 'audit'
  | 'final-guard'
  | 'source-race'
  | 'reservation-race'
  | 'envelope-race'
  | 'reconciled-null-race';

class Statement {
  values: SQLInputValue[] = [];
  constructor(
    private readonly owner: AtomicD1,
    private readonly database: DatabaseSync,
    readonly sql: string,
  ) {}
  bind(...values: SQLInputValue[]) {
    this.values = values;
    return this;
  }
  first<T>() {
    this.owner.record(this.values.length);
    return Promise.resolve((this.database.prepare(this.sql).get(...this.values) as T) ?? null);
  }
  all<T>() {
    this.owner.record(this.values.length);
    return Promise.resolve({ results: this.database.prepare(this.sql).all(...this.values) as T[] });
  }
  run() {
    this.owner.record(this.values.length);
    return Promise.resolve({
      meta: { changes: Number(this.database.prepare(this.sql).run(...this.values).changes) },
    });
  }
}

class AtomicD1 {
  queries = 0;
  maxBoundParameters = 0;
  maxBatchStatements = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private sabotageUsed = false;

  constructor(
    readonly database: DatabaseSync,
    private readonly sabotage: Sabotage = 'none',
  ) {}

  record(bound: number) {
    this.queries += 1;
    this.maxBoundParameters = Math.max(this.maxBoundParameters, bound);
  }

  prepare(sql: string) {
    return new Statement(this, this.database, sql);
  }

  batch(statements: Statement[]) {
    this.maxBatchStatements = Math.max(this.maxBatchStatements, statements.length);
    const execute = async () => {
      if (!this.sabotageUsed) {
        if (this.sabotage === 'successor') statements[1]!.values[0] = 'budget-old';
        if (this.sabotage === 'audit') statements[2]!.values[0] = 'seed-audit';
        if (this.sabotage === 'final-guard') statements[2]!.values[8] = 'missing-successor';
        if (this.sabotage === 'source-race')
          this.database.exec(
            "UPDATE editorial_project_execution_budgets SET status='CONSUMED',version=2,updated_at='concurrent' WHERE id='budget-old'",
          );
        if (this.sabotage === 'reservation-race')
          this.database.exec(
            "UPDATE editorial_execution_reservations SET status='RECONCILED',actual_microusd=321920,reconciled_at='concurrent' WHERE id='execution_reservation_5bd3685e-b5f5-43ee-9e5d-9f0fc307974a'",
          );
        if (this.sabotage === 'envelope-race')
          this.database.exec(
            "UPDATE editorial_execution_envelopes SET provider_model_id='model_openai_gpt_5_6_sol_20260903',version=3 WHERE id='execution_envelope_0f8fbd95-e7d3-46c3-b71c-2d99a7dbf378'",
          );
        if (this.sabotage === 'reconciled-null-race')
          this.database.exec(
            "DROP TRIGGER editorial_execution_reservation_reconcile_guard; UPDATE editorial_execution_reservations SET actual_microusd=NULL WHERE id='execution_reservation_da6950b9-dc52-4761-b4e8-0097cc12747f'",
          );
        this.sabotageUsed = this.sabotage !== 'none';
      }
      this.database.exec('BEGIN IMMEDIATE');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        this.database.exec('COMMIT');
        return results;
      } catch (error) {
        this.database.exec('ROLLBACK');
        throw error;
      }
    };
    const result = this.queue.then(execute, execute);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

const command = {
  oldBudgetId: 'budget-old',
  expectedOldBudgetVersion: 1,
  expectedOldBudgetStatus: 'ACTIVE',
  expectedAmbiguousReservationId: 'execution_reservation_5bd3685e-b5f5-43ee-9e5d-9f0fc307974a',
  reason: 'HISTORICAL_AMBIGUITY_QUARANTINE',
} as const;
const ROLLOVER_OPERATION = 'editorial.execution_budget_rolled_over';

const owner = {
  id: 'owner',
  workspaceId: 'workspace',
  roles: ['owner' as const],
};
const context = {
  requestId: 'request-rollover',
  environment: 'test',
  accessIssuer: 'https://access.example.test',
  accessSubject: 'owner-subject',
};

function count(database: DatabaseSync, table: string) {
  return Number(database.prepare(`SELECT count(*) value FROM ${table}`).get()!.value);
}

function seedFixture(database: DatabaseSync, names: readonly string[] = currentMigrations) {
  for (const migration of names) database.exec(migrationSql(migration));
  database.exec(`
    INSERT INTO workspaces(id,slug,name,created_at,updated_at) VALUES('workspace','workspace','Workspace','t','t');
    INSERT INTO users(id,workspace_id,email,status,created_at,updated_at) VALUES('owner','workspace','owner@example.test','active','t','t');
    INSERT INTO content_brands(id,workspace_id,name,normalized_name,primary_language,created_at,updated_at,created_by) VALUES('brand','workspace','Brand','brand','de','t','t','owner');
    INSERT INTO channel_profiles(id,workspace_id,content_brand_id,name,normalized_name,primary_language,created_at,updated_at,created_by) VALUES('channel','workspace','brand','Channel','channel','de','t','t','owner');
    INSERT INTO projects(id,workspace_id,content_brand_id,channel_profile_id,title,format,operating_mode,status,primary_language,readiness_status,created_at,updated_at,created_by) VALUES('project','workspace','brand','channel','Project','SHORT','ASSISTED','ANALYZING','de','ready','t','t','owner');
    INSERT INTO ai_providers(id,key,display_name,status,adapter_version,created_at,updated_at) VALUES('provider_openai','openai','OpenAI','configured','1','t','t');
    INSERT INTO ai_provider_models(id,provider_id,model_key,display_name,status,capabilities_json,effective_from,created_at,updated_at) VALUES
      ('model_openai_gpt_5_6_terra_20260903','provider_openai','gpt-5.6-terra','Terra','available','{}','t','t','t'),
      ('model_openai_gpt_5_6_sol_20260903','provider_openai','gpt-5.6-sol','Sol','available','{}','t','t','t');
    INSERT INTO ai_pricing_snapshots(id,provider_model_id,currency,input_unit_price,output_unit_price,unit_name,verification_status,effective_from,created_at) VALUES
      ('pricing-terra','model_openai_gpt_5_6_terra_20260903','USD',1,1,'token','externally_verified','t','t'),
      ('pricing-sol','model_openai_gpt_5_6_sol_20260903','USD',1,1,'token','externally_verified','t','t');
    INSERT INTO editorial_project_execution_budgets(id,workspace_id,project_id,profile_key,profile_version,currency,monetary_ceiling_microusd,status,authorized_by,created_at,updated_at,version) VALUES('budget-old','workspace','project','phase3_terminal_graph_v1',1,'USD',1331520,'ACTIVE','owner','t','t',1);
    INSERT INTO audit_events(id,workspace_id,actor_type,action,resource_type,resource_id,outcome,request_id,environment,metadata_json,occurred_at,ingested_at) VALUES('seed-audit','workspace','system','fixture.created','fixture','fixture','success','fixture','test','{}','t','t');
  `);

  const reconciled = [
    {
      envelopeId: 'execution_envelope_0f8fbd95-e7d3-46c3-b71c-2d99a7dbf378',
      reservationId: 'execution_reservation_da6950b9-dc52-4761-b4e8-0097cc12747f',
      stage: 'TOPIC_RESEARCH',
      model: 'model_openai_gpt_5_6_terra_20260903',
      pricing: 'pricing-terra',
      ceiling: 225_920,
      actual: 4_146,
    },
    {
      envelopeId: 'execution_envelope_e6c09f5e-203e-4ebe-a552-4c6fb728bdac',
      reservationId: 'execution_reservation_374dbf0c-b7e0-44a1-964c-b7afe8e04b42',
      stage: 'IDEA_GENERATION',
      model: 'model_openai_gpt_5_6_terra_20260903',
      pricing: 'pricing-terra',
      ceiling: 177_920,
      actual: 14_408,
    },
    {
      envelopeId: 'execution_envelope_7f0dd940-340c-4d7b-a726-faae05101468',
      reservationId: 'execution_reservation_f91a5860-99bb-42a2-9a59-b54953110a30',
      stage: 'CONTENT_BRIEF',
      model: 'model_openai_gpt_5_6_terra_20260903',
      pricing: 'pricing-terra',
      ceiling: 201_920,
      actual: 13_502,
    },
    {
      envelopeId: 'execution_envelope_cf4d27f4-2296-4b0d-9ba7-7893bd21dc38',
      reservationId: 'execution_reservation_f4136c98-622d-4460-8dea-805b5fc5d38d',
      stage: 'SCRIPT_CRITIC',
      model: 'model_openai_gpt_5_6_sol_20260903',
      pricing: 'pricing-sol',
      ceiling: 403_840,
      actual: 69_669,
    },
  ] as const;
  for (const item of reconciled) {
    const runId = `run-${item.stage.toLowerCase()}`;
    database
      .prepare(
        `INSERT INTO editorial_execution_envelopes(id,workspace_id,project_id,profile_key,profile_version,provider_id,provider_model_id,currency,monetary_ceiling_microusd,maximum_calls,status,authorized_by,created_at,updated_at,version,project_execution_budget_id,stage_key) VALUES(?,'workspace','project','phase3_terminal_graph_v1',1,'provider_openai',?,'USD',?,1,'ACTIVE','owner','t','t',1,'budget-old',?)`,
      )
      .run(item.envelopeId, item.model, item.ceiling, item.stage);
    database
      .prepare(
        `INSERT INTO intelligence_runs(id,workspace_id,project_id,task_type,provider_id,provider_model_id,initiated_by,operating_mode,status,idempotency_key,creative_regeneration_number,safe_metadata_json,created_at,updated_at,version) VALUES(?,'workspace','project',?,'provider_openai',?,'owner','ASSISTED','RUNNING',?,0,'{}','t','t',1)`,
      )
      .run(runId, item.stage, item.model, `key-${item.stage}`);
    database
      .prepare(
        `INSERT INTO editorial_execution_reservations(id,envelope_id,workspace_id,project_id,intelligence_run_id,step_key,pricing_snapshot_id,reserved_microusd,actual_microusd,status,created_at,dispatched_at,reconciled_at,project_execution_budget_id) VALUES(?,?,'workspace','project',?,?,?, ?,NULL,'RESERVED','t',NULL,NULL,'budget-old')`,
      )
      .run(item.reservationId, item.envelopeId, runId, item.stage, item.pricing, item.ceiling);
    database
      .prepare(
        `UPDATE editorial_execution_reservations SET status='DISPATCHED',dispatched_at='t' WHERE id=?`,
      )
      .run(item.reservationId);
    database
      .prepare(
        `UPDATE editorial_execution_reservations SET status='RECONCILED',actual_microusd=?,reconciled_at='t' WHERE id=?`,
      )
      .run(item.actual, item.reservationId);
    database
      .prepare(`UPDATE editorial_execution_envelopes SET status='CONSUMED',version=2 WHERE id=?`)
      .run(item.envelopeId);
  }

  const ambiguousId = command.expectedAmbiguousReservationId;
  const storyboardEnvelope = 'execution_envelope_2a2db2a2-557d-4d5a-b914-ede34b9ab453';
  database.exec(`
    INSERT INTO editorial_execution_envelopes(id,workspace_id,project_id,profile_key,profile_version,provider_id,provider_model_id,currency,monetary_ceiling_microusd,maximum_calls,status,authorized_by,created_at,updated_at,version,project_execution_budget_id,stage_key) VALUES('${storyboardEnvelope}','workspace','project','phase3_terminal_graph_v1',1,'provider_openai','model_openai_gpt_5_6_terra_20260903','USD',321920,1,'ACTIVE','owner','t','t',1,'budget-old','STORYBOARD_PLANNER');
    INSERT INTO intelligence_runs(id,workspace_id,project_id,task_type,provider_id,provider_model_id,initiated_by,operating_mode,status,idempotency_key,creative_regeneration_number,safe_metadata_json,created_at,updated_at,version) VALUES('run-storyboard','workspace','project','STORYBOARD_PLANNER','provider_openai','model_openai_gpt_5_6_terra_20260903','owner','ASSISTED','RUNNING','key-storyboard',0,'{}','t','t',1);
    INSERT INTO editorial_execution_reservations(id,envelope_id,workspace_id,project_id,intelligence_run_id,step_key,pricing_snapshot_id,reserved_microusd,actual_microusd,status,created_at,dispatched_at,reconciled_at,project_execution_budget_id) VALUES('${ambiguousId}','${storyboardEnvelope}','workspace','project','run-storyboard','STORYBOARD_PLANNER','pricing-terra',321920,NULL,'RESERVED','t',NULL,NULL,'budget-old');
    UPDATE editorial_execution_reservations SET status='DISPATCHED',dispatched_at='t' WHERE id='${ambiguousId}';
    UPDATE editorial_execution_reservations SET status='AMBIGUOUS',reconciled_at='t' WHERE id='${ambiguousId}';
    UPDATE editorial_execution_envelopes SET status='CONSUMED',version=2 WHERE id='${storyboardEnvelope}';
  `);
}

function fixture(sabotage: Sabotage = 'none', names: readonly string[] = currentMigrations) {
  const database = new DatabaseSync(':memory:');
  seedFixture(database, names);
  const d1 = new AtomicD1(database, sabotage);
  const service = new ProjectBudgetRolloverService(d1 as unknown as D1Database, owner, context);
  return { database, d1, service };
}

function addReservation(
  database: DatabaseSync,
  suffix: string,
  status: 'RESERVED' | 'DISPATCHED' | 'AMBIGUOUS',
) {
  const envelope = `extra-envelope-${suffix}`;
  const run = `extra-run-${suffix}`;
  const reservation = `extra-reservation-${suffix}`;
  database
    .prepare(
      `INSERT INTO editorial_execution_envelopes(id,workspace_id,project_id,profile_key,profile_version,provider_id,provider_model_id,currency,monetary_ceiling_microusd,maximum_calls,status,authorized_by,created_at,updated_at,version,project_execution_budget_id,stage_key) VALUES(?,'workspace','project','phase3_terminal_graph_v1',1,'provider_openai','model_openai_gpt_5_6_terra_20260903','USD',1000,1,'ACTIVE','owner','t','t',1,'budget-old','TOPIC_RESEARCH')`,
    )
    .run(envelope);
  database
    .prepare(
      `INSERT INTO intelligence_runs(id,workspace_id,project_id,task_type,provider_id,provider_model_id,initiated_by,operating_mode,status,idempotency_key,creative_regeneration_number,safe_metadata_json,created_at,updated_at,version) VALUES(?,'workspace','project','TOPIC_RESEARCH','provider_openai','model_openai_gpt_5_6_terra_20260903','owner','ASSISTED','RUNNING',?,0,'{}','t','t',1)`,
    )
    .run(run, `extra-key-${suffix}`);
  database
    .prepare(
      `INSERT INTO editorial_execution_reservations(id,envelope_id,workspace_id,project_id,intelligence_run_id,step_key,pricing_snapshot_id,reserved_microusd,actual_microusd,status,created_at,dispatched_at,reconciled_at,project_execution_budget_id) VALUES(?,?,'workspace','project',?,'TOPIC_RESEARCH','pricing-terra',1000,NULL,'RESERVED','t',NULL,NULL,'budget-old')`,
    )
    .run(reservation, envelope, run);
  if (status !== 'RESERVED')
    database
      .prepare(
        `UPDATE editorial_execution_reservations SET status='DISPATCHED',dispatched_at='t' WHERE id=?`,
      )
      .run(reservation);
  if (status === 'AMBIGUOUS') {
    database
      .prepare(`UPDATE editorial_execution_reservations SET status='AMBIGUOUS' WHERE id=?`)
      .run(reservation);
    database
      .prepare(`UPDATE editorial_execution_envelopes SET status='CONSUMED',version=2 WHERE id=?`)
      .run(envelope);
  }
}

async function expectAtomicFailure(sabotage: Sabotage) {
  const { database, service } = fixture(sabotage);
  const beforeReservation = database
    .prepare('SELECT * FROM editorial_execution_reservations ORDER BY id')
    .all();
  const beforeEnvelopes = database
    .prepare('SELECT * FROM editorial_execution_envelopes ORDER BY id')
    .all();
  await expect(service.rollover('project', `key-${sabotage}`, command)).rejects.toThrow();
  expect(
    database.prepare(`SELECT status,version FROM editorial_project_execution_budgets`).all(),
  ).toEqual([{ status: 'ACTIVE', version: 1 }]);
  expect(count(database, 'audit_events')).toBe(1);
  expect(
    database.prepare('SELECT * FROM editorial_execution_reservations ORDER BY id').all(),
  ).toEqual(beforeReservation);
  expect(database.prepare('SELECT * FROM editorial_execution_envelopes ORDER BY id').all()).toEqual(
    beforeEnvelopes,
  );
  database.close();
}

type FixtureMutation = (database: DatabaseSync) => void;

function dropTableTriggers(database: DatabaseSync, table: string) {
  const triggers = database
    .prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name=?")
    .all(table) as { name: string }[];
  for (const { name } of triggers) database.exec(`DROP TRIGGER "${name.replaceAll('"', '""')}"`);
}

function cloneReservation(
  database: DatabaseSync,
  sourceId: string,
  replacementId: string,
  status: 'RESERVED' | 'DISPATCHED' | 'RECONCILED' | 'AMBIGUOUS' | 'CANCELLED',
  stepOverride = 'SCRIPT_WRITER_SHORT',
) {
  dropTableTriggers(database, 'editorial_execution_reservations');
  const dispatchedAt = status === 'RESERVED' || status === 'CANCELLED' ? null : 't';
  const reconciledAt = status === 'RECONCILED' || status === 'AMBIGUOUS' ? 't' : null;
  const runId = `clone-run-${replacementId}`;
  database
    .prepare(
      `INSERT INTO intelligence_runs(
        id,workspace_id,project_id,task_type,provider_id,provider_model_id,
        initiated_by,operating_mode,status,idempotency_key,
        creative_regeneration_number,safe_metadata_json,created_at,updated_at,version
      )
      SELECT ?,r.workspace_id,r.project_id,?,run.provider_id,run.provider_model_id,
        run.initiated_by,run.operating_mode,'RUNNING',?,0,'{}','t','t',1
      FROM editorial_execution_reservations r
      JOIN intelligence_runs run ON run.id=r.intelligence_run_id
      WHERE r.id=?`,
    )
    .run(runId, stepOverride, `clone-key-${replacementId}`, sourceId);
  database
    .prepare(
      `INSERT INTO editorial_execution_reservations(
        id,envelope_id,workspace_id,project_id,intelligence_run_id,step_key,
        pricing_snapshot_id,reserved_microusd,actual_microusd,status,created_at,
        dispatched_at,reconciled_at,project_execution_budget_id
      )
      SELECT ?,envelope_id,workspace_id,project_id,?,?,
        pricing_snapshot_id,reserved_microusd,
        CASE WHEN ?='RECONCILED' THEN actual_microusd ELSE NULL END,
        ?,created_at,?,?,project_execution_budget_id
      FROM editorial_execution_reservations WHERE id=?`,
    )
    .run(replacementId, runId, stepOverride, status, status, dispatchedAt, reconciledAt, sourceId);
}

function expectRolloverConflict(outcome: PromiseSettledResult<unknown> | undefined) {
  expect(outcome?.status).toBe('rejected');
  if (!outcome || outcome.status !== 'rejected') throw new Error('expected rejected rollover');
  const reason: unknown = outcome.reason;
  expect(reason).toBeInstanceOf(ProjectBudgetRolloverError);
  if (!(reason instanceof ProjectBudgetRolloverError))
    throw new Error('expected rollover conflict');
  expect(reason.status).toBe(409);
}

async function expectSnapshotMutationRejected(name: string, mutate: FixtureMutation) {
  const { database, service } = fixture();
  mutate(database);
  const beforeBudgets = database
    .prepare('SELECT * FROM editorial_project_execution_budgets ORDER BY id')
    .all();
  const beforeAudit = count(database, 'audit_events');
  await expect(service.rollover('project', `attack-${name}`, command)).rejects.toBeInstanceOf(
    ProjectBudgetRolloverError,
  );
  expect(
    database.prepare('SELECT * FROM editorial_project_execution_budgets ORDER BY id').all(),
  ).toEqual(beforeBudgets);
  expect(count(database, 'audit_events')).toBe(beforeAudit);
  database.close();
}

async function testDigest(value: unknown) {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return [...new Uint8Array(bytes)].map((part) => part.toString(16).padStart(2, '0')).join('');
}

function testRolloverCommandHash(operationType: string = ROLLOVER_OPERATION) {
  return testDigest([
    ['workspace', 'workspace'],
    ['operationType', operationType],
    ['project', 'project'],
    ['oldBudgetId', command.oldBudgetId],
    ['expectedOldBudgetVersion', command.expectedOldBudgetVersion],
    ['expectedOldBudgetStatus', command.expectedOldBudgetStatus],
    ['expectedAmbiguousReservationId', command.expectedAmbiguousReservationId],
    ['reason', command.reason],
  ]);
}

type ReceiptMutation = (database: DatabaseSync, auditEventId: string) => void;
type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mutateReceiptMetadata(
  database: DatabaseSync,
  auditEventId: string,
  mutate: (metadata: JsonObject) => void,
) {
  const row = database
    .prepare('SELECT metadata_json metadataJson FROM audit_events WHERE id=?')
    .get(auditEventId) as { metadataJson: string };
  const metadata: unknown = JSON.parse(row.metadataJson);
  if (!isJsonObject(metadata)) throw new Error('expected receipt metadata');
  mutate(metadata);
  database
    .prepare('UPDATE audit_events SET metadata_json=? WHERE id=?')
    .run(JSON.stringify(metadata), auditEventId);
}

function mutateNestedReceiptResult(metadata: JsonObject, mutate: (result: JsonObject) => void) {
  if (!isJsonObject(metadata.result)) throw new Error('expected nested receipt result');
  mutate(metadata.result);
}

async function expectReceiptCorruptionRejected(name: string, mutate: ReceiptMutation) {
  const { database, service } = fixture();
  const key = `receipt-corruption-${name}`;
  const created = await service.rollover('project', key, command);
  dropTableTriggers(database, 'audit_events');
  mutate(database, created.auditEventId);
  const budgetState = database
    .prepare('SELECT * FROM editorial_project_execution_budgets ORDER BY id')
    .all();
  const auditCount = count(database, 'audit_events');
  await expect(service.rollover('project', key, command)).rejects.toThrow(
    'execution_budget_rollover_receipt_invalid',
  );
  expect(
    database.prepare('SELECT * FROM editorial_project_execution_budgets ORDER BY id').all(),
  ).toEqual(budgetState);
  expect(count(database, 'audit_events')).toBe(auditCount);
  database.close();
}

const projectBPolicy: ProjectBudgetRolloverPolicy = {
  envelopes: [
    {
      id: 'project-b-envelope-research',
      stage: 'TOPIC_RESEARCH',
      model: 'model_openai_gpt_5_6_terra_20260903',
      ceiling: 225_920,
    },
    {
      id: 'project-b-envelope-storyboard',
      stage: 'STORYBOARD_PLANNER',
      model: 'model_openai_gpt_5_6_terra_20260903',
      ceiling: 321_920,
    },
    {
      id: 'project-b-envelope-brief',
      stage: 'CONTENT_BRIEF',
      model: 'model_openai_gpt_5_6_terra_20260903',
      ceiling: 201_920,
    },
    {
      id: 'project-b-envelope-critic',
      stage: 'SCRIPT_CRITIC',
      model: 'model_openai_gpt_5_6_sol_20260903',
      ceiling: 403_840,
    },
    {
      id: 'project-b-envelope-ideas',
      stage: 'IDEA_GENERATION',
      model: 'model_openai_gpt_5_6_terra_20260903',
      ceiling: 177_920,
    },
  ],
  reservations: [
    {
      id: 'project-b-reservation-ideas',
      envelopeId: 'project-b-envelope-ideas',
      stage: 'IDEA_GENERATION',
      reserved: 177_920,
      actual: 14_408,
      status: 'RECONCILED',
    },
    {
      id: 'project-b-reservation-research',
      envelopeId: 'project-b-envelope-research',
      stage: 'TOPIC_RESEARCH',
      reserved: 225_920,
      actual: 4_146,
      status: 'RECONCILED',
    },
    {
      id: 'project-b-reservation-critic',
      envelopeId: 'project-b-envelope-critic',
      stage: 'SCRIPT_CRITIC',
      reserved: 403_840,
      actual: 69_669,
      status: 'RECONCILED',
    },
    {
      id: 'project-b-reservation-brief',
      envelopeId: 'project-b-envelope-brief',
      stage: 'CONTENT_BRIEF',
      reserved: 201_920,
      actual: 13_502,
      status: 'RECONCILED',
    },
    {
      id: 'project-b-reservation-storyboard',
      envelopeId: 'project-b-envelope-storyboard',
      stage: 'STORYBOARD_PLANNER',
      reserved: 321_920,
      actual: null,
      status: 'AMBIGUOUS',
    },
  ],
};

const projectBCommand = {
  ...command,
  oldBudgetId: 'budget-b-old',
  expectedAmbiguousReservationId: 'project-b-reservation-storyboard',
};

function seedProjectBHistory(database: DatabaseSync) {
  database.exec(`
    INSERT INTO projects(id,workspace_id,content_brand_id,channel_profile_id,title,format,operating_mode,status,primary_language,readiness_status,created_at,updated_at,created_by)
    VALUES('project-b','workspace','brand','channel','Project B','SHORT','ASSISTED','ANALYZING','de','ready','t','t','owner');
    INSERT INTO editorial_project_execution_budgets(id,workspace_id,project_id,profile_key,profile_version,currency,monetary_ceiling_microusd,status,authorized_by,created_at,updated_at,version)
    VALUES('budget-b-old','workspace','project-b','phase3_terminal_graph_v1',1,'USD',1331520,'ACTIVE','owner','t','t',1);
  `);
  for (const envelope of projectBPolicy.envelopes)
    database
      .prepare(
        `INSERT INTO editorial_execution_envelopes(id,workspace_id,project_id,profile_key,profile_version,provider_id,provider_model_id,currency,monetary_ceiling_microusd,maximum_calls,status,authorized_by,created_at,updated_at,version,project_execution_budget_id,stage_key)
         VALUES(?,'workspace','project-b','phase3_terminal_graph_v1',1,'provider_openai',?,'USD',?,1,'ACTIVE','owner','t','t',1,'budget-b-old',?)`,
      )
      .run(envelope.id, envelope.model, envelope.ceiling, envelope.stage);
  for (const reservation of projectBPolicy.reservations) {
    const envelope = projectBPolicy.envelopes.find(
      (candidate) => candidate.id === reservation.envelopeId,
    )!;
    const runId = `project-b-run-${reservation.stage.toLowerCase()}`;
    database
      .prepare(
        `INSERT INTO intelligence_runs(id,workspace_id,project_id,task_type,provider_id,provider_model_id,initiated_by,operating_mode,status,idempotency_key,creative_regeneration_number,safe_metadata_json,created_at,updated_at,version)
         VALUES(?,'workspace','project-b',?,'provider_openai',?,'owner','ASSISTED','RUNNING',?,0,'{}','t','t',1)`,
      )
      .run(runId, reservation.stage, envelope.model, `project-b-key-${reservation.stage}`);
    database
      .prepare(
        `INSERT INTO editorial_execution_reservations(id,envelope_id,workspace_id,project_id,intelligence_run_id,step_key,pricing_snapshot_id,reserved_microusd,actual_microusd,status,created_at,dispatched_at,reconciled_at,project_execution_budget_id)
         VALUES(?,?,'workspace','project-b',?,?,?, ?,NULL,'RESERVED','t',NULL,NULL,'budget-b-old')`,
      )
      .run(
        reservation.id,
        reservation.envelopeId,
        runId,
        reservation.stage,
        reservation.stage === 'SCRIPT_CRITIC' ? 'pricing-sol' : 'pricing-terra',
        reservation.reserved,
      );
    database
      .prepare(
        `UPDATE editorial_execution_reservations SET status='DISPATCHED',dispatched_at='t' WHERE id=?`,
      )
      .run(reservation.id);
    database
      .prepare(
        `UPDATE editorial_execution_reservations SET status=?,actual_microusd=?,reconciled_at='t' WHERE id=?`,
      )
      .run(reservation.status, reservation.actual, reservation.id);
    database
      .prepare(`UPDATE editorial_execution_envelopes SET status='CONSUMED',version=2 WHERE id=?`)
      .run(reservation.envelopeId);
  }
}

describe('safe project budget rollover', () => {
  it('enforces the exact strict command and route permission', () => {
    expect(projectExecutionBudgetRolloverSchema.safeParse(command).success).toBe(true);
    for (const invalid of [
      { ...command, reason: 'OTHER' },
      { ...command, expectedOldBudgetVersion: 2 },
      { ...command, expectedOldBudgetStatus: 'CONSUMED' },
      { ...command, successorCeiling: 907875 },
      { ...command, oldBudgetId: '' },
    ])
      expect(projectExecutionBudgetRolloverSchema.safeParse(invalid).success).toBe(false);
    expect(routes).toContain(
      "'/admin/projects/:projectId/editorial-project-execution-budgets/rollover'",
    );
    expect(routes).toContain("requirePermission('providers:admin')");
    expect(routes).toContain("c.req.header('Idempotency-Key')?.trim()");
  });

  it('binds the same canonical operation into the claim, command hash, and audit action', async () => {
    const { database, service } = fixture();
    const key = 'operation-hash';
    const created = await service.rollover('project', key, command);
    const audit = database
      .prepare('SELECT action,metadata_json metadataJson FROM audit_events WHERE id=?')
      .get(created.auditEventId) as { action: string; metadataJson: string };
    const metadata = JSON.parse(audit.metadataJson) as JsonObject;
    const expectedCommandHash = await testRolloverCommandHash();
    const repeatedCommandHash = await testRolloverCommandHash();
    const otherOperationHash = await testRolloverCommandHash('other.operation');
    const expectedClaimId = `audit_${await testDigest({
      workspaceId: 'workspace',
      operation: ROLLOVER_OPERATION,
      projectId: 'project',
      idempotencyKey: key,
    })}`;

    expect(metadata.operation).toBe(ROLLOVER_OPERATION);
    expect(metadata.commandHash).toBe(expectedCommandHash);
    expect(repeatedCommandHash).toBe(expectedCommandHash);
    expect(otherOperationHash).not.toBe(expectedCommandHash);
    expect(audit.action).toBe(ROLLOVER_OPERATION);
    expect(created.auditEventId).toBe(expectedClaimId);
    await expect(service.rollover('project', key, command)).resolves.toEqual({
      ...created,
      idempotentReplay: true,
    });
    database.close();
  });

  it('rolls over atomically with exact accounting and preserves historical children', async () => {
    const { database, d1, service } = fixture();
    const reservationBefore = database
      .prepare('SELECT * FROM editorial_execution_reservations ORDER BY id')
      .all();
    const envelopesBefore = database
      .prepare('SELECT * FROM editorial_execution_envelopes ORDER BY id')
      .all();
    const result = await service.rollover('project', 'rollover-key', command);
    expect(result.idempotentReplay).toBe(false);
    expect(result.canonicalCommittedMicroUsd).toBe(423645);
    expect(result.ambiguousExposureMicroUsd).toBe(321920);
    expect(result.successorBudget.monetaryCeilingMicroUsd).toBe(907875);
    expect(
      database
        .prepare(
          'SELECT id,status,version,monetary_ceiling_microusd ceiling FROM editorial_project_execution_budgets ORDER BY CASE WHEN id=? THEN 0 ELSE 1 END',
        )
        .all('budget-old'),
    ).toEqual([
      { id: 'budget-old', status: 'CONSUMED', version: 2, ceiling: 1331520 },
      {
        id: result.successorBudget.id,
        status: 'ACTIVE',
        version: 1,
        ceiling: 907875,
      },
    ]);
    expect(
      database.prepare('SELECT * FROM editorial_execution_reservations ORDER BY id').all(),
    ).toEqual(reservationBefore);
    expect(
      database.prepare('SELECT * FROM editorial_execution_envelopes ORDER BY id').all(),
    ).toEqual(envelopesBefore);
    expect(
      database
        .prepare(
          'SELECT count(*) value FROM editorial_execution_envelopes WHERE project_execution_budget_id=?',
        )
        .get(result.successorBudget.id)!.value,
    ).toBe(0);
    expect(
      database
        .prepare(
          `SELECT status,reserved_microusd reserved,actual_microusd actual,dispatched_at dispatchedAt FROM editorial_execution_reservations WHERE id=?`,
        )
        .get(command.expectedAmbiguousReservationId),
    ).toEqual({ status: 'AMBIGUOUS', reserved: 321920, actual: null, dispatchedAt: 't' });
    expect(
      database
        .prepare(
          `SELECT status FROM editorial_execution_envelopes WHERE id='execution_envelope_2a2db2a2-557d-4d5a-b914-ede34b9ab453'`,
        )
        .get(),
    ).toEqual({ status: 'CONSUMED' });
    expect(423645 + result.successorBudget.monetaryCeilingMicroUsd).toBe(1331520);
    const audit = database
      .prepare('SELECT * FROM audit_events WHERE id=?')
      .get(result.auditEventId)!;
    expect(audit.action).toBe('editorial.execution_budget_rolled_over');
    expect(audit.resource_id).toBe(result.successorBudget.id);
    expect(audit.actor_id).toBe('owner');
    expect(audit.actor_role).toBe('owner');
    expect(audit.request_id).toBe('request-rollover');
    const metadata = JSON.parse(String(audit.metadata_json)) as Record<string, unknown>;
    expect(metadata).toMatchObject({
      oldBudgetId: 'budget-old',
      oldBudgetVersionBefore: 1,
      oldBudgetVersionAfter: 2,
      oldStatus: 'ACTIVE',
      oldNewStatus: 'CONSUMED',
      successorBudgetId: result.successorBudget.id,
      originalCeilingMicroUsd: 1331520,
      canonicalCommittedMicroUsd: 423645,
      ambiguousExposureMicroUsd: 321920,
      successorCeilingMicroUsd: 907875,
      ambiguousReservationIds: [command.expectedAmbiguousReservationId],
      reason: 'HISTORICAL_AMBIGUITY_QUARANTINE',
      workspace: 'workspace',
      project: 'project',
      environment: 'test',
      requestId: 'request-rollover',
      idempotencyKey: 'rollover-key',
    });
    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(d1.maxBoundParameters).toBe(21);
    expect(d1.maxBatchStatements).toBe(3);
    expect(d1.queries).toBe(5);
    database.close();
  });

  it('replays identically and rejects a changed command under the same key', async () => {
    const { database, service } = fixture();
    const created = await service.rollover('project', 'same-key', command);
    await expect(service.rollover('project', 'same-key', command)).resolves.toEqual({
      ...created,
      idempotentReplay: true,
    });
    await expect(
      service.rollover('project', 'same-key', {
        ...command,
        expectedAmbiguousReservationId: 'different-reservation',
      }),
    ).rejects.toThrow('execution_budget_rollover_idempotency_conflict');
    expect(count(database, 'editorial_project_execution_budgets')).toBe(2);
    expect(
      database
        .prepare(
          `SELECT count(*) value FROM audit_events WHERE action='editorial.execution_budget_rolled_over'`,
        )
        .get()!.value,
    ).toBe(1);
    database.close();
  });

  it('serializes concurrent identical commands to one result and one successor', async () => {
    const { database, d1 } = fixture();
    const first = new ProjectBudgetRolloverService(d1 as unknown as D1Database, owner, context);
    const second = new ProjectBudgetRolloverService(d1 as unknown as D1Database, owner, context);
    const results = await Promise.all([
      first.rollover('project', 'concurrent-key', command),
      second.rollover('project', 'concurrent-key', command),
    ]);
    expect(new Set(results.map((result) => result.successorBudget.id)).size).toBe(1);
    expect(results.filter((result) => result.idempotentReplay)).toHaveLength(1);
    expect(count(database, 'editorial_project_execution_budgets')).toBe(2);
    expect(
      database
        .prepare(
          `SELECT count(*) value FROM audit_events WHERE action='editorial.execution_budget_rolled_over'`,
        )
        .get()!.value,
    ).toBe(1);
    database.close();
  });

  it.each([
    [
      'terminal old budget',
      (db: DatabaseSync) =>
        db.exec(
          "UPDATE editorial_project_execution_budgets SET status='CONSUMED',version=2 WHERE id='budget-old'",
        ),
    ],
    [
      'budget ceiling drift',
      (db: DatabaseSync) =>
        db.exec(
          "UPDATE editorial_project_execution_budgets SET monetary_ceiling_microusd=1331519,version=2 WHERE id='budget-old'",
        ),
    ],
    [
      'profile drift',
      (db: DatabaseSync) =>
        db.exec(
          "UPDATE editorial_project_execution_budgets SET profile_key='other',version=2 WHERE id='budget-old'",
        ),
    ],
    [
      'ambiguous reconciliation race',
      (db: DatabaseSync) =>
        db.exec(
          `UPDATE editorial_execution_reservations SET status='RECONCILED',actual_microusd=321920,reconciled_at='t' WHERE id='${command.expectedAmbiguousReservationId}'`,
        ),
    ],
    [
      'second ambiguous reservation',
      (db: DatabaseSync) => {
        db.exec('DROP TRIGGER editorial_execution_reservation_ambiguous_guard');
        addReservation(db, 'ambiguous', 'AMBIGUOUS');
      },
    ],
    [
      'new reserved reservation',
      (db: DatabaseSync) => {
        db.exec('DROP TRIGGER editorial_execution_reservation_ambiguous_guard');
        addReservation(db, 'reserved', 'RESERVED');
      },
    ],
    [
      'new dispatched reservation',
      (db: DatabaseSync) => {
        db.exec('DROP TRIGGER editorial_execution_reservation_ambiguous_guard');
        addReservation(db, 'dispatched', 'DISPATCHED');
      },
    ],
    [
      'active envelope',
      (db: DatabaseSync) =>
        db.exec(
          "INSERT INTO editorial_execution_envelopes(id,workspace_id,project_id,profile_key,profile_version,provider_id,provider_model_id,currency,monetary_ceiling_microusd,maximum_calls,status,authorized_by,created_at,updated_at,version,project_execution_budget_id,stage_key) VALUES('active-extra','workspace','project','phase3_terminal_graph_v1',1,'provider_openai','model_openai_gpt_5_6_terra_20260903','USD',1,1,'ACTIVE','owner','t','t',1,'budget-old','TOPIC_RESEARCH')",
        ),
    ],
    [
      'historical envelope drift',
      (db: DatabaseSync) =>
        db.exec(
          "UPDATE editorial_execution_envelopes SET stage_key='SCRIPT_CRITIC',version=3 WHERE id='execution_envelope_2a2db2a2-557d-4d5a-b914-ede34b9ab453'",
        ),
    ],
  ])('fails closed without partial writes for %s', async (_name, mutate) => {
    const { database, service } = fixture();
    mutate(database);
    const beforeBudgets = database
      .prepare('SELECT * FROM editorial_project_execution_budgets')
      .all();
    const beforeAudit = count(database, 'audit_events');
    await expect(service.rollover('project', `drift-${_name}`, command)).rejects.toBeInstanceOf(
      ProjectBudgetRolloverError,
    );
    expect(database.prepare('SELECT * FROM editorial_project_execution_budgets').all()).toEqual(
      beforeBudgets,
    );
    expect(count(database, 'audit_events')).toBe(beforeAudit);
    database.close();
  });

  it('rejects wrong budget, project, workspace, ambiguity identity, and permission', async () => {
    const { database, d1, service } = fixture();
    await expect(
      service.rollover('project', 'wrong-budget', { ...command, oldBudgetId: 'missing' }),
    ).rejects.toThrow('execution_budget_rollover_source_not_found');
    await expect(service.rollover('other-project', 'wrong-project', command)).rejects.toThrow(
      'execution_budget_rollover_source_not_found',
    );
    await expect(
      service.rollover('project', 'wrong-reservation', {
        ...command,
        expectedAmbiguousReservationId: 'other-reservation',
      }),
    ).rejects.toThrow('execution_budget_rollover_idempotency_conflict');
    const forbidden = new ProjectBudgetRolloverService(
      d1 as unknown as D1Database,
      { ...owner, roles: ['viewer'] },
      context,
    );
    await expect(forbidden.rollover('project', 'forbidden', command)).rejects.toThrow(
      'execution_budget_rollover_forbidden',
    );
    database.exec(`
      INSERT INTO workspaces(id,slug,name,created_at,updated_at) VALUES('other-workspace','other','Other','t','t');
      INSERT INTO users(id,workspace_id,email,status,created_at,updated_at) VALUES('other-owner','other-workspace','other@example.test','active','t','t');
    `);
    const crossWorkspace = new ProjectBudgetRolloverService(
      d1 as unknown as D1Database,
      { id: 'other-owner', workspaceId: 'other-workspace', roles: ['owner'] },
      context,
    );
    await expect(crossWorkspace.rollover('project', 'cross-workspace', command)).rejects.toThrow(
      'execution_budget_rollover_source_not_found',
    );
    expect(count(database, 'editorial_project_execution_budgets')).toBe(1);
    database.close();
  });

  it.each(['successor', 'audit', 'final-guard'] as const)(
    'rolls back every write on %s failure',
    async (sabotage) => expectAtomicFailure(sabotage),
  );

  it.each(['source-race', 'reservation-race', 'envelope-race', 'reconciled-null-race'] as const)(
    'fails closed on %s after the pre-transaction snapshot',
    async (sabotage) => {
      const { database, service } = fixture(sabotage);
      await expect(service.rollover('project', `key-${sabotage}`, command)).rejects.toThrow(
        'execution_budget_rollover_conflict',
      );
      expect(count(database, 'editorial_project_execution_budgets')).toBe(1);
      expect(
        database
          .prepare(
            `SELECT count(*) value FROM audit_events WHERE action='editorial.execution_budget_rolled_over'`,
          )
          .get()!.value,
      ).toBe(0);
      database.close();
    },
  );

  it('executes two fresh concurrent project-scoped rollovers under the same workspace and key', async () => {
    const { database, d1 } = fixture();
    const key = 'shared-cross-project-key';
    seedProjectBHistory(database);
    const first = new ProjectBudgetRolloverService(d1 as unknown as D1Database, owner, context);
    const second = new ProjectBudgetRolloverService(
      d1 as unknown as D1Database,
      owner,
      context,
      projectBPolicy,
    );
    const [projectAResult, projectBResult] = await Promise.all([
      first.rollover('project', key, command),
      second.rollover('project-b', key, projectBCommand),
    ]);
    expect(projectAResult.auditEventId).not.toBe(projectBResult.auditEventId);
    expect(projectAResult.idempotentReplay).toBe(false);
    expect(projectBResult.idempotentReplay).toBe(false);
    expect(projectAResult.successorBudget.id).not.toBe(projectBResult.successorBudget.id);
    await expect(first.rollover('project', key, command)).resolves.toEqual({
      ...projectAResult,
      idempotentReplay: true,
    });
    await expect(second.rollover('project-b', key, projectBCommand)).resolves.toEqual({
      ...projectBResult,
      idempotentReplay: true,
    });
    expect(
      database
        .prepare(
          `SELECT json_extract(metadata_json,'$.project') projectId,resource_id resourceId FROM audit_events WHERE id IN (?,?) ORDER BY projectId`,
        )
        .all(projectAResult.auditEventId, projectBResult.auditEventId),
    ).toEqual([
      { projectId: 'project', resourceId: projectAResult.successorBudget.id },
      { projectId: 'project-b', resourceId: projectBResult.successorBudget.id },
    ]);
    expect(
      database
        .prepare(
          `SELECT count(*) value FROM audit_events WHERE action='editorial.execution_budget_rolled_over'`,
        )
        .get()!.value,
    ).toBe(2);
    expect(count(database, 'editorial_project_execution_budgets')).toBe(4);
    database.close();
  });

  it('allows one canonical winner for concurrent same-key different-command requests', async () => {
    const { database, d1 } = fixture();
    const first = new ProjectBudgetRolloverService(d1 as unknown as D1Database, owner, context);
    const second = new ProjectBudgetRolloverService(d1 as unknown as D1Database, owner, context);
    const changed = { ...command, expectedAmbiguousReservationId: 'changed-reservation' };
    const outcomes = await Promise.allSettled([
      first.rollover('project', 'same-key-different-command', command),
      second.rollover('project', 'same-key-different-command', changed),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    const rejected = outcomes.find((outcome) => outcome.status === 'rejected');
    expectRolloverConflict(rejected);
    if (!rejected || rejected.status !== 'rejected') throw new Error('expected rejected rollover');
    expect((rejected.reason as Error).message).toBe(
      'execution_budget_rollover_idempotency_conflict',
    );
    await expect(second.rollover('project', 'same-key-different-command', changed)).rejects.toThrow(
      'execution_budget_rollover_idempotency_conflict',
    );
    expect(count(database, 'editorial_project_execution_budgets')).toBe(2);
    expect(
      database
        .prepare(
          `SELECT count(*) value FROM audit_events WHERE action='editorial.execution_budget_rolled_over'`,
        )
        .get()!.value,
    ).toBe(1);
    database.close();
  });

  it('allows at most one successor for concurrent different keys on the same old budget', async () => {
    const { database, d1 } = fixture();
    const first = new ProjectBudgetRolloverService(d1 as unknown as D1Database, owner, context);
    const second = new ProjectBudgetRolloverService(d1 as unknown as D1Database, owner, context);
    const outcomes = await Promise.allSettled([
      first.rollover('project', 'different-key-a', command),
      second.rollover('project', 'different-key-b', command),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    const rejected = outcomes.find((outcome) => outcome.status === 'rejected');
    expectRolloverConflict(rejected);
    if (!rejected || rejected.status !== 'rejected') throw new Error('expected rejected rollover');
    expect((rejected.reason as Error).message).toBe('execution_budget_rollover_conflict');
    expect(count(database, 'editorial_project_execution_budgets')).toBe(2);
    expect(
      database
        .prepare(
          `SELECT count(*) value FROM audit_events WHERE action='editorial.execution_budget_rolled_over'`,
        )
        .get()!.value,
    ).toBe(1);
    database.close();
  });

  it.each<[string, FixtureMutation]>([
    [
      'replace non-storyboard envelope ID',
      (db) => {
        db.exec('PRAGMA foreign_keys=OFF');
        db.exec(
          "UPDATE editorial_execution_envelopes SET id='replacement-envelope',version=3 WHERE id='execution_envelope_0f8fbd95-e7d3-46c3-b71c-2d99a7dbf378'",
        );
      },
    ],
    [
      'remove non-storyboard envelope and add a compensating envelope',
      (db) => {
        db.exec('PRAGMA foreign_keys=OFF');
        db.exec(`
          INSERT INTO editorial_execution_envelopes(
            id,workspace_id,project_id,profile_key,profile_version,provider_id,
            provider_model_id,currency,monetary_ceiling_microusd,maximum_calls,
            status,authorized_by,created_at,updated_at,version,
            project_execution_budget_id,stage_key
          )
          SELECT 'compensating-envelope',workspace_id,project_id,profile_key,profile_version,
            provider_id,provider_model_id,currency,monetary_ceiling_microusd,maximum_calls,
            status,authorized_by,created_at,updated_at,version,
            project_execution_budget_id,stage_key
          FROM editorial_execution_envelopes
          WHERE id='execution_envelope_0f8fbd95-e7d3-46c3-b71c-2d99a7dbf378';
          DELETE FROM editorial_execution_envelopes
          WHERE id='execution_envelope_0f8fbd95-e7d3-46c3-b71c-2d99a7dbf378';
        `);
      },
    ],
    [
      'swap envelope stage',
      (db) =>
        db.exec(
          "UPDATE editorial_execution_envelopes SET stage_key='SCRIPT_WRITER_SHORT',version=3 WHERE id='execution_envelope_0f8fbd95-e7d3-46c3-b71c-2d99a7dbf378'",
        ),
    ],
    [
      'alter envelope provider',
      (db) => {
        db.exec(
          "INSERT INTO ai_providers(id,key,display_name,status,adapter_version,created_at,updated_at) VALUES('other-provider','other','Other','configured','1','t','t')",
        );
        db.exec(
          "UPDATE editorial_execution_envelopes SET provider_id='other-provider',version=3 WHERE id='execution_envelope_0f8fbd95-e7d3-46c3-b71c-2d99a7dbf378'",
        );
      },
    ],
    [
      'alter envelope model',
      (db) =>
        db.exec(
          "UPDATE editorial_execution_envelopes SET provider_model_id='model_openai_gpt_5_6_sol_20260903',version=3 WHERE id='execution_envelope_0f8fbd95-e7d3-46c3-b71c-2d99a7dbf378'",
        ),
    ],
    [
      'alter envelope version',
      (db) =>
        db.exec(
          "UPDATE editorial_execution_envelopes SET version=3 WHERE id='execution_envelope_0f8fbd95-e7d3-46c3-b71c-2d99a7dbf378'",
        ),
    ],
    [
      'alter envelope ceiling',
      (db) =>
        db.exec(
          "UPDATE editorial_execution_envelopes SET monetary_ceiling_microusd=225921,version=3 WHERE id='execution_envelope_0f8fbd95-e7d3-46c3-b71c-2d99a7dbf378'",
        ),
    ],
    [
      'alter envelope maximum calls',
      (db) => {
        db.exec('PRAGMA ignore_check_constraints=ON');
        db.exec(
          "UPDATE editorial_execution_envelopes SET maximum_calls=2,version=3 WHERE id='execution_envelope_0f8fbd95-e7d3-46c3-b71c-2d99a7dbf378'",
        );
      },
    ],
    [
      'add a sixth consumed envelope',
      (db) =>
        db.exec(
          "INSERT INTO editorial_execution_envelopes(id,workspace_id,project_id,profile_key,profile_version,provider_id,provider_model_id,currency,monetary_ceiling_microusd,maximum_calls,status,authorized_by,created_at,updated_at,version,project_execution_budget_id,stage_key) VALUES('sixth-envelope','workspace','project','phase3_terminal_graph_v1',1,'provider_openai','model_openai_gpt_5_6_terra_20260903','USD',1,1,'CONSUMED','owner','t','t',2,'budget-old','TOPIC_RESEARCH')",
        ),
    ],
    [
      'remove an expected envelope',
      (db) => {
        db.exec('PRAGMA foreign_keys=OFF');
        db.exec(
          "DELETE FROM editorial_execution_envelopes WHERE id='execution_envelope_0f8fbd95-e7d3-46c3-b71c-2d99a7dbf378'",
        );
      },
    ],
  ])('rejects historical envelope attack: %s', async (name, mutate) => {
    await expectSnapshotMutationRejected(name, mutate);
  });

  it.each<[string, FixtureMutation]>([
    [
      'replace a reconciled reservation ID',
      (db) =>
        db.exec(
          "UPDATE editorial_execution_reservations SET id='replacement-reservation' WHERE id='execution_reservation_da6950b9-dc52-4761-b4e8-0097cc12747f'",
        ),
    ],
    [
      'swap a reconciled reservation envelope',
      (db) =>
        db.exec(
          "UPDATE editorial_execution_reservations SET envelope_id='execution_envelope_e6c09f5e-203e-4ebe-a552-4c6fb728bdac' WHERE id='execution_reservation_da6950b9-dc52-4761-b4e8-0097cc12747f'",
        ),
    ],
    [
      'swap a reconciled reservation stage',
      (db) =>
        db.exec(
          "UPDATE editorial_execution_reservations SET step_key='IDEA_GENERATION' WHERE id='execution_reservation_da6950b9-dc52-4761-b4e8-0097cc12747f'",
        ),
    ],
    [
      'alter a reconciled reserved amount',
      (db) =>
        db.exec(
          "UPDATE editorial_execution_reservations SET reserved_microusd=225919 WHERE id='execution_reservation_da6950b9-dc52-4761-b4e8-0097cc12747f'",
        ),
    ],
    [
      'alter actuals while preserving their aggregate',
      (db) =>
        db.exec(`
          UPDATE editorial_execution_reservations SET actual_microusd=4147
          WHERE id='execution_reservation_da6950b9-dc52-4761-b4e8-0097cc12747f';
          UPDATE editorial_execution_reservations SET actual_microusd=14407
          WHERE id='execution_reservation_374dbf0c-b7e0-44a1-964c-b7afe8e04b42';
        `),
    ],
    [
      'delete a reservation and add a compensating row',
      (db) => {
        dropTableTriggers(db, 'editorial_execution_reservations');
        db.exec(`
          CREATE TEMP TABLE saved_reservation AS
          SELECT * FROM editorial_execution_reservations
          WHERE id='execution_reservation_da6950b9-dc52-4761-b4e8-0097cc12747f';
          DELETE FROM editorial_execution_reservations
          WHERE id='execution_reservation_da6950b9-dc52-4761-b4e8-0097cc12747f';
          INSERT INTO editorial_execution_reservations(
            id,envelope_id,workspace_id,project_id,intelligence_run_id,step_key,
            pricing_snapshot_id,reserved_microusd,actual_microusd,status,created_at,
            dispatched_at,reconciled_at,project_execution_budget_id
          )
          SELECT 'compensating-reservation',envelope_id,workspace_id,project_id,
            intelligence_run_id,step_key,pricing_snapshot_id,reserved_microusd,
            actual_microusd,status,created_at,dispatched_at,reconciled_at,
            project_execution_budget_id
          FROM saved_reservation;
          DROP TABLE saved_reservation;
        `);
      },
    ],
    [
      'add a cancelled row',
      (db) =>
        cloneReservation(
          db,
          'execution_reservation_da6950b9-dc52-4761-b4e8-0097cc12747f',
          'cancelled-reservation',
          'CANCELLED',
        ),
    ],
    [
      'add an extra reconciled row',
      (db) =>
        cloneReservation(
          db,
          'execution_reservation_da6950b9-dc52-4761-b4e8-0097cc12747f',
          'extra-reconciled',
          'RECONCILED',
        ),
    ],
    [
      'persist reconciled actual NULL',
      (db) => {
        dropTableTriggers(db, 'editorial_execution_reservations');
        db.exec(
          "UPDATE editorial_execution_reservations SET actual_microusd=NULL WHERE id='execution_reservation_da6950b9-dc52-4761-b4e8-0097cc12747f'",
        );
      },
    ],
    [
      'add a second ambiguous row',
      (db) =>
        cloneReservation(
          db,
          command.expectedAmbiguousReservationId,
          'second-ambiguous',
          'AMBIGUOUS',
        ),
    ],
    [
      'add a reserved row',
      (db) =>
        cloneReservation(
          db,
          'execution_reservation_da6950b9-dc52-4761-b4e8-0097cc12747f',
          'extra-reserved',
          'RESERVED',
        ),
    ],
    [
      'add a dispatched row',
      (db) =>
        cloneReservation(
          db,
          'execution_reservation_da6950b9-dc52-4761-b4e8-0097cc12747f',
          'extra-dispatched',
          'DISPATCHED',
        ),
    ],
  ])('rejects historical reservation attack: %s', async (name, mutate) => {
    await expectSnapshotMutationRejected(name, mutate);
  });

  it.each<[string, FixtureMutation]>([
    [
      'negative reconciled actual',
      (db) => {
        dropTableTriggers(db, 'editorial_execution_reservations');
        db.exec('PRAGMA ignore_check_constraints=ON');
        db.exec(
          "UPDATE editorial_execution_reservations SET actual_microusd=-1 WHERE id='execution_reservation_da6950b9-dc52-4761-b4e8-0097cc12747f'",
        );
      },
    ],
    [
      'reconciled actual above reserved',
      (db) => {
        dropTableTriggers(db, 'editorial_execution_reservations');
        db.exec(
          "UPDATE editorial_execution_reservations SET actual_microusd=225921 WHERE id='execution_reservation_da6950b9-dc52-4761-b4e8-0097cc12747f'",
        );
      },
    ],
  ])('rejects malformed accounting: %s', async (name, mutate) => {
    await expectSnapshotMutationRejected(name, mutate);
  });

  it.each<[string, ReceiptMutation]>([
    [
      'audit action',
      (db, id) => db.prepare("UPDATE audit_events SET action='other.action' WHERE id=?").run(id),
    ],
    [
      'audit resource type',
      (db, id) => db.prepare("UPDATE audit_events SET resource_type='other' WHERE id=?").run(id),
    ],
    [
      'audit resource id',
      (db, id) => db.prepare("UPDATE audit_events SET resource_id='other' WHERE id=?").run(id),
    ],
    [
      'audit workspace',
      (db, id) => {
        db.exec(
          "INSERT INTO workspaces(id,slug,name,created_at,updated_at) VALUES('other-workspace','other-workspace','Other','t','t')",
        );
        db.prepare("UPDATE audit_events SET workspace_id='other-workspace' WHERE id=?").run(id);
      },
    ],
    [
      'audit actor',
      (db, id) => db.prepare("UPDATE audit_events SET actor_id='other' WHERE id=?").run(id),
    ],
    [
      'audit actor role',
      (db, id) => db.prepare("UPDATE audit_events SET actor_role='admin' WHERE id=?").run(id),
    ],
    [
      'audit access issuer',
      (db, id) => db.prepare("UPDATE audit_events SET access_issuer='other' WHERE id=?").run(id),
    ],
    [
      'audit access subject',
      (db, id) => db.prepare("UPDATE audit_events SET access_subject='other' WHERE id=?").run(id),
    ],
    [
      'audit environment',
      (db, id) => db.prepare("UPDATE audit_events SET environment='other' WHERE id=?").run(id),
    ],
    [
      'audit outcome',
      (db, id) => db.prepare("UPDATE audit_events SET outcome='failure' WHERE id=?").run(id),
    ],
    [
      'audit request id',
      (db, id) => db.prepare("UPDATE audit_events SET request_id='other' WHERE id=?").run(id),
    ],
    [
      'audit timestamp',
      (db, id) => db.prepare("UPDATE audit_events SET occurred_at='other' WHERE id=?").run(id),
    ],
    [
      'metadata workspace',
      (db, id) => mutateReceiptMetadata(db, id, (metadata) => (metadata.workspace = 'other')),
    ],
    [
      'metadata project',
      (db, id) => mutateReceiptMetadata(db, id, (metadata) => (metadata.project = 'other')),
    ],
    [
      'metadata actor',
      (db, id) => mutateReceiptMetadata(db, id, (metadata) => (metadata.actor = 'other')),
    ],
    [
      'metadata role',
      (db, id) => mutateReceiptMetadata(db, id, (metadata) => (metadata.role = 'admin')),
    ],
    [
      'metadata environment',
      (db, id) => mutateReceiptMetadata(db, id, (metadata) => (metadata.environment = 'other')),
    ],
    [
      'metadata request id',
      (db, id) => mutateReceiptMetadata(db, id, (metadata) => (metadata.requestId = 'other')),
    ],
    [
      'metadata timestamp',
      (db, id) => mutateReceiptMetadata(db, id, (metadata) => (metadata.timestamp = 'other')),
    ],
    [
      'metadata operation',
      (db, id) => mutateReceiptMetadata(db, id, (metadata) => (metadata.operation = 'other')),
    ],
    [
      'metadata idempotency key',
      (db, id) => mutateReceiptMetadata(db, id, (metadata) => (metadata.idempotencyKey = 'other')),
    ],
    [
      'metadata command hash',
      (db, id) => mutateReceiptMetadata(db, id, (metadata) => (metadata.commandHash = 'other')),
    ],
    [
      'metadata reason',
      (db, id) => mutateReceiptMetadata(db, id, (metadata) => (metadata.reason = 'other')),
    ],
    [
      'metadata old budget id',
      (db, id) => mutateReceiptMetadata(db, id, (metadata) => (metadata.oldBudgetId = 'other')),
    ],
    [
      'metadata old version before',
      (db, id) =>
        mutateReceiptMetadata(db, id, (metadata) => (metadata.oldBudgetVersionBefore = 9)),
    ],
    [
      'metadata old version after',
      (db, id) => mutateReceiptMetadata(db, id, (metadata) => (metadata.oldBudgetVersionAfter = 9)),
    ],
    [
      'metadata old status',
      (db, id) => mutateReceiptMetadata(db, id, (metadata) => (metadata.oldStatus = 'other')),
    ],
    [
      'metadata old new status',
      (db, id) => mutateReceiptMetadata(db, id, (metadata) => (metadata.oldNewStatus = 'other')),
    ],
    [
      'metadata successor budget id',
      (db, id) =>
        mutateReceiptMetadata(db, id, (metadata) => (metadata.successorBudgetId = 'other')),
    ],
    [
      'metadata successor version',
      (db, id) => mutateReceiptMetadata(db, id, (metadata) => (metadata.successorVersion = 9)),
    ],
    [
      'metadata successor status',
      (db, id) => mutateReceiptMetadata(db, id, (metadata) => (metadata.successorStatus = 'other')),
    ],
    [
      'metadata original ceiling',
      (db, id) =>
        mutateReceiptMetadata(db, id, (metadata) => (metadata.originalCeilingMicroUsd = 1)),
    ],
    [
      'metadata committed amount',
      (db, id) =>
        mutateReceiptMetadata(db, id, (metadata) => (metadata.canonicalCommittedMicroUsd = 1)),
    ],
    [
      'metadata ambiguous exposure',
      (db, id) =>
        mutateReceiptMetadata(db, id, (metadata) => (metadata.ambiguousExposureMicroUsd = 1)),
    ],
    [
      'metadata successor ceiling',
      (db, id) =>
        mutateReceiptMetadata(db, id, (metadata) => (metadata.successorCeilingMicroUsd = 1)),
    ],
    [
      'metadata ambiguous reservation ids',
      (db, id) =>
        mutateReceiptMetadata(db, id, (metadata) => (metadata.ambiguousReservationIds = ['other'])),
    ],
    [
      'nested result old budget id',
      (db, id) =>
        mutateReceiptMetadata(db, id, (metadata) =>
          mutateNestedReceiptResult(metadata, (result) => {
            if (!isJsonObject(result.oldBudget)) throw new Error('expected old budget result');
            result.oldBudget.id = 'other';
          }),
        ),
    ],
    [
      'nested result successor budget id',
      (db, id) =>
        mutateReceiptMetadata(db, id, (metadata) =>
          mutateNestedReceiptResult(metadata, (result) => {
            if (!isJsonObject(result.successorBudget)) throw new Error('expected successor result');
            result.successorBudget.id = 'other';
          }),
        ),
    ],
    [
      'nested result committed amount',
      (db, id) =>
        mutateReceiptMetadata(db, id, (metadata) =>
          mutateNestedReceiptResult(metadata, (result) => (result.canonicalCommittedMicroUsd = 1)),
        ),
    ],
    [
      'nested result audit id',
      (db, id) =>
        mutateReceiptMetadata(db, id, (metadata) =>
          mutateNestedReceiptResult(metadata, (result) => (result.auditEventId = 'other')),
        ),
    ],
    [
      'multiple semantic receipts',
      (db, id) =>
        db
          .prepare(
            `INSERT INTO audit_events(id,workspace_id,actor_type,actor_id,actor_role,access_issuer,access_subject,action,resource_type,resource_id,outcome,reason,request_id,environment,metadata_json,before_hash,after_hash,occurred_at,ingested_at)
             SELECT 'audit_duplicate',workspace_id,actor_type,actor_id,actor_role,access_issuer,access_subject,action,resource_type,resource_id,outcome,reason,request_id,environment,metadata_json,before_hash,after_hash,occurred_at,ingested_at FROM audit_events WHERE id=?`,
          )
          .run(id),
    ],
  ])('rejects corrupted persisted receipt: %s', async (name, mutate) => {
    await expectReceiptCorruptionRejected(name, mutate);
  });

  it('rejects a receipt whose command hash and metadata bind a different operation', async () => {
    const { database, service } = fixture();
    const key = 'wrong-operation-receipt';
    const created = await service.rollover('project', key, command);
    const wrongOperationHash = await testRolloverCommandHash('other.operation');
    dropTableTriggers(database, 'audit_events');
    mutateReceiptMetadata(database, created.auditEventId, (metadata) => {
      metadata.operation = 'other.operation';
      metadata.commandHash = wrongOperationHash;
    });
    const budgetState = database
      .prepare('SELECT * FROM editorial_project_execution_budgets ORDER BY id')
      .all();
    const auditCount = count(database, 'audit_events');
    await expect(service.rollover('project', key, command)).rejects.toThrow(
      'execution_budget_rollover_receipt_invalid',
    );
    expect(
      database.prepare('SELECT * FROM editorial_project_execution_budgets ORDER BY id').all(),
    ).toEqual(budgetState);
    expect(count(database, 'audit_events')).toBe(auditCount);
    database.close();
  });

  it.each<[string, (database: DatabaseSync, successorId: string) => void]>([
    [
      'successor ceiling',
      (db, id) =>
        db
          .prepare(
            'UPDATE editorial_project_execution_budgets SET monetary_ceiling_microusd=907874 WHERE id=?',
          )
          .run(id),
    ],
    [
      'successor status',
      (db, id) =>
        db
          .prepare("UPDATE editorial_project_execution_budgets SET status='CONSUMED' WHERE id=?")
          .run(id),
    ],
    [
      'successor version',
      (db, id) =>
        db.prepare('UPDATE editorial_project_execution_budgets SET version=2 WHERE id=?').run(id),
    ],
    [
      'old budget version',
      (db) =>
        db
          .prepare("UPDATE editorial_project_execution_budgets SET version=3 WHERE id='budget-old'")
          .run(),
    ],
    [
      'unexpected successor envelope',
      (db, id) => {
        dropTableTriggers(db, 'editorial_execution_envelopes');
        db.prepare(
          `INSERT INTO editorial_execution_envelopes(id,workspace_id,project_id,profile_key,profile_version,provider_id,provider_model_id,currency,monetary_ceiling_microusd,maximum_calls,status,authorized_by,created_at,updated_at,version,project_execution_budget_id,stage_key)
           VALUES('successor-extra-envelope','workspace','project','phase3_terminal_graph_v1',1,'provider_openai','model_openai_gpt_5_6_terra_20260903','USD',1,1,'ACTIVE','owner','t','t',1,?,'SCRIPT_WRITER_SHORT')`,
        ).run(id);
      },
    ],
    [
      'unexpected successor reservation',
      (db, id) => {
        dropTableTriggers(db, 'editorial_execution_reservations');
        db.exec(
          `INSERT INTO intelligence_runs(id,workspace_id,project_id,task_type,provider_id,provider_model_id,initiated_by,operating_mode,status,idempotency_key,creative_regeneration_number,safe_metadata_json,created_at,updated_at,version)
           VALUES('successor-extra-run','workspace','project','TOPIC_RESEARCH','provider_openai','model_openai_gpt_5_6_terra_20260903','owner','ASSISTED','RUNNING','successor-extra-key',0,'{}','t','t',1)`,
        );
        db.prepare(
          `INSERT INTO editorial_execution_reservations(id,envelope_id,workspace_id,project_id,intelligence_run_id,step_key,pricing_snapshot_id,reserved_microusd,actual_microusd,status,created_at,dispatched_at,reconciled_at,project_execution_budget_id)
           VALUES('successor-extra-reservation','execution_envelope_0f8fbd95-e7d3-46c3-b71c-2d99a7dbf378','workspace','project','successor-extra-run','SCRIPT_WRITER_SHORT','pricing-terra',1,NULL,'RESERVED','t',NULL,NULL,?)`,
        ).run(id);
      },
    ],
  ])('rejects replay after database-state tampering: %s', async (name, mutate) => {
    const { database, service } = fixture();
    const key = `database-tampering-${name}`;
    const created = await service.rollover('project', key, command);
    dropTableTriggers(database, 'editorial_project_execution_budgets');
    mutate(database, created.successorBudget.id);
    await expect(service.rollover('project', key, command)).rejects.toThrow(
      'execution_budget_rollover_receipt_invalid',
    );
    expect(count(database, 'editorial_project_execution_budgets')).toBe(2);
    expect(
      database
        .prepare(
          "SELECT count(*) value FROM audit_events WHERE action='editorial.execution_budget_rolled_over'",
        )
        .get()!.value,
    ).toBe(1);
    database.close();
  });

  it('rejects a pre-existing deterministic claim collision before any rollover mutation', async () => {
    const { database, service } = fixture();
    const key = 'preexisting-claim-collision';
    const auditEventId = `audit_${await testDigest({
      workspaceId: 'workspace',
      operation: 'editorial.execution_budget_rolled_over',
      projectId: 'project',
      idempotencyKey: key,
    })}`;
    database
      .prepare(
        `INSERT INTO audit_events(
          id,workspace_id,actor_type,action,resource_type,resource_id,outcome,
          request_id,environment,metadata_json,occurred_at,ingested_at
        ) VALUES(?,'workspace','system','unrelated.action','fixture','fixture',
          'success','collision','test','{}','t','t')`,
      )
      .run(auditEventId);
    await expect(service.rollover('project', key, command)).rejects.toThrow(
      'execution_budget_rollover_receipt_invalid',
    );
    expect(
      database
        .prepare(
          "SELECT status,version FROM editorial_project_execution_budgets WHERE id='budget-old'",
        )
        .get(),
    ).toEqual({ status: 'ACTIVE', version: 1 });
    expect(count(database, 'editorial_project_execution_budgets')).toBe(1);
    database.close();
  });

  it('never expands the successor after a later historical reconciliation', async () => {
    const { database, service } = fixture();
    const created = await service.rollover('project', 'future-reconciliation', command);
    database
      .prepare(
        `UPDATE editorial_execution_reservations SET status='RECONCILED',actual_microusd=123456,reconciled_at='later' WHERE id=?`,
      )
      .run(command.expectedAmbiguousReservationId);
    expect(
      database
        .prepare(
          'SELECT monetary_ceiling_microusd ceiling FROM editorial_project_execution_budgets WHERE id=?',
        )
        .get(created.successorBudget.id),
    ).toEqual({ ceiling: 907875 });
    await expect(service.rollover('project', 'future-reconciliation', command)).resolves.toEqual({
      ...created,
      idempotentReplay: true,
    });
    await expect(service.rollover('project', 'new-key-after-reconcile', command)).rejects.toThrow(
      'execution_budget_rollover_conflict',
    );
    database.close();
  });

  it('executes unchanged against the complete 0000-0016 schema', async () => {
    const { database, service } = fixture('none', currentMigrations);
    const result = await service.rollover('project', 'current-schema', command);
    expect(result.successorBudget.monetaryCeilingMicroUsd).toBe(907875);
    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    database.close();
  });

  it('contains bounded SQL, no child mutations, and no provider path', () => {
    expect(serviceSource).not.toMatch(
      /UPDATE (?:editorial_execution_reservations|editorial_execution_envelopes|intelligence_runs|intelligence_run_attempts)/u,
    );
    expect(serviceSource).not.toContain('INSERT INTO editorial_execution_envelopes');
    expect(serviceSource).not.toContain('INSERT INTO editorial_execution_reservations');
    expect(serviceSource).not.toContain('INSERT INTO intelligence_runs');
    expect(serviceSource).not.toContain('OpenAI');
    expect(serviceSource).toContain('this.db.batch([');
    expect(serviceSource).toContain('canonicalCommittedMicroUsd');
  });
});
