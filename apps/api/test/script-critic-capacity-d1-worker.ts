import { createApp } from '../src/app';
import {
  ScriptCriticCapacityError,
  ScriptCriticCapacityService,
  type ScriptCriticCapacityPolicy,
  type ScriptCriticCapacityResult,
} from '../src/editorial/script-critic-capacity';

type Env = { DB: D1Database };
type Scenario = 'success' | 'audit-failure' | 'final-failure';
type ConcurrentScenario =
  | 'same-key-same-command'
  | 'same-key-changed-command-canonical-first'
  | 'same-key-changed-command-changed-first'
  | 'different-keys-same-capacity'
  | 'cross-project-same-key'
  | 'reservation-low'
  | 'reservation-high'
  | 'active-envelope-race';
type JsonRow = Record<string, unknown>;

class CapturedStatement {
  values: unknown[] = [];
  constructor(
    private readonly database: D1Database,
    readonly sql: string,
    private readonly onQuery: () => void,
  ) {}
  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }
  private statement() {
    return this.database.prepare(this.sql).bind(...this.values);
  }
  first<T>(columnName?: string) {
    this.onQuery();
    return columnName === undefined
      ? this.statement().first<T>()
      : this.statement().first<T>(columnName);
  }
  all<T>() {
    this.onQuery();
    return this.statement().all<T>();
  }
  run() {
    this.onQuery();
    return this.statement().run();
  }
}

class InstrumentedD1 {
  batchSqlBytes: number[] = [];
  batchBindings: number[] = [];
  queryCount = 0;
  batchReached = false;
  constructor(
    private readonly database: D1Database,
    private readonly scenario: Scenario = 'success',
    private readonly beforeBatch?: () => Promise<void>,
  ) {}
  prepare(sql: string) {
    return new CapturedStatement(this.database, sql, () => {
      this.queryCount += 1;
    });
  }
  async batch(statements: CapturedStatement[]) {
    this.batchReached = true;
    await this.beforeBatch?.();
    this.batchSqlBytes = statements.map(
      (statement) => new TextEncoder().encode(statement.sql).length,
    );
    this.batchBindings = statements.map((statement) => statement.values.length);
    this.queryCount += statements.length;
    const prepared = statements.map((statement, index) => {
      if (this.scenario === 'audit-failure' && index === 1)
        return this.database.prepare("SELECT json('forced_audit_failure')");
      if (this.scenario === 'final-failure' && index === 2)
        return this.database.prepare("SELECT json('forced_final_failure')");
      return this.database.prepare(statement.sql).bind(...statement.values);
    });
    return this.database.batch(prepared);
  }
}

const owner = { id: 'owner', workspaceId: 'workspace', roles: ['owner' as const] };
const context = {
  requestId: 'request-d1-capacity',
  environment: 'test',
  accessIssuer: 'https://access.example.test',
  accessSubject: 'owner-subject',
};
const policy: ScriptCriticCapacityPolicy = {
  workspaceId: 'workspace',
  projectId: 'project',
  successorBudgetId: 'budget-successor',
  historicalEnvelopeId: 'historical-critic',
};
const policyB: ScriptCriticCapacityPolicy = {
  workspaceId: 'workspace',
  projectId: 'project-b',
  successorBudgetId: 'budget-successor-b',
  historicalEnvelopeId: 'historical-critic-b',
};
const changedCommandPolicy: ScriptCriticCapacityPolicy = {
  ...policy,
  historicalEnvelopeId: 'historical-critic-changed',
};
const command = {
  successorBudgetId: 'budget-successor',
  expectedBudgetVersion: 1,
  expectedBudgetStatus: 'ACTIVE',
  consumedHistoricalEnvelopeId: 'historical-critic',
  reason: 'REPLACEMENT_SCRIPT_CRITIC_CAPACITY',
} as const;
const commandB = {
  ...command,
  successorBudgetId: 'budget-successor-b',
  consumedHistoricalEnvelopeId: 'historical-critic-b',
};
const changedCommand = {
  ...command,
  consumedHistoricalEnvelopeId: 'historical-critic-changed',
};

