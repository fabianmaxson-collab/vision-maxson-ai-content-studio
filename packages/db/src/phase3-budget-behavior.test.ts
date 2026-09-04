import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
const migration = readFileSync(
  new URL('../migrations/0003_editorial_execution_budgets.sql', import.meta.url),
  'utf8',
);
let db: DatabaseSync;
const reservation = (id: string, workspace = 'w1', step = 'SCRIPT_WRITER_SHORT', amount = 3000) =>
  db
    .prepare(
      `INSERT INTO editorial_execution_reservations(id,envelope_id,workspace_id,project_id,intelligence_run_id,step_key,pricing_snapshot_id,reserved_microusd,status,created_at) VALUES(?,'e1',?,'p1',?,?, 'price1',?,'RESERVED','now')`,
    )
    .run(id, workspace, `run_${id}`, step, amount);
describe('Phase 3 budget guards execute in SQLite/D1-compatible SQL', () => {
  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    db.exec(
      `PRAGMA foreign_keys=ON; CREATE TABLE workspaces(id TEXT PRIMARY KEY); CREATE TABLE projects(id TEXT PRIMARY KEY); CREATE TABLE users(id TEXT PRIMARY KEY); CREATE TABLE ai_providers(id TEXT PRIMARY KEY); CREATE TABLE ai_provider_models(id TEXT PRIMARY KEY); CREATE TABLE intelligence_runs(id TEXT PRIMARY KEY); CREATE TABLE ai_pricing_snapshots(id TEXT PRIMARY KEY);`,
    );
    db.exec(migration);
    db.exec(
      `INSERT INTO workspaces VALUES('w1'); INSERT INTO workspaces VALUES('w2'); INSERT INTO projects VALUES('p1'); INSERT INTO users VALUES('u1'); INSERT INTO ai_providers VALUES('provider1'); INSERT INTO ai_provider_models VALUES('model1'); INSERT INTO ai_pricing_snapshots VALUES('price1'); INSERT INTO intelligence_runs VALUES('run_r1'); INSERT INTO intelligence_runs VALUES('run_r2'); INSERT INTO intelligence_runs VALUES('run_r3'); INSERT INTO intelligence_runs VALUES('run_r4'); INSERT INTO editorial_execution_envelopes(id,workspace_id,project_id,profile_key,profile_version,provider_id,provider_model_id,currency,monetary_ceiling_microusd,maximum_calls,status,authorized_by,created_at,updated_at,version) VALUES('e1','w1','p1','phase3_short_en_review_es_v1',1,'provider1','model1','USD',7000,2,'ACTIVE','u1','now','now',1);`,
    );
  });
  it('accepts and reconciles a valid reservation lifecycle', () => {
    reservation('r1');
    db.exec(
      `UPDATE editorial_execution_reservations SET status='DISPATCHED',dispatched_at='later' WHERE id='r1'; UPDATE editorial_execution_reservations SET status='RECONCILED',actual_microusd=2500,reconciled_at='done' WHERE id='r1';`,
    );
    expect(
      db
        .prepare(
          `SELECT status,actual_microusd AS actual FROM editorial_execution_reservations WHERE id='r1'`,
        )
        .get(),
    ).toEqual({ status: 'RECONCILED', actual: 2500 });
  });
  it('rejects a duplicate step reservation', () => {
    reservation('r1');
    expect(() => reservation('r2')).toThrow(/UNIQUE constraint failed/u);
  });
  it('rejects a reservation outside the envelope scope', () =>
    expect(() => reservation('r1', 'w2')).toThrow(/execution_envelope_scope_or_status_invalid/u));
  it('rejects a reservation that exceeds remaining budget', () => {
    reservation('r1');
    expect(() => reservation('r2', 'w1', 'REVIEW_TRANSLATION_ES', 5000)).toThrow(
      /execution_envelope_budget_exceeded/u,
    );
  });
  it('rejects a third dispatch reservation at the call ceiling', () => {
    reservation('r1');
    reservation('r2', 'w1', 'REVIEW_TRANSLATION_ES', 3000);
    expect(() => reservation('r3', 'w1', 'SCRIPT_WRITER_SHORT', 1)).toThrow(
      /execution_envelope_call_limit_exceeded/u,
    );
  });
});
