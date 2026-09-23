import {
  ProjectBudgetRolloverService,
  type ProjectBudgetRolloverResult,
} from '../src/editorial/budget-rollover';

type Env = { DB: D1Database };
type Sabotage =
  'none' | 'missing-statement-1' | 'missing-successor' | 'audit-collision' | 'successor-collision';

type JsonRow = Record<string, unknown>;

class CapturedStatement {
  values: unknown[] = [];

  constructor(
    private readonly database: D1Database,
    readonly sql: string,
  ) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  private statement() {
    return this.database.prepare(this.sql).bind(...this.values);
  }

  first<T>(columnName?: string) {
    return columnName === undefined
      ? this.statement().first<T>()
      : this.statement().first<T>(columnName);
  }

  all<T>() {
    return this.statement().all<T>();
  }

  run() {
    return this.statement().run();
  }
}

class InstrumentedD1 {
  batchSqlBytes: number[] = [];
  batchBindings: number[] = [];

  constructor(
    private readonly database: D1Database,
    private readonly sabotage: Sabotage,
  ) {}

  prepare(sql: string) {
    return new CapturedStatement(this.database, sql);
  }

  batch(statements: CapturedStatement[]) {
    this.batchSqlBytes = statements.map(
      (statement) => new TextEncoder().encode(statement.sql).length,
    );
    this.batchBindings = statements.map((statement) => statement.values.length);
    const prepared = statements.map((statement, index) => {
      if (this.sabotage === 'missing-statement-1' && index === 0)
        return this.database.prepare('SELECT 1');
      if (this.sabotage === 'missing-successor' && index === 1)
        return this.database.prepare('SELECT 1');
      const values = [...statement.values];
      if (this.sabotage === 'successor-collision' && index === 1) values[0] = 'budget-old';
      if (this.sabotage === 'audit-collision' && index === 2) values[0] = 'seed-audit';
      return this.database.prepare(statement.sql).bind(...values);
    });
    return this.database.batch(prepared);
  }
}

const command = {
  oldBudgetId: 'budget-old',
  expectedOldBudgetVersion: 1,
  expectedOldBudgetStatus: 'ACTIVE',
  expectedAmbiguousReservationId: 'execution_reservation_5bd3685e-b5f5-43ee-9e5d-9f0fc307974a',
  reason: 'HISTORICAL_AMBIGUITY_QUARANTINE',
} as const;

const owner = {
  id: 'owner',
  workspaceId: 'workspace',
  roles: ['owner' as const],
};