async function executeSql(database: D1Database, sql: string) {
  const statements = sql
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean)
    .map((statement) => database.prepare(statement));
  await database.batch(statements);
}

async function seed(database: D1Database, production = false) {
  const sql = `
    CREATE TABLE concurrency_barrier(
      scenario TEXT NOT NULL,
      flow TEXT NOT NULL,
      PRIMARY KEY(scenario,flow)
    );
    INSERT INTO workspaces(id,slug,name,created_at,updated_at)
      VALUES('workspace','workspace','Workspace','t','t');
    INSERT INTO users(id,workspace_id,email,status,created_at,updated_at)
      VALUES('owner','workspace','owner@example.test','active','t','t');
    INSERT INTO user_roles(workspace_id,user_id,role_id,created_at)
      SELECT 'workspace','owner',id,'t' FROM roles WHERE key='owner';
    INSERT INTO access_identities(
      id,workspace_id,user_id,issuer,subject,email,last_seen_at,created_at,updated_at)
      VALUES('identity','workspace','owner','https://access.example.test','owner-subject',
        'owner@example.test','t','t','t');
    INSERT INTO content_brands(
      id,workspace_id,name,normalized_name,primary_language,created_at,updated_at,created_by)
      VALUES('brand','workspace','Brand','brand','de','t','t','owner');
    INSERT INTO channel_profiles(
      id,workspace_id,content_brand_id,name,normalized_name,primary_language,created_at,updated_at,created_by)
      VALUES('channel','workspace','brand','Channel','channel','de','t','t','owner');
    INSERT INTO projects(
      id,workspace_id,content_brand_id,channel_profile_id,title,format,operating_mode,status,
      primary_language,readiness_status,created_at,updated_at,created_by)
      VALUES('project','workspace','brand','channel','Project','SHORT','ASSISTED','ANALYZING',
        'de','ready','t','t','owner');
    INSERT INTO ai_providers(
      id,key,display_name,status,adapter_version,created_at,updated_at,version)
      VALUES('provider_openai','openai','OpenAI','configured','1','t','t',1);
    INSERT INTO ai_provider_models(
      id,provider_id,model_key,display_name,status,capabilities_json,effective_from,
      created_at,updated_at,version)
      VALUES('model_openai_gpt_5_6_sol_20260903','provider_openai','gpt-5.6-sol','Sol',
        'available','{"capabilities":["STRUCTURED_OUTPUT","CRITIQUE"],"qualityTier":"HIGH"}',
        '2026-01-01T00:00:00.000Z','t','t',2);
    INSERT INTO ai_pricing_snapshots(
      id,provider_model_id,currency,input_unit_price,output_unit_price,unit_name,
      verification_status,effective_from,created_at)
      VALUES('pricing_model_openai_gpt_5_6_sol_20260903',
        'model_openai_gpt_5_6_sol_20260903','USD',0.000004,0.000020,'token',
        'externally_verified','2026-01-01T00:00:00.000Z','t');
    INSERT INTO editorial_project_execution_budgets(
      id,workspace_id,project_id,profile_key,profile_version,currency,
      monetary_ceiling_microusd,status,authorized_by,created_at,updated_at,version)
      VALUES('budget-old','workspace','project','phase3_terminal_graph_v1',1,'USD',
        1331520,'ACTIVE','owner','t','t',1);
    INSERT INTO editorial_execution_envelopes(
      id,workspace_id,project_id,profile_key,profile_version,provider_id,provider_model_id,
      currency,monetary_ceiling_microusd,maximum_calls,status,authorized_by,created_at,
      updated_at,version,project_execution_budget_id,stage_key)
      VALUES('historical-critic','workspace','project','phase3_terminal_graph_v1',1,
        'provider_openai','model_openai_gpt_5_6_sol_20260903','USD',403840,1,'CONSUMED',
        'owner','t','t',2,'budget-old','SCRIPT_CRITIC');
    UPDATE editorial_project_execution_budgets
      SET status='CONSUMED',version=2 WHERE id='budget-old';
    INSERT INTO editorial_project_execution_budgets(
      id,workspace_id,project_id,profile_key,profile_version,currency,
      monetary_ceiling_microusd,status,authorized_by,created_at,updated_at,version)
      VALUES('budget-old-changed','workspace','project','phase3_terminal_graph_v1',1,'USD',
        1331520,'ACTIVE','owner','t','t',1);
    INSERT INTO editorial_execution_envelopes(
      id,workspace_id,project_id,profile_key,profile_version,provider_id,provider_model_id,
      currency,monetary_ceiling_microusd,maximum_calls,status,authorized_by,created_at,
      updated_at,version,project_execution_budget_id,stage_key)
      VALUES('historical-critic-changed','workspace','project','phase3_terminal_graph_v1',1,
        'provider_openai','model_openai_gpt_5_6_sol_20260903','USD',403840,1,'CONSUMED',
        'owner','t','t',2,'budget-old-changed','SCRIPT_CRITIC');
    UPDATE editorial_project_execution_budgets
      SET status='CONSUMED',version=2 WHERE id='budget-old-changed';
    INSERT INTO editorial_project_execution_budgets(
      id,workspace_id,project_id,profile_key,profile_version,currency,
      monetary_ceiling_microusd,status,authorized_by,created_at,updated_at,version)
      VALUES('budget-successor','workspace','project','phase3_terminal_graph_v1',1,'USD',
        907875,'ACTIVE','owner','t','t',1);
  `;
  const productionSql = production
    ? sql
        .replaceAll("'workspace'", "'workspace_primary'")
        .replaceAll("'project'", "'project_2135b883-8499-48e9-a4a7-bb04b970d72a'")
        .replaceAll(
          "'budget-successor'",
          "'project_execution_budget_e00c938b-5621-4ce4-ae74-eea07d9b5529'",
        )
        .replaceAll(
          "'historical-critic'",
          "'execution_envelope_cf4d27f4-2296-4b0d-9ba7-7893bd21dc38'",
        )
    : sql;
  await executeSql(database, productionSql);
  await executeSql(
    database,
    `INSERT INTO users(id,workspace_id,email,status,created_at,updated_at)
       VALUES('viewer',${production ? "'workspace_primary'" : "'workspace'"},'viewer@example.test','active','t','t');
     INSERT INTO access_identities(
       id,workspace_id,user_id,issuer,subject,email,last_seen_at,created_at,updated_at)
       VALUES('viewer-identity',${production ? "'workspace_primary'" : "'workspace'"},'viewer',
       'https://access.example.test','viewer-subject','viewer@example.test','t','t','t')`,
  );
}

