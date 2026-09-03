import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../migrations/0001_phase_2_product_channel_monetization.sql', import.meta.url),
  'utf8',
);
const mappings = [
  readFileSync(new URL('./schema.ts', import.meta.url), 'utf8'),
  readFileSync(new URL('./phase2-schema.ts', import.meta.url), 'utf8'),
].join('\n');
const phase2Tables = [...migration.matchAll(/CREATE TABLE ([a-z0-9_]+)/g)].map((match) => match[1]);
const phase2Indexes = [...migration.matchAll(/CREATE (?:UNIQUE )?INDEX ([a-z0-9_]+)/g)].map(
  (match) => match[1],
);

describe('Phase 2 Drizzle mapping compatibility', () => {
  it('maps every existing Phase 2 table without inventing a migration', () => {
    expect(phase2Tables).toHaveLength(25);
    for (const table of phase2Tables) expect(mappings).toContain(`'${table}'`);
  });

  it('preserves every Phase 2 index name and partial-index predicate', () => {
    for (const index of phase2Indexes) expect(mappings).toContain(`'${index}'`);
    for (const predicate of [
      'deleted_at IS NULL',
      'external_account_id IS NOT NULL AND deleted_at IS NULL',
      'effective_to IS NULL',
      'is_primary=1',
      "variant_kind='MASTER' AND deleted_at IS NULL",
      "variant_kind='PLATFORM' AND deleted_at IS NULL",
    ])
      expect(mappings).toContain(predicate);
  });
});