async function executeSql(database: D1Database, sql: string) {
  const statements = sql
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean)
    .map((statement) => database.prepare(statement));
  await database.batch(statements);
}
async function seedFixture(database: D1Database) {
  await executeSql(
    database,
    `
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
  `,
  );

  const reconciled = [
    [
      'execution_envelope_0f8fbd95-e7d3-46c3-b71c-2d99a7dbf378',
      'execution_reservation_da6950b9-dc52-4761-b4e8-0097cc12747f',
      'TOPIC_RESEARCH',
      'model_openai_gpt_5_6_terra_20260903',
      'pricing-terra',
      225920,
      4146,
    ],
    [
      'execution_envelope_e6c09f5e-203e-4ebe-a552-4c6fb728bdac',
      'execution_reservation_374dbf0c-b7e0-44a1-964c-b7afe8e04b42',
      'IDEA_GENERATION',
      'model_openai_gpt_5_6_terra_20260903',
      'pricing-terra',
      177920,
      14408,
    ],
    [
      'execution_envelope_7f0dd940-340c-4d7b-a726-faae05101468',
      'execution_reservation_f91a5860-99bb-42a2-9a59-b54953110a30',
      'CONTENT_BRIEF',
      'model_openai_gpt_5_6_terra_20260903',
      'pricing-terra',
      201920,
      13502,
    ],
    [
      'execution_envelope_cf4d27f4-2296-4b0d-9ba7-7893bd21dc38',
      'execution_reservation_f4136c98-622d-4460-8dea-805b5fc5d38d',
      'SCRIPT_CRITIC',
      'model_openai_gpt_5_6_sol_20260903',
      'pricing-sol',
      403840,
      69669,
    ],
  ] as const;

  for (const [envelopeId, reservationId, stage, model, pricing, ceiling, actual] of reconciled) {
    const runId = `run-${stage.toLowerCase()}`;
    await database
      .prepare(
        `INSERT INTO editorial_execution_envelopes(id,workspace_id,project_id,profile_key,profile_version,provider_id,provider_model_id,currency,monetary_ceiling_microusd,maximum_calls,status,authorized_by,created_at,updated_at,version,project_execution_budget_id,stage_key) VALUES(?,'workspace','project','phase3_terminal_graph_v1',1,'provider_openai',?,'USD',?,1,'ACTIVE','owner','t','t',1,'budget-old',?)`,
      )
      .bind(envelopeId, model, ceiling, stage)
      .run();
    await database
      .prepare(
        `INSERT INTO intelligence_runs(id,workspace_id,project_id,task_type,provider_id,provider_model_id,initiated_by,operating_mode,status,idempotency_key,creative_regeneration_number,safe_metadata_json,created_at,updated_at,version) VALUES(?,'workspace','project',?,'provider_openai',?,'owner','ASSISTED','RUNNING',?,0,'{}','t','t',1)`,
      )
      .bind(runId, stage, model, `key-${stage}`)
      .run();
    await database
      .prepare(
        `INSERT INTO editorial_execution_reservations(id,envelope_id,workspace_id,project_id,intelligence_run_id,step_key,pricing_snapshot_id,reserved_microusd,actual_microusd,status,created_at,dispatched_at,reconciled_at,project_execution_budget_id) VALUES(?,?,'workspace','project',?,?,?, ?,NULL,'RESERVED','t',NULL,NULL,'budget-old')`,
      )
      .bind(reservationId, envelopeId, runId, stage, pricing, ceiling)
      .run();
    await database
      .prepare(
        `UPDATE editorial_execution_reservations SET status='DISPATCHED',dispatched_at='t' WHERE id=?`,
      )
      .bind(reservationId)
      .run();
    await database
      .prepare(
        `UPDATE editorial_execution_reservations SET status='RECONCILED',actual_microusd=?,reconciled_at='t' WHERE id=?`,
      )
      .bind(actual, reservationId)
      .run();
    await database
      .prepare(`UPDATE editorial_execution_envelopes SET status='CONSUMED',version=2 WHERE id=?`)
      .bind(envelopeId)
      .run();
  }

  await executeSql(
    database,
    `
    INSERT INTO editorial_execution_envelopes(id,workspace_id,project_id,profile_key,profile_version,provider_id,provider_model_id,currency,monetary_ceiling_microusd,maximum_calls,status,authorized_by,created_at,updated_at,version,project_execution_budget_id,stage_key) VALUES('execution_envelope_2a2db2a2-557d-4d5a-b914-ede34b9ab453','workspace','project','phase3_terminal_graph_v1',1,'provider_openai','model_openai_gpt_5_6_terra_20260903','USD',321920,1,'ACTIVE','owner','t','t',1,'budget-old','STORYBOARD_PLANNER');
    INSERT INTO intelligence_runs(id,workspace_id,project_id,task_type,provider_id,provider_model_id,initiated_by,operating_mode,status,idempotency_key,creative_regeneration_number,safe_metadata_json,created_at,updated_at,version) VALUES('run-storyboard','workspace','project','STORYBOARD_PLANNER','provider_openai','model_openai_gpt_5_6_terra_20260903','owner','ASSISTED','RUNNING','key-storyboard',0,'{}','t','t',1);
    INSERT INTO editorial_execution_reservations(id,envelope_id,workspace_id,project_id,intelligence_run_id,step_key,pricing_snapshot_id,reserved_microusd,actual_microusd,status,created_at,dispatched_at,reconciled_at,project_execution_budget_id) VALUES('execution_reservation_5bd3685e-b5f5-43ee-9e5d-9f0fc307974a','execution_envelope_2a2db2a2-557d-4d5a-b914-ede34b9ab453','workspace','project','run-storyboard','STORYBOARD_PLANNER','pricing-terra',321920,NULL,'RESERVED','t',NULL,NULL,'budget-old');
    UPDATE editorial_execution_reservations SET status='DISPATCHED',dispatched_at='t' WHERE id='execution_reservation_5bd3685e-b5f5-43ee-9e5d-9f0fc307974a';
    UPDATE editorial_execution_reservations SET status='AMBIGUOUS',reconciled_at='t' WHERE id='execution_reservation_5bd3685e-b5f5-43ee-9e5d-9f0fc307974a';
    UPDATE editorial_execution_envelopes SET status='CONSUMED',version=2 WHERE id='execution_envelope_2a2db2a2-557d-4d5a-b914-ede34b9ab453';
  `,
  );
}

