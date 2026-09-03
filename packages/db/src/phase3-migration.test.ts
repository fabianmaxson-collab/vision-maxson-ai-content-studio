import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../migrations/0002_phase_3_editorial_intelligence.sql', import.meta.url),
  'utf8',
);
const tables = [...migration.matchAll(/CREATE TABLE ([a-z_]+)/g)].map((match) => match[1]);
describe('Phase 3 forward-only migration', () => {
  it('creates exactly the approved 22 tables', () => expect(tables).toHaveLength(22));
  it('is non-destructive and contains no fake business data', () => {
    expect(migration).not.toMatch(/DROP TABLE|DELETE FROM|fake revenue|fake analytics/i);
    expect(migration).not.toContain('INSERT INTO ai_providers');
  });
  it('seeds only approved prompt definition catalog entries', () => {
    expect(migration).toContain("'prompt_topic_research'");
    expect(migration).not.toContain('INSERT INTO prompt_versions');
  });
  it('protects immutable versions and append-only approvals', () => {
    expect(migration).toContain('editorial_versions_no_update');
    expect(migration).toContain('artifact_approvals_no_delete');
  });
});
