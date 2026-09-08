import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

const migration = (name: string) =>
  readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8');
const migrations = [
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
] as const;

describe('migration 0009 Storyboard continuity prompt v3', () => {
  it('adds one immutable highest-active prompt without changing schema or v2', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys=ON');
    migrations.slice(0, -1).forEach((name) => db.exec(migration(name)));
    const schemaBefore = db
      .prepare('SELECT name,type,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type,name')
      .all();
    const v2Before = db
      .prepare("SELECT * FROM prompt_versions WHERE id='prompt_version_storyboard_v2'")
      .get();

    db.exec(migration(migrations.at(-1)!));

    const v3 = db
      .prepare("SELECT * FROM prompt_versions WHERE id='prompt_version_storyboard_v3'")
      .get() as Record<string, unknown>;
    expect(v3).toMatchObject({
      id: 'prompt_version_storyboard_v3',
      prompt_definition_id: 'prompt_storyboard_planner',
      version_number: 3,
      input_schema_version: 'storyboard-input-v2',
      output_schema_version: 'storyboard-output-v2',
      status: 'active',
    });
    expect(createHash('sha256').update(String(v3.template_text)).digest('hex')).toBe(
      v3.content_hash,
    );
    expect(
      db
        .prepare(
          "SELECT COUNT(*) count FROM prompt_versions WHERE id='prompt_version_storyboard_v3'",
        )
        .get(),
    ).toEqual({ count: 1 });
    db.exec(migration(migrations.at(-1)!));
    expect(
      db
        .prepare(
          "SELECT COUNT(*) count FROM prompt_versions WHERE id='prompt_version_storyboard_v3'",
        )
        .get(),
    ).toEqual({ count: 1 });
    expect(
      db
        .prepare(
          "SELECT id FROM prompt_versions WHERE prompt_definition_id='prompt_storyboard_planner' AND status='active' ORDER BY version_number DESC LIMIT 1",
        )
        .get(),
    ).toEqual({ id: 'prompt_version_storyboard_v3' });
    expect(
      db.prepare("SELECT * FROM prompt_versions WHERE id='prompt_version_storyboard_v2'").get(),
    ).toEqual(v2Before);
    expect((v2Before as Record<string, unknown>).content_hash).toBe(
      '8eeecd23c8b6c0aa2f424e1a5ffcbf27cc8721220723a166c2d4e47caa1fe006',
    );
    expect(
      db
        .prepare('SELECT name,type,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type,name')
        .all(),
    ).toEqual(schemaBefore);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    db.close();
  });
});
