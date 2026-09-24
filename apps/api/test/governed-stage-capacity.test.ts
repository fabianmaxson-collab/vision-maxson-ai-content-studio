import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { governedStageCapacitySchema } from '@vision-maxson/contracts';
import { loadGovernedTerminalEnvelope } from '../src/editorial/governed-budget';
import {
  GovernedStageCapacityError,
  GovernedStageCapacityService,
  governedStageCapacityExposureSql,
} from '../src/editorial/governed-stage-capacity';

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
  first<T>() {
    return Promise.resolve((this.database.prepare(this.sql).get(...this.values) as T) ?? null);
  }
  all<T>() {
    return Promise.resolve({ results: this.database.prepare(this.sql).all(...this.values) as T[] });
  }
  run() {
    return Promise.resolve({
      meta: { changes: Number(this.database.prepare(this.sql).run(...this.values).changes) },
    });
  }
}
class AtomicD1 {
  private queue: Promise<unknown> = Promise.resolve();
  beforeBatch: (() => void) | undefined;
  constructor(readonly database: DatabaseSync) {}
  prepare(sql: string) {
    return new Statement(this.database, sql);
  }
  batch(statements: Statement[]) {
    const execute = async () => {
      const beforeBatch = this.beforeBatch;
      this.beforeBatch = undefined;
      beforeBatch?.();
      this.database.exec('BEGIN IMMEDIATE');
      try {
        for (const statement of statements) await statement.run();
        this.database.exec('COMMIT');
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
const actor = { id: 'owner', workspaceId: 'workspace', roles: ['owner' as const] };
const context = {
  requestId: 'request',
  environment: 'staging',
  accessIssuer: 'issuer',
  accessSubject: 'subject',
};
const command = {
  budgetId: 'successor',
  expectedBudgetVersion: 1,
  stageKey: 'STORYBOARD_PLANNER',
  reason: 'OPEN_REVISION_STORYBOARD_REPLACEMENT',
} as const;
function count(database: DatabaseSync, table: string) {
  return Number(database.prepare(`SELECT COUNT(*) n FROM ${table}`).get()!.n);
}
function fixture(ceiling = 907875) {
  const database = new DatabaseSync(':memory:');
  for (const migration of migrations)
    database.exec(readFileSync(new URL(migration, migrationDirectory), 'utf8'));
  database.exec(`
    INSERT INTO workspaces(id,slug,name,created_at,updated_at) VALUES('workspace','workspace','W','t','t');
    INSERT INTO users(id,workspace_id,email,status,created_at,updated_at) VALUES('owner','workspace','owner@example.test','active','t','t');
    INSERT INTO user_roles(workspace_id,user_id,role_id,created_at) SELECT 'workspace','owner',id,'t' FROM roles WHERE key='owner';
    INSERT INTO content_brands(id,workspace_id,name,normalized_name,primary_language,created_at,updated_at,created_by) VALUES('brand','workspace','Brand','brand','de','t','t','owner');
    INSERT INTO channel_profiles(id,workspace_id,content_brand_id,name,normalized_name,primary_language,created_at,updated_at,created_by) VALUES('channel','workspace','brand','Channel','channel','de','t','t','owner');
    INSERT INTO projects(id,workspace_id,content_brand_id,channel_profile_id,title,format,operating_mode,status,primary_language,readiness_status,created_at,updated_at,created_by) VALUES('project','workspace','brand','channel','Project','SHORT','ASSISTED','ANALYZING','de','ready','t','t','owner');
    INSERT INTO ai_providers(id,key,display_name,status,adapter_version,created_at,updated_at,version) VALUES('provider','openai','OpenAI','configured','1','t','t',1);
    INSERT INTO ai_provider_models(id,provider_id,model_key,display_name,status,capabilities_json,effective_from,created_at,updated_at,version) VALUES('terra','provider','gpt-5.6-terra','Terra','available','{"capabilities":["STRUCTURED_OUTPUT","STORYBOARD_PLANNING"],"qualityTier":"BALANCED","costRank":2}','2026-01-01','t','t',2);
    INSERT INTO ai_pricing_snapshots(id,provider_model_id,currency,input_unit_price,output_unit_price,unit_name,verification_status,effective_from,created_at) VALUES('pricing','terra','USD',0.000002,0.000012,'token','externally_verified','2026-01-01','t');
    INSERT INTO editorial_project_execution_budgets(id,workspace_id,project_id,profile_key,profile_version,currency,monetary_ceiling_microusd,status,authorized_by,created_at,updated_at,version) VALUES('old','workspace','project','phase3_terminal_graph_v1',1,'USD',1331520,'ACTIVE','owner','t','t',1);
    INSERT INTO editorial_execution_envelopes(id,workspace_id,project_id,profile_key,profile_version,provider_id,provider_model_id,currency,monetary_ceiling_microusd,maximum_calls,status,authorized_by,created_at,updated_at,version,project_execution_budget_id,stage_key) VALUES('old-storyboard','workspace','project','phase3_terminal_graph_v1',1,'provider','terra','USD',321920,1,'ACTIVE','owner','t','t',1,'old','STORYBOARD_PLANNER');
    INSERT INTO intelligence_runs(id,workspace_id,project_id,task_type,provider_id,provider_model_id,initiated_by,operating_mode,status,idempotency_key,created_at,updated_at) VALUES('old-run','workspace','project','STORYBOARD_PLANNER','provider','terra','owner','ASSISTED','RUNNING','old-key','t','t');
    INSERT INTO editorial_execution_reservations(id,envelope_id,workspace_id,project_id,intelligence_run_id,step_key,pricing_snapshot_id,reserved_microusd,status,created_at,project_execution_budget_id) VALUES('old-ambiguous','old-storyboard','workspace','project','old-run','STORYBOARD_PLANNER','pricing',321920,'AMBIGUOUS','t','old');
    UPDATE editorial_execution_envelopes SET status='CONSUMED',version=2 WHERE id='old-storyboard';
    UPDATE editorial_project_execution_budgets SET status='CONSUMED',version=2 WHERE id='old';
    INSERT INTO editorial_project_execution_budgets(id,workspace_id,project_id,profile_key,profile_version,currency,monetary_ceiling_microusd,status,authorized_by,created_at,updated_at,version) VALUES('successor','workspace','project','phase3_terminal_graph_v1',1,'USD',${ceiling},'ACTIVE','owner','t','t',1);
    INSERT INTO editorial_execution_envelopes(id,workspace_id,project_id,profile_key,profile_version,provider_id,provider_model_id,currency,monetary_ceiling_microusd,maximum_calls,status,authorized_by,created_at,updated_at,version,project_execution_budget_id,stage_key) VALUES('critic-1','workspace','project','phase3_terminal_graph_v1',1,'provider','terra','USD',403840,1,'ACTIVE','owner','t','t',1,'successor','SCRIPT_CRITIC');
    INSERT INTO intelligence_runs(id,workspace_id,project_id,task_type,provider_id,provider_model_id,initiated_by,operating_mode,status,idempotency_key,created_at,updated_at) VALUES('critic-run-1','workspace','project','SCRIPT_CRITIC','provider','terra','owner','ASSISTED','RUNNING','critic-key-1','t','t');
    INSERT INTO editorial_execution_reservations(id,envelope_id,workspace_id,project_id,intelligence_run_id,step_key,pricing_snapshot_id,reserved_microusd,actual_microusd,status,created_at,project_execution_budget_id) VALUES('critic-reservation-1','critic-1','workspace','project','critic-run-1','SCRIPT_CRITIC','pricing',403840,53004,'RECONCILED','t','successor');
    UPDATE editorial_execution_envelopes SET status='CONSUMED',version=2 WHERE id='critic-1';
    INSERT INTO editorial_execution_envelopes(id,workspace_id,project_id,profile_key,profile_version,provider_id,provider_model_id,currency,monetary_ceiling_microusd,maximum_calls,status,authorized_by,created_at,updated_at,version,project_execution_budget_id,stage_key) VALUES('critic-2','workspace','project','phase3_terminal_graph_v1',1,'provider','terra','USD',403840,1,'ACTIVE','owner','t','t',1,'successor','SCRIPT_CRITIC');
    INSERT INTO intelligence_runs(id,workspace_id,project_id,task_type,provider_id,provider_model_id,initiated_by,operating_mode,status,idempotency_key,created_at,updated_at) VALUES('critic-run-2','workspace','project','SCRIPT_CRITIC','provider','terra','owner','ASSISTED','RUNNING','critic-key-2','t','t');
    INSERT INTO editorial_execution_reservations(id,envelope_id,workspace_id,project_id,intelligence_run_id,step_key,pricing_snapshot_id,reserved_microusd,actual_microusd,status,created_at,project_execution_budget_id) VALUES('critic-reservation-2','critic-2','workspace','project','critic-run-2','SCRIPT_CRITIC','pricing',403840,100572,'RECONCILED','t','successor');
    UPDATE editorial_execution_envelopes SET status='CONSUMED',version=2 WHERE id='critic-2';
  `);
  const db = new AtomicD1(database);
  const service = new GovernedStageCapacityService(db as unknown as D1Database, actor, context);
  return { database, db, service };
}
function available(database: DatabaseSync) {
  return Number(
    database
      .prepare(
        `SELECT monetary_ceiling_microusd-(${governedStageCapacityExposureSql('b')}) AS available FROM editorial_project_execution_budgets b WHERE id='successor'`,
      )
      .get()!.available,
  );
}
function before(database: DatabaseSync) {
  return [
    'editorial_execution_envelopes',
    'audit_events',
    'intelligence_runs',
    'intelligence_run_attempts',
    'editorial_execution_reservations',
    'editorial_artifact_versions',
    'artifact_approvals',
    'editorial_revision_request_resolutions',
  ].map((table) => count(database, table));
}
describe('governed one-call stage capacity', () => {
  it('strictly rejects caller-controlled economics and unsupported policy', () => {
    expect(
      governedStageCapacitySchema.safeParse({ ...command, monetaryCeilingMicrousd: 999999 })
        .success,
    ).toBe(false);
    expect(
      governedStageCapacitySchema.safeParse({ ...command, providerKey: 'other' }).success,
    ).toBe(false);
    expect(governedStageCapacitySchema.safeParse({ ...command, modelKey: 'other' }).success).toBe(
      false,
    );
    expect(governedStageCapacitySchema.safeParse({ ...command, pricingId: 'other' }).success).toBe(
      false,
    );
    // Schema boundary: only STORYBOARD_PLANNER is the declared contract capability.
    expect(governedStageCapacitySchema.safeParse({ ...command, stageKey: 'OTHER' }).success).toBe(
      false,
    );
    expect(
      governedStageCapacitySchema.safeParse({ ...command, stageKey: 'TOPIC_RESEARCH' }).success,
    ).toBe(false);
    expect(
      governedStageCapacitySchema.safeParse({ ...command, stageKey: 'IDEA_GENERATION' }).success,
    ).toBe(false);
    expect(
      governedStageCapacitySchema.safeParse({ ...command, stageKey: 'CONTENT_BRIEF' }).success,
    ).toBe(false);
    expect(
      governedStageCapacitySchema.safeParse({ ...command, stageKey: 'SCRIPT_CRITIC' }).success,
    ).toBe(false);
    // STORYBOARD_PLANNER is the one accepted stage.
    expect(governedStageCapacitySchema.safeParse(command).success).toBe(true);
  });
  it('rejects unsupported stages at schema boundary and service allowlist independently', async () => {
    // Schema rejects all non-STORYBOARD_PLANNER stages before the service is reached.
    for (const stageKey of [
      'TOPIC_RESEARCH',
      'IDEA_GENERATION',
      'CONTENT_BRIEF',
      'SCRIPT_CRITIC',
    ] as const) {
      expect(
        governedStageCapacitySchema.safeParse({ ...command, stageKey }).success,
        `schema must reject stageKey=${stageKey}`,
      ).toBe(false);
    }
    // Service-layer allowlist provides defense-in-depth: it independently rejects an
    // unsupported stage even when bypassing schema validation (e.g. cast via `as`).
    const { database, service } = fixture();
    const snapshot = before(database);
    await expect(
      service.provision('project', 'service-allowlist-guard', {
        ...command,
        stageKey: 'IDEA_GENERATION' as unknown as 'STORYBOARD_PLANNER',
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect(before(database)).toEqual(snapshot);
  });
  it('provisions exactly one envelope and audit, with canonical accounting and no execution', async () => {
    const { database, service } = fixture();
    expect(available(database)).toBe(754299);
    const original = before(database);
    const created = await service.provision('project', 'capacity-key', command);
    expect(created.envelope).toMatchObject({
      stageKey: 'STORYBOARD_PLANNER',
      status: 'ACTIVE',
      maximumCalls: 1,
      usedCalls: 0,
      monetaryCeilingMicroUsd: 321920,
    });
    expect(available(database)).toBe(432379);
    const after = before(database);
    expect(after.map((n, index) => n - original[index]!)).toEqual([1, 1, 0, 0, 0, 0, 0, 0]);
    expect(
      database
        .prepare(
          "SELECT status,reserved_microusd,actual_microusd,project_execution_budget_id FROM editorial_execution_reservations WHERE id='old-ambiguous'",
        )
        .get(),
    ).toMatchObject({
      status: 'AMBIGUOUS',
      reserved_microusd: 321920,
      actual_microusd: null,
      project_execution_budget_id: 'old',
    });
    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    const replay = await service.provision('project', 'capacity-key', command);
    expect(replay.envelope.id).toBe(created.envelope.id);
    expect(replay.idempotentReplay).toBe(true);
    expect(before(database)).toEqual(after);
  });
  it('fails closed with insufficient headroom', async () => {
    const { database, service } = fixture(460000);
    const snapshot = before(database);
    await expect(service.provision('project', 'low', command)).rejects.toMatchObject({
      status: 409,
    });
    expect(before(database)).toEqual(snapshot);
  });
  it('rejects a second active stage envelope and a changed command under the same key', async () => {
    const { database, service } = fixture();
    await service.provision('project', 'one', command);
    await expect(service.provision('project', 'two', command)).rejects.toMatchObject({
      status: 409,
    });
    await expect(
      service.provision('project', 'one', { ...command, expectedBudgetVersion: 2 }),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      Number(
        database
          .prepare(
            "SELECT COUNT(*) n FROM editorial_execution_envelopes WHERE stage_key='STORYBOARD_PLANNER' AND status='ACTIVE'",
          )
          .get()!.n,
      ),
    ).toBe(1);
  });
  it('serializes concurrent requests to one active envelope', async () => {
    const { database, service } = fixture();
    const outcomes = await Promise.allSettled([
      service.provision('project', 'parallel-a', command),
      service.provision('project', 'parallel-b', command),
    ]);
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(
      Number(
        database
          .prepare(
            "SELECT COUNT(*) n FROM editorial_execution_envelopes WHERE stage_key='STORYBOARD_PLANNER' AND status='ACTIVE'",
          )
          .get()!.n,
      ),
    ).toBe(1);
    expect(available(database)).toBe(432379);
  });
  it('is selected by the real Storyboard execution envelope loader without provider execution', async () => {
    const { database, db, service } = fixture();
    const created = await service.provision('project', 'claim-compatible', command);
    const selected = await loadGovernedTerminalEnvelope(
      db as unknown as D1Database,
      actor,
      'project',
      'STORYBOARD_PLANNER',
      { providerKey: 'openai', modelKey: 'gpt-5.6-terra' },
    );
    expect(selected).toMatchObject({
      id: created.envelope.id,
      projectExecutionBudgetId: command.budgetId,
      monetaryCeilingMicrousd: 321920,
      maximumCalls: 1,
      status: 'ACTIVE',
    });
    expect(count(database, 'editorial_execution_reservations')).toBe(3);
    expect(count(database, 'intelligence_run_attempts')).toBe(0);
  });
  it('rechecks headroom atomically when another stage claims exposure after the pre-read', async () => {
    const { database, db, service } = fixture();
    db.beforeBatch = () =>
      database.exec(`
      INSERT INTO editorial_execution_envelopes(id,workspace_id,project_id,profile_key,profile_version,provider_id,provider_model_id,currency,monetary_ceiling_microusd,maximum_calls,status,authorized_by,created_at,updated_at,version,project_execution_budget_id,stage_key)
      VALUES('concurrent-brief','workspace','project','phase3_terminal_graph_v1',1,'provider','terra','USD',600000,1,'ACTIVE','owner','t','t',1,'successor','CONTENT_BRIEF');
    `);
    await expect(service.provision('project', 'headroom-race', command)).rejects.toMatchObject({
      status: 409,
    });
    expect(available(database)).toBe(154299);
    expect(
      Number(
        database
          .prepare(
            "SELECT COUNT(*) n FROM editorial_execution_envelopes WHERE project_execution_budget_id='successor' AND stage_key='STORYBOARD_PLANNER'",
          )
          .get()!.n,
      ),
    ).toBe(0);
    expect(count(database, 'audit_events')).toBe(0);
    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
  it('rejects unsupported governed stages and cross-workspace access without mutation', async () => {
    const { database, service } = fixture();
    const snapshot = before(database);
    await expect(
      service.provision('project', 'unsupported', {
        ...command,
        stageKey: 'IDEA_GENERATION' as unknown as 'STORYBOARD_PLANNER',
      }),
    ).rejects.toMatchObject({ status: 422 });
    const otherWorkspace = new GovernedStageCapacityService(
      new AtomicD1(database) as unknown as D1Database,
      { ...actor, workspaceId: 'other-workspace' },
      context,
    );
    await expect(
      otherWorkspace.provision('project', 'cross-workspace', command),
    ).rejects.toMatchObject({ status: 409 });
    expect(before(database)).toEqual(snapshot);
  });
  it('fails closed if model availability or current pricing changes', async () => {
    const model = fixture();
    model.database.exec(
      "UPDATE ai_provider_models SET status='inactive',version=3 WHERE id='terra'",
    );
    const beforeModel = before(model.database);
    await expect(
      model.service.provision('project', 'inactive-model', command),
    ).rejects.toMatchObject({ status: 409 });
    expect(before(model.database)).toEqual(beforeModel);
    const pricing = fixture();
    pricing.database.exec(
      "UPDATE ai_pricing_snapshots SET effective_to='2026-02-01' WHERE id='pricing'",
    );
    const beforePricing = before(pricing.database);
    await expect(
      pricing.service.provision('project', 'expired-pricing', command),
    ).rejects.toMatchObject({ status: 409 });
    expect(before(pricing.database)).toEqual(beforePricing);
  });
  it('rejects unauthorized, wrong project, and consumed budget without mutation', async () => {
    const { database, service } = fixture();
    const snapshot = before(database);
    const forbidden = new GovernedStageCapacityService(
      {} as D1Database,
      { ...actor, roles: [] },
      context,
    );
    await expect(forbidden.provision('project', 'forbidden', command)).rejects.toBeInstanceOf(
      GovernedStageCapacityError,
    );
    await expect(service.provision('other-project', 'scope', command)).rejects.toMatchObject({
      status: 409,
    });
    await expect(
      service.provision('project', 'old', {
        ...command,
        budgetId: 'old',
        expectedBudgetVersion: 2,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(before(database)).toEqual(snapshot);
  });
});
