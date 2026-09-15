import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { platform } from 'node:os';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { productionScriptRetrySchemaReady } from './phase3-schema';

const dir = new URL('../migrations/', import.meta.url);
const files = readdirSync(dir)
  .filter((file) => /^\d{4}.*\.sql$/u.test(file))
  .sort();
const migration16 = readFileSync(
  new URL('0016_governed_production_script_retry_authorization.sql', dir),
  'utf8',
);

function fixture(include16 = true) {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys=ON');
  for (const file of files.filter((file) => include16 || file < '0016'))
    database.exec(readFileSync(new URL(file, dir), 'utf8'));
  const d1 = {
    prepare(sql: string) {
      let values: SQLInputValue[] = [];
      return {
        bind(...input: SQLInputValue[]) {
          values = input;
          return this;
        },
        all<T>() {
          return Promise.resolve({ results: database.prepare(sql).all(...values) as T[] });
        },
      };
    },
  } as unknown as D1Database;
  return { database, d1 };
}

describe('production Script retry migration 0016', () => {
  it('replays 0000-0016 and upgrades 0015 without historical drift', async () => {
    const fresh = fixture();
    try {
      expect(await productionScriptRetrySchemaReady(fresh.d1)).toBe(true);
      expect(fresh.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      fresh.database.close();
    }

    const upgrade = fixture(false);
    try {
      const before = upgrade.database
        .prepare(
          "SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all();
      expect(await productionScriptRetrySchemaReady(upgrade.d1)).toBe(false);
      upgrade.database.exec(migration16);
      expect(await productionScriptRetrySchemaReady(upgrade.d1)).toBe(true);
      const after = upgrade.database
        .prepare(
          "SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '%production_script_retry%' AND name<>'editorial_production_script_retry_capacities' AND name NOT LIKE '%legacy_remediation%' AND name NOT LIKE 'production_script_legacy_%' ORDER BY name",
        )
        .all();
      expect(after).toEqual(before);
      expect(upgrade.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      upgrade.database.close();
    }
  });

  it.each([
    'editorial_production_script_retry_capacities',
    'production_script_retry_eligible_failures',
    'production_script_retry_execution_eligible',
    'production_script_retry_capacity_scope_guard',
    'production_script_retry_reservation_guard',
    'legacy_remediation_attestation_guard',
    'legacy_remediation_attestation_no_update',
    'legacy_remediation_attestation_no_delete',
    'legacy_remediation_claim_guard',
    'legacy_remediation_claim_no_update',
    'legacy_remediation_claim_no_delete',
    'production_script_legacy_incident_base',
    'production_script_legacy_editorial_state',
    'production_script_legacy_history',
    'production_script_legacy_economics',
    'production_script_legacy_lineage',
    'production_script_legacy_incident_live',
    'production_script_retry_attestation_editorial_binding',
    'production_script_retry_attestation_policy_binding',
    'production_script_retry_attestation_request_binding',
  ])('fails closed when %s is absent', async (name) => {
    const fixture16 = fixture();
    try {
      const row = fixture16.database
        .prepare('SELECT type FROM sqlite_master WHERE name=?')
        .get(name)!;
      fixture16.database.exec(`DROP ${String(row.type)} ${name}`);
      expect(await productionScriptRetrySchemaReady(fixture16.d1)).toBe(false);
    } finally {
      fixture16.database.close();
    }
  });

  it('replays and compiles the live legacy views with SQLite expression depth 100', () => {
    const script = String.raw`
import pathlib, sqlite3, sys
connection = sqlite3.connect(":memory:", cached_statements=0)
connection.execute("PRAGMA foreign_keys=ON")
connection.setlimit(sqlite3.SQLITE_LIMIT_EXPR_DEPTH, 100)
for migration in sorted(pathlib.Path(sys.argv[1]).glob("[0-9][0-9][0-9][0-9]*.sql")):
    connection.executescript(migration.read_text(encoding="utf-8"))
connection.execute("SELECT * FROM production_script_legacy_incident_live").fetchall()
connection.execute("SELECT * FROM production_script_retry_execution_eligible").fetchall()
connection.execute("SELECT * FROM production_script_retry_eligible_policy").fetchall()
for table in (
    "editorial_legacy_remediation_attestations",
    "editorial_production_script_retry_capacities",
    "editorial_legacy_remediation_claims",
    "editorial_execution_reservations",
):
    connection.execute("EXPLAIN INSERT INTO " + table + " DEFAULT VALUES").fetchall()
assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
print("expression_depth=100 replay=pass live_views=pass insert_guards=pass foreign_keys=pass")
`;
    const migrationPath = fileURLToPath(dir);
    const commands = platform() === 'win32' ? ['python', 'python3'] : ['python3', 'python'];
    const results = commands.map((command) =>
      spawnSync(command, ['-c', script, migrationPath], { encoding: 'utf8' }),
    );
    const result = results.find((candidate) => candidate.status !== null);
    expect(result, results.map((candidate) => candidate.error?.message).join('\n')).toBeDefined();
    expect(result?.status, `${result?.stdout ?? ''}\n${result?.stderr ?? ''}`).toBe(0);
    expect(result?.stdout).toContain(
      'expression_depth=100 replay=pass live_views=pass insert_guards=pass foreign_keys=pass',
    );
  });
  it('pins the one-call 2970 micro-USD policy and immutable receipt', () => {
    for (const fragment of [
      "economic_profile_key TEXT NOT NULL CHECK(economic_profile_key='phase3_production_script_retry_v1')",
      'monetary_ceiling_microusd INTEGER NOT NULL CHECK(monetary_ceiling_microusd=2970)',
      'maximum_calls INTEGER NOT NULL CHECK(maximum_calls=1)',
      'maximum_attempts INTEGER NOT NULL CHECK(maximum_attempts=1)',
      'sdk_max_retries INTEGER NOT NULL CHECK(sdk_max_retries=0)',
      'UNIQUE(workspace_id,project_id,revision_request_id,stage_key)',
      'production_script_retry_capacity_no_update',
      'production_script_retry_capacity_no_delete',
    ])
      expect(migration16).toContain(fragment);
  });
});
