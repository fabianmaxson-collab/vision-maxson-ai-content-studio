import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
const sql = (n: string) => readFileSync(new URL(`../migrations/${n}`, import.meta.url), 'utf8');
describe('migration 0007', () => {
  it('replays additively with linkage, uniqueness, and clean foreign keys', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys=ON');
    for (const n of [
      '0000_phase_1_data_security_core.sql',
      '0001_phase_2_product_channel_monetization.sql',
      '0002_phase_3_editorial_intelligence.sql',
      '0003_editorial_execution_budgets.sql',
      '0004_terminal_pipeline_hardening.sql',
      '0005_deterministic_preflight_provenance.sql',
      '0006_storyboard_v2_contract_hardening.sql',
      '0007_governed_remediation_capacity.sql',
    ])
      db.exec(sql(n));
    expect(
      db
        .prepare(
          "SELECT COUNT(*) count FROM sqlite_master WHERE type='table' AND name='editorial_execution_remediations'",
        )
        .get(),
    ).toEqual({ count: 1 });
    expect(
      db
        .prepare(
          "SELECT COUNT(*) count FROM sqlite_master WHERE type='trigger' AND name='editorial_execution_remediation_evidence_guard'",
        )
        .get(),
    ).toEqual({ count: 1 });
    expect(
      db
        .prepare(
          "SELECT COUNT(*) count FROM pragma_foreign_key_list('editorial_execution_remediations')",
        )
        .get(),
    ).toEqual({ count: 12 });
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    db.close();
  });
});
