import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { governedChainedRemediationCapacitySchema } from '@vision-maxson/contracts';
import { GovernedChainedRemediationService } from '../src/editorial/governed-chained-remediation';
import { loadGovernedRemediationEnvelope } from '../src/editorial/governed-budget';

class Statement {
  values: SQLInputValue[] = [];
  constructor(
    private db: DatabaseSync,
    private sql: string,
  ) {}
  bind(...values: SQLInputValue[]) {
    this.values = values;
    return this;
  }
  first<T>() {
    return Promise.resolve((this.db.prepare(this.sql).get(...this.values) as T) ?? null);
  }
  run() {
    return Promise.resolve({
      meta: { changes: Number(this.db.prepare(this.sql).run(...this.values).changes) },
    });
  }
}
class AtomicD1 {
  constructor(
    private db: DatabaseSync,
    private sabotageAudit = false,
  ) {}
  prepare(sql: string) {
    return new Statement(this.db, sql);
  }
  async batch(statements: Statement[]) {
    if (this.sabotageAudit) statements.at(-1)!.values[15] = 'missing-audit';
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.db.exec('COMMIT');
      return results;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}
const migration = (name: string) =>
  readFileSync(new URL('../../../packages/db/migrations/' + name, import.meta.url), 'utf8');
const names = [
  '0000_phase_1_data_security_core.sql',
  '0001_phase_2_product_channel_monetization.sql',
  '0002_phase_3_editorial_intelligence.sql',
  '0003_editorial_execution_budgets.sql',
  '0004_terminal_pipeline_hardening.sql',
  '0005_deterministic_preflight_provenance.sql',
  '0006_storyboard_v2_contract_hardening.sql',
  '0007_governed_remediation_capacity.sql',
  '0008_remediation_evidence_expression_depth.sql',
  '0009_storyboard_continuity_prompt_v3.sql',
  '0010_governed_chained_remediation_v2.sql',
];
const valid = {
  workspaceId: 'workspace_primary',
  parentRemediationId: 'root-remediation',
  historicalRunId: 'child-run',
  remediationStage: 'STORYBOARD_PLANNER',
  providerKey: 'openai',
  modelKey: 'gpt-5.6-terra',
  remediationCeilingMicrousd: 321920,
  maximumCalls: 1,
  remediationProfileKey: 'phase3_storyboard_chained_remediation_v2',
  remediationProfileVersion: 2,
  reasonCategory: 'SCHEMA_VALIDATION_DUPLICATE_CONTINUITY_KEY',
} as const;
function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  for (const name of names) db.exec(migration(name));
  db.exec(`
    INSERT INTO workspaces(id,slug,name,created_at,updated_at) VALUES('workspace_primary','w','W','t','t');
    INSERT INTO users(id,workspace_id,email,status,created_at,updated_at) VALUES('owner','workspace_primary','o@example.test','active','t','t');
    INSERT INTO content_brands(id,workspace_id,name,normalized_name,primary_language,created_at,updated_at,created_by) VALUES('brand','workspace_primary','B','b','de','t','t','owner');
    INSERT INTO channel_profiles(id,workspace_id,content_brand_id,name,normalized_name,primary_language,created_at,updated_at,created_by) VALUES('channel','workspace_primary','brand','C','c','de','t','t','owner');
    INSERT INTO projects(id,workspace_id,content_brand_id,channel_profile_id,title,format,operating_mode,status,primary_language,readiness_status,created_at,updated_at,created_by) VALUES('project','workspace_primary','brand','channel','P','SHORT','ASSISTED','STORYBOARD_REVIEW','de','ready','t','t','owner');
    INSERT INTO ai_providers(id,key,display_name,status,adapter_version,created_at,updated_at) VALUES('provider','openai','OpenAI','configured','1','t','t');
    INSERT INTO ai_provider_models(id,provider_id,model_key,display_name,status,capabilities_json,effective_from,created_at,updated_at) VALUES('model','provider','gpt-5.6-terra','Terra','available','{}','t','t','t');
    INSERT INTO ai_pricing_snapshots(id,provider_model_id,currency,input_unit_price,output_unit_price,unit_name,verification_status,effective_from,created_at) VALUES('pricing','model','USD',1,1,'token','externally_verified','t','t');
    INSERT INTO editorial_project_execution_budgets(id,workspace_id,project_id,profile_key,profile_version,currency,monetary_ceiling_microusd,status,authorized_by,created_at,updated_at,version) VALUES
      ('original-budget','workspace_primary','project','phase3_terminal_graph_v1',1,'USD',1331520,'ACTIVE','owner','t','t',1),
      ('root-budget','workspace_primary','project','phase3_storyboard_remediation_v1',1,'USD',321920,'ACTIVE','owner','t','t',1);
    INSERT INTO editorial_execution_envelopes(id,workspace_id,project_id,profile_key,profile_version,provider_id,provider_model_id,currency,monetary_ceiling_microusd,maximum_calls,status,authorized_by,created_at,updated_at,version,project_execution_budget_id,stage_key) VALUES
      ('original-envelope','workspace_primary','project','phase3_terminal_graph_v1',1,'provider','model','USD',321920,1,'ACTIVE','owner','t','t',2,'original-budget','STORYBOARD_PLANNER'),
      ('root-envelope','workspace_primary','project','phase3_storyboard_remediation_v1',1,'provider','model','USD',321920,1,'ACTIVE','owner','t','t',1,'root-budget','STORYBOARD_PLANNER');
    INSERT INTO intelligence_runs(id,workspace_id,project_id,task_type,provider_id,provider_model_id,initiated_by,operating_mode,status,idempotency_key,error_category,safe_error_detail,created_at,updated_at) VALUES
      ('root-run','workspace_primary','project','STORYBOARD_PLANNER','provider','model','owner','ASSISTED','RUNNING','root-run-key',NULL,NULL,'t','t');
    INSERT INTO intelligence_run_attempts(id,intelligence_run_id,attempt_number,attempt_kind,status,error_category,safe_error_detail,started_at,completed_at) VALUES('root-attempt','root-run',1,'TECHNICAL','FAILED_PERMANENT','SCHEMA_VALIDATION','schema_validation_failed','t','t');
    INSERT INTO editorial_execution_reservations(id,envelope_id,workspace_id,project_id,intelligence_run_id,step_key,pricing_snapshot_id,reserved_microusd,actual_microusd,status,created_at,dispatched_at,reconciled_at,project_execution_budget_id) VALUES('root-reservation','original-envelope','workspace_primary','project','root-run','STORYBOARD_PLANNER','pricing',321920,NULL,'AMBIGUOUS','t','t',NULL,'original-budget');
    UPDATE editorial_execution_envelopes SET status='CONSUMED',version=2 WHERE id='original-envelope';
    INSERT INTO audit_events(id,workspace_id,actor_type,action,resource_type,resource_id,outcome,request_id,environment,metadata_json,occurred_at,ingested_at) VALUES
      ('root-terminal','workspace_primary','system','intelligence.run_failed','intelligence_run','root-run','failure','r','test','{}','t','t'),
      ('root-auth','workspace_primary','user','editorial.remediation_capacity_authorized','editorial_execution_remediation','root-remediation','success','r','test','{}','t','t');
    UPDATE intelligence_runs SET status='FAILED_PERMANENT',error_category='SCHEMA_VALIDATION',safe_error_detail='schema_validation_failed',terminal_audit_event_id='root-terminal' WHERE id='root-run';
    INSERT INTO editorial_execution_remediations(id,workspace_id,project_id,original_project_execution_budget_id,expected_original_budget_version,historical_reservation_id,historical_run_id,historical_envelope_id,remediation_project_execution_budget_id,remediation_envelope_id,profile_key,profile_version,stage_key,provider_id,provider_model_id,additional_exposure_microusd,maximum_calls,maximum_attempts,sdk_max_retries,fallback_enabled,creative_regeneration_enabled,external_research_enabled,human_approval_required,reason_category,idempotency_key,command_hash,audit_event_id,authorized_by,created_at)
      VALUES('root-remediation','workspace_primary','project','original-budget',1,'root-reservation','root-run','original-envelope','root-budget','root-envelope','phase3_storyboard_remediation_v1',1,'STORYBOARD_PLANNER','provider','model',321920,1,1,0,0,0,0,1,'PROVIDER_OUTPUT_SCHEMA_VALIDATION_AMBIGUOUS','root-key','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','root-auth','owner','t');
    INSERT INTO intelligence_runs(id,workspace_id,project_id,task_type,provider_id,provider_model_id,initiated_by,operating_mode,status,idempotency_key,error_category,safe_error_detail,created_at,updated_at) VALUES('child-run','workspace_primary','project','STORYBOARD_PLANNER','provider','model','owner','ASSISTED','RUNNING','child-run-key',NULL,NULL,'t','t');
    INSERT INTO audit_events(id,workspace_id,actor_type,action,resource_type,resource_id,outcome,request_id,environment,metadata_json,occurred_at,ingested_at) VALUES('child-terminal','workspace_primary','system','intelligence.run_failed','intelligence_run','child-run','failure','r2','test','{}','t','t');
    INSERT INTO intelligence_run_attempts(id,intelligence_run_id,attempt_number,attempt_kind,status,error_category,safe_error_detail,started_at,completed_at) VALUES('child-attempt','child-run',1,'TECHNICAL','FAILED_PERMANENT','SCHEMA_VALIDATION','duplicate_continuity_key','t','t');
    UPDATE intelligence_runs SET status='FAILED_PERMANENT',error_category='SCHEMA_VALIDATION',safe_error_detail='duplicate_continuity_key',terminal_audit_event_id='child-terminal' WHERE id='child-run';
    INSERT INTO editorial_execution_reservations(id,envelope_id,workspace_id,project_id,intelligence_run_id,step_key,pricing_snapshot_id,reserved_microusd,actual_microusd,status,created_at,dispatched_at,reconciled_at,project_execution_budget_id) VALUES('child-reservation','root-envelope','workspace_primary','project','child-run','STORYBOARD_PLANNER','pricing',321920,88480,'RECONCILED','t','t','t','root-budget');
    UPDATE editorial_execution_envelopes SET status='CONSUMED',version=2 WHERE id='root-envelope';
  `);
  const service = new GovernedChainedRemediationService(
    new AtomicD1(db) as unknown as D1Database,
    { id: 'owner', workspaceId: 'workspace_primary', roles: ['owner'] },
    { requestId: 'request', environment: 'test', accessIssuer: 'issuer', accessSubject: 'subject' },
  );
  return { db, service };
}
const count = (db: DatabaseSync, table: string) =>
  Number(db.prepare('SELECT COUNT(*) count FROM ' + table).get()!.count);
