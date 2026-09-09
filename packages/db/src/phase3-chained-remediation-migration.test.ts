import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
const sql = (name: string) =>
  readFileSync(new URL('../migrations/' + name, import.meta.url), 'utf8');
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
describe('migration 0010 governed chained remediation v2', () => {
  it('is additive, forward-only, shallow, and preserves root semantics', () => {
    const migration = sql(names.at(-1)!);
    expect(migration).toContain('CREATE TABLE editorial_chained_execution_remediations');
    expect(migration).not.toMatch(/\b(?:DROP TABLE|ALTER TABLE|UPDATE|DELETE)\b/u);
    expect(migration).toContain(
      "profile_key TEXT NOT NULL CHECK(profile_key='phase3_storyboard_chained_remediation_v2')",
    );
    expect(migration).toContain(
      'remediation_generation INTEGER NOT NULL CHECK(remediation_generation=2)',
    );
    expect(migration).toContain(
      'parent_remediation_id TEXT NOT NULL UNIQUE REFERENCES editorial_execution_remediations(id)',
    );
    expect(migration).toContain('historical_reservation_id TEXT NOT NULL UNIQUE');
    expect(migration).toContain('historical_run_id TEXT NOT NULL UNIQUE');
    expect(sql('0007_governed_remediation_capacity.sql')).toContain("r.status='AMBIGUOUS'");
    const guards = migration.match(/CREATE TRIGGER[\s\S]*?END;/gu) ?? [];
    expect(guards).toHaveLength(10);
    expect(Math.max(...guards.map((guard) => guard.match(/\bAND\b/gu)?.length ?? 0))).toBeLessThan(
      16,
    );
  });
  it('replays 0000-0010 with clean foreign keys and both immutable profiles', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys=ON');
    for (const name of names) db.exec(sql(name));
    expect(
      db
        .prepare(
          "SELECT COUNT(*) count FROM sqlite_master WHERE type='table' AND name IN ('editorial_execution_remediations','editorial_chained_execution_remediations')",
        )
        .get(),
    ).toEqual({ count: 2 });
    expect(
      db
        .prepare(
          "SELECT COUNT(*) count FROM sqlite_master WHERE type='trigger' AND name GLOB 'chained_remediation_*_guard'",
        )
        .get(),
    ).toEqual({ count: 10 });
    expect(
      db
        .prepare(
          "SELECT COUNT(*) count FROM pragma_foreign_key_list('editorial_chained_execution_remediations')",
        )
        .get(),
    ).toEqual({ count: 12 });
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    db.close();
  });
});