async function seedSecondProject(database: D1Database) {
  await executeSql(
    database,
    `
    INSERT INTO projects(
      id,workspace_id,content_brand_id,channel_profile_id,title,format,operating_mode,status,
      primary_language,readiness_status,created_at,updated_at,created_by)
      VALUES('project-b','workspace','brand','channel','Project B','SHORT','ASSISTED','ANALYZING',
        'de','ready','t','t','owner');
    INSERT INTO editorial_project_execution_budgets(
      id,workspace_id,project_id,profile_key,profile_version,currency,
      monetary_ceiling_microusd,status,authorized_by,created_at,updated_at,version)
      VALUES('budget-old-b','workspace','project-b','phase3_terminal_graph_v1',1,'USD',
        1331520,'ACTIVE','owner','t','t',1);
    INSERT INTO editorial_execution_envelopes(
      id,workspace_id,project_id,profile_key,profile_version,provider_id,provider_model_id,
      currency,monetary_ceiling_microusd,maximum_calls,status,authorized_by,created_at,
      updated_at,version,project_execution_budget_id,stage_key)
      VALUES('historical-critic-b','workspace','project-b','phase3_terminal_graph_v1',1,
        'provider_openai','model_openai_gpt_5_6_sol_20260903','USD',403840,1,'CONSUMED',
        'owner','t','t',2,'budget-old-b','SCRIPT_CRITIC');
    UPDATE editorial_project_execution_budgets
      SET status='CONSUMED',version=2 WHERE id='budget-old-b';
    INSERT INTO editorial_project_execution_budgets(
      id,workspace_id,project_id,profile_key,profile_version,currency,
      monetary_ceiling_microusd,status,authorized_by,created_at,updated_at,version)
      VALUES('budget-successor-b','workspace','project-b','phase3_terminal_graph_v1',1,'USD',
        907875,'ACTIVE','owner','t','t',1);
  `,
  );
}

