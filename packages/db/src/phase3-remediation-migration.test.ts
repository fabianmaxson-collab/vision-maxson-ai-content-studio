import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
const sql = (n: string) => readFileSync(new URL(`../migrations/${n}`, import.meta.url), 'utf8');
describe('remediation migrations', () => {
  it('maps every 0007 evidence predicate into shallow fail-closed guards', () => {
    const previous = sql('0007_governed_remediation_capacity.sql');
    const replacement = sql('0008_remediation_evidence_expression_depth.sql');
    const predicates = [
      "ob.status='ACTIVE'",
      'ob.version=NEW.expected_original_budget_version',
      "r.status='AMBIGUOUS'",
      'r.actual_microusd IS NULL',
      'r.dispatched_at IS NOT NULL',
      "run.task_type='STORYBOARD_PLANNER'",
      "run.status='FAILED_PERMANENT'",
      "run.error_category='SCHEMA_VALIDATION'",
      "olde.status='CONSUMED'",
      'olde.maximum_calls=1',
      'SELECT COUNT(*) FROM editorial_execution_reservations',
      "nb.currency='USD'",
      'nb.monetary_ceiling_microusd=NEW.additional_exposure_microusd',
      "nb.status='ACTIVE'",
      "ne.currency='USD'",
      'ne.maximum_calls=1',
      "ne.status='ACTIVE'",
      "p.key='openai'",
      "p.status='configured'",
      "m.model_key='gpt-5.6-terra'",
      "m.status='available'",
      "a.action='editorial.remediation_capacity_authorized'",
      "a.resource_type='editorial_execution_remediation'",
      "a.outcome='success'",
    ];
    const aliases: Record<string, string> = { ob: 'b', olde: 'e', nb: 'b', ne: 'e', run: 'r' };
    for (const predicate of predicates) {
      expect(previous).toContain(predicate);
      const mapped = predicate.replace(
        /^(ob|olde|nb|ne|run)\./u,
        (alias) => `${aliases[alias.slice(0, -1)]}.`,
      );
      expect(replacement).toContain(mapped);
    }
    const guards = replacement.match(/CREATE TRIGGER[\s\S]*?END;/gu) ?? [];
    expect(guards).toHaveLength(8);
    expect(Math.max(...guards.map((guard) => guard.match(/\bAND\b/gu)?.length ?? 0))).toBeLessThan(
      16,
    );
    expect(replacement).toContain('DROP TRIGGER editorial_execution_remediation_evidence_guard');
    expect(replacement).not.toMatch(/\b(?:UPDATE|DELETE)\b/u);
  });

  it('replays 0000-0008 with shallow evidence guards and clean foreign keys', () => {
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
      '0008_remediation_evidence_expression_depth.sql',
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
    ).toEqual({ count: 0 });
    expect(
      db
        .prepare(
          "SELECT COUNT(*) count FROM sqlite_master WHERE type='trigger' AND name GLOB 'editorial_execution_remediation_*_guard'",
        )
        .get(),
    ).toEqual({ count: 8 });
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
