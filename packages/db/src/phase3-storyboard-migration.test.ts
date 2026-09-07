import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
const sql = (n: string) => readFileSync(new URL(`../migrations/${n}`, import.meta.url), 'utf8');
describe('migration 0006', () => {
  it('replays additively without V2 backfill', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys=ON');
    for (const n of [
      '0000_phase_1_data_security_core.sql',
      '0001_phase_2_product_channel_monetization.sql',
      '0002_phase_3_editorial_intelligence.sql',
      '0003_editorial_execution_budgets.sql',
      '0004_terminal_pipeline_hardening.sql',
      '0005_deterministic_preflight_provenance.sql',
    ])
      db.exec(sql(n));
    db.exec(sql('0006_storyboard_v2_contract_hardening.sql'));
    expect(
      db
        .prepare(
          "SELECT output_schema_version outputSchemaVersion FROM prompt_versions WHERE id='prompt_version_storyboard_v2'",
        )
        .get(),
    ).toEqual({ outputSchemaVersion: 'storyboard-output-v2' });
    expect(
      db
        .prepare(
          "SELECT COUNT(*) count FROM pragma_table_info('storyboard_scenes') WHERE name='contract_version'",
        )
        .get(),
    ).toEqual({ count: 1 });
    expect(
      db
        .prepare('SELECT COUNT(*) count FROM storyboard_scenes WHERE contract_version IS NOT NULL')
        .get(),
    ).toEqual({ count: 0 });
    expect(
      db
        .prepare(
          "SELECT COUNT(*) count FROM sqlite_master WHERE type='index' AND name='scene_script_segments_script_idx'",
        )
        .get(),
    ).toEqual({ count: 1 });
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    db.close();
  });
});