async function state(database: D1Database) {
  const envelopes = await database
    .prepare(
      `SELECT id,project_id projectId,project_execution_budget_id budgetId,stage_key stageKey,
        status,version,maximum_calls maximumCalls,monetary_ceiling_microusd ceiling
       FROM editorial_execution_envelopes
       WHERE project_execution_budget_id IN ('budget-successor','budget-successor-b')
       ORDER BY project_id,id`,
    )
    .all<JsonRow>();
  const receipts = await database
    .prepare(
      `SELECT id,resource_id resourceId,metadata_json metadataJson
       FROM audit_events WHERE action='editorial.script_critic_capacity_provisioned'
       ORDER BY id`,
    )
    .all<JsonRow>();
  const historicalEnvelopes = await database
    .prepare(
      `SELECT id,status,version FROM editorial_execution_envelopes
       WHERE id IN ('historical-critic','historical-critic-changed','historical-critic-b')
       ORDER BY id`,
    )
    .all<JsonRow>();
  const reservations = await database
    .prepare(
      `SELECT id,project_execution_budget_id budgetId,reserved_microusd reservedMicrousd,status
       FROM editorial_execution_reservations
       WHERE project_execution_budget_id IN ('budget-successor','budget-successor-b')
       ORDER BY id`,
    )
    .all<JsonRow>();
  const runs = await database
    .prepare(
      `SELECT id,project_id projectId,status FROM intelligence_runs
       WHERE project_id IN ('project','project-b') ORDER BY id`,
    )
    .all<JsonRow>();
  const foreignKeys = await database.prepare('PRAGMA foreign_key_check').all<JsonRow>();
  return {
    envelopes: envelopes.results,
    receipts: receipts.results,
    historicalEnvelopes: historicalEnvelopes.results,
    reservations: reservations.results,
    runs: runs.results,
    foreignKeys: foreignKeys.results,
  };
}

async function execute(database: D1Database, scenario: Scenario) {
  await seed(database);
  const instrumented = new InstrumentedD1(database, scenario);
  const service = new ScriptCriticCapacityService(
    instrumented as unknown as D1Database,
    owner,
    context,
    policy,
  );
  let result: ScriptCriticCapacityResult | null = null;
  let replay: ScriptCriticCapacityResult | null = null;
  let error: string | null = null;
  try {
    result = await service.provision('project', `d1-${scenario}`, command);
    replay = await service.provision('project', `d1-${scenario}`, command);
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
    queryCount: instrumented.queryCount,
    state: await state(database),
  };
}

async function barrier(database: D1Database, scenario: string, flow: string) {
  await database
    .prepare('INSERT INTO concurrency_barrier(scenario,flow) VALUES(?,?)')
    .bind(scenario, flow)
    .run();
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const row = await database
      .prepare('SELECT count(*) value FROM concurrency_barrier WHERE scenario=?')
      .bind(scenario)
      .first<JsonRow>();
    if (Number(row?.value ?? 0) === 2) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('concurrency_barrier_timeout');
}

async function waitForRaceState(database: D1Database, scenario: ConcurrentScenario) {
  const table =
    scenario === 'active-envelope-race'
      ? 'editorial_execution_envelopes'
      : 'editorial_execution_reservations';
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const row = await database
      .prepare(
        `SELECT count(*) value FROM ${table}
         WHERE project_execution_budget_id='budget-successor'`,
      )
      .first<JsonRow>();
    if (Number(row?.value ?? 0) === 1) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('race_state_timeout');
}

