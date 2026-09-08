import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { governedRemediationCapacitySchema } from '@vision-maxson/contracts';
import { GovernedRemediationService } from '../src/editorial/governed-remediation';
const service = readFileSync(
  new URL('../src/editorial/governed-remediation.ts', import.meta.url),
  'utf8',
);
const routes = readFileSync(new URL('../src/editorial/routes.ts', import.meta.url), 'utf8');
const migration = readFileSync(
  new URL(
    '../../../packages/db/migrations/0007_governed_remediation_capacity.sql',
    import.meta.url,
  ),
  'utf8',
);
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
  all<T>() {
    return Promise.resolve({ results: this.db.prepare(this.sql).all(...this.values) as T[] });
  }
  run() {
    return Promise.resolve({
      meta: { changes: Number(this.db.prepare(this.sql).run(...this.values).changes) },
    });
  }
}
class AtomicD1 {
  constructor(private db: DatabaseSync) {}
  prepare(sql: string) {
    return new Statement(this.db, sql);
  }
  async batch(statements: Statement[]) {
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
const migrationSql = (name: string) =>
  readFileSync(new URL(`../../../packages/db/migrations/${name}`, import.meta.url), 'utf8');
const count = (db: DatabaseSync, table: string) =>
  Number(db.prepare(`SELECT COUNT(*) count FROM ${table}`).get()!.count);
const valid = {
  workspaceId: 'workspace_primary',
  originalProjectExecutionBudgetId: 'budget_old',
  expectedOriginalBudgetVersion: 1,
  expectedOriginalBudgetStatus: 'ACTIVE',
  historicalReservationId: 'reservation_old',
  historicalRunId: 'run_old',
  historicalEnvelopeId: 'envelope_old',
  remediationStage: 'STORYBOARD_PLANNER',
  providerKey: 'openai',
  modelKey: 'gpt-5.6-terra',
  remediationCeilingMicrousd: 321920,
  maximumCalls: 1,
  remediationProfileKey: 'phase3_storyboard_remediation_v1',
  remediationProfileVersion: 1,
  reasonCategory: 'PROVIDER_OUTPUT_SCHEMA_VALIDATION_AMBIGUOUS',
} as const;
describe('governed remediation capacity', () => {
  it('accepts only the exact bounded Storyboard policy', () => {
    expect(governedRemediationCapacitySchema.safeParse(valid).success).toBe(true);
    for (const bad of [
      { ...valid, remediationStage: 'SCRIPT_CRITIC' },
      { ...valid, modelKey: 'gpt-5.6-sol' },
      { ...valid, remediationCeilingMicrousd: 321921 },
      { ...valid, maximumCalls: 2 },
    ])
      expect(governedRemediationCapacitySchema.safeParse(bad).success).toBe(false);
  });
  it('requires providers admin and explicit idempotency', () => {
    expect(routes).toContain("'/admin/projects/:projectId/editorial-remediation-capacities'");
    expect(routes).toContain("requirePermission('providers:admin')");
    expect(routes).toContain("c.req.header('Idempotency-Key')");
  });
  it('gates every immutable historical link before its atomic batch', () => {
    for (const token of [
      "run.status='FAILED_PERMANENT'",
      "run.error_category='SCHEMA_VALIDATION'",
      "r.status='AMBIGUOUS'",
      'r.actual_microusd IS NULL',
      'r.dispatched_at IS NOT NULL',
      "olde.status='CONSUMED'",
      'olde.maximum_calls=1',
      'ob.version=?',
      "p.status='configured'",
      "m.status='available'",
    ])
      expect(service).toContain(token);
    expect(service.indexOf('remediation_historical_evidence_invalid')).toBeLessThan(
      service.indexOf('this.db.batch(['),
    );
  });
  it('creates capacity, envelope, remediation linkage, and audit in one batch only', () => {
    expect(service).toContain('this.db.batch([');
    expect(service).toContain('INSERT INTO editorial_project_execution_budgets');
    expect(service).toContain('INSERT INTO editorial_execution_envelopes');
    expect(service).toContain('INSERT INTO editorial_execution_remediations');
    expect(service).toContain('editorial.remediation_capacity_authorized');
    expect(service).not.toContain('INSERT INTO editorial_execution_reservations');
    expect(service).not.toContain('INSERT INTO intelligence_runs');
    expect(service).not.toContain('OpenAIResponsesAdapter');
  });
  it('preserves history and isolates ambiguity by a separate budget', () => {
    expect(service).not.toMatch(
      /UPDATE (intelligence_runs|intelligence_run_attempts|editorial_execution_reservations|editorial_execution_envelopes|editorial_project_execution_budgets)/u,
    );
    expect(migration).toContain('remediation_project_execution_budget_id');
    expect(migration).toContain('historical_reservation_id');
    expect(migration).toContain("profile_key='phase3_storyboard_remediation_v1'");
  });
  it('is unique, idempotent, and concurrency safe', () => {
    expect(migration).toContain('UNIQUE(workspace_id,idempotency_key)');
    expect(migration).toContain('UNIQUE(historical_reservation_id,profile_key,profile_version)');
    expect(service).toContain('remediation_idempotency_conflict');
    expect(service).toContain('remediation_already_exists');
    expect(service).toMatch(/const concurrent = await this\.replay/u);
  });
  it('stores the exact no-retry policy and never weakens the old guard', () => {
    for (const token of [
      'maximum_attempts',
      'sdk_max_retries',
      'fallback_enabled',
      'creative_regeneration_enabled',
      'external_research_enabled',
      'human_approval_required',
    ])
      expect(migration).toContain(token);
    expect(migration).not.toContain('DROP TRIGGER editorial_execution_reservation_ambiguous_guard');
  });
  it('executes the production authorization SQL atomically on schema 0007', async () => {
    const db = new DatabaseSync(':memory:');
    for (const name of [
      '0000_phase_1_data_security_core.sql',
      '0001_phase_2_product_channel_monetization.sql',
      '0002_phase_3_editorial_intelligence.sql',
      '0003_editorial_execution_budgets.sql',
      '0004_terminal_pipeline_hardening.sql',
      '0005_deterministic_preflight_provenance.sql',
      '0006_storyboard_v2_contract_hardening.sql',
      '0007_governed_remediation_capacity.sql',
    ])
      db.exec(migrationSql(name));
    db.exec(`
      INSERT INTO workspaces(id,slug,name,created_at,updated_at) VALUES('workspace_primary','test','Test','t','t');
      INSERT INTO users(id,workspace_id,email,status,created_at,updated_at) VALUES('owner','workspace_primary','owner@example.test','active','t','t');
      INSERT INTO content_brands(id,workspace_id,name,normalized_name,primary_language,created_at,updated_at,created_by) VALUES('brand','workspace_primary','Brand','brand','de','t','t','owner');
      INSERT INTO channel_profiles(id,workspace_id,content_brand_id,name,normalized_name,primary_language,created_at,updated_at,created_by) VALUES('channel','workspace_primary','brand','Channel','channel','de','t','t','owner');
      INSERT INTO projects(id,workspace_id,content_brand_id,channel_profile_id,title,format,operating_mode,status,primary_language,readiness_status,created_at,updated_at,created_by) VALUES('project','workspace_primary','brand','channel','Project','SHORT','ASSISTED','STORYBOARD_REVIEW','de','ready','t','t','owner');
      INSERT INTO ai_providers(id,key,display_name,status,adapter_version,created_at,updated_at) VALUES('provider_openai','openai','OpenAI','configured','1','t','t');
      INSERT INTO ai_provider_models(id,provider_id,model_key,display_name,status,capabilities_json,effective_from,created_at,updated_at) VALUES('model_terra','provider_openai','gpt-5.6-terra','Terra','available','{}','t','t','t');
      INSERT INTO ai_pricing_snapshots(id,provider_model_id,currency,input_unit_price,output_unit_price,unit_name,verification_status,effective_from,created_at) VALUES('pricing','model_terra','USD',1,1,'token','externally_verified','t','t');
      INSERT INTO editorial_project_execution_budgets VALUES('budget_old','workspace_primary','project','phase3_terminal_graph_v1',1,'USD',1331520,'ACTIVE','owner','t','t',1);
      INSERT INTO editorial_execution_envelopes VALUES('envelope_old','workspace_primary','project','phase3_terminal_graph_v1',1,'provider_openai','model_terra','USD',321920,1,'ACTIVE','owner','t','t',1,'budget_old','STORYBOARD_PLANNER');
      INSERT INTO intelligence_runs(id,workspace_id,project_id,task_type,provider_id,provider_model_id,initiated_by,operating_mode,status,idempotency_key,created_at,updated_at) VALUES('run_old','workspace_primary','project','STORYBOARD_PLANNER','provider_openai','model_terra','owner','ASSISTED','RUNNING','historical','t','t');
      INSERT INTO intelligence_run_attempts(id,intelligence_run_id,attempt_number,attempt_kind,status,error_category,safe_error_detail,started_at,completed_at) VALUES('attempt_old','run_old',1,'TECHNICAL','FAILED_PERMANENT','SCHEMA_VALIDATION','invalid','t','t');
      INSERT INTO editorial_execution_reservations VALUES('reservation_old','envelope_old','workspace_primary','project','run_old','STORYBOARD_PLANNER','pricing',321920,NULL,'DISPATCHED','t','t',NULL,'budget_old');
      INSERT INTO audit_events(id,workspace_id,actor_type,action,resource_type,resource_id,outcome,request_id,environment,metadata_json,occurred_at,ingested_at) VALUES('terminal_audit','workspace_primary','system','intelligence.run_failed','intelligence_run','run_old','failure','old-request','test','{}','t','t');
      UPDATE intelligence_runs SET status='FAILED_PERMANENT',error_category='SCHEMA_VALIDATION',terminal_audit_event_id='terminal_audit' WHERE id='run_old';
      UPDATE editorial_execution_reservations SET status='AMBIGUOUS' WHERE id='reservation_old';
      UPDATE editorial_execution_envelopes SET status='CONSUMED' WHERE id='envelope_old';
    `);
    const history = [
      'intelligence_runs',
      'intelligence_run_attempts',
      'editorial_execution_reservations',
      'editorial_execution_envelopes',
      'editorial_project_execution_budgets',
    ].map((table) => db.prepare(`SELECT * FROM ${table}`).all());
    const subject = new GovernedRemediationService(
      new AtomicD1(db) as unknown as D1Database,
      {
        id: 'owner',
        workspaceId: 'workspace_primary',
        roles: ['owner'],
      },
      {
        requestId: 'request-test',
        environment: 'test',
        accessIssuer: 'issuer',
        accessSubject: 'subject',
      },
    );
    const created = await subject.authorize('project', 'remediation-key', valid);
    expect(created.idempotent).toBe(false);
    expect([
      count(db, 'editorial_project_execution_budgets'),
      count(db, 'editorial_execution_envelopes'),
      count(db, 'editorial_execution_remediations'),
      count(db, 'audit_events'),
    ]).toEqual([2, 2, 1, 2]);
    expect(
      [
        'intelligence_runs',
        'intelligence_run_attempts',
        'editorial_execution_reservations',
        'editorial_artifacts',
        'editorial_artifact_versions',
        'artifact_dependencies',
      ].map((table) => count(db, table)),
    ).toEqual([1, 1, 1, 0, 0, 0]);
    expect(
      db
        .prepare('SELECT action,resource_id FROM audit_events WHERE id=?')
        .get(created.auditEventId),
    ).toEqual({
      action: 'editorial.remediation_capacity_authorized',
      resource_id: created.remediationId,
    });
    expect(
      db
        .prepare('SELECT status,maximum_calls FROM editorial_execution_envelopes WHERE id=?')
        .get(created.envelopeId),
    ).toEqual({ status: 'ACTIVE', maximum_calls: 1 });
    expect(
      db
        .prepare(
          'SELECT currency,monetary_ceiling_microusd,status FROM editorial_project_execution_budgets WHERE id=?',
        )
        .get(created.budgetId),
    ).toEqual({ currency: 'USD', monetary_ceiling_microusd: 321920, status: 'ACTIVE' });
    expect(
      db
        .prepare(
          'SELECT stage_key,provider_id,provider_model_id FROM editorial_execution_envelopes WHERE id=?',
        )
        .get(created.envelopeId),
    ).toEqual({
      stage_key: 'STORYBOARD_PLANNER',
      provider_id: 'provider_openai',
      provider_model_id: 'model_terra',
    });
    const remediationRow = db
      .prepare(
        'SELECT idempotency_key,command_hash FROM editorial_execution_remediations WHERE id=?',
      )
      .get(created.remediationId) as { idempotency_key: string; command_hash: string };
    expect(remediationRow.idempotency_key).toBe('remediation-key');
    expect(remediationRow.command_hash).toMatch(/^[0-9a-f]{64}$/u);
    expect(
      db
        .prepare('SELECT COUNT(*) count FROM editorial_execution_reservations WHERE envelope_id=?')
        .get(created.envelopeId)!.count,
    ).toBe(0);
    expect(
      [
        'intelligence_runs',
        'intelligence_run_attempts',
        'editorial_execution_reservations',
        'editorial_execution_envelopes',
        'editorial_project_execution_budgets',
      ].map((table) => db.prepare(`SELECT * FROM ${table} WHERE id LIKE '%old'`).all()),
    ).toEqual(history);
    expect(await subject.authorize('project', 'remediation-key', valid)).toEqual({
      ...created,
      idempotent: true,
    });
    expect([count(db, 'editorial_execution_remediations'), count(db, 'audit_events')]).toEqual([
      1, 2,
    ]);
    await expect(
      subject.authorize('project', 'remediation-key', {
        ...valid,
        expectedOriginalBudgetVersion: 2,
      }),
    ).rejects.toThrow('remediation_idempotency_conflict');
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    db.close();
  });
});
