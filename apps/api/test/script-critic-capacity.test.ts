import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { Bindings } from '../src/app';
import { editorialRoutes } from '../src/editorial/routes';
import {
  scriptCriticCapacitySchema,
  chainedScriptCriticCapacitySchema,
  requiredScriptCritiqueDimensions,
} from '@vision-maxson/contracts';
import { ChainedScriptCriticCapacityService } from '../src/editorial/script-critic-chained-capacity';
import {
  SCRIPT_CRITIC_CAPACITY_CEILING_MICROUSD,
  SCRIPT_CRITIC_CAPACITY_OPERATION,
  ScriptCriticCapacityError,
  ScriptCriticCapacityService,
  type ScriptCriticCapacityResult,
} from '../src/editorial/script-critic-capacity';

type Sabotage =
  | 'none'
  | 'envelope'
  | 'audit'
  | 'final'
  | 'budget-race'
  | 'reservation-race'
  | 'active-envelope-race'
  | 'unexpected-batch';

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
        if (this.sabotage === 'unexpected-batch') {
          this.sabotageUsed = true;
          throw new Error('sensitive_d1_runtime_error');
        }
        if (this.sabotage === 'budget-race')
          this.database.exec(
            "UPDATE editorial_project_execution_budgets SET status='CONSUMED',version=2 WHERE id='budget-successor'",
          );
        if (this.sabotage === 'reservation-race') seedSuccessorReservation(this.database);
        if (this.sabotage === 'active-envelope-race')
          seedSuccessorEnvelope(this.database, 'race-envelope', 'SCRIPT_CRITIC');
        this.sabotageUsed = this.sabotage !== 'none';
      }
      this.database.exec('BEGIN IMMEDIATE');
      try {
        const results = [];
        for (let index = 0; index < statements.length; index += 1) {
          if (this.sabotage === 'envelope' && index === 0) {
            results.push(this.database.prepare('SELECT 1').run());
            continue;
          }
          if (this.sabotage === 'audit' && index === 1) {
            results.push(this.database.prepare('SELECT 1').run());
            continue;
          }
          if (this.sabotage === 'final' && index === 2)
            throw new Error('forced_final_guard_failure');
          results.push(await statements[index]!.run());
        }
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

const migrationDirectory = new URL('../../../packages/db/migrations/', import.meta.url);
const migrations = readdirSync(migrationDirectory)
  .filter((name) => /^(?:000[0-9]|001[0-6])_.*\.sql$/u.test(name))
  .sort();
const routes = readFileSync(new URL('../src/editorial/routes.ts', import.meta.url), 'utf8');
const serviceSource = readFileSync(
  new URL('../src/editorial/script-critic-capacity.ts', import.meta.url),
  'utf8',
);

const command = {
  successorBudgetId: 'budget-successor',
  expectedBudgetVersion: 1,
  expectedBudgetStatus: 'ACTIVE',
  consumedHistoricalEnvelopeId: 'historical-critic',
  reason: 'REPLACEMENT_SCRIPT_CRITIC_CAPACITY',
} as const;
const owner = { id: 'owner', workspaceId: 'workspace', roles: ['owner' as const] };
const context = {
  requestId: 'request-capacity',
  environment: 'test',
  accessIssuer: 'https://access.example.test',
  accessSubject: 'owner-subject',
};

function count(database: DatabaseSync, table: string) {
  return Number(database.prepare(`SELECT count(*) value FROM ${table}`).get()!.value);
}

function seedSuccessorEnvelope(
  database: DatabaseSync,
  id = 'other-envelope',
  stage = 'CONTENT_BRIEF',
) {
  database
    .prepare(
      `INSERT INTO editorial_execution_envelopes(
        id,workspace_id,project_id,profile_key,profile_version,provider_id,provider_model_id,
        currency,monetary_ceiling_microusd,maximum_calls,status,authorized_by,created_at,
        updated_at,version,project_execution_budget_id,stage_key)
       VALUES(?,'workspace','project','phase3_terminal_graph_v1',1,'provider_openai',
        'model_openai_gpt_5_6_sol_20260903','USD',600000,1,'ACTIVE','owner','t','t',1,
        'budget-successor',?)`,
    )
    .run(id, stage);
}

function seedSuccessorReservation(database: DatabaseSync) {
  seedSuccessorEnvelope(database, 'reservation-envelope', 'CONTENT_BRIEF');
  database.exec(`
    INSERT INTO intelligence_runs(
      id,workspace_id,project_id,task_type,provider_id,provider_model_id,initiated_by,
      operating_mode,status,idempotency_key,creative_regeneration_number,safe_metadata_json,
      created_at,updated_at,version)
    VALUES('reservation-run','workspace','project','CONTENT_BRIEF','provider_openai',
      'model_openai_gpt_5_6_sol_20260903','owner','ASSISTED','RUNNING','reservation-key',
      0,'{}','t','t',1);
    INSERT INTO editorial_execution_reservations(
      id,envelope_id,workspace_id,project_id,intelligence_run_id,step_key,pricing_snapshot_id,
      reserved_microusd,actual_microusd,status,created_at,project_execution_budget_id)
    VALUES('successor-reservation','reservation-envelope','workspace','project','reservation-run',
      'CONTENT_BRIEF','pricing_model_openai_gpt_5_6_sol_20260903',600000,NULL,'RESERVED','t',
      'budget-successor');
  `);
}

function fixture(sabotage: Sabotage = 'none') {
  const database = new DatabaseSync(':memory:');
  for (const migration of migrations)
    database.exec(readFileSync(new URL(migration, migrationDirectory), 'utf8'));
  database.exec(`
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
    VALUES('budget-old','workspace','project','phase3_terminal_graph_v1',1,'USD',1331520,
      'ACTIVE','owner','t','t',1);
    INSERT INTO editorial_execution_envelopes(
      id,workspace_id,project_id,profile_key,profile_version,provider_id,provider_model_id,
      currency,monetary_ceiling_microusd,maximum_calls,status,authorized_by,created_at,
      updated_at,version,project_execution_budget_id,stage_key)
    VALUES('historical-critic','workspace','project','phase3_terminal_graph_v1',1,
      'provider_openai','model_openai_gpt_5_6_sol_20260903','USD',403840,1,'CONSUMED',
      'owner','t','t',2,'budget-old','SCRIPT_CRITIC');
    UPDATE editorial_project_execution_budgets SET status='CONSUMED',version=2 WHERE id='budget-old';
    INSERT INTO editorial_project_execution_budgets(id,workspace_id,project_id,profile_key,profile_version,currency,monetary_ceiling_microusd,status,authorized_by,created_at,updated_at,version)
    VALUES('budget-successor','workspace','project','phase3_terminal_graph_v1',1,'USD',907875,'ACTIVE','owner','t','t',1);
  `);
  const d1 = new AtomicD1(database, sabotage);
  const service = new ScriptCriticCapacityService(d1 as unknown as D1Database, owner, context);
  return { database, d1, service };
}
function seedOtherFirstProject(database: DatabaseSync) {
  database.exec(`
    INSERT INTO projects(
      id,workspace_id,content_brand_id,channel_profile_id,title,format,operating_mode,status,
      primary_language,readiness_status,created_at,updated_at,created_by)
    VALUES('project-b','workspace','brand','channel','Second Project','SHORT','ASSISTED','ANALYZING',
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
    UPDATE editorial_project_execution_budgets SET status='CONSUMED',version=2
      WHERE id='budget-old-b';
    INSERT INTO editorial_project_execution_budgets(
      id,workspace_id,project_id,profile_key,profile_version,currency,
      monetary_ceiling_microusd,status,authorized_by,created_at,updated_at,version)
    VALUES('budget-successor-b','workspace','project-b','phase3_terminal_graph_v1',1,'USD',
      1120000,'ACTIVE','owner','t','t',1);
  `);
}

function seedForeignWorkspaceFirstProject(database: DatabaseSync) {
  database.exec(`
    INSERT INTO workspaces(id,slug,name,created_at,updated_at)
    VALUES('workspace-b','workspace-b','Other Workspace','t','t');
    INSERT INTO users(id,workspace_id,email,status,created_at,updated_at)
    VALUES('owner-b','workspace-b','owner-b@example.test','active','t','t');
    INSERT INTO user_roles(workspace_id,user_id,role_id,created_at)
    SELECT 'workspace-b','owner-b',id,'t' FROM roles WHERE key='owner';
    INSERT INTO access_identities(
      id,workspace_id,user_id,issuer,subject,email,last_seen_at,created_at,updated_at)
    VALUES('identity-b','workspace-b','owner-b','https://access.example.test',
      'owner-b-subject','owner-b@example.test','t','t','t');
    INSERT INTO content_brands(
      id,workspace_id,name,normalized_name,primary_language,created_at,updated_at,created_by)
    VALUES('brand-b','workspace-b','Brand B','brand-b','de','t','t','owner-b');
    INSERT INTO channel_profiles(
      id,workspace_id,content_brand_id,name,normalized_name,primary_language,
      created_at,updated_at,created_by)
    VALUES('channel-b','workspace-b','brand-b','Channel B','channel-b','de','t','t','owner-b');
    INSERT INTO projects(
      id,workspace_id,content_brand_id,channel_profile_id,title,format,operating_mode,status,
      primary_language,readiness_status,created_at,updated_at,created_by)
    VALUES('project-c','workspace-b','brand-b','channel-b','Third Project','SHORT','ASSISTED',
      'ANALYZING','de','ready','t','t','owner-b');
    INSERT INTO editorial_project_execution_budgets(
      id,workspace_id,project_id,profile_key,profile_version,currency,
      monetary_ceiling_microusd,status,authorized_by,created_at,updated_at,version)
    VALUES('budget-old-c','workspace-b','project-c','phase3_terminal_graph_v1',1,'USD',
      1331520,'ACTIVE','owner-b','t','t',1);
    INSERT INTO editorial_execution_envelopes(
      id,workspace_id,project_id,profile_key,profile_version,provider_id,provider_model_id,
      currency,monetary_ceiling_microusd,maximum_calls,status,authorized_by,created_at,
      updated_at,version,project_execution_budget_id,stage_key)
    VALUES('historical-critic-c','workspace-b','project-c','phase3_terminal_graph_v1',1,
      'provider_openai','model_openai_gpt_5_6_sol_20260903','USD',403840,1,'CONSUMED',
      'owner-b','t','t',2,'budget-old-c','SCRIPT_CRITIC');
    UPDATE editorial_project_execution_budgets SET status='CONSUMED',version=2
      WHERE id='budget-old-c';
    INSERT INTO editorial_project_execution_budgets(
      id,workspace_id,project_id,profile_key,profile_version,currency,
      monetary_ceiling_microusd,status,authorized_by,created_at,updated_at,version)
    VALUES('budget-successor-c','workspace-b','project-c','phase3_terminal_graph_v1',1,'USD',
      740000,'ACTIVE','owner-b','t','t',1);
  `);
}

const productionProjectId = 'project_2135b883-8499-48e9-a4a7-bb04b970d72a';
const productionBudgetId = 'project_execution_budget_e00c938b-5621-4ce4-ae74-eea07d9b5529';
const productionHistoricalEnvelopeId = 'execution_envelope_cf4d27f4-2296-4b0d-9ba7-7893bd21dc38';
const productionCommand = {
  successorBudgetId: productionBudgetId,
  expectedBudgetVersion: 1,
  expectedBudgetStatus: 'ACTIVE',
  consumedHistoricalEnvelopeId: productionHistoricalEnvelopeId,
  reason: 'REPLACEMENT_SCRIPT_CRITIC_CAPACITY',
} as const;
const productionActor = {
  id: 'owner-production',
  workspaceId: 'workspace_primary',
  roles: ['owner' as const],
};

function productionFixture(sabotage: Sabotage = 'none') {
  const base = fixture();
  base.database.exec(`
    INSERT INTO workspaces(id,slug,name,created_at,updated_at)
    VALUES('workspace_primary','workspace-primary','Production Workspace','t','t');
    INSERT INTO users(id,workspace_id,email,status,created_at,updated_at)
    VALUES('owner-production','workspace_primary','owner-production@example.test','active','t','t');
    INSERT INTO user_roles(workspace_id,user_id,role_id,created_at)
    SELECT 'workspace_primary','owner-production',id,'t' FROM roles WHERE key='owner';
    INSERT INTO access_identities(
      id,workspace_id,user_id,issuer,subject,email,last_seen_at,created_at,updated_at)
    VALUES('identity-production','workspace_primary','owner-production',
      'https://access.example.test','owner-production-subject',
      'owner-production@example.test','t','t','t');
    INSERT INTO content_brands(
      id,workspace_id,name,normalized_name,primary_language,created_at,updated_at,created_by)
    VALUES('brand-production','workspace_primary','Production Brand','production-brand',
      'de','t','t','owner-production');
    INSERT INTO channel_profiles(
      id,workspace_id,content_brand_id,name,normalized_name,primary_language,
      created_at,updated_at,created_by)
    VALUES('channel-production','workspace_primary','brand-production','Production Channel',
      'production-channel','de','t','t','owner-production');
    INSERT INTO projects(
      id,workspace_id,content_brand_id,channel_profile_id,title,format,operating_mode,status,
      primary_language,readiness_status,created_at,updated_at,created_by)
    VALUES('${productionProjectId}','workspace_primary','brand-production','channel-production',
      'Production Project','SHORT','ASSISTED','ANALYZING','de','ready','t','t','owner-production');
    INSERT INTO editorial_project_execution_budgets(
      id,workspace_id,project_id,profile_key,profile_version,currency,
      monetary_ceiling_microusd,status,authorized_by,created_at,updated_at,version)
    VALUES('production-budget-old','workspace_primary','${productionProjectId}',
      'phase3_terminal_graph_v1',1,'USD',1331520,'ACTIVE','owner-production','t','t',1);
    INSERT INTO editorial_execution_envelopes(
      id,workspace_id,project_id,profile_key,profile_version,provider_id,provider_model_id,
      currency,monetary_ceiling_microusd,maximum_calls,status,authorized_by,created_at,
      updated_at,version,project_execution_budget_id,stage_key)
    VALUES('${productionHistoricalEnvelopeId}','workspace_primary','${productionProjectId}',
      'phase3_terminal_graph_v1',1,'provider_openai','model_openai_gpt_5_6_sol_20260903',
      'USD',403840,1,'CONSUMED','owner-production','t','t',2,'production-budget-old',
      'SCRIPT_CRITIC');
    UPDATE editorial_project_execution_budgets
      SET status='CONSUMED',version=2 WHERE id='production-budget-old';
    INSERT INTO editorial_project_execution_budgets(
      id,workspace_id,project_id,profile_key,profile_version,currency,
      monetary_ceiling_microusd,status,authorized_by,created_at,updated_at,version)
    VALUES('${productionBudgetId}','workspace_primary','${productionProjectId}',
      'phase3_terminal_graph_v1',1,'USD',907875,'ACTIVE','owner-production','t','t',1);
  `);
  const d1 = new AtomicD1(base.database, sabotage);
  return { database: base.database, d1 };
}

function productionApp(d1: AtomicD1) {
  const app = new Hono<{
    Bindings: Bindings;
    Variables: {
      user: typeof productionActor;
      requestId: string;
      identity: { issuer: string; subject: string; email: string };
    };
  }>();
  app.use('*', async (c, next) => {
    c.set('user', productionActor);
    c.set('requestId', 'production-capacity-http');
    c.set('identity', {
      issuer: 'https://access.example.test',
      subject: 'owner-production-subject',
      email: 'owner-production@example.test',
    });
    await next();
  });
  app.route('/api/v1', editorialRoutes);
  return { app, env: { DB: d1, ENVIRONMENT: 'staging' } as unknown as Bindings };
}

describe('dedicated SCRIPT_CRITIC capacity provisioning', () => {
  it('exposes a strict command and providers:admin route', () => {
    expect(scriptCriticCapacitySchema.safeParse(command).success).toBe(true);
    for (const invalid of [
      { ...command, extra: true },
      { ...command, expectedBudgetVersion: 2 },
      { ...command, expectedBudgetStatus: 'CONSUMED' },
      { ...command, reason: 'OTHER' },
      { ...command, monetaryCeilingMicrousd: 1 },
      { ...command, providerKey: 'other' },
    ])
      expect(scriptCriticCapacitySchema.safeParse(invalid).success).toBe(false);
    expect(routes).toContain("'/admin/projects/:projectId/editorial-script-critic-capacities'");
    expect(routes).toContain("requirePermission('providers:admin')");
    expect(routes).toContain("c.req.header('Idempotency-Key')?.trim()");
    expect(serviceSource).toContain("'editorial.script_critic_capacity_provisioned'");
    expect(serviceSource).toContain("newId('execution_envelope')");
  });

  it('provisions an independent first replacement with a different D1 budget ceiling', async () => {
    const { database, service } = fixture();
    seedOtherFirstProject(database);
    const otherCommand = {
      ...command,
      successorBudgetId: 'budget-successor-b',
      consumedHistoricalEnvelopeId: 'historical-critic-b',
    };
    const created = await service.provision('project-b', 'other-first', otherCommand);
    const receipt = database
      .prepare('SELECT metadata_json value FROM audit_events WHERE id=?')
      .get(created.auditEventId)!;
    expect(JSON.parse(String(receipt.value))).toMatchObject({
      workspace: 'workspace',
      project: 'project-b',
      successorBudgetId: 'budget-successor-b',
      successorBudgetCeilingMicroUsd: 1120000,
      historicalEnvelopeId: 'historical-critic-b',
    });
    expect(
      (await service.provision('project-b', 'other-first', otherCommand)).idempotentReplay,
    ).toBe(true);
    expect(
      database
        .prepare(
          'SELECT workspace_id,project_id,project_execution_budget_id FROM editorial_execution_envelopes WHERE id=?',
        )
        .get(created.envelope.id),
    ).toEqual({
      workspace_id: 'workspace',
      project_id: 'project-b',
      project_execution_budget_id: 'budget-successor-b',
    });
    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    database.close();
  });

  it('fails closed for cross-project and cross-workspace first-capacity substitutions', async () => {
    const { database, service } = fixture();
    seedOtherFirstProject(database);
    seedForeignWorkspaceFirstProject(database);
    const before = [
      count(database, 'editorial_execution_envelopes'),
      count(database, 'audit_events'),
    ];
    const attacks = [
      ['project', { ...command, successorBudgetId: 'budget-successor-b' }],
      ['project', { ...command, consumedHistoricalEnvelopeId: 'historical-critic-b' }],
      ['project-b', command],
      [
        'project-c',
        {
          ...command,
          successorBudgetId: 'budget-successor-c',
          consumedHistoricalEnvelopeId: 'historical-critic-c',
        },
      ],
      ['project', { ...command, successorBudgetId: 'budget-successor-c' }],
      ['project', { ...command, consumedHistoricalEnvelopeId: 'historical-critic-c' }],
    ] as const;
    for (const [projectId, attack] of attacks)
      await expect(
        service.provision(
          projectId,
          'scope-' +
            projectId +
            '-' +
            attack.successorBudgetId +
            '-' +
            attack.consumedHistoricalEnvelopeId,
          attack,
        ),
      ).rejects.toBeInstanceOf(ScriptCriticCapacityError);
    expect([
      count(database, 'editorial_execution_envelopes'),
      count(database, 'audit_events'),
    ]).toEqual(before);
    const otherActor = { id: 'owner-b', workspaceId: 'workspace-b', roles: ['owner' as const] };
    const otherService = new ScriptCriticCapacityService(
      new AtomicD1(database) as unknown as D1Database,
      otherActor,
      { ...context, accessSubject: 'owner-b-subject' },
    );
    const own = await otherService.provision('project-c', 'workspace-b-first', {
      ...command,
      successorBudgetId: 'budget-successor-c',
      consumedHistoricalEnvelopeId: 'historical-critic-c',
    });
    expect(own.envelope.projectExecutionBudgetId).toBe('budget-successor-c');
    database.close();
  });

  it('rejects a previously provisioned replacement as a historical first-capacity source', async () => {
    const { database, service } = fixture();
    database.exec(`
      INSERT INTO audit_events(
        id,workspace_id,actor_type,actor_id,actor_role,access_issuer,access_subject,
        action,resource_type,resource_id,outcome,request_id,environment,metadata_json,
        occurred_at,ingested_at)
      VALUES('prior-capacity-receipt','workspace','user','owner','owner',
        'https://access.example.test','owner-subject',
        'editorial.script_critic_capacity_provisioned','editorial_execution_envelope',
        'historical-critic','success','prior-request','test','{}','t','t');
    `);
    const before = [
      count(database, 'editorial_execution_envelopes'),
      count(database, 'audit_events'),
    ];
    await expect(
      service.provision('project', 'not-a-first-capacity', command),
    ).rejects.toMatchObject({
      status: 409,
      message: 'script_critic_capacity_snapshot_invalid',
    });
    expect([
      count(database, 'editorial_execution_envelopes'),
      count(database, 'audit_events'),
    ]).toEqual(before);
    database.close();
  });

  it('creates exactly one server-governed envelope and authenticated receipt atomically', async () => {
    const { database, d1, service } = fixture();
    const before = {
      reservations: count(database, 'editorial_execution_reservations'),
      runs: count(database, 'intelligence_runs'),
      attempts: count(database, 'intelligence_run_attempts'),
    };
    const created = await service.provision('project', 'capacity-key', command);
    expect(created).toMatchObject({
      envelope: {
        projectExecutionBudgetId: 'budget-successor',
        stageKey: 'SCRIPT_CRITIC',
        status: 'ACTIVE',
        version: 1,
        maximumCalls: 1,
        usedCalls: 0,
        monetaryCeilingMicroUsd: SCRIPT_CRITIC_CAPACITY_CEILING_MICROUSD,
      },
      idempotentReplay: false,
    });
    expect(
      database
        .prepare('SELECT * FROM editorial_execution_envelopes WHERE id=?')
        .get(created.envelope.id),
    ).toMatchObject({
      workspace_id: 'workspace',
      project_id: 'project',
      profile_key: 'phase3_terminal_graph_v1',
      profile_version: 1,
      provider_id: 'provider_openai',
      provider_model_id: 'model_openai_gpt_5_6_sol_20260903',
      currency: 'USD',
      monetary_ceiling_microusd: 403840,
      maximum_calls: 1,
      status: 'ACTIVE',
      version: 1,
      project_execution_budget_id: 'budget-successor',
      stage_key: 'SCRIPT_CRITIC',
    });
    expect(
      database
        .prepare(
          "SELECT status,version FROM editorial_execution_envelopes WHERE id='historical-critic'",
        )
        .get(),
    ).toEqual({ status: 'CONSUMED', version: 2 });
    expect(count(database, 'editorial_execution_reservations')).toBe(before.reservations);
    expect(count(database, 'intelligence_runs')).toBe(before.runs);
    expect(count(database, 'intelligence_run_attempts')).toBe(before.attempts);
    const audit = database
      .prepare(
        'SELECT action,resource_type resourceType,resource_id resourceId,actor_id actorId,actor_role actorRole,access_issuer accessIssuer,access_subject accessSubject,metadata_json metadataJson FROM audit_events WHERE id=?',
      )
      .get(created.auditEventId) as Record<string, unknown>;
    expect(audit).toMatchObject({
      action: SCRIPT_CRITIC_CAPACITY_OPERATION,
      resourceType: 'editorial_execution_envelope',
      resourceId: created.envelope.id,
      actorId: 'owner',
      actorRole: 'owner',
      accessIssuer: 'https://access.example.test',
      accessSubject: 'owner-subject',
    });
    const metadata = JSON.parse(String(audit.metadataJson)) as Record<string, unknown>;
    expect(metadata).toMatchObject({
      operation: SCRIPT_CRITIC_CAPACITY_OPERATION,
      successorBudgetId: 'budget-successor',
      successorBudgetCeilingMicroUsd: 907875,
      availableBudgetBeforeMicroUsd: 907875,
      historicalEnvelopeId: 'historical-critic',
      stageKey: 'SCRIPT_CRITIC',
      providerId: 'provider_openai',
      modelId: 'model_openai_gpt_5_6_sol_20260903',
      pricingSnapshotId: 'pricing_model_openai_gpt_5_6_sol_20260903',
      reasoningEffort: 'high',
      maximumCalls: 1,
      maximumAttempts: 1,
      gatewayAttempts: 1,
      sdkMaxRetries: 0,
      requestRetries: 0,
      fallbackAllowed: false,
      creativeRegeneration: false,
      monetaryCeilingMicroUsd: 403840,
      reason: 'REPLACEMENT_SCRIPT_CRITIC_CAPACITY',
    });
    expect(d1.maxBoundParameters).toBeLessThanOrEqual(100);
    expect(d1.maxBatchStatements).toBe(3);
    expect(d1.queries).toBeLessThanOrEqual(250);
    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    database.close();
  });

  it('rejects replay when the live project is no longer active in the receipt workspace', async () => {
    const { database, service } = fixture();
    await service.provision('project', 'project-replay-key', command);
    database.prepare("UPDATE projects SET deleted_at='t' WHERE id='project'").run();
    await expect(service.provision('project', 'project-replay-key', command)).rejects.toThrow(
      'script_critic_capacity_receipt_invalid',
    );
    expect(
      Number(
        database
          .prepare(
            "SELECT count(*) value FROM audit_events WHERE action='editorial.script_critic_capacity_provisioned'",
          )
          .get()!.value,
      ),
    ).toBe(1);
    database.close();
  });

  it('replays the exact command once and rejects a changed command or malformed receipt', async () => {
    const { database, service } = fixture();
    const created = await service.provision('project', 'replay-key', command);
    await expect(service.provision('project', 'replay-key', command)).resolves.toEqual({
      ...created,
      idempotentReplay: true,
    });
    const changed = {
      ...command,
      consumedHistoricalEnvelopeId: 'different-history',
    };
    await expect(service.provision('project', 'replay-key', changed)).rejects.toMatchObject({
      status: 409,
    });
    database.exec('DROP TRIGGER audit_events_no_update');
    database
      .prepare('UPDATE audit_events SET metadata_json=? WHERE id=?')
      .run('{"operation":"forged"}', created.auditEventId);
    await expect(service.provision('project', 'replay-key', command)).rejects.toThrow(
      'script_critic_capacity_idempotency_conflict',
    );
    expect(
      Number(
        database
          .prepare(
            "SELECT count(*) value FROM audit_events WHERE action='editorial.script_critic_capacity_provisioned'",
          )
          .get()!.value,
      ),
    ).toBe(1);
    database.close();
  });

  it.each([
    [
      'budget terminal',
      "UPDATE editorial_project_execution_budgets SET status='CONSUMED',version=2 WHERE id='budget-successor'",
    ],
    [
      'budget version drift',
      "UPDATE editorial_project_execution_budgets SET version=2 WHERE id='budget-successor'",
    ],
    [
      'budget below stage ceiling',
      "UPDATE editorial_project_execution_budgets SET monetary_ceiling_microusd=403839 WHERE id='budget-successor'",
    ],
    [
      'budget profile drift',
      "UPDATE editorial_project_execution_budgets SET profile_key='other' WHERE id='budget-successor'",
    ],
    [
      'budget currency drift',
      "PRAGMA ignore_check_constraints=ON; UPDATE editorial_project_execution_budgets SET currency='EUR' WHERE id='budget-successor'; PRAGMA ignore_check_constraints=OFF",
    ],
    ['ambiguous successor reservation', null],
    [
      'historical version drift',
      "UPDATE editorial_execution_envelopes SET version=3 WHERE id='historical-critic'",
    ],
    [
      'historical reactivated',
      "UPDATE editorial_execution_envelopes SET status='ACTIVE',version=3 WHERE id='historical-critic'",
    ],
    ['provider disabled', "UPDATE ai_providers SET status='disabled' WHERE id='provider_openai'"],
    [
      'model unavailable',
      "UPDATE ai_provider_models SET status='inactive' WHERE id='model_openai_gpt_5_6_sol_20260903'",
    ],
    [
      'pricing invalid',
      "UPDATE ai_pricing_snapshots SET verification_status='stale' WHERE id='pricing_model_openai_gpt_5_6_sol_20260903'",
    ],
    [
      'pricing amount drift',
      "UPDATE ai_pricing_snapshots SET input_unit_price=0.000005 WHERE id='pricing_model_openai_gpt_5_6_sol_20260903'",
    ],
    [
      'capability drift',
      `UPDATE ai_provider_models SET capabilities_json='{"capabilities":["STRUCTURED_OUTPUT"],"qualityTier":"HIGH"}' WHERE id='model_openai_gpt_5_6_sol_20260903'`,
    ],
    [
      'quality drift',
      `UPDATE ai_provider_models SET capabilities_json='{"capabilities":["STRUCTURED_OUTPUT","CRITIQUE"],"qualityTier":"BALANCED"}' WHERE id='model_openai_gpt_5_6_sol_20260903'`,
    ],
    ['membership removed', "DELETE FROM user_roles WHERE user_id='owner'"],
    ['identity removed', "DELETE FROM access_identities WHERE user_id='owner'"],
  ] as const)('fails closed for %s without writes', async (name, mutation) => {
    const { database, service } = fixture();
    if (name === 'ambiguous successor reservation') {
      seedSuccessorReservation(database);
      database
        .prepare(
          "UPDATE editorial_execution_reservations SET status='DISPATCHED',dispatched_at='t' WHERE id='successor-reservation'",
        )
        .run();
      database
        .prepare(
          "UPDATE editorial_execution_reservations SET status='AMBIGUOUS',reconciled_at='t' WHERE id='successor-reservation'",
        )
        .run();
    } else {
      if (
        name.startsWith('budget ') &&
        name !== 'budget terminal' &&
        name !== 'budget version drift'
      )
        database.exec('DROP TRIGGER editorial_project_budget_version_guard');
      if (name === 'historical reactivated')
        database.exec('DROP TRIGGER editorial_execution_envelope_terminal_guard');
      database.exec(mutation);
    }
    const beforeAudit = count(database, 'audit_events');
    const beforeEnvelope = count(database, 'editorial_execution_envelopes');
    await expect(service.provision('project', `fail-${name}`, command)).rejects.toBeInstanceOf(
      ScriptCriticCapacityError,
    );
    expect(count(database, 'audit_events')).toBe(beforeAudit);
    expect(count(database, 'editorial_execution_envelopes')).toBe(beforeEnvelope);
    database.close();
  });

  it.each(['budget-race', 'reservation-race', 'active-envelope-race'] as const)(
    'rolls back and maps the known %s conflict to 409',
    async (sabotage) => {
      const { database, service } = fixture(sabotage);
      const beforeAudit = count(database, 'audit_events');
      await expect(
        service.provision('project', `atomic-${sabotage}`, command),
      ).rejects.toMatchObject({ status: 409, message: 'script_critic_capacity_conflict' });
      expect(
        Number(
          database
            .prepare(
              "SELECT count(*) value FROM audit_events WHERE action='editorial.script_critic_capacity_provisioned'",
            )
            .get()!.value,
        ),
      ).toBe(0);
      expect(count(database, 'audit_events')).toBe(beforeAudit);
      database.close();
    },
  );

  it.each(['unexpected-batch', 'envelope', 'audit', 'final'] as const)(
    'rolls back and preserves unknown %s storage classification',
    async (sabotage) => {
      const { database, service } = fixture(sabotage);
      const beforeAudit = count(database, 'audit_events');
      const beforeEnvelope = count(database, 'editorial_execution_envelopes');
      let caught: unknown;
      try {
        await service.provision('project', `storage-${sabotage}`, command);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(Error);
      expect(caught).not.toBeInstanceOf(ScriptCriticCapacityError);
      expect(count(database, 'audit_events')).toBe(beforeAudit);
      expect(count(database, 'editorial_execution_envelopes')).toBe(beforeEnvelope);
      database.close();
    },
  );

  it('preserves idempotency in the supplemental SQLite concurrency harness', async () => {
    {
      const { database, service } = fixture();
      const [first, second] = await Promise.all([
        service.provision('project', 'same-key', command),
        service.provision('project', 'same-key', command),
      ]);
      expect([first.idempotentReplay, second.idempotentReplay].sort()).toEqual([false, true]);
      expect(first.envelope.id).toBe(second.envelope.id);
      expect(
        Number(
          database
            .prepare(
              "SELECT count(*) value FROM editorial_execution_envelopes WHERE project_execution_budget_id='budget-successor' AND stage_key='SCRIPT_CRITIC' AND status='ACTIVE'",
            )
            .get()!.value,
        ),
      ).toBe(1);
      database.close();
    }
    {
      const { database, service } = fixture();
      const settled = await Promise.allSettled([
        service.provision('project', 'different-a', command),
        service.provision('project', 'different-b', command),
      ]);
      expect(settled.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(settled.filter((result) => result.status === 'rejected')).toHaveLength(1);
      expect(
        Number(
          database
            .prepare(
              "SELECT count(*) value FROM editorial_execution_envelopes WHERE project_execution_budget_id='budget-successor' AND stage_key='SCRIPT_CRITIC' AND status='ACTIVE'",
            )
            .get()!.value,
        ),
      ).toBe(1);
      database.close();
    }
  });

  it('fails closed for RBAC and cross-workspace/project scope', async () => {
    const { database, d1 } = fixture();
    const viewer = new ScriptCriticCapacityService(
      d1 as unknown as D1Database,
      { ...owner, roles: ['viewer'] },
      context,
    );
    await expect(viewer.provision('project', 'viewer', command)).rejects.toMatchObject({
      status: 403,
    });
    const wrongProject = new ScriptCriticCapacityService(
      d1 as unknown as D1Database,
      owner,
      context,
    );
    await expect(wrongProject.provision('project-b', 'shared-key', command)).rejects.toMatchObject({
      status: 404,
    });
    expect(
      Number(
        database
          .prepare(
            "SELECT count(*) value FROM audit_events WHERE action='editorial.script_critic_capacity_provisioned'",
          )
          .get()!.value,
      ),
    ).toBe(0);
    database.close();
  });

  it('uses canonical 404 scope semantics through the actual production route policy', async () => {
    const { database, d1 } = productionFixture();
    const { app, env } = productionApp(d1);
    const beforeAudit = count(database, 'audit_events');
    const beforeEnvelope = count(database, 'editorial_execution_envelopes');
    const response = await app.request(
      '/api/v1/admin/projects/project-foreign/editorial-script-critic-capacities',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'production-scope-key',
        },
        body: JSON.stringify(productionCommand),
      },
      env,
    );
    const body = await response.json<{ detail: string }>();
    expect(response.status).toBe(404);
    expect(body.detail).toBe('script_critic_capacity_source_not_found');
    expect(count(database, 'audit_events')).toBe(beforeAudit);
    expect(count(database, 'editorial_execution_envelopes')).toBe(beforeEnvelope);
    database.close();
  });

  it('sanitizes an unexpected pre-write D1 batch error as HTTP 500', async () => {
    const { database, d1 } = productionFixture('unexpected-batch');
    const { app, env } = productionApp(d1);
    const beforeAudit = count(database, 'audit_events');
    const beforeEnvelope = count(database, 'editorial_execution_envelopes');
    const response = await app.request(
      `/api/v1/admin/projects/${productionProjectId}/editorial-script-critic-capacities`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'unexpected-storage-key',
        },
        body: JSON.stringify(productionCommand),
      },
      env,
    );
    const raw = await response.text();
    const body = JSON.parse(raw) as { title: string; detail: string };
    expect(response.status).toBe(500);
    expect(body).toMatchObject({
      title: 'Internal Server Error',
      detail: 'The request could not be completed.',
    });
    expect(raw).not.toContain('sensitive_d1_runtime_error');
    expect(raw).not.toContain('INSERT INTO');
    expect(count(database, 'audit_events')).toBe(beforeAudit);
    expect(count(database, 'editorial_execution_envelopes')).toBe(beforeEnvelope);
    database.close();
  });
  it('documents bounded production SQL and no migration 0017', () => {
    expect(migrations).toHaveLength(17);
    expect(migrations.at(-1)).toBe('0016_governed_production_script_retry_authorization.sql');
    expect(serviceSource).toContain('await this.db.batch([');
    expect(serviceSource).toContain('finalGuardSql');
    expect(serviceSource).not.toContain('fetch(');
    expect(serviceSource).not.toContain('intelligence_runs(id');
    expect(serviceSource).not.toContain('editorial_execution_reservations(id');
  });
});