async function createReservationRace(
  database: D1Database,
  scenario: 'reservation-low' | 'reservation-high',
) {
  const amount = scenario === 'reservation-low' ? 100_000 : 600_000;
  await database.batch([
    database
      .prepare(
        `INSERT INTO editorial_execution_envelopes(
          id,workspace_id,project_id,profile_key,profile_version,provider_id,provider_model_id,
          currency,monetary_ceiling_microusd,maximum_calls,status,authorized_by,created_at,
          updated_at,version,project_execution_budget_id,stage_key)
         VALUES(?, 'workspace','project','phase3_terminal_graph_v1',1,'provider_openai',
          'model_openai_gpt_5_6_sol_20260903','USD',?,1,'ACTIVE','owner','t','t',1,
          'budget-successor','CONTENT_BRIEF')`,
      )
      .bind(`${scenario}-envelope`, amount),
    database
      .prepare(
        `INSERT INTO intelligence_runs(
          id,workspace_id,project_id,task_type,provider_id,provider_model_id,initiated_by,
          operating_mode,status,idempotency_key,creative_regeneration_number,safe_metadata_json,
          created_at,updated_at,version)
         VALUES(?,'workspace','project','CONTENT_BRIEF','provider_openai',
          'model_openai_gpt_5_6_sol_20260903','owner','ASSISTED','RUNNING',?,0,'{}','t','t',1)`,
      )
      .bind(`${scenario}-run`, `${scenario}-run-key`),
    database
      .prepare(
        `INSERT INTO editorial_execution_reservations(
          id,envelope_id,workspace_id,project_id,intelligence_run_id,step_key,
          pricing_snapshot_id,reserved_microusd,actual_microusd,status,created_at,
          project_execution_budget_id)
         VALUES(?,?, 'workspace','project',?,'CONTENT_BRIEF',
          'pricing_model_openai_gpt_5_6_sol_20260903',?,NULL,'RESERVED','t','budget-successor')`,
      )
      .bind(`${scenario}-reservation`, `${scenario}-envelope`, `${scenario}-run`, amount),
  ]);
}

async function createActiveEnvelopeRace(database: D1Database) {
  await database
    .prepare(
      `INSERT INTO editorial_execution_envelopes(
        id,workspace_id,project_id,profile_key,profile_version,provider_id,provider_model_id,
        currency,monetary_ceiling_microusd,maximum_calls,status,authorized_by,created_at,
        updated_at,version,project_execution_budget_id,stage_key)
       VALUES('active-race-envelope','workspace','project','phase3_terminal_graph_v1',1,
        'provider_openai','model_openai_gpt_5_6_sol_20260903','USD',403840,1,'ACTIVE',
        'owner','t','t',1,'budget-successor','SCRIPT_CRITIC')`,
    )
    .run();
}

