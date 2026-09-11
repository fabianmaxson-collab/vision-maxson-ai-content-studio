import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { describe, it, expect } from 'vitest';
import { ideaRevisionSchemaReady } from './phase3-schema';
const dir = new URL('../migrations/', import.meta.url);
const files = readdirSync(dir)
  .filter((f) => /^\d{4}.*\.sql$/u.test(f))
  .sort();
const migration14 = readFileSync(new URL('0014_governed_idea_revision_capacity.sql', dir), 'utf8');
function fixture(sql: string | null = migration14) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  for (const file of files.filter((f) => f < '0014'))
    db.exec(readFileSync(new URL(file, dir), 'utf8'));
  if (sql !== null) db.exec(sql);
  const d1 = {
    prepare(query: string) {
      let values: SQLInputValue[] = [];
      return {
        bind(...args: SQLInputValue[]) {
          values = args;
          return this;
        },
        all() {
          return Promise.resolve({ results: db.prepare(query).all(...values) });
        },
        first() {
          return Promise.resolve(db.prepare(query).get(...values) ?? null);
        },
      };
    },
  } as unknown as D1Database;
  return { db, d1 };
}
describe('0014 structural capability and additive replay', () => {
  it('replays exactly 0000�0014 with the required structures and clean FKs', async () => {
    const { db, d1 } = fixture();
    expect(await ideaRevisionSchemaReady(d1)).toBe(true);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(
      db
        .prepare(
          "SELECT count(*) n FROM sqlite_master WHERE type='trigger' AND name LIKE 'idea_revision_capacity_%'",
        )
        .get(),
    ).toEqual({ n: 13 });
    expect(() =>
      db.exec("INSERT INTO editorial_idea_revision_capacities(id) VALUES('incomplete')"),
    ).toThrow();
    db.close();
  });
  it('does not report 0014 capabilities on schema 0013', async () => {
    const { db, d1 } = fixture(null);
    expect(await ideaRevisionSchemaReady(d1)).toBe(false);
    db.close();
  });
  it('normalizes SQL formatting and keywords without weakening the guards', async () => {
    const { db, d1 } = fixture(
      migration14
        .replaceAll('CREATE TRIGGER', 'create   trigger')
        .replaceAll('CREATE VIEW', 'create\nview'),
    );
    expect(await ideaRevisionSchemaReady(d1)).toBe(true);
    db.close();
  });
  it('rejects the pre-fix capacity audit guard without numeric JSON type checks', async () => {
    const oldAuditGuard = migration14
      .replace(" AND json_type(a.metadata_json)='object'", '')
      .replace(" AND json_type(a.metadata_json,'$.profileVersion')='integer'", '')
      .replace(" AND json_type(a.metadata_json,'$.monetaryCeilingMicrousd')='integer'", '')
      .replace(" AND json_type(a.metadata_json,'$.maximumCalls')='integer'", '');
    expect(oldAuditGuard).not.toBe(migration14);
    const { db, d1 } = fixture(oldAuditGuard);
    expect(await ideaRevisionSchemaReady(d1)).toBe(false);
    db.close();
  });
  it.each(['reservation', 'dispatch', 'no_update', 'no_delete'])(
    'rejects same-name SELECT 1 replacement: %s',
    async (guard) => {
      const { db, d1 } = fixture();
      const name = `idea_revision_capacity_${guard}${['reservation', 'dispatch'].includes(guard) ? '_guard' : ''}`;
      db.exec(
        `DROP TRIGGER ${name}; CREATE TRIGGER ${name} BEFORE INSERT ON editorial_idea_revision_capacities BEGIN SELECT 1; END;`,
      );
      expect(await ideaRevisionSchemaReady(d1)).toBe(false);
      db.close();
    },
  );
  it.each(['no_update', 'no_delete', 'dispatch_guard'])('rejects missing %s', async (guard) => {
    const { db, d1 } = fixture();
    db.exec(`DROP TRIGGER idea_revision_capacity_${guard}`);
    expect(await ideaRevisionSchemaReady(d1)).toBe(false);
    db.close();
  });
  it.each([
    [
      'missing single-capacity uniqueness',
      migration14.replace(
        ',\n UNIQUE(workspace_id,project_id,revision_request_id,research_version_id,stage_key)',
        '',
      ),
    ],
    [
      'wrong unique columns',
      migration14.replace(
        'UNIQUE(workspace_id,idempotency_key)',
        'UNIQUE(workspace_id,idempotency_key,command_hash)',
      ),
    ],
    [
      'missing budget uniqueness',
      migration14.replace('budget_id TEXT NOT NULL UNIQUE', 'budget_id TEXT NOT NULL'),
    ],
    [
      'missing required receipt column',
      migration14.replace(/ sdk_max_retries INTEGER[^\n]+\n/u, ''),
    ],
    [
      'nullable critical column',
      migration14.replace('workspace_id TEXT NOT NULL REFERENCES', 'workspace_id TEXT REFERENCES'),
    ],
  ])('rejects %s', async (_name, sql) => {
    const { db, d1 } = fixture(sql);
    expect(await ideaRevisionSchemaReady(d1)).toBe(false);
    db.close();
  });
  it.each(['idea_revision_eligible_research', 'idea_revision_eligible_policy'])(
    'rejects partial view %s',
    async (name) => {
      const { db, d1 } = fixture();
      db.exec(`DROP VIEW ${name}; CREATE VIEW ${name} AS SELECT 1 placeholder;`);
      expect(await ideaRevisionSchemaReady(d1)).toBe(false);
      db.close();
    },
  );
});

