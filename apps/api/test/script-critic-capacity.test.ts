import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { Bindings } from '../src/app';
import { editorialRoutes } from '../src/editorial/routes';
import { scriptCriticCapacitySchema } from '@vision-maxson/contracts';
import {
  SCRIPT_CRITIC_CAPACITY_CEILING_MICROUSD,
  SCRIPT_CRITIC_CAPACITY_OPERATION,
  ScriptCriticCapacityError,
  ScriptCriticCapacityService,
  type ScriptCriticCapacityPolicy,
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

const policy: ScriptCriticCapacityPolicy = {
  workspaceId: 'workspace',
  projectId: 'project',
  successorBudgetId: 'budget-successor',
  historicalEnvelopeId: 'historical-critic',
};
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
  const service = new ScriptCriticCapacityService(
    d1 as unknown as D1Database,
    owner,
    context,
    policy,
  );
  return { database, d1, service };
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
      'budget ceiling drift',
      "UPDATE editorial_project_execution_budgets SET monetary_ceiling_microusd=907874 WHERE id='budget-successor'",
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
      policy,
    );
    await expect(viewer.provision('project', 'viewer', command)).rejects.toMatchObject({
      status: 403,
    });
    const wrongProject = new ScriptCriticCapacityService(
      d1 as unknown as D1Database,
      owner,
      context,
      { ...policy, projectId: 'project-b' },
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