async function operation(database: D1Database, scenario: ConcurrentScenario, flow: 'a' | 'b') {
  await barrier(database, scenario, flow);
  if (scenario === 'reservation-low' || scenario === 'reservation-high') {
    if (flow === 'b') {
      await createReservationRace(database, scenario);
      return {
        kind: 'race',
        mutation: 'reservation',
        amount: scenario === 'reservation-low' ? 100000 : 600000,
      };
    }
    await waitForRaceState(database, scenario);
  }
  if (scenario === 'active-envelope-race') {
    if (flow === 'b') {
      await createActiveEnvelopeRace(database);
      return { kind: 'race', mutation: 'active-envelope' };
    }
    await waitForRaceState(database, scenario);
  }

  const changedCommandScenario = scenario.startsWith('same-key-changed-command-');
  const selectedPolicy =
    scenario === 'cross-project-same-key' && flow === 'b'
      ? policyB
      : changedCommandScenario && flow === 'b'
        ? changedCommandPolicy
        : policy;
  const selectedCommand =
    scenario === 'cross-project-same-key' && flow === 'b'
      ? commandB
      : changedCommandScenario && flow === 'b'
        ? changedCommand
        : command;
  const commandVariant = changedCommandScenario && flow === 'b' ? 'changed' : 'canonical';
  const projectId = selectedPolicy.projectId;
  const key =
    scenario === 'different-keys-same-capacity'
      ? `different-${flow}`
      : scenario === 'reservation-low' ||
          scenario === 'reservation-high' ||
          scenario === 'active-envelope-race'
        ? `race-${scenario}`
        : 'shared-concurrency-key';
  const preferredFlow = scenario.endsWith('changed-first') ? 'b' : 'a';
  const beforeBatch = changedCommandScenario
    ? async () => {
        await barrier(database, 'batch:' + scenario, flow);
        if (flow !== preferredFlow) await new Promise((resolve) => setTimeout(resolve, 50));
      }
    : undefined;
  const instrumented = new InstrumentedD1(database, 'success', beforeBatch);
  const service = new ScriptCriticCapacityService(
    instrumented as unknown as D1Database,
    owner,
    { ...context, requestId: `request-${scenario}-${flow}` },
    selectedPolicy,
  );
  try {
    return {
      kind: 'result',
      commandVariant,
      result: await service.provision(projectId, key, selectedCommand),
      sqlBytes: instrumented.batchSqlBytes,
      bindingCounts: instrumented.batchBindings,
      queryCount: instrumented.queryCount,
      batchReached: instrumented.batchReached,
    };
  } catch (error) {
    return {
      kind: 'error',
      commandVariant,
      status: error instanceof ScriptCriticCapacityError ? error.status : 500,
      error: error instanceof Error ? error.message : String(error),
      errorClass:
        error instanceof ScriptCriticCapacityError ? 'ScriptCriticCapacityError' : 'Error',
      sqlBytes: instrumented.batchSqlBytes,
      bindingCounts: instrumented.batchBindings,
      queryCount: instrumented.queryCount,
      batchReached: instrumented.batchReached,
    };
  }
}

const verifyLocalIdentity = (token: string) => {
  if (token === 'invalid') return Promise.reject(new Error('invalid identity'));
  return Promise.resolve({
    issuer: 'https://access.example.test',
    subject: token === 'viewer' ? 'viewer-subject' : 'owner-subject',
    email: token === 'viewer' ? 'viewer@example.test' : 'owner@example.test',
  });
};

type HttpScenario =
  ConcurrentScenario | 'default' | 'scope' | 'rbac' | 'storage' | 'factory-safety';
let routeApp: ReturnType<typeof createApp> | null = null;
let routeScenario: HttpScenario = 'default';
let constructionCount = 0;
const routeMetrics: Array<{
  flow: string;
  batchReached: boolean;
  queryCount: number;
  bindings: number[];
  sqlBytes: number[];
}> = [];

