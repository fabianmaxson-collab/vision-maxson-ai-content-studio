import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const sql = readFileSync(
  new URL('../migrations/0001_phase_2_product_channel_monetization.sql', import.meta.url),
  'utf8',
);
describe('Phase 2 migration contract', () => {
  it('keeps external rules and internal strategy in separate immutable tables', () => {
    expect(sql).toContain('CREATE TABLE platform_monetization_rule_versions');
    expect(sql).toContain('CREATE TABLE platform_strategy_rule_versions');
    expect(sql).toContain('platform_rules_no_update');
    expect(sql).toContain('strategy_rules_no_update');
  });
  it('labels the TikTok platform baseline unverified and the 65–90 range as strategy', () => {
    expect(sql).toMatch(/platform_rule_tiktok_creator_rewards_v1[\s\S]*'unverified'/);
    expect(sql).toMatch(/strategy_short_tiktok_v1[\s\S]*65,90/);
  });
  it('uses partial indexes for nullable uniqueness', () => {
    expect(sql).toContain('WHERE social_account_id IS NULL AND deleted_at IS NULL');
    expect(sql).toContain('WHERE effective_to IS NULL');
  });
  it('enforces one active master variant', () =>
    expect(sql).toContain("WHERE variant_kind='MASTER' AND deleted_at IS NULL"));
  it('supports reference-only social accounts without credential columns', () => {
    const table = sql.match(/CREATE TABLE social_accounts \([\s\S]*?\);/)?.[0] ?? '';
    expect(table).toContain("connection_method='manual_reference'");
    expect(table).not.toMatch(/access_token|refresh_token|password|secret/);
  });
  it('never seeds financial measurements', () => {
    const inserts = sql.split('INSERT INTO').slice(1).join('INSERT INTO');
    expect(inserts).not.toMatch(/rpm|cpm|expected_views|expected_revenue/);
  });
  it('preserves Phase 1 by containing no destructive schema operation', () =>
    expect(sql).not.toMatch(/\b(DROP|TRUNCATE)\b/i));
});
