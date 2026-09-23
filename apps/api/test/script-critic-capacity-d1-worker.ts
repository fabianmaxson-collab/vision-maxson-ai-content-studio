import { createApp } from '../src/app';
import { ChainedScriptCriticCapacityService } from '../src/editorial/script-critic-chained-capacity';
import {
  ScriptCriticCapacityError,
  ScriptCriticCapacityService,
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
type FixtureScope = {
  workspaceId: string;
  projectId: string;
  successorBudgetId: string;
  historicalEnvelopeId: string;
};
const policy: FixtureScope = {
  workspaceId: 'workspace',
  projectId: 'project',
  successorBudgetId: 'budget-successor',
  historicalEnvelopeId: 'historical-critic',
};
const policyB: FixtureScope = {
  workspaceId: 'workspace',
  projectId: 'project-b',
  successorBudgetId: 'budget-successor-b',
  historicalEnvelopeId: 'historical-critic-b',
};
const changedCommandPolicy: FixtureScope = {
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
        1120000,'ACTIVE','owner','t','t',1);
  `,
  );
}

async function seedForeignWorkspaceProject(database: D1Database) {
  await executeSql(
    database,
    `
    INSERT INTO workspaces(id,slug,name,created_at,updated_at)
      VALUES('workspace-b','workspace-b','Workspace B','t','t');
    INSERT INTO users(id,workspace_id,email,status,created_at,updated_at)
      VALUES('owner-b','workspace-b','owner-b@example.test','active','t','t');
    INSERT INTO user_roles(workspace_id,user_id,role_id,created_at)
      SELECT 'workspace-b','owner-b',id,'t' FROM roles WHERE key='owner';
    INSERT INTO content_brands(id,workspace_id,name,normalized_name,primary_language,created_at,updated_at,created_by)
      VALUES('brand-b','workspace-b','Brand B','brand-b','de','t','t','owner-b');
    INSERT INTO channel_profiles(id,workspace_id,content_brand_id,name,normalized_name,primary_language,created_at,updated_at,created_by)
      VALUES('channel-b','workspace-b','brand-b','Channel B','channel-b','de','t','t','owner-b');
    INSERT INTO projects(id,workspace_id,content_brand_id,channel_profile_id,title,format,operating_mode,status,primary_language,readiness_status,created_at,updated_at,created_by)
      VALUES('project-c','workspace-b','brand-b','channel-b','Project C','SHORT','ASSISTED','ANALYZING','de','ready','t','t','owner-b');
    INSERT INTO editorial_project_execution_budgets(id,workspace_id,project_id,profile_key,profile_version,currency,monetary_ceiling_microusd,status,authorized_by,created_at,updated_at,version)
      VALUES('budget-old-c','workspace-b','project-c','phase3_terminal_graph_v1',1,'USD',1331520,'ACTIVE','owner-b','t','t',1);
    INSERT INTO editorial_execution_envelopes(id,workspace_id,project_id,profile_key,profile_version,provider_id,provider_model_id,currency,monetary_ceiling_microusd,maximum_calls,status,authorized_by,created_at,updated_at,version,project_execution_budget_id,stage_key)
      VALUES('historical-critic-c','workspace-b','project-c','phase3_terminal_graph_v1',1,'provider_openai','model_openai_gpt_5_6_sol_20260903','USD',403840,1,'CONSUMED','owner-b','t','t',2,'budget-old-c','SCRIPT_CRITIC');
    UPDATE editorial_project_execution_budgets SET status='CONSUMED',version=2 WHERE id='budget-old-c';
    INSERT INTO editorial_project_execution_budgets(id,workspace_id,project_id,profile_key,profile_version,currency,monetary_ceiling_microusd,status,authorized_by,created_at,updated_at,version)
      VALUES('budget-successor-c','workspace-b','project-c','phase3_terminal_graph_v1',1,'USD',740000,'ACTIVE','owner-b','t','t',1);
    `,
  );
}

async function state(database: D1Database) {
  const envelopes = await database
    .prepare(
      `SELECT id,project_id projectId,project_execution_budget_id budgetId,stage_key stageKey,
        status,version,maximum_calls maximumCalls,monetary_ceiling_microusd ceiling
       FROM editorial_execution_envelopes
       WHERE project_execution_budget_id IN ('budget-successor','budget-successor-b','budget-successor-c')
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
       WHERE id IN ('historical-critic','historical-critic-changed','historical-critic-b','historical-critic-c')
       ORDER BY id`,
    )
    .all<JsonRow>();
  const reservations = await database
    .prepare(
      `SELECT id,project_execution_budget_id budgetId,reserved_microusd reservedMicrousd,status
       FROM editorial_execution_reservations
       WHERE project_execution_budget_id IN ('budget-successor','budget-successor-b','budget-successor-c')
       ORDER BY id`,
    )
    .all<JsonRow>();
  const runs = await database
    .prepare(
      `SELECT id,project_id projectId,status FROM intelligence_runs
       WHERE project_id IN ('project','project-b','project-c') ORDER BY id`,
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
  const service = new ScriptCriticCapacityService(instrumented as unknown as D1Database, owner, {
    ...context,
    requestId: `request-${scenario}-${flow}`,
  });
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
  | ConcurrentScenario
  | 'default'
  | 'scope'
  | 'rbac'
  | 'storage'
  | 'factory-safety'
  | 'workspace-scope';
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

async function chainedLocalScenario(database: D1Database, scenario: string) {
  await seed(database, true);
  const projectId = 'project_2135b883-8499-48e9-a4a7-bb04b970d72a';
  const budgetId = 'project_execution_budget_e00c938b-5621-4ce4-ae74-eea07d9b5529';
  const owner = { id: 'owner', workspaceId: 'workspace_primary', roles: ['owner' as const] };
  const context = {
    requestId: 'local-chained-capacity',
    environment: 'test',
    accessIssuer: 'https://access.example.test',
    accessSubject: 'owner-subject',
  };
  const firstService = new ScriptCriticCapacityService(database, owner, context);
  const first = await firstService.provision(projectId, 'local-first-capacity', {
    successorBudgetId: budgetId,
    expectedBudgetVersion: 1,
    expectedBudgetStatus: 'ACTIVE',
    consumedHistoricalEnvelopeId: 'execution_envelope_cf4d27f4-2296-4b0d-9ba7-7893bd21dc38',
    reason: 'REPLACEMENT_SCRIPT_CRITIC_CAPACITY',
  });
  await executeSql(
    database,
    'INSERT INTO editorial_artifacts(id,workspace_id,project_id,artifact_type,current_version_id,status,created_at,updated_at,version,created_by,updated_by) ' +
      "VALUES('local-script','workspace_primary','" +
      projectId +
      "','PRODUCTION_SCRIPT','local-script-v3','approved','t','t',3,'owner','owner');" +
      'INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,language_code,content_text,source_type,content_hash,created_at,created_by) ' +
      "VALUES('local-script-v3','workspace_primary','local-script',3,'de','Deutscher Kurzfilm.','HUMAN_EDITED','" +
      'a'.repeat(64) +
      "','t','owner');" +
      'INSERT INTO artifact_approvals(id,workspace_id,artifact_version_id,decision,actor_id,actor_role,decided_at) ' +
      "VALUES('local-script-approval','workspace_primary','local-script-v3','APPROVED','owner','owner','t');" +
      'INSERT INTO editorial_artifacts(id,workspace_id,project_id,artifact_type,current_version_id,status,created_at,updated_at,version,created_by,updated_by) ' +
      "VALUES('local-critique','workspace_primary','" +
      projectId +
      "','SCRIPT_CRITIQUE','local-critique-v2','active','t','t',2,'owner','owner');" +
      'INSERT INTO intelligence_runs(id,workspace_id,project_id,task_type,provider_id,provider_model_id,input_artifact_version_id,output_artifact_version_id,initiated_by,operating_mode,status,idempotency_key,creative_regeneration_number,safe_metadata_json,created_at,updated_at,version) ' +
      "VALUES('local-critic-run','workspace_primary','" +
      projectId +
      "','SCRIPT_CRITIC','provider_openai','model_openai_gpt_5_6_sol_20260903','local-script-v3','local-critique-v2','owner','ASSISTED','QUEUED','local-critic-key',0,'{}','t','t',1)",
  );
  const critique = {
    sourceScriptVersionId: 'local-script-v3',
    languageCode: 'de',
    strengths: ['El guion tiene una narración clara para el público y funciona bien.'],
    issues: [],
    dimensionsEvaluated: [
      'FACTUAL_CONSISTENCY',
      'BRIEF_ALIGNMENT',
      'RESEARCH_ALIGNMENT',
      'CLARITY',
      'HOOK',
      'PACING',
      'REDUNDANCY',
      'CTA',
      'TECHNICAL_ACCURACY',
      'SHORT_FORMAT_SUITABILITY',
      'LANGUAGE_AND_EDITORIAL_CONSTRAINTS',
    ],
  };
  await database
    .prepare(
      'INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,language_code,content_json,source_type,intelligence_run_id,content_hash,source_script_version_id,created_at,created_by) ' +
        "VALUES('local-critique-v2','workspace_primary','local-critique',2,'de',?,'AI_GENERATED','local-critic-run',?,NULL,'t','owner')",
    )
    .bind(JSON.stringify(critique), 'b'.repeat(64))
    .run();
  await executeSql(
    database,
    'INSERT INTO artifact_dependencies(id,workspace_id,source_artifact_version_id,dependent_artifact_version_id,dependency_type,validity_status,created_at,updated_at,version) ' +
      "VALUES('local-critique-dependency','workspace_primary','local-script-v3','local-critique-v2','EVALUATES_SOURCE','CURRENT','t','t',1);" +
      'INSERT INTO intelligence_run_attempts(id,intelligence_run_id,attempt_number,attempt_kind,status,safe_metadata_json,started_at,completed_at) ' +
      "VALUES('local-critic-attempt','local-critic-run',1,'TECHNICAL','SUCCEEDED','{}','t','t')",
  );
  await database
    .prepare(
      'INSERT INTO editorial_execution_reservations(id,envelope_id,workspace_id,project_id,intelligence_run_id,step_key,pricing_snapshot_id,reserved_microusd,actual_microusd,status,created_at,project_execution_budget_id) ' +
        "VALUES('local-critic-reservation',?,'workspace_primary',?,'local-critic-run','SCRIPT_CRITIC','pricing_model_openai_gpt_5_6_sol_20260903',403840,53004,'RECONCILED','t',?)",
    )
    .bind(first.envelope.id, projectId, budgetId)
    .run();
  await database
    .prepare("UPDATE editorial_execution_envelopes SET status='CONSUMED',version=2 WHERE id=?")
    .bind(first.envelope.id)
    .run();
  await executeSql(
    database,
    'INSERT INTO audit_events(id,workspace_id,actor_type,actor_id,actor_role,access_issuer,access_subject,action,resource_type,resource_id,outcome,request_id,environment,metadata_json,occurred_at,ingested_at) ' +
      "VALUES('local-critic-run-audit','workspace_primary','user','owner','owner','https://access.example.test','owner-subject','intelligence.run_completed','intelligence_run','local-critic-run','success','local-critic-run-request','test','{}','t','t');" +
      "UPDATE intelligence_runs SET status='SUCCEEDED',terminal_audit_event_id='local-critic-run-audit',version=2 WHERE id='local-critic-run'",
  );
  const command = {
    successorBudgetId: budgetId,
    expectedBudgetVersion: 1,
    expectedBudgetStatus: 'ACTIVE' as const,
    predecessorCapacityEnvelopeId: first.envelope.id,
    rejectedCritiqueVersionId: 'local-critique-v2',
    reason: 'LANGUAGE_CONTRACT_FAILURE' as const,
  };
  if (scenario === 'multi') {
    await seedSecondChainedProject(database);
    const secondCommand = {
      successorBudgetId: 'local-budget-b',
      expectedBudgetVersion: 1,
      expectedBudgetStatus: 'ACTIVE' as const,
      predecessorCapacityEnvelopeId: 'local-prior-b',
      rejectedCritiqueVersionId: 'local-critique-v2-b',
      reason: 'LANGUAGE_CONTRACT_FAILURE' as const,
    };
    const instrumentedA = new InstrumentedD1(database);
    const instrumentedB = new InstrumentedD1(database);
    const serviceA = new ChainedScriptCriticCapacityService(
      instrumentedA as unknown as D1Database,
      owner,
      context,
    );
    const serviceB = new ChainedScriptCriticCapacityService(
      instrumentedB as unknown as D1Database,
      owner,
      context,
    );
    const outcomes = await Promise.allSettled([
      serviceA.provision(projectId, 'local-chain-multi', command),
      serviceB.provision('local-project-b', 'local-chain-multi', secondCommand),
    ]);
    const rows = await database
      .prepare(
        'SELECT project_id projectId,project_execution_budget_id budgetId,count(*) activeCount ' +
          "FROM editorial_execution_envelopes WHERE status='ACTIVE' AND stage_key='SCRIPT_CRITIC' " +
          'AND project_execution_budget_id IN (?,?) GROUP BY project_id,project_execution_budget_id ORDER BY project_id',
      )
      .bind(budgetId, 'local-budget-b')
      .all<JsonRow>();
    const foreignKeys = await database.prepare('PRAGMA foreign_key_check').all<JsonRow>();
    return {
      outcomes: outcomes.map((outcome) =>
        outcome.status === 'fulfilled'
          ? { kind: 'result', result: outcome.value }
          : {
              kind: 'error',
              message:
                outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
            },
      ),
      rows: rows.results,
      foreignKeys: foreignKeys.results,
      sqlBytes: [...instrumentedA.batchSqlBytes, ...instrumentedB.batchSqlBytes],
      bindingCounts: [...instrumentedA.batchBindings, ...instrumentedB.batchBindings],
      queryCount: instrumentedA.queryCount + instrumentedB.queryCount,
    };
  }
  const instrumented = new InstrumentedD1(database);
  const service = new ChainedScriptCriticCapacityService(
    instrumented as unknown as D1Database,
    owner,
    context,
  );
  const outcomes = await Promise.allSettled([
    service.provision(
      projectId,
      scenario === 'different' ? 'local-chain-a' : 'local-chain',
      command,
    ),
    service.provision(
      projectId,
      scenario === 'different' ? 'local-chain-b' : 'local-chain',
      command,
    ),
  ]);
  const result = await database
    .prepare(
      "SELECT (SELECT count(*) FROM editorial_execution_envelopes WHERE project_execution_budget_id=? AND stage_key='SCRIPT_CRITIC' AND status='ACTIVE') activeCount," +
        "(SELECT count(*) FROM audit_events WHERE action='editorial.script_critic_capacity_provisioned' AND workspace_id='workspace_primary') auditCount",
    )
    .bind(budgetId)
    .first<JsonRow>();
  const foreignKeys = await database.prepare('PRAGMA foreign_key_check').all<JsonRow>();
  return {
    outcomes: outcomes.map((outcome) =>
      outcome.status === 'fulfilled'
        ? { kind: 'result', result: outcome.value }
        : {
            kind: 'error',
            message:
              outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
          },
    ),
    activeCount: Number(result?.activeCount),
    auditCount: Number(result?.auditCount),
    foreignKeys: foreignKeys.results,
    sqlBytes: instrumented.batchSqlBytes,
    bindingCounts: instrumented.batchBindings,
    queryCount: instrumented.queryCount,
  };
}

async function seedSecondChainedProject(database: D1Database) {
  await executeSql(
    database,
    'INSERT INTO projects(id,workspace_id,content_brand_id,channel_profile_id,title,format,operating_mode,status,primary_language,readiness_status,created_at,updated_at,created_by) ' +
      "VALUES('local-project-b','workspace_primary','brand','channel','Project B','SHORT','ASSISTED','ANALYZING','es','ready','t','t','owner');" +
      'INSERT INTO editorial_project_execution_budgets(id,workspace_id,project_id,profile_key,profile_version,currency,monetary_ceiling_microusd,status,authorized_by,created_at,updated_at,version) ' +
      "VALUES('local-budget-b','workspace_primary','local-project-b','phase3_terminal_graph_v1',1,'USD',500000,'ACTIVE','owner','t','t',1);" +
      'INSERT INTO editorial_artifacts(id,workspace_id,project_id,artifact_type,current_version_id,status,created_at,updated_at,version,created_by,updated_by) ' +
      "VALUES('local-script-b','workspace_primary','local-project-b','PRODUCTION_SCRIPT','local-script-v3-b','approved','t','t',3,'owner','owner');" +
      'INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,language_code,content_text,source_type,content_hash,created_at,created_by) ' +
      "VALUES('local-script-v3-b','workspace_primary','local-script-b',3,'es','Guion breve.','HUMAN_EDITED','" +
      'c'.repeat(64) +
      "','t','owner');" +
      'INSERT INTO artifact_approvals(id,workspace_id,artifact_version_id,decision,actor_id,actor_role,decided_at) ' +
      "VALUES('local-script-approval-b','workspace_primary','local-script-v3-b','APPROVED','owner','owner','t');" +
      'INSERT INTO editorial_artifacts(id,workspace_id,project_id,artifact_type,current_version_id,status,created_at,updated_at,version,created_by,updated_by) ' +
      "VALUES('local-critique-b','workspace_primary','local-project-b','SCRIPT_CRITIQUE','local-critique-v2-b','active','t','t',2,'owner','owner');" +
      'INSERT INTO intelligence_runs(id,workspace_id,project_id,task_type,provider_id,provider_model_id,input_artifact_version_id,output_artifact_version_id,initiated_by,operating_mode,status,idempotency_key,creative_regeneration_number,safe_metadata_json,created_at,updated_at,version) ' +
      "VALUES('local-critic-run-b','workspace_primary','local-project-b','SCRIPT_CRITIC','provider_openai','model_openai_gpt_5_6_sol_20260903','local-script-v3-b','local-critique-v2-b','owner','ASSISTED','QUEUED','local-critic-key-b',0,'{}','t','t',1)",
  );
  const critique = {
    sourceScriptVersionId: 'local-script-v3-b',
    languageCode: 'es',
    strengths: ['The script has a clear narrative for the audience and follows its evidence.'],
    issues: [],
    dimensionsEvaluated: [
      'FACTUAL_CONSISTENCY',
      'BRIEF_ALIGNMENT',
      'RESEARCH_ALIGNMENT',
      'CLARITY',
      'HOOK',
      'PACING',
      'REDUNDANCY',
      'CTA',
      'TECHNICAL_ACCURACY',
      'SHORT_FORMAT_SUITABILITY',
      'LANGUAGE_AND_EDITORIAL_CONSTRAINTS',
    ],
  };
  await database
    .prepare(
      'INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,language_code,content_json,source_type,intelligence_run_id,content_hash,source_script_version_id,created_at,created_by) ' +
        "VALUES('local-critique-v2-b','workspace_primary','local-critique-b',2,'es',?,'AI_GENERATED','local-critic-run-b',?,NULL,'t','owner')",
    )
    .bind(JSON.stringify(critique), 'd'.repeat(64))
    .run();
  await executeSql(
    database,
    'INSERT INTO artifact_dependencies(id,workspace_id,source_artifact_version_id,dependent_artifact_version_id,dependency_type,validity_status,created_at,updated_at,version) ' +
      "VALUES('local-critique-dependency-b','workspace_primary','local-script-v3-b','local-critique-v2-b','EVALUATES_SOURCE','CURRENT','t','t',1);" +
      'INSERT INTO intelligence_run_attempts(id,intelligence_run_id,attempt_number,attempt_kind,status,safe_metadata_json,started_at,completed_at) ' +
      "VALUES('local-critic-attempt-b','local-critic-run-b',1,'TECHNICAL','SUCCEEDED','{}','t','t');" +
      'INSERT INTO editorial_execution_envelopes(id,workspace_id,project_id,profile_key,profile_version,provider_id,provider_model_id,currency,monetary_ceiling_microusd,maximum_calls,status,authorized_by,created_at,updated_at,version,project_execution_budget_id,stage_key) ' +
      "VALUES('local-prior-b','workspace_primary','local-project-b','phase3_terminal_graph_v1',1,'provider_openai','model_openai_gpt_5_6_sol_20260903','USD',403840,1,'ACTIVE','owner','t','t',1,'local-budget-b','SCRIPT_CRITIC');" +
      'INSERT INTO audit_events(id,workspace_id,actor_type,actor_id,actor_role,access_issuer,access_subject,action,resource_type,resource_id,outcome,request_id,environment,metadata_json,occurred_at,ingested_at) ' +
      "VALUES('local-prior-audit-b','workspace_primary','user','owner','owner','https://access.example.test','owner-subject','editorial.script_critic_capacity_provisioned','editorial_execution_envelope','local-prior-b','success','local-prior-request-b','test','{\"newEnvelopeId\":\"local-prior-b\"}','t','t');" +
      'INSERT INTO editorial_execution_reservations(id,envelope_id,workspace_id,project_id,intelligence_run_id,step_key,pricing_snapshot_id,reserved_microusd,actual_microusd,status,created_at,project_execution_budget_id) ' +
      "VALUES('local-critic-reservation-b','local-prior-b','workspace_primary','local-project-b','local-critic-run-b','SCRIPT_CRITIC','pricing_model_openai_gpt_5_6_sol_20260903',403840,53004,'RECONCILED','t','local-budget-b');" +
      "UPDATE editorial_execution_envelopes SET status='CONSUMED',version=2 WHERE id='local-prior-b';" +
      'INSERT INTO audit_events(id,workspace_id,actor_type,actor_id,actor_role,access_issuer,access_subject,action,resource_type,resource_id,outcome,request_id,environment,metadata_json,occurred_at,ingested_at) ' +
      "VALUES('local-critic-run-audit-b','workspace_primary','user','owner','owner','https://access.example.test','owner-subject','intelligence.run_completed','intelligence_run','local-critic-run-b','success','local-critic-run-request-b','test','{}','t','t');" +
      "UPDATE intelligence_runs SET status='SUCCEEDED',terminal_audit_event_id='local-critic-run-audit-b',version=2 WHERE id='local-critic-run-b'",
  );
}
export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    if (url.pathname === '/health') return Response.json({ ok: true });
    if (request.method === 'POST' && url.pathname.startsWith('/chained/')) {
      try {
        return Response.json(
          await chainedLocalScenario(env.DB, url.pathname.slice('/chained/'.length)),
        );
      } catch (error) {
        return Response.json(
          { fatal: error instanceof Error ? error.message : String(error) },
          { status: 500 },
        );
      }
    }
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
        if (httpRoute && routeScenario === 'workspace-scope')
          await seedForeignWorkspaceProject(env.DB);
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
