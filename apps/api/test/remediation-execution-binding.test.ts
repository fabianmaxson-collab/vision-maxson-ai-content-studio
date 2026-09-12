import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { intelligenceCommandSchema } from '@vision-maxson/contracts';
import type { EditorialActor } from '../src/editorial/repository';
import {
  loadGovernedRemediationEnvelope,
  loadGovernedTerminalEnvelope,
} from '../src/editorial/governed-budget';

class Statement {
  private values: SQLInputValue[] = [];
  constructor(
    private readonly database: DatabaseSync,
    private readonly sql: string,
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
class MemoryD1 {
  constructor(readonly database: DatabaseSync) {}
  prepare(sql: string) {
    return new Statement(this.database, sql);
  }
}
const actor: EditorialActor = { id: 'owner', workspaceId: 'workspace', roles: ['owner'] };
const selected = { providerKey: 'openai', modelKey: 'gpt-5.6-terra' };

function fixture() {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE editorial_project_execution_budgets(id TEXT PRIMARY KEY,workspace_id TEXT,project_id TEXT,profile_key TEXT,profile_version INTEGER,currency TEXT,monetary_ceiling_microusd INTEGER,status TEXT,version INTEGER);
    CREATE TABLE editorial_execution_envelopes(id TEXT PRIMARY KEY,workspace_id TEXT,project_id TEXT,profile_key TEXT,profile_version INTEGER,provider_id TEXT,provider_model_id TEXT,currency TEXT,monetary_ceiling_microusd INTEGER,maximum_calls INTEGER,status TEXT,project_execution_budget_id TEXT,stage_key TEXT);
    CREATE TABLE ai_providers(id TEXT PRIMARY KEY,key TEXT,status TEXT);
    CREATE TABLE ai_provider_models(id TEXT PRIMARY KEY,provider_id TEXT,model_key TEXT,status TEXT);
    CREATE TABLE audit_events(id TEXT PRIMARY KEY,workspace_id TEXT,action TEXT,resource_type TEXT,resource_id TEXT,outcome TEXT);
    CREATE TABLE intelligence_runs(id TEXT PRIMARY KEY,workspace_id TEXT,project_id TEXT,task_type TEXT,status TEXT,error_category TEXT,terminal_audit_event_id TEXT);
    CREATE TABLE editorial_execution_reservations(id TEXT PRIMARY KEY,envelope_id TEXT,workspace_id TEXT,project_id TEXT,project_execution_budget_id TEXT,intelligence_run_id TEXT,status TEXT,actual_microusd INTEGER,dispatched_at TEXT);
    CREATE TABLE editorial_execution_remediations(id TEXT PRIMARY KEY,workspace_id TEXT,project_id TEXT,original_project_execution_budget_id TEXT,historical_reservation_id TEXT,historical_run_id TEXT,historical_envelope_id TEXT,expected_original_budget_version INTEGER,remediation_project_execution_budget_id TEXT,remediation_envelope_id TEXT,profile_key TEXT,profile_version INTEGER,stage_key TEXT,provider_id TEXT,provider_model_id TEXT,additional_exposure_microusd INTEGER,maximum_calls INTEGER,maximum_attempts INTEGER,sdk_max_retries INTEGER,fallback_enabled INTEGER,creative_regeneration_enabled INTEGER,external_research_enabled INTEGER,human_approval_required INTEGER,reason_category TEXT,audit_event_id TEXT);
    INSERT INTO ai_providers VALUES('provider','openai','configured');
    INSERT INTO ai_provider_models VALUES('model','provider','gpt-5.6-terra','available');
    INSERT INTO editorial_project_execution_budgets VALUES('old-budget','workspace','project','phase3_terminal_graph_v1',1,'USD',1000000,'ACTIVE',1);
    INSERT INTO editorial_project_execution_budgets VALUES('remediation-budget','workspace','project','phase3_storyboard_remediation_v1',1,'USD',321920,'ACTIVE',1);
    INSERT INTO editorial_project_execution_budgets VALUES('generic-budget','workspace','project','other_profile',1,'USD',321920,'ACTIVE',1);
    INSERT INTO editorial_execution_envelopes VALUES('old-envelope','workspace','project','phase3_terminal_graph_v1',1,'provider','model','USD',321920,1,'CONSUMED','old-budget','STORYBOARD_PLANNER');
    INSERT INTO editorial_execution_envelopes VALUES('generic-envelope','workspace','project','other_profile',1,'provider','model','USD',321920,1,'ACTIVE','generic-budget','STORYBOARD_PLANNER');
    INSERT INTO editorial_execution_envelopes VALUES('remediation-envelope','workspace','project','phase3_storyboard_remediation_v1',1,'provider','model','USD',321920,1,'ACTIVE','remediation-budget','STORYBOARD_PLANNER');
    INSERT INTO intelligence_runs VALUES('old-run','workspace','project','STORYBOARD_PLANNER','FAILED_PERMANENT','SCHEMA_VALIDATION','terminal-audit');
    INSERT INTO editorial_execution_reservations VALUES('old-reservation','old-envelope','workspace','project','old-budget','old-run','AMBIGUOUS',NULL,'t');
    INSERT INTO audit_events VALUES('terminal-audit','workspace','intelligence.run_failed','intelligence_run','old-run','failure');
    INSERT INTO audit_events VALUES('authorization-audit','workspace','editorial.remediation_capacity_authorized','editorial_execution_remediation','remediation','success');
    INSERT INTO editorial_execution_remediations VALUES('remediation','workspace','project','old-budget','old-reservation','old-run','old-envelope',1,'remediation-budget','remediation-envelope','phase3_storyboard_remediation_v1',1,'STORYBOARD_PLANNER','provider','model',321920,1,1,0,0,0,0,1,'PROVIDER_OUTPUT_SCHEMA_VALIDATION_AMBIGUOUS','authorization-audit');
  `);
  return { database, d1: new MemoryD1(database) as unknown as D1Database };
}

async function resolve(
  d1: D1Database,
  overrides: {
    projectId?: string;
    stage?: 'STORYBOARD_PLANNER' | 'SCRIPT_CRITIC';
    providerKey?: string;
    modelKey?: string;
    remediationId?: string;
  } = {},
) {
  return loadGovernedRemediationEnvelope(
    d1,
    actor,
    overrides.projectId ?? 'project',
    overrides.stage ?? 'STORYBOARD_PLANNER',
    {
      providerKey: overrides.providerKey ?? 'openai',
      modelKey: overrides.modelKey ?? 'gpt-5.6-terra',
    },
    overrides.remediationId ?? 'remediation',
  );
}

describe('explicit remediation execution binding', () => {
  it('accepts remediationId in the strict command contract', () => {
    expect(intelligenceCommandSchema.parse({ remediationId: 'remediation' }).remediationId).toBe(
      'remediation',
    );
  });

  it('resolves the remediation-linked budget and envelope even when another active envelope matches', async () => {
    const { d1 } = fixture();
    await expect(resolve(d1)).resolves.toMatchObject({
      id: 'remediation-envelope',
      projectExecutionBudgetId: 'remediation-budget',
      maximumCalls: 1,
      status: 'ACTIVE',
    });
    await expect(
      loadGovernedTerminalEnvelope(d1, actor, 'project', 'STORYBOARD_PLANNER', selected),
    ).rejects.toThrow('An active governed stage envelope is required.');
  });

  it.each([
    ['unknown remediation', undefined, { remediationId: 'missing' }],
    ['wrong project', undefined, { projectId: 'other-project' }],
    ['wrong workspace', "UPDATE editorial_execution_remediations SET workspace_id='other'", {}],
    ['wrong stage', undefined, { stage: 'SCRIPT_CRITIC' as const }],
    ['wrong provider', undefined, { providerKey: 'other' }],
    ['wrong model', undefined, { modelKey: 'other' }],
    [
      'inactive budget',
      "UPDATE editorial_project_execution_budgets SET status='CONSUMED' WHERE id='remediation-budget'",
      {},
    ],
    [
      'inactive envelope',
      "UPDATE editorial_execution_envelopes SET status='CONSUMED' WHERE id='remediation-envelope'",
      {},
    ],
    [
      'wrong envelope budget',
      "UPDATE editorial_execution_envelopes SET project_execution_budget_id='generic-budget' WHERE id='remediation-envelope'",
      {},
    ],
    [
      'consumed call',
      "INSERT INTO editorial_execution_reservations VALUES('used','remediation-envelope','workspace','project','remediation-budget','old-run','RECONCILED',1,'t')",
      {},
    ],
    [
      'invalid historical linkage',
      "UPDATE editorial_execution_reservations SET status='RECONCILED' WHERE id='old-reservation'",
      {},
    ],
    [
      'invalid authorization audit',
      "UPDATE audit_events SET outcome='failure' WHERE id='authorization-audit'",
      {},
    ],
  ])('fails closed for %s', async (_label, mutation, overrides) => {
    const { database, d1 } = fixture();
    if (mutation) database.exec(mutation);
    const before = Number(
      database.prepare('SELECT COUNT(*) count FROM editorial_execution_reservations').get()!.count,
    );
    await expect(resolve(d1, overrides)).rejects.toThrow(
      'Remediation execution binding is invalid.',
    );
    expect(
      Number(
        database.prepare('SELECT COUNT(*) count FROM editorial_execution_reservations').get()!
          .count,
      ),
    ).toBe(before);
  });

  it('keeps remediation identity in command hashing and resolves before reservation or dispatch', () => {
    const execution = readFileSync(
      new URL('../src/editorial/execution.ts', import.meta.url),
      'utf8',
    );
    const hash = execution.indexOf('digest({ projectId, task, command })');
    const resolver = execution.indexOf('loadGovernedRemediationEnvelope(');
    const reservation = execution.indexOf('reservationStatement(this.db');
    const run = execution.indexOf('const insertRun');
    const adapter = execution.indexOf('new OpenAIResponsesAdapter');
    expect(hash).toBeGreaterThan(0);
    expect(resolver).toBeGreaterThan(hash);
    expect(resolver).toBeLessThan(run);
    expect(resolver).toBeLessThan(reservation);
    expect(reservation).toBeLessThan(adapter);
    expect(execution).toContain("command.remediationId && task !== 'STORYBOARD_PLANNER'");
    expect(execution.indexOf('command.creativeRegeneration)')).toBeLessThan(resolver);
    expect(execution).toMatch(/command\.remediationId\s*\?/u);
  });
});
