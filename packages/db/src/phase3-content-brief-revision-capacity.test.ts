import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { describe, it, expect } from 'vitest';
import { contentBriefRevisionSchemaReady } from './phase3-schema';
const dir = new URL('../migrations/', import.meta.url);
const files = readdirSync(dir)
  .filter((f) => /^\d{4}.*\.sql$/u.test(f))
  .sort();
const migration15 = readFileSync(
  new URL('0015_governed_content_brief_revision_capacity.sql', dir),
  'utf8',
);
function fixture(sql: string | null = migration15) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  for (const file of files.filter((f) => f < '0015'))
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

describe('Brief schema capability proof', () => {
  it('fresh replay and upgrade preserve historical objects and foreign keys', async () => {
    const f = fixture(null);
    try {
      const before = f.db
        .prepare(
          "SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all();
      expect(await contentBriefRevisionSchemaReady(f.d1)).toBe(false);
      f.db.exec(migration15);
      expect(await contentBriefRevisionSchemaReady(f.d1)).toBe(true);
      const after = f.db
        .prepare(
          "SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE 'content_brief_revision_%' AND name NOT LIKE 'editorial_content_brief_revision_%' ORDER BY name",
        )
        .all();
      expect(after).toEqual(before);
      expect(f.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      expect(
        f.db
          .prepare(
            "SELECT count(*) n FROM sqlite_master WHERE name LIKE 'content_brief_revision_%' OR name IN ('editorial_content_brief_revision_capacities','editorial_content_brief_revision_capacity_recoveries')",
          )
          .get(),
      ).toEqual({ n: 39 });
    } finally {
      f.db.close();
    }
  });
  it.each([
    'content_brief_revision_capacity_scope_guard',
    'content_brief_revision_capacity_dispatch_guard',
    'content_brief_revision_eligible_inputs',
    'editorial_content_brief_revision_capacity_recoveries',
  ])('rejects missing %s', async (name) => {
    const f = fixture();
    try {
      const row = f.db.prepare('SELECT type FROM sqlite_master WHERE name=?').get(name)!;
      f.db.exec(`DROP ${String(row.type)} ${name}`);
      expect(await contentBriefRevisionSchemaReady(f.d1)).toBe(false);
    } finally {
      f.db.close();
    }
  });
  it.each([
    'REFERENCES projects(id)',
    'UNIQUE(workspace_id,idempotency_key)',
    "AND p.status='ANALYZING'",
  ])('rejects altered DDL %s', async (fragment) => {
    const sql = migration15.replace(
      fragment,
      fragment.startsWith('REFERENCES')
        ? 'REFERENCES workspaces(id)'
        : fragment.startsWith('UNIQUE')
          ? 'CHECK(1)'
          : "AND p.status<>'DELETED'",
    );
    expect(sql).not.toBe(migration15);
    const f = fixture(sql);
    try {
      expect(await contentBriefRevisionSchemaReady(f.d1)).toBe(false);
    } finally {
      f.db.close();
    }
  });
});