const chainedContext = {
  requestId: 'chained-capacity-request',
  environment: 'staging',
  accessIssuer: 'https://access.example.test',
  accessSubject: 'owner-production-subject',
};
const chainedCommand = {
  successorBudgetId: productionBudgetId,
  expectedBudgetVersion: 1,
  expectedBudgetStatus: 'ACTIVE',
  predecessorCapacityEnvelopeId: '',
  rejectedCritiqueVersionId: 'critique-v2',
  reason: 'LANGUAGE_CONTRACT_FAILURE',
} as const;
async function chainedFixture(reservationStatus: 'RECONCILED' | 'AMBIGUOUS' = 'RECONCILED') {
  const { database, d1 } = productionFixture();
  const first = new ScriptCriticCapacityService(
    d1 as unknown as D1Database,
    productionActor,
    chainedContext,
  );
  const capacity = await first.provision(
    productionProjectId,
    'historical-first-capacity',
    productionCommand,
  );
  const predecessorId = capacity.envelope.id;
  database.exec(
    'INSERT INTO editorial_artifacts(id,workspace_id,project_id,artifact_type,current_version_id,status,created_at,updated_at,version,created_by,updated_by) ' +
      "VALUES('script-artifact','workspace_primary','" +
      productionProjectId +
      "','PRODUCTION_SCRIPT','script-v3','approved','t','t',3,'owner-production','owner-production');" +
      'INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,language_code,content_text,source_type,content_hash,created_at,created_by) ' +
      "VALUES('script-v3','workspace_primary','script-artifact',3,'de','Ein deutscher Kurzfilm.','HUMAN_EDITED','" +
      'a'.repeat(64) +
      "','t','owner-production');" +
      'INSERT INTO artifact_approvals(id,workspace_id,artifact_version_id,decision,actor_id,actor_role,decided_at) ' +
      "VALUES('script-approval','workspace_primary','script-v3','APPROVED','owner-production','owner','t');" +
      'INSERT INTO editorial_artifacts(id,workspace_id,project_id,artifact_type,current_version_id,status,created_at,updated_at,version,created_by,updated_by) ' +
      "VALUES('critique-artifact','workspace_primary','" +
      productionProjectId +
      "','SCRIPT_CRITIQUE','critique-v2','active','t','t',2,'owner-production','owner-production');" +
      'INSERT INTO intelligence_runs(id,workspace_id,project_id,task_type,provider_id,provider_model_id,input_artifact_version_id,output_artifact_version_id,initiated_by,operating_mode,status,idempotency_key,creative_regeneration_number,safe_metadata_json,created_at,updated_at,version) ' +
      "VALUES('critic-run','workspace_primary','" +
      productionProjectId +
      "','SCRIPT_CRITIC','provider_openai','model_openai_gpt_5_6_sol_20260903','script-v3','critique-v2','owner-production','ASSISTED','QUEUED','critic-run-key',0,'{}','t','t',1);",
  );
  const critique = {
    sourceScriptVersionId: 'script-v3',
    languageCode: 'de',
    strengths: ['El guion tiene una narración clara para el público y funciona bien.'],
    issues: [
      {
        dimension: 'CLARITY',
        issue: 'La narración es clara, pero el guion debe revisar la información.',
        severity: 'MEDIUM',
        recommendation: 'El guion debe mantener la narración y explicar la causa.',
        confidence: 0.8,
        evidenceType: 'HEURISTIC',
        segmentOrders: [1],
      },
    ],
    dimensionsEvaluated: requiredScriptCritiqueDimensions,
  };
  database
    .prepare(
      'INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,language_code,content_json,source_type,intelligence_run_id,content_hash,source_script_version_id,created_at,created_by) ' +
        "VALUES('critique-v2','workspace_primary','critique-artifact',2,'de',?,'AI_GENERATED','critic-run',?,NULL,'t','owner-production')",
    )
    .run(JSON.stringify(critique), 'b'.repeat(64));
  database.exec(
    'INSERT INTO artifact_dependencies(id,workspace_id,source_artifact_version_id,dependent_artifact_version_id,dependency_type,validity_status,created_at,updated_at,version) ' +
      "VALUES('critique-dependency','workspace_primary','script-v3','critique-v2','EVALUATES_SOURCE','CURRENT','t','t',1);" +
      'INSERT INTO intelligence_run_attempts(id,intelligence_run_id,attempt_number,attempt_kind,status,safe_metadata_json,started_at,completed_at) ' +
      "VALUES('critic-attempt','critic-run',1,'TECHNICAL','SUCCEEDED','{}','t','t');",
  );
  database
    .prepare(
      'INSERT INTO editorial_execution_reservations(id,envelope_id,workspace_id,project_id,intelligence_run_id,step_key,pricing_snapshot_id,reserved_microusd,actual_microusd,status,created_at,project_execution_budget_id) ' +
        "VALUES('critic-reservation',?,'workspace_primary',?,'critic-run','SCRIPT_CRITIC','pricing_model_openai_gpt_5_6_sol_20260903',403840,?,?,'t',?)",
    )
    .run(
      predecessorId,
      productionProjectId,
      reservationStatus === 'RECONCILED' ? 53004 : null,
      reservationStatus,
      productionBudgetId,
    );
  database
    .prepare(
      "UPDATE editorial_execution_envelopes SET status='CONSUMED',version=2,updated_at='t' WHERE id=?",
    )
    .run(predecessorId);
  database.exec(
    'INSERT INTO audit_events(id,workspace_id,actor_type,actor_id,actor_role,access_issuer,access_subject,action,resource_type,resource_id,outcome,request_id,environment,metadata_json,occurred_at,ingested_at) ' +
      "VALUES('critic-run-audit','workspace_primary','user','owner-production','owner','https://access.example.test','owner-production-subject','intelligence.run_completed','intelligence_run','critic-run','success','critic-run-request','staging','{}','t','t');" +
      "UPDATE intelligence_runs SET status='SUCCEEDED',terminal_audit_event_id='critic-run-audit',version=2 WHERE id='critic-run';",
  );
  const command = { ...chainedCommand, predecessorCapacityEnvelopeId: predecessorId };
  const service = new ChainedScriptCriticCapacityService(
    d1 as unknown as D1Database,
    productionActor,
    chainedContext,
  );
  return { database, d1, service, command, first, predecessorId };
}
describe('governed chained SCRIPT_CRITIC capacity', () => {
  it('requires a strict explicit predecessor, rejected version and reason', () => {
    expect(
      chainedScriptCriticCapacitySchema.safeParse({
        ...chainedCommand,
        predecessorCapacityEnvelopeId: 'execution_envelope_test',
      }).success,
    ).toBe(true);
    for (const changed of [
      { ...chainedCommand, reason: 'OTHER' },
      { ...chainedCommand, extra: true },
      { ...chainedCommand, rejectedCritiqueVersionId: null },
    ])
      expect(chainedScriptCriticCapacitySchema.safeParse(changed).success).toBe(false);
  });

  it('accounts the prior reconciled actual cost, provisions once and replays', async () => {
    const f = await chainedFixture();
    const key = 'chain-one';
    const result = await f.service.provision(productionProjectId, key, f.command);
    expect(result.envelope.monetaryCeilingMicroUsd).toBe(403840);
    expect(result.idempotentReplay).toBe(false);
    const metadata: unknown = JSON.parse(
      String(
        f.database
          .prepare('SELECT metadata_json value FROM audit_events WHERE id=?')
          .get(result.auditEventId)!.value,
      ),
    );
    expect(metadata).toMatchObject({
      committedBeforeMicroUsd: 53004,
      activeResidualBeforeMicroUsd: 0,
      predecessorRunId: 'critic-run',
      languagePolicyVersion: 'script_critic_source_language_v2',
    });
    expect(53004 + 403840).toBeLessThanOrEqual(907875);
    const replay = await f.service.provision(productionProjectId, key, f.command);
    expect(replay).toMatchObject({ auditEventId: result.auditEventId, idempotentReplay: true });
    expect(count(f.database, 'editorial_execution_envelopes')).toBe(4);
    expect(count(f.database, 'editorial_execution_reservations')).toBe(1);
    expect(count(f.database, 'intelligence_runs')).toBe(1);
    expect(count(f.database, 'intelligence_run_attempts')).toBe(1);
    expect(f.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('allows historical replay after its envelope is legitimately consumed', async () => {
    const f = await chainedFixture();
    const old = await f.first.provision(
      productionProjectId,
      'historical-first-capacity',
      productionCommand,
    );
    expect(old.idempotentReplay).toBe(true);
    const created = await f.service.provision(productionProjectId, 'chain-terminal', f.command);
    f.database.exec(
      'INSERT INTO intelligence_runs(id,workspace_id,project_id,task_type,provider_id,provider_model_id,initiated_by,operating_mode,status,idempotency_key,creative_regeneration_number,safe_metadata_json,created_at,updated_at,version) ' +
        "VALUES('later-run','workspace_primary','" +
        productionProjectId +
        "','SCRIPT_CRITIC','provider_openai','model_openai_gpt_5_6_sol_20260903','owner-production','ASSISTED','QUEUED','later-run-key',0,'{}','t','t',1)",
    );
    f.database
      .prepare(
        'INSERT INTO editorial_execution_reservations(id,envelope_id,workspace_id,project_id,intelligence_run_id,step_key,pricing_snapshot_id,reserved_microusd,actual_microusd,status,created_at,project_execution_budget_id) ' +
          "VALUES('later-reservation',?,'workspace_primary',?,'later-run','SCRIPT_CRITIC','pricing_model_openai_gpt_5_6_sol_20260903',403840,10000,'RECONCILED','t',?)",
      )
      .run(created.envelope.id, productionProjectId, productionBudgetId);
    f.database
      .prepare("UPDATE editorial_execution_envelopes SET status='CONSUMED',version=2 WHERE id=?")
      .run(created.envelope.id);
    expect(
      (await f.service.provision(productionProjectId, 'chain-terminal', f.command))
        .idempotentReplay,
    ).toBe(true);
  });

  it('fails closed on active capacity, wrong target, approved target and ambiguous predecessor', async () => {
    for (const sabotage of ['active', 'target', 'approved', 'ambiguous'] as const) {
      const f = await chainedFixture(sabotage === 'ambiguous' ? 'AMBIGUOUS' : 'RECONCILED');
      if (sabotage === 'active') {
        await f.service.provision(productionProjectId, 'earlier', f.command);
      } else if (sabotage === 'approved') {
        f.database.exec(
          "INSERT INTO artifact_approvals(id,workspace_id,artifact_version_id,decision,actor_id,actor_role,decided_at) VALUES('wrong-approval','workspace_primary','critique-v2','APPROVED','owner-production','owner','t')",
        );
      }
      const request =
        sabotage === 'target'
          ? { ...f.command, rejectedCritiqueVersionId: 'wrong-version' }
          : f.command;
      await expect(
        f.service.provision(productionProjectId, 'sabotage-' + sabotage, request),
      ).rejects.toMatchObject({ status: 409 });
      expect(count(f.database, 'editorial_execution_envelopes')).toBe(
        sabotage === 'active' ? 4 : 3,
      );
    }
  });

  it('rejects changed-command replay and permits one winner for different keys', async () => {
    const f = await chainedFixture();
    await f.service.provision(productionProjectId, 'same-key', f.command);
    await expect(
      f.service.provision(productionProjectId, 'same-key', {
        ...f.command,
        rejectedCritiqueVersionId: 'other',
      }),
    ).rejects.toMatchObject({
      status: 409,
      message: 'script_critic_capacity_idempotency_conflict',
    });
    await expect(
      f.service.provision(productionProjectId, 'different-key', f.command),
    ).rejects.toMatchObject({ status: 409 });
    expect(count(f.database, 'editorial_execution_envelopes')).toBe(4);
  });
});

describe('chained capacity fail-closed evidence and races', () => {
  const extraEnvelope =
    'INSERT INTO editorial_execution_envelopes(id,workspace_id,project_id,profile_key,profile_version,provider_id,provider_model_id,currency,monetary_ceiling_microusd,maximum_calls,status,authorized_by,created_at,updated_at,version,project_execution_budget_id,stage_key) ' +
    "VALUES('budget-race-envelope','workspace_primary','" +
    productionProjectId +
    "','phase3_terminal_graph_v1',1,'provider_openai','model_openai_gpt_5_6_sol_20260903','USD',600000,1,'ACTIVE','owner-production','t','t',1,'" +
    productionBudgetId +
    "','CONTENT_BRIEF')";

  it('fails when an active unrelated envelope would cause double exposure', async () => {
    const f = await chainedFixture();
    f.database.exec(extraEnvelope);
    await expect(
      f.service.provision(productionProjectId, 'double-exposure', f.command),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      Number(
        f.database
          .prepare(
            "SELECT count(*) count FROM editorial_execution_envelopes WHERE project_execution_budget_id=? AND stage_key='SCRIPT_CRITIC' AND status='ACTIVE'",
          )
          .get(productionBudgetId)!.count,
      ),
    ).toBe(0);
  });

  it('detects exposure changing after its read snapshot before the D1 batch', async () => {
    const f = await chainedFixture();
    let raced = false;
    const racedDatabase = {
      prepare(sql: string) {
        return f.d1.prepare(sql);
      },
      batch(statements: Statement[]) {
        if (!raced) {
          raced = true;
          f.database.exec(extraEnvelope);
        }
        return f.d1.batch(statements);
      },
    };
    const service = new ChainedScriptCriticCapacityService(
      racedDatabase as unknown as D1Database,
      productionActor,
      chainedContext,
    );
    await expect(
      service.provision(productionProjectId, 'budget-race-key', f.command),
    ).rejects.toMatchObject({ status: 409 });
    expect(raced).toBe(true);
    expect(
      Number(
        f.database
          .prepare(
            "SELECT count(*) count FROM audit_events WHERE action='editorial.script_critic_capacity_provisioned' AND workspace_id='workspace_primary'",
          )
          .get()!.count,
      ),
    ).toBe(1);
  });

  it('rejects predecessor, identity and catalog drift without new writes', async () => {
    const changes = [
      (database: DatabaseSync) =>
        database.exec(
          "UPDATE editorial_project_execution_budgets SET version=2 WHERE id='" +
            productionBudgetId +
            "'",
        ),
      (database: DatabaseSync) =>
        database.exec("DELETE FROM editorial_execution_reservations WHERE id='critic-reservation'"),
      (database: DatabaseSync) =>
        database.exec(
          "UPDATE ai_provider_models SET status='inactive' WHERE id='model_openai_gpt_5_6_sol_20260903'",
        ),
      (database: DatabaseSync) =>
        database.exec(
          "UPDATE ai_pricing_snapshots SET output_unit_price=0.000021 WHERE id='pricing_model_openai_gpt_5_6_sol_20260903'",
        ),
      (database: DatabaseSync) =>
        database.exec("DELETE FROM access_identities WHERE id='identity-production'"),
      (database: DatabaseSync) =>
        database.exec(
          "UPDATE editorial_artifacts SET current_version_id=NULL WHERE id='critique-artifact'",
        ),
    ];
    for (const [index, change] of changes.entries()) {
      const f = await chainedFixture();
      change(f.database);
      await expect(
        f.service.provision(productionProjectId, 'drift-' + index, f.command),
      ).rejects.toMatchObject({ status: index === 4 ? 403 : 409 });
      expect(
        Number(
          f.database
            .prepare(
              "SELECT count(*) count FROM editorial_execution_envelopes WHERE project_execution_budget_id=? AND stage_key='SCRIPT_CRITIC' AND status='ACTIVE'",
            )
            .get(productionBudgetId)!.count,
        ),
      ).toBe(0);
    }
  });

  it('allows exactly one same-key concurrent creation and replay', async () => {
    const f = await chainedFixture();
    const outcomes = await Promise.allSettled([
      f.service.provision(productionProjectId, 'same-concurrent-key', f.command),
      f.service.provision(productionProjectId, 'same-concurrent-key', f.command),
    ]);
    expect(outcomes.every((outcome) => outcome.status === 'fulfilled')).toBe(true);
    const results = outcomes
      .filter(
        (outcome): outcome is PromiseFulfilledResult<ScriptCriticCapacityResult> =>
          outcome.status === 'fulfilled',
      )
      .map((outcome) => outcome.value);
    expect(results.map((result) => result.idempotentReplay).sort()).toEqual([false, true]);
    expect(new Set(results.map((result) => result.envelope.id)).size).toBe(1);
  });

  it('allows exactly one different-key concurrent creation', async () => {
    const f = await chainedFixture();
    const outcomes = await Promise.allSettled([
      f.service.provision(productionProjectId, 'different-concurrent-a', f.command),
      f.service.provision(productionProjectId, 'different-concurrent-b', f.command),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
    expect(
      Number(
        f.database
          .prepare(
            "SELECT count(*) count FROM editorial_execution_envelopes WHERE project_execution_budget_id=? AND stage_key='SCRIPT_CRITIC' AND status='ACTIVE'",
          )
          .get(productionBudgetId)!.count,
      ),
    ).toBe(1);
  });
});

describe('chained capacity receipt integrity', () => {
  it('rejects a locally tampered audit chain even when the idempotency key matches', async () => {
    const f = await chainedFixture();
    const key = 'tamper-receipt-key';
    const result = await f.service.provision(productionProjectId, key, f.command);
    // Local corruption simulation: production audit rows are append-only.
    f.database.exec('DROP TRIGGER audit_events_no_update');
    f.database
      .prepare(
        "UPDATE audit_events SET metadata_json=json_set(metadata_json,'$.predecessorRunId','forged-run') WHERE id=?",
      )
      .run(result.auditEventId);
    await expect(f.service.provision(productionProjectId, key, f.command)).rejects.toMatchObject({
      status: 409,
      message: 'script_critic_chained_capacity_receipt_invalid',
    });
  });
});

describe('chained capacity explicit sabotage matrix', () => {
  it('rejects wrong scope, missing predecessor, and budget status drift without persistence', async () => {
    for (const sabotage of [
      'workspace',
      'project',
      'budget',
      'predecessor',
      'budget-status',
    ] as const) {
      const f = await chainedFixture();
      let service = f.service;
      let projectId = productionProjectId;
      let command: Parameters<ChainedScriptCriticCapacityService['provision']>[2] = f.command;
      if (sabotage === 'workspace') {
        service = new ChainedScriptCriticCapacityService(
          f.d1 as unknown as D1Database,
          { ...productionActor, workspaceId: 'another-workspace' },
          chainedContext,
        );
      } else if (sabotage === 'project') {
        projectId = 'another-project';
      } else if (sabotage === 'budget') {
        command = { ...f.command, successorBudgetId: 'another-budget' };
      } else if (sabotage === 'predecessor') {
        command = { ...f.command, predecessorCapacityEnvelopeId: 'another-envelope' };
      } else {
        f.database
          .prepare(
            'UPDATE editorial_project_execution_budgets SET status=?,version=version+1 WHERE id=?',
          )
          .run('CANCELLED', productionBudgetId);
      }
      await expect(
        service.provision(projectId, 'scope-' + sabotage, command),
      ).rejects.toMatchObject({
        status: sabotage === 'budget-status' ? 409 : 404,
      });
      expect(count(f.database, 'editorial_execution_envelopes')).toBe(3);
      expect(
        Number(
          f.database
            .prepare(
              "SELECT count(*) count FROM audit_events WHERE action='editorial.script_critic_capacity_provisioned'",
            )
            .get()!.count,
        ),
      ).toBe(1);
    }
  });

  it('rejects wrong predecessor stage and terminal-state drift', async () => {
    for (const sabotage of ['stage', 'active'] as const) {
      const f = await chainedFixture();
      if (sabotage === 'stage') {
        f.database
          .prepare('UPDATE editorial_execution_envelopes SET stage_key=? WHERE id=?')
          .run('CONTENT_BRIEF', f.predecessorId);
      } else if (sabotage === 'active') {
        // Isolated corruption simulation; production terminal envelopes cannot revert.
        f.database.exec('DROP TRIGGER editorial_execution_envelope_terminal_guard');
        f.database
          .prepare('UPDATE editorial_execution_envelopes SET status=?,version=1 WHERE id=?')
          .run('ACTIVE', f.predecessorId);
      }
      await expect(
        f.service.provision(productionProjectId, 'predecessor-' + sabotage, f.command),
      ).rejects.toMatchObject({ status: 409 });
      expect(
        Number(
          f.database
            .prepare(
              "SELECT count(*) count FROM editorial_execution_envelopes WHERE project_execution_budget_id=? AND stage_key='SCRIPT_CRITIC' AND status='ACTIVE'",
            )
            .get(productionBudgetId)!.count,
        ),
      ).toBe(sabotage === 'active' ? 1 : 0);
    }
  });

  it('rejects invalid Critique lineage, a newer version, and a now-German target', async () => {
    for (const sabotage of ['dependency', 'newer', 'language'] as const) {
      const f = await chainedFixture();
      if (sabotage === 'dependency') {
        f.database.exec("DELETE FROM artifact_dependencies WHERE id='critique-dependency'");
      } else if (sabotage === 'newer') {
        f.database.exec(
          'INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,language_code,content_text,source_type,intelligence_run_id,content_hash,created_at,created_by) ' +
            "VALUES('critique-v3','workspace_primary','critique-artifact',3,'de','Neu.','AI_GENERATED','critic-run','" +
            'c'.repeat(64) +
            "','t','owner-production')",
        );
      } else {
        f.database.exec('DROP TRIGGER editorial_versions_no_update');
        const row = f.database
          .prepare('SELECT content_json value FROM editorial_artifact_versions WHERE id=?')
          .get('critique-v2')!;
        const content = JSON.parse(String(row.value)) as Record<string, unknown>;
        content.strengths = ['Das Drehbuch erzählt die Geschichte klar und präzise.'];
        content.issues = [];
        f.database
          .prepare('UPDATE editorial_artifact_versions SET content_json=? WHERE id=?')
          .run(JSON.stringify(content), 'critique-v2');
      }
      await expect(
        f.service.provision(productionProjectId, 'critique-' + sabotage, f.command),
      ).rejects.toMatchObject({ status: 409 });
      expect(count(f.database, 'editorial_execution_envelopes')).toBe(3);
    }
  });
});

describe('chained capacity inherited D1 guards', () => {
  it('prevents excess calls, duplicate reservations and unknown reconciled actual cost', async () => {
    const f = await chainedFixture();
    expect(() =>
      f.database
        .prepare('UPDATE editorial_execution_envelopes SET maximum_calls=2 WHERE id=?')
        .run(f.predecessorId),
    ).toThrow();
    expect(() =>
      f.database
        .prepare(
          'INSERT INTO editorial_execution_reservations(id,envelope_id,workspace_id,project_id,intelligence_run_id,step_key,pricing_snapshot_id,reserved_microusd,actual_microusd,status,created_at,project_execution_budget_id) ' +
            "VALUES('second-critic-reservation',?,'workspace_primary',?,'critic-run','SCRIPT_CRITIC','pricing_model_openai_gpt_5_6_sol_20260903',1,1,'RECONCILED','t',?)",
        )
        .run(f.predecessorId, productionProjectId, productionBudgetId),
    ).toThrow();
    expect(() =>
      f.database
        .prepare('UPDATE editorial_execution_reservations SET actual_microusd=NULL WHERE id=?')
        .run('critic-reservation'),
    ).toThrow();
    expect(count(f.database, 'editorial_execution_reservations')).toBe(1);
    expect(count(f.database, 'editorial_execution_envelopes')).toBe(3);
  });
});
type ChainedFixture = Awaited<ReturnType<typeof chainedFixture>>;

function seedAlternateChain(
  f: ChainedFixture,
  prefix: string,
  options: { otherWorkspace?: boolean; ceiling?: number } = {},
) {
  const workspaceId = options.otherWorkspace ? 'workspace_other' : 'workspace_primary';
  const actorId = options.otherWorkspace ? 'owner-other' : 'owner-production';
  const subject = options.otherWorkspace ? 'owner-other-subject' : 'owner-production-subject';
  const projectId = prefix + '-project';
  const budgetId = prefix + '-budget';
  const envelopeId = prefix + '-envelope';
  const scriptArtifactId = prefix + '-script-artifact';
  const scriptVersionId = prefix + '-script-v3';
  const critiqueArtifactId = prefix + '-critique-artifact';
  const critiqueVersionId = prefix + '-critique-v2';
  const runId = prefix + '-run';
  const attemptId = prefix + '-attempt';
  const reservationId = prefix + '-reservation';
  const ceiling = options.ceiling ?? 500000;
  if (options.otherWorkspace) {
    f.database.exec(
      "INSERT INTO workspaces(id,slug,name,created_at,updated_at) VALUES('workspace_other','workspace-other','Other','t','t');" +
        "INSERT INTO users(id,workspace_id,email,status,created_at,updated_at) VALUES('owner-other','workspace_other','owner-other@example.test','active','t','t');" +
        "INSERT INTO user_roles(workspace_id,user_id,role_id,created_at) SELECT 'workspace_other','owner-other',id,'t' FROM roles WHERE key='owner';" +
        "INSERT INTO access_identities(id,workspace_id,user_id,issuer,subject,email,last_seen_at,created_at,updated_at) VALUES('identity-other','workspace_other','owner-other','https://access.example.test','owner-other-subject','owner-other@example.test','t','t','t');" +
        "INSERT INTO content_brands(id,workspace_id,name,normalized_name,primary_language,created_at,updated_at,created_by) VALUES('brand-other','workspace_other','Other Brand','other-brand','es','t','t','owner-other');" +
        "INSERT INTO channel_profiles(id,workspace_id,content_brand_id,name,normalized_name,primary_language,created_at,updated_at,created_by) VALUES('channel-other','workspace_other','brand-other','Other Channel','other-channel','es','t','t','owner-other')",
    );
  }
  const brandId = options.otherWorkspace ? 'brand-other' : 'brand-production';
  const channelId = options.otherWorkspace ? 'channel-other' : 'channel-production';
  f.database.exec(
    `INSERT INTO projects(id,workspace_id,content_brand_id,channel_profile_id,title,format,operating_mode,status,primary_language,readiness_status,created_at,updated_at,created_by)
     VALUES('${projectId}','${workspaceId}','${brandId}','${channelId}','Second Project','SHORT','ASSISTED','ANALYZING','es','ready','t','t','${actorId}');
     INSERT INTO editorial_project_execution_budgets(id,workspace_id,project_id,profile_key,profile_version,currency,monetary_ceiling_microusd,status,authorized_by,created_at,updated_at,version)
     VALUES('${budgetId}','${workspaceId}','${projectId}','phase3_terminal_graph_v1',1,'USD',${ceiling},'ACTIVE','${actorId}','t','t',1);
     INSERT INTO editorial_artifacts(id,workspace_id,project_id,artifact_type,current_version_id,status,created_at,updated_at,version,created_by,updated_by)
     VALUES('${scriptArtifactId}','${workspaceId}','${projectId}','PRODUCTION_SCRIPT','${scriptVersionId}','approved','t','t',3,'${actorId}','${actorId}');
     INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,language_code,content_text,source_type,content_hash,created_at,created_by)
     VALUES('${scriptVersionId}','${workspaceId}','${scriptArtifactId}',3,'es','Un guion breve.','HUMAN_EDITED','${'a'.repeat(64)}','t','${actorId}');
     INSERT INTO artifact_approvals(id,workspace_id,artifact_version_id,decision,actor_id,actor_role,decided_at)
     VALUES('${prefix}-script-approval','${workspaceId}','${scriptVersionId}','APPROVED','${actorId}','owner','t');
     INSERT INTO editorial_artifacts(id,workspace_id,project_id,artifact_type,current_version_id,status,created_at,updated_at,version,created_by,updated_by)
     VALUES('${critiqueArtifactId}','${workspaceId}','${projectId}','SCRIPT_CRITIQUE','${critiqueVersionId}','active','t','t',2,'${actorId}','${actorId}');
     INSERT INTO intelligence_runs(id,workspace_id,project_id,task_type,provider_id,provider_model_id,input_artifact_version_id,output_artifact_version_id,initiated_by,operating_mode,status,idempotency_key,creative_regeneration_number,safe_metadata_json,created_at,updated_at,version)
     VALUES('${runId}','${workspaceId}','${projectId}','SCRIPT_CRITIC','provider_openai','model_openai_gpt_5_6_sol_20260903','${scriptVersionId}','${critiqueVersionId}','${actorId}','ASSISTED','QUEUED','${prefix}-run-key',0,'{}','t','t',1)`,
  );
  const critique = {
    sourceScriptVersionId: scriptVersionId,
    languageCode: 'es',
    strengths: [
      'The script follows the source and the research, but the evidence remains unclear.',
    ],
    issues: [],
    dimensionsEvaluated: requiredScriptCritiqueDimensions,
  };
  f.database
    .prepare(
      'INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,language_code,content_json,source_type,intelligence_run_id,content_hash,source_script_version_id,created_at,created_by) ' +
        'VALUES(?,?,?,2,?,? ,?, ?, ?,NULL,?,?)',
    )
    .run(
      critiqueVersionId,
      workspaceId,
      critiqueArtifactId,
      'es',
      JSON.stringify(critique),
      'AI_GENERATED',
      runId,
      'b'.repeat(64),
      't',
      actorId,
    );
  f.database.exec(
    `INSERT INTO artifact_dependencies(id,workspace_id,source_artifact_version_id,dependent_artifact_version_id,dependency_type,validity_status,created_at,updated_at,version)
     VALUES('${prefix}-dependency','${workspaceId}','${scriptVersionId}','${critiqueVersionId}','EVALUATES_SOURCE','CURRENT','t','t',1);
     INSERT INTO intelligence_run_attempts(id,intelligence_run_id,attempt_number,attempt_kind,status,safe_metadata_json,started_at,completed_at)
     VALUES('${attemptId}','${runId}',1,'TECHNICAL','SUCCEEDED','{}','t','t');
     INSERT INTO editorial_execution_envelopes(id,workspace_id,project_id,profile_key,profile_version,provider_id,provider_model_id,currency,monetary_ceiling_microusd,maximum_calls,status,authorized_by,created_at,updated_at,version,project_execution_budget_id,stage_key)
     VALUES('${envelopeId}','${workspaceId}','${projectId}','phase3_terminal_graph_v1',1,'provider_openai','model_openai_gpt_5_6_sol_20260903','USD',403840,1,'ACTIVE','${actorId}','t','t',1,'${budgetId}','SCRIPT_CRITIC')`,
  );
  f.database
    .prepare(
      'INSERT INTO audit_events(id,workspace_id,actor_type,actor_id,actor_role,access_issuer,access_subject,action,resource_type,resource_id,outcome,request_id,environment,metadata_json,occurred_at,ingested_at) ' +
        "VALUES(?,?,'user',?,'owner','https://access.example.test',?,'editorial.script_critic_capacity_provisioned','editorial_execution_envelope',?,'success',?,'test',?,'t','t')",
    )
    .run(
      prefix + '-capacity-audit',
      workspaceId,
      actorId,
      subject,
      envelopeId,
      prefix + '-capacity-request',
      JSON.stringify({ newEnvelopeId: envelopeId }),
    );
  f.database.exec(
    `INSERT INTO editorial_execution_reservations(id,envelope_id,workspace_id,project_id,intelligence_run_id,step_key,pricing_snapshot_id,reserved_microusd,actual_microusd,status,created_at,project_execution_budget_id)
     VALUES('${reservationId}','${envelopeId}','${workspaceId}','${projectId}','${runId}','SCRIPT_CRITIC','pricing_model_openai_gpt_5_6_sol_20260903',403840,53004,'RECONCILED','t','${budgetId}');
     UPDATE editorial_execution_envelopes SET status='CONSUMED',version=2 WHERE id='${envelopeId}';
     INSERT INTO audit_events(id,workspace_id,actor_type,actor_id,actor_role,access_issuer,access_subject,action,resource_type,resource_id,outcome,request_id,environment,metadata_json,occurred_at,ingested_at)
     VALUES('${prefix}-run-audit','${workspaceId}','user','${actorId}','owner','https://access.example.test','${subject}','intelligence.run_completed','intelligence_run','${runId}','success','${prefix}-run-request','test','{}','t','t');
     UPDATE intelligence_runs SET status='SUCCEEDED',terminal_audit_event_id='${prefix}-run-audit',version=2 WHERE id='${runId}'`,
  );
  const actor = {
    id: actorId,
    workspaceId,
    roles: ['owner' as const],
  };
  const context = {
    requestId: prefix + '-capacity-request',
    environment: 'test',
    accessIssuer: 'https://access.example.test',
    accessSubject: subject,
  };
  const service = new ChainedScriptCriticCapacityService(
    f.d1 as unknown as D1Database,
    actor,
    context,
  );
  const command = {
    successorBudgetId: budgetId,
    expectedBudgetVersion: 1,
    expectedBudgetStatus: 'ACTIVE' as const,
    predecessorCapacityEnvelopeId: envelopeId,
    rejectedCritiqueVersionId: critiqueVersionId,
    reason: 'LANGUAGE_CONTRACT_FAILURE' as const,
  };
  return { service, actor, context, command, projectId, budgetId, envelopeId, critiqueVersionId };
}

describe('generic multi-project chained SCRIPT_CRITIC scope', () => {
  it('authorizes a Spanish second project using its own 500000 ceiling and actual cost', async () => {
    const f = await chainedFixture();
    const b = seedAlternateChain(f, 'second');
    const result = await b.service.provision(b.projectId, 'second-capacity', b.command);
    expect(result.envelope.projectExecutionBudgetId).toBe(b.budgetId);
    const metadata = JSON.parse(
      String(
        f.database
          .prepare('SELECT metadata_json value FROM audit_events WHERE id=?')
          .get(result.auditEventId)!.value,
      ),
    ) as Record<string, unknown>;
    expect(metadata).toMatchObject({
      budgetCeilingMicroUsd: 500000,
      committedBeforeMicroUsd: 53004,
      activeResidualBeforeMicroUsd: 0,
      rejectedCritiqueVersionId: b.critiqueVersionId,
    });
    expect(500000 - 53004 - 403840).toBe(43156);
    expect(
      (await b.service.provision(b.projectId, 'second-capacity', b.command)).idempotentReplay,
    ).toBe(true);
    expect(f.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('rejects a second project whose own ceiling is 450000 even while A has free capacity', async () => {
    const f = await chainedFixture();
    const b = seedAlternateChain(f, 'limited', { ceiling: 450000 });
    await expect(b.service.provision(b.projectId, 'limited-key', b.command)).rejects.toMatchObject({
      status: 409,
    });
    expect(
      Number(
        f.database
          .prepare(
            'SELECT count(*) count FROM editorial_execution_envelopes WHERE project_execution_budget_id=? AND status=?',
          )
          .get(b.budgetId, 'ACTIVE')!.count,
      ),
    ).toBe(0);
  });

  it('rejects cross-project budget, predecessor and Critique substitutions independently', async () => {
    for (const attack of ['budget', 'predecessor', 'critique'] as const) {
      const f = await chainedFixture();
      const b = seedAlternateChain(f, 'cross');
      const command =
        attack === 'budget'
          ? { ...f.command, successorBudgetId: b.budgetId }
          : attack === 'predecessor'
            ? { ...f.command, predecessorCapacityEnvelopeId: b.envelopeId }
            : { ...f.command, rejectedCritiqueVersionId: b.critiqueVersionId };
      await expect(
        f.service.provision(productionProjectId, 'cross-' + attack, command),
      ).rejects.toMatchObject({ status: attack === 'budget' ? 404 : 409 });
      expect(
        Number(
          f.database
            .prepare(
              'SELECT count(*) count FROM editorial_execution_envelopes WHERE project_execution_budget_id=? AND status=?',
            )
            .get(b.budgetId, 'ACTIVE')!.count,
        ),
      ).toBe(0);
    }
  });

  it('keeps a different workspace fully isolated from the authenticated A actor', async () => {
    const f = await chainedFixture();
    const b = seedAlternateChain(f, 'other', { otherWorkspace: true });
    await expect(
      f.service.provision(b.projectId, 'other-project', b.command),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      f.service.provision(productionProjectId, 'other-budget', {
        ...f.command,
        successorBudgetId: b.budgetId,
      }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      f.service.provision(productionProjectId, 'other-predecessor', {
        ...f.command,
        predecessorCapacityEnvelopeId: b.envelopeId,
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      f.service.provision(productionProjectId, 'other-critique', {
        ...f.command,
        rejectedCritiqueVersionId: b.critiqueVersionId,
      }),
    ).rejects.toMatchObject({ status: 409 });
    const authorized = await b.service.provision(b.projectId, 'other-owner-valid', b.command);
    expect(authorized.envelope.projectExecutionBudgetId).toBe(b.budgetId);
    expect(authorized.idempotentReplay).toBe(false);
    expect(f.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('isolates same idempotency key by project and allows independent valid capacities', async () => {
    const f = await chainedFixture();
    const b = seedAlternateChain(f, 'parallel');
    const [aResult, bResult] = await Promise.all([
      f.service.provision(productionProjectId, 'shared-key', f.command),
      b.service.provision(b.projectId, 'shared-key', b.command),
    ]);
    expect(aResult.envelope.projectExecutionBudgetId).toBe(productionBudgetId);
    expect(bResult.envelope.projectExecutionBudgetId).toBe(b.budgetId);
    expect(aResult.auditEventId).not.toBe(bResult.auditEventId);
  });
});
