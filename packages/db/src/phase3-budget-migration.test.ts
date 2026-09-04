import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const sql = readFileSync(
  new URL('../migrations/0003_editorial_execution_budgets.sql', import.meta.url),
  'utf8',
);
describe('Phase 3 execution-budget migration contract', () => {
  it('adds only the envelope and reservation tables', () =>
    expect([...sql.matchAll(/CREATE TABLE ([a-z_]+)/g)].map((m) => m[1])).toEqual([
      'editorial_execution_envelopes',
      'editorial_execution_reservations',
    ]));
  it('is forward-only and contains no business seed data', () => {
    expect(sql).not.toMatch(/DROP|ALTER|DELETE FROM|INSERT INTO ai_/i);
  });
  it('uses integer micro-USD authorization', () => {
    expect(sql).toContain('monetary_ceiling_microusd INTEGER');
    expect(sql).toContain('reserved_microusd INTEGER');
    expect(sql).toContain("currency='USD'");
  });
  it('enforces envelope, step and run uniqueness', () => {
    expect(sql).toContain('editorial_execution_envelopes_active_profile_idx');
    expect(sql).toContain('UNIQUE(envelope_id,step_key)');
    expect(sql).toContain('UNIQUE(intelligence_run_id)');
  });
  it('fails closed for scope, call-count and monetary races', () => {
    expect(sql).toContain('execution_envelope_scope_or_status_invalid');
    expect(sql).toContain('execution_envelope_call_limit_exceeded');
    expect(sql).toContain('execution_envelope_budget_exceeded');
    expect(sql).toContain('editorial_execution_reservation_call_limit_guard');
    expect(sql).toContain('editorial_execution_reservation_budget_guard');
  });
  it('uses D1-safe single-statement trigger bodies', () => {
    const triggers = [...sql.matchAll(/CREATE TRIGGER[\s\S]*?END;/g)].map((match) => match[0]);
    expect(triggers).toHaveLength(3);
    for (const trigger of triggers) {
      expect(trigger.match(/SELECT RAISE\(/g)).toHaveLength(1);
      expect(trigger.slice(0, trigger.lastIndexOf('END;')).match(/;/g)).toHaveLength(1);
    }
  });
  it('preserves dispatched and ambiguous lifecycle states', () =>
    expect(sql).toContain("'RESERVED','DISPATCHED','RECONCILED','AMBIGUOUS','CANCELLED'"));
});