async function state(database: D1Database) {
  const oldBudget = await database
    .prepare(`SELECT status,version FROM editorial_project_execution_budgets WHERE id='budget-old'`)
    .first<JsonRow>();
  const successors = await database
    .prepare(
      `SELECT id,status,version,monetary_ceiling_microusd monetaryCeiling FROM editorial_project_execution_budgets WHERE id<>'budget-old'`,
    )
    .all<JsonRow>();
  const receipt = await database
    .prepare(
      `SELECT count(*) value FROM audit_events WHERE action='editorial.execution_budget_rolled_over'`,
    )
    .first<JsonRow>();
  const successorEnvelopeCount = await database
    .prepare(
      `SELECT count(*) value FROM editorial_execution_envelopes WHERE project_execution_budget_id<>'budget-old'`,
    )
    .first<JsonRow>();
  const successorReservationCount = await database
    .prepare(
      `SELECT count(*) value FROM editorial_execution_reservations WHERE project_execution_budget_id<>'budget-old'`,
    )
    .first<JsonRow>();
  const ambiguous = await database
    .prepare(
      `SELECT status,reserved_microusd reserved,actual_microusd actual FROM editorial_execution_reservations WHERE id='execution_reservation_5bd3685e-b5f5-43ee-9e5d-9f0fc307974a'`,
    )
    .first<JsonRow>();
  const foreignKeys = await database.prepare('PRAGMA foreign_key_check').all<JsonRow>();
  return {
    oldBudget,
    successors: successors.results,
    receiptCount: Number(receipt?.value ?? 0),
    successorEnvelopeCount: Number(successorEnvelopeCount?.value ?? 0),
    successorReservationCount: Number(successorReservationCount?.value ?? 0),
    ambiguous,
    foreignKeys: foreignKeys.results,
  };
}

async function execute(database: D1Database, scenario: string) {
  await seedFixture(database);
  if (scenario === 'historical-drift')
    await database
      .prepare(
        `UPDATE editorial_execution_envelopes SET version=3 WHERE id='execution_envelope_0f8fbd95-e7d3-46c3-b71c-2d99a7dbf378'`,
      )
      .run();

  const sabotage: Sabotage =
    scenario === 'missing-statement-1' ||
    scenario === 'missing-successor' ||
    scenario === 'audit-collision' ||
    scenario === 'successor-collision'
      ? scenario
      : 'none';
  const instrumented = new InstrumentedD1(database, sabotage);
  const service = new ProjectBudgetRolloverService(instrumented as unknown as D1Database, owner, {
    requestId: `request-${scenario}`,
    environment: 'test',
    accessIssuer: 'https://access.example.test',
    accessSubject: 'owner-subject',
  });
  const key = `d1-${scenario}`;
  let result: ProjectBudgetRolloverResult | null = null;
  let replay: ProjectBudgetRolloverResult | null = null;
  let error: string | null = null;
  try {
    result = await service.rollover('project', key, command);
    replay = await service.rollover('project', key, command);
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }
  return {
    scenario,
    result,
    replay,
    error,
    sqlBytes: instrumented.batchSqlBytes,
    bindingCounts: instrumented.batchBindings,
    state: await state(database),
  };
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    if (url.pathname === '/listening') return Response.json({ ok: true });
    if (url.pathname === '/health') {
      await env.DB.prepare('SELECT 1').first();
      return Response.json({ ok: true });
    }
    if (request.method !== 'POST' || !url.pathname.startsWith('/scenario/'))
      return new Response('not found', { status: 404 });
    const scenario = url.pathname.slice('/scenario/'.length);
    try {
      return Response.json(await execute(env.DB, scenario));
    } catch (error) {
      return Response.json(
        { fatal: error instanceof Error ? error.message : String(error) },
        { status: 500 },
      );
    }
  },
};