describe('0014 recovery capability fail-closed', () => {
  it.each([
    'scope_guard',
    'failure_guard',
    'current_guard',
    'envelope_guard',
    'actor_guard',
    'result_guard',
    'audit_guard',
    'no_update',
    'no_delete',
    'budget_no_update',
    'original_envelope_no_update',
    'failed_reservation_no_update',
    'failed_run_no_update',
    'reservation_evidence_guard',
    'dispatch_evidence_guard',
  ])('requires the complete recovery %s', async (guard) => {
    const { db, d1 } = fixture();
    db.exec('DROP TRIGGER idea_revision_recovery_' + guard);
    expect(await ideaRevisionSchemaReady(d1)).toBe(false);
    db.close();
  });
  it.each([
    'idea_revision_zero_provider_failures',
    'idea_revision_recovery_eligible',
    'idea_revision_execution_bindings',
  ])('rejects degraded recovery view %s', async (view) => {
    const { db, d1 } = fixture();
    db.exec('DROP VIEW ' + view + '; CREATE VIEW ' + view + ' AS SELECT 1 placeholder;');
    expect(await ideaRevisionSchemaReady(d1)).toBe(false);
    db.close();
  });
  it('rejects a same-name no-op recovery guard', async () => {
    const { db, d1 } = fixture();
    db.exec(
      'DROP TRIGGER idea_revision_recovery_failure_guard; CREATE TRIGGER idea_revision_recovery_failure_guard BEFORE INSERT ON editorial_idea_revision_capacity_recoveries BEGIN SELECT 1; END;',
    );
    expect(await ideaRevisionSchemaReady(d1)).toBe(false);
    db.close();
  });
  it.each([
    'idea_revision_capacity_id',
    'replacement_envelope_id',
    'failed_run_id',
    'failed_reservation_id',
  ])('requires durable recovery uniqueness for %s', async (column) => {
    const { db, d1 } = fixture(
      migration14.replace(column + ' TEXT NOT NULL UNIQUE', column + ' TEXT NOT NULL'),
    );
    expect(await ideaRevisionSchemaReady(d1)).toBe(false);
    db.close();
  });
  it('starts the recovery table empty with independent foreign keys', async () => {
    const { db, d1 } = fixture();
    expect(await ideaRevisionSchemaReady(d1)).toBe(true);
    expect(
      db.prepare('SELECT count(*) n FROM editorial_idea_revision_capacity_recoveries').get(),
    ).toEqual({ n: 0 });
    expect(
      db.prepare("PRAGMA foreign_key_list('editorial_idea_revision_capacity_recoveries')").all()
        .length,
    ).toBeGreaterThanOrEqual(15);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    db.close();
  });
});

it('rejects a same-name eligibility view that drops the sole approval invariant', async () => {
  const { db, d1 } = fixture();
  const ddl = String(
    db.prepare("SELECT sql FROM sqlite_master WHERE name='idea_revision_eligible_research'").get()!
      .sql,
  );
  const weakened = ddl.replace(
    ' AND NOT EXISTS(SELECT 1 FROM artifact_approvals other WHERE other.artifact_version_id=v.id AND other.id<>ap.id)',
    '',
  );
  expect(weakened).not.toBe(ddl);
  db.exec('DROP VIEW idea_revision_eligible_research');
  db.exec(weakened);
  expect(await ideaRevisionSchemaReady(d1)).toBe(false);
  db.close();
});