describe('governed chained remediation v2', () => {
  it('uses an explicit providers-admin endpoint and derives economic IDs server-side', () => {
    const routes = readFileSync(new URL('../src/editorial/routes.ts', import.meta.url), 'utf8');
    expect(routes).toContain(
      "'/admin/projects/:projectId/editorial-chained-remediation-capacities'",
    );
    expect(routes).toContain("requirePermission('providers:admin')");
    expect(Object.keys(valid)).not.toContain('remediationBudgetId');
    expect(Object.keys(valid)).not.toContain('remediationEnvelopeId');
  });
  it('accepts only the exact generation-2 policy contract', () => {
    expect(governedChainedRemediationCapacitySchema.safeParse(valid).success).toBe(true);
    for (const bad of [
      { ...valid, remediationProfileVersion: 1 },
      { ...valid, modelKey: 'gpt-5.6-sol' },
      { ...valid, maximumCalls: 2 },
      { ...valid, reasonCategory: 'OTHER' },
    ])
      expect(governedChainedRemediationCapacitySchema.safeParse(bad).success).toBe(false);
  });
  it('creates exactly one atomic generation-2 capacity and preserves history', async () => {
    const { db, service } = fixture();
    const history = [
      'intelligence_runs',
      'intelligence_run_attempts',
      'editorial_execution_reservations',
    ].map((t) => db.prepare('SELECT * FROM ' + t + ' ORDER BY id').all());
    const created = await service.authorize('project', 'child-key', valid);
    expect(created).toMatchObject({ generation: 2, idempotent: false });
    await expect(
      loadGovernedRemediationEnvelope(
        new AtomicD1(db) as unknown as D1Database,
        { id: 'owner', workspaceId: 'workspace_primary', roles: ['owner'] },
        'project',
        'STORYBOARD_PLANNER',
        { providerKey: 'openai', modelKey: 'gpt-5.6-terra' },
        created.remediationId,
      ),
    ).resolves.toMatchObject({
      id: created.envelopeId,
      projectExecutionBudgetId: created.budgetId,
      maximumCalls: 1,
      status: 'ACTIVE',
    });
    expect([
      count(db, 'editorial_chained_execution_remediations'),
      count(db, 'editorial_project_execution_budgets'),
      count(db, 'editorial_execution_envelopes'),
    ]).toEqual([1, 3, 3]);
    expect(
      ['intelligence_runs', 'intelligence_run_attempts', 'editorial_execution_reservations'].map(
        (t) => db.prepare('SELECT * FROM ' + t + ' ORDER BY id').all(),
      ),
    ).toEqual(history);
    const row = db
      .prepare(
        'SELECT parent_remediation_id,remediation_generation,failure_category,diagnostic_category,maximum_calls,maximum_attempts,sdk_max_retries FROM editorial_chained_execution_remediations',
      )
      .get();
    expect(row).toEqual({
      parent_remediation_id: 'root-remediation',
      remediation_generation: 2,
      failure_category: 'SCHEMA_VALIDATION',
      diagnostic_category: 'duplicate_continuity_key',
      maximum_calls: 1,
      maximum_attempts: 1,
      sdk_max_retries: 0,
    });
    expect(await service.authorize('project', 'child-key', valid)).toEqual({
      ...created,
      idempotent: true,
    });
    await expect(
      service.authorize('project', 'child-key', { ...valid, historicalRunId: 'other' }),
    ).rejects.toThrow('chained_remediation_idempotency_conflict');
    expect(count(db, 'editorial_chained_execution_remediations')).toBe(1);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
  it.each([
    [
      'allowlisted failure',
      "UPDATE intelligence_runs SET error_category='TIMEOUT' WHERE id='child-run'",
    ],
    [
      'allowlisted diagnostic',
      "UPDATE intelligence_runs SET safe_error_detail='other' WHERE id='child-run'",
    ],
  ])('fails closed without writes when %s is invalid', async (_label, sql) => {
    const { db, service } = fixture();
    db.exec(sql);
    const before = [
      count(db, 'editorial_project_execution_budgets'),
      count(db, 'editorial_execution_envelopes'),
      count(db, 'audit_events'),
    ];
    await expect(service.authorize('project', 'child-key', valid)).rejects.toThrow();
    expect([
      count(db, 'editorial_project_execution_budgets'),
      count(db, 'editorial_execution_envelopes'),
      count(db, 'audit_events'),
    ]).toEqual(before);
  });
  it.each([
    ['unknown parent', { ...valid, parentRemediationId: 'missing' }],
    ['unknown run', { ...valid, historicalRunId: 'missing' }],
    ['workspace mismatch', { ...valid, workspaceId: 'other' }],
    ['provider mismatch', { ...valid, providerKey: 'other' }],
    ['model mismatch', { ...valid, modelKey: 'other' }],
  ])('rejects %s before persistence', async (_label, command) => {
    const { db, service } = fixture();
    const before = count(db, 'audit_events');
    await expect(
      service.authorize('project', 'invalid-key', command as typeof valid),
    ).rejects.toThrow();
    expect(count(db, 'audit_events')).toBe(before);
  });
  it('enforces reconciled known-cost, consumed single-call, no-output and exact lineage in code and D1', () => {
    const source = readFileSync(
      new URL('../src/editorial/governed-chained-remediation.ts', import.meta.url),
      'utf8',
    );
    const sql = migration('0010_governed_chained_remediation_v2.sql');
    for (const token of [
      "r.status='RECONCILED'",
      'r.actual_microusd IS NOT NULL',
      'r.actual_microusd>=0',
      "pe.status='CONSUMED'",
      'pe.maximum_calls=1',
      'COUNT(*) FROM editorial_execution_reservations',
      "run.status='FAILED_PERMANENT'",
      "run.error_category='SCHEMA_VALIDATION'",
      "run.safe_error_detail='duplicate_continuity_key'",
      "a.artifact_type='STORYBOARD'",
    ])
      expect(source).toContain(token);
    for (const token of [
      "r.status='RECONCILED'",
      'r.actual_microusd IS NOT NULL',
      "e.status='CONSUMED'",
      'e.maximum_calls=1',
      'chained_remediation_no_output_guard',
    ])
      expect(sql).toContain(token);
  });
  it('rolls back audit, budget, envelope, and child when the atomic linkage fails', async () => {
    const { db } = fixture();
    const service = new GovernedChainedRemediationService(
      new AtomicD1(db, true) as unknown as D1Database,
      { id: 'owner', workspaceId: 'workspace_primary', roles: ['owner'] },
      {
        requestId: 'request',
        environment: 'test',
        accessIssuer: 'issuer',
        accessSubject: 'subject',
      },
    );
    const before = [
      count(db, 'audit_events'),
      count(db, 'editorial_project_execution_budgets'),
      count(db, 'editorial_execution_envelopes'),
    ];
    await expect(service.authorize('project', 'atomic-failure', valid)).rejects.toThrow();
    expect([
      count(db, 'audit_events'),
      count(db, 'editorial_project_execution_budgets'),
      count(db, 'editorial_execution_envelopes'),
    ]).toEqual(before);
    expect(count(db, 'editorial_chained_execution_remediations')).toBe(0);
  });
  it('database uniqueness prevents generation 3 and duplicate children by design', () => {
    const sql = migration('0010_governed_chained_remediation_v2.sql');
    expect(sql).toContain(
      'parent_remediation_id TEXT NOT NULL UNIQUE REFERENCES editorial_execution_remediations',
    );
    expect(sql).toContain(
      'remediation_generation INTEGER NOT NULL CHECK(remediation_generation=2)',
    );
    expect(sql).not.toContain('REFERENCES editorial_chained_execution_remediations(id)');
  });
});