function routeFactory(
  database: D1Database,
  actor: ConstructorParameters<typeof ScriptCriticCapacityService>[1],
  auditContext: ConstructorParameters<typeof ScriptCriticCapacityService>[2],
) {
  const flow = constructionCount++ === 0 ? 'a' : 'b';
  const changed = routeScenario.startsWith('same-key-changed-command-');
  const selectedPolicy =
    routeScenario === 'cross-project-same-key' && flow === 'b'
      ? policyB
      : changed && flow === 'b'
        ? changedCommandPolicy
        : policy;
  const preferredFlow = routeScenario.endsWith('changed-first') ? 'b' : 'a';
  const concurrent = [
    'same-key-same-command',
    'same-key-changed-command-canonical-first',
    'same-key-changed-command-changed-first',
    'different-keys-same-capacity',
    'cross-project-same-key',
  ].includes(routeScenario);
  const beforeBatch = concurrent
    ? async () => {
        await barrier(database, 'http:' + routeScenario, flow);
        if (changed && flow !== preferredFlow)
          await new Promise((resolve) => setTimeout(resolve, 50));
      }
    : undefined;
  const instrumented = new InstrumentedD1(
    database,
    routeScenario === 'storage' ? 'audit-failure' : 'success',
    beforeBatch,
  );
  const metric = {
    flow,
    batchReached: false,
    queryCount: 0,
    bindings: [] as number[],
    sqlBytes: [] as number[],
  };
  routeMetrics.push(metric);
  const service = new ScriptCriticCapacityService(
    instrumented as unknown as D1Database,
    actor,
    auditContext,
    selectedPolicy,
  );
  const originalProvision = service.provision.bind(service);
  service.provision = async (...args) => {
    try {
      return await originalProvision(...args);
    } finally {
      metric.batchReached = instrumented.batchReached;
      metric.queryCount = instrumented.queryCount;
      metric.bindings = instrumented.batchBindings;
      metric.sqlBytes = instrumented.batchSqlBytes;
    }
  };
  return service;
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    if (url.pathname === '/health') return Response.json({ ok: true });
    if (request.method === 'POST' && url.pathname.startsWith('/scenario/')) {
      const scenario = url.pathname.slice('/scenario/'.length) as Scenario;
      try {
        return Response.json(await execute(env.DB, scenario));
      } catch (error) {
        return Response.json(
          { fatal: error instanceof Error ? error.message : String(error) },
          { status: 500 },
        );
      }
    }
    if (request.method === 'POST' && url.pathname.startsWith('/setup/')) {
      const scenario = url.pathname.slice('/setup/'.length);
      const httpRoute = scenario.startsWith('http-');
      if (httpRoute) {
        routeScenario = scenario.slice('http-'.length) as HttpScenario;
        constructionCount = 0;
        routeMetrics.length = 0;
      }
      try {
        await seed(env.DB, httpRoute && routeScenario === 'default');
        if (
          (httpRoute && routeScenario === 'cross-project-same-key') ||
          scenario === 'cross-project-same-key'
        )
          await seedSecondProject(env.DB);
        if (httpRoute)
          routeApp =
            routeScenario === 'default'
              ? createApp(verifyLocalIdentity)
              : createApp(verifyLocalIdentity, undefined, {
                  createScriptCriticCapacityService: routeFactory,
                });
        return Response.json(
          {
            scenario,
            ready: true,
            initialState: httpRoute && routeScenario === 'default' ? null : await state(env.DB),
          },
          { status: 201 },
        );
      } catch (error) {
        return Response.json(
          { fatal: error instanceof Error ? error.message : String(error) },
          { status: 500 },
        );
      }
    }
    if (request.method === 'POST' && url.pathname.startsWith('/operation/')) {
      const [, , scenario, flow] = url.pathname.split('/');
      try {
        return Response.json(
          await operation(env.DB, scenario as ConcurrentScenario, flow as 'a' | 'b'),
        );
      } catch (error) {
        return Response.json(
          { fatal: error instanceof Error ? error.message : String(error) },
          { status: 500 },
        );
      }
    }
    if (url.pathname.startsWith('/api/v1/') && routeApp)
      return routeApp.fetch(request, {
        ...env,
        ENVIRONMENT: 'local',
        RELEASE_VERSION: 'local-http-capacity',
        ACCESS_TEAM_DOMAIN: 'https://team.cloudflareaccess.com',
        ACCESS_AUD: 'local-capacity-audience',
        APP_ORIGIN: 'http://localhost',
        OWNER_BOOTSTRAP_ENABLED: 'false',
        BOOTSTRAP_OWNER_EMAIL: 'owner@example.test',
        TOKEN_ENCRYPTION_KEY: 'local-test-key',
        OPENAI_PROVIDER_ENABLED: 'false',
        AI_PROVIDER_CONNECTIVITY_DIAGNOSTIC_ENABLED: 'false',
        ASSETS: { fetch: () => Promise.resolve(new Response('unused')) } as unknown as Fetcher,
      });
    if (request.method === 'GET' && url.pathname.startsWith('/state/'))
      return Response.json(
        routeApp
          ? {
              constructionCount,
              metrics: routeMetrics,
              state: routeScenario === 'default' ? null : await state(env.DB),
            }
          : await state(env.DB),
      );
    return new Response('not found', { status: 404 });
  },
};
