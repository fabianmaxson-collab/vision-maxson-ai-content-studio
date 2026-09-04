import { describe, expect, it } from 'vitest';
import { intelligenceCommandSchema } from '@vision-maxson/contracts';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../..');
const execution = readFileSync(resolve(root, 'apps/api/src/editorial/execution.ts'), 'utf8');
const budget = readFileSync(resolve(root, 'apps/api/src/editorial/budget.ts'), 'utf8');
const routes = readFileSync(resolve(root, 'apps/api/src/editorial/routes.ts'), 'utf8');
const migration = readFileSync(
  resolve(root, 'packages/db/migrations/0003_editorial_execution_budgets.sql'),
  'utf8',
);
describe('editorial routing and budget hardening', () => {
  it.each(['minimumQuality', 'forceModel', 'ignoreQuality', 'maxAttempts', 'maxOutputTokens'])(
    'rejects unsafe caller override %s',
    (key) => expect(intelligenceCommandSchema.safeParse({ [key]: 1 }).success).toBe(false),
  );
  it('does not emit a second completion audit for replay', () =>
    expect(routes).toContain('if (!result.idempotentReplay)'));
  it('re-reads and compares the winning command hash', () => {
    expect(execution).toContain('this.commandHash(reserved) !== commandHash');
    expect(execution).toContain('this.commandHash(winner) === commandHash');
  });
  it('rejects LONG_FORM through the short route', () =>
    expect(execution).toContain("project.format !== 'SHORT'"));
  it('loads the exact current approved production script in the same scope', () => {
    expect(execution).toContain('a.current_version_id=v.id');
    expect(execution).toContain("a.artifact_type='PRODUCTION_SCRIPT'");
    expect(execution).toContain("a.status='approved'");
    expect(execution).toContain('v.language_code=?');
    expect(execution).toContain('projectProfile.productionLanguage');
    expect(execution).toContain('a.project_id=?');
  });
  it('keeps German authorization explicit and server controlled', () => {
    expect(routes).toContain('phase3ShortDeReviewEsProfile');
    expect(routes).toContain(
      '`/admin/projects/:projectId/editorial-execution-envelopes/${profile.key}`',
    );
    expect(routes).toContain('profileKey: profile.key');
    expect(routes).toContain('maximumCalls: profile.maximumDispatches');
  });
  it('requires the current approved de to es brief before German authorization', () => {
    expect(budget).toContain('PHASE3_SHORT_DE_REVIEW_ES_PROFILE');
    expect(budget).toContain("a.artifact_type='CONTENT_BRIEF'");
    expect(budget).toContain("a.status='approved'");
    expect(budget).toContain('content.productionLanguage !== profile.productionLanguage');
    expect(budget).toContain('content.reviewLanguage !== profile.reviewLanguage');
  });
  it('isolates envelope lookup by profile key and version', () => {
    expect(budget).toContain('e.profile_key=? AND e.profile_version=?');
    expect(budget).toContain('profile.key');
    expect(budget).toContain('profile.version');
  });
  it('carries the selected profile languages into provider context', () => {
    expect(execution).toContain('key: boundedProfile.key');
    expect(execution).toContain('productionLanguage: boundedProfile.productionLanguage');
    expect(execution).toContain('reviewLanguage: boundedProfile.reviewLanguage');
  });
  it('keeps review output tied to the exact source without mutating it', () => {
    expect(execution).toContain('sourceScriptVersionId !== inputVersionId');
    expect(execution).toContain('source_script_version_id');
    expect(execution).not.toMatch(
      /UPDATE editorial_artifact_versions SET source_script_version_id/u,
    );
  });
  it('reserves atomically before constructing the provider adapter', () =>
    expect(execution.indexOf('reservationStatement(this.db')).toBeLessThan(
      execution.indexOf('new OpenAIResponsesAdapter'),
    ));
  it('marks dispatch and preserves ambiguous reservations', () => {
    expect(execution).toContain("status='DISPATCHED'");
    expect(execution).toContain("status='AMBIGUOUS'");
  });
  it('defines workspace/project isolation and one reservation per step', () => {
    expect(migration).toContain('workspace_id TEXT NOT NULL');
    expect(migration).toContain('project_id TEXT NOT NULL');
    expect(migration).toContain('UNIQUE(envelope_id,step_key)');
  });
  it('enforces two calls and the USD 0.007 integer ceiling', () => {
    expect(migration).toContain('monetary_ceiling_microusd<=7000');
    expect(migration).toContain('maximum_calls=2');
    expect(migration).toContain('execution_envelope_call_limit_exceeded');
    expect(migration).toContain('execution_envelope_budget_exceeded');
  });
  it('requires Owner/Admin permission and disallows body budget overrides', () => {
    expect(routes).toContain("requirePermission('providers:admin')");
    expect(routes).toContain('accepts no budget overrides');
  });
});
