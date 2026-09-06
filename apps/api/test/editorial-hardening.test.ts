import { describe, expect, it } from 'vitest';
import { intelligenceCommandSchema } from '@vision-maxson/contracts';
import { conservativeInputTokenUpperBound } from '@vision-maxson/providers/execution-profile';
import { reviewTranslationProviderContext } from '../src/editorial/execution';
import { phase3ShortDeReviewEsProfile } from '@vision-maxson/providers/execution-profile';
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
  it('keeps terminal auditing inside the writer and removes route-level completion audit', () => {
    expect(routes).not.toContain("await audit(c, 'intelligence.run_completed'");
    expect(execution).toContain('this.terminalAuditStatement(');
    expect(execution).toContain('terminal_audit_event_id=?');
  });
  it('fails closed on schema 0003 before configuration, reservation, or provider construction', () => {
    const gate = execution.indexOf('await this.terminalSchemaReady()');
    expect(gate).toBeGreaterThan(0);
    expect(gate).toBeLessThan(execution.indexOf('this.config.openAIEnabled'));
    expect(gate).toBeLessThan(execution.indexOf('reservationStatement(this.db'));
    expect(gate).toBeLessThan(execution.indexOf('new OpenAIResponsesAdapter'));
    expect(execution).toContain("pragma_table_info('intelligence_runs')");
  });
  it('writes attempt, reconciliation, terminal audit, and terminal run in one success batch', () => {
    const persistence = execution.slice(execution.indexOf('private async persist'));
    expect(persistence).toContain("UPDATE intelligence_run_attempts SET status='SUCCEEDED'");
    expect(persistence).toContain("reconciled ? 'RECONCILED' : 'AMBIGUOUS'");
    expect(persistence.indexOf('this.terminalAuditStatement(')).toBeLessThan(
      persistence.indexOf('UPDATE intelligence_runs SET output_artifact_version_id'),
    );
    expect(persistence).toContain('await this.db.batch(statements)');
  });
  it('writes failure attempt, ambiguous reservation, audit, and terminal run in one batch', () => {
    expect(execution).toContain("'intelligence.run_failed'");
    expect(execution).toContain("'failure'");
    expect(execution).toContain("status='AMBIGUOUS',reconciled_at=?");
    expect(execution).toContain('terminal_audit_event_id=?');
  });
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
  it('validates exact bounded provider material before dispatch without duplicating context', () => {
    expect(execution).toContain('const providerRequestInput = boundedStep ? {} : providerInput');
    expect(execution).toContain('input: providerRequestInput');
    expect(execution).toContain('renderPrompt(prompt.templateText, providerInput)');
    expect(execution.indexOf('Provider-bound input exceeds')).toBeLessThan(
      execution.indexOf('new OpenAIResponsesAdapter'),
    );
  });
  it('builds a dedicated review-only provider context with the complete exact source', () => {
    const sourceScript = 'Vollständiger autoritativer deutscher Text.';
    const context = reviewTranslationProviderContext(
      {
        id: 'project-1',
        brandName: 'must-not-be-provider-bound',
        channelName: 'must-not-be-provider-bound',
        editorialStrategyJson: 'must-not-be-provider-bound',
        approvedArtifacts: [{ artifactType: 'CONTENT_BRIEF', versionId: 'brief-version-1' }],
        exactSource: {
          artifactType: 'PRODUCTION_SCRIPT',
          versionId: 'script-version-1',
          languageCode: 'de',
          contentText: sourceScript,
        },
      },
      phase3ShortDeReviewEsProfile,
    );

    expect(context).toEqual({
      task: 'REVIEW_TRANSLATION_ES',
      sourceScriptVersionId: 'script-version-1',
      sourceLanguage: 'de',
      targetLanguage: 'es',
      sourceScript,
    });
    const serialized = JSON.stringify(context);
    expect(serialized.match(/Vollständiger autoritativer deutscher Text\./gu)).toHaveLength(1);
    expect(serialized).not.toContain('CONTENT_BRIEF');
    expect(serialized).not.toContain('must-not-be-provider-bound');
  });
  it('fails closed when the exact source text or production language is invalid', () => {
    expect(() =>
      reviewTranslationProviderContext(
        { exactSource: { versionId: 'script-version-1', languageCode: 'en', contentText: 'text' } },
        phase3ShortDeReviewEsProfile,
      ),
    ).toThrow('exact production-language source text');
    expect(() =>
      reviewTranslationProviderContext(
        { exactSource: { versionId: 'script-version-1', languageCode: 'de', contentText: null } },
        phase3ShortDeReviewEsProfile,
      ),
    ).toThrow('exact production-language source text');
  });
  it('still fails closed when a genuinely distinct source is oversized', () => {
    const estimate = conservativeInputTokenUpperBound({
      instructions: 'x'.repeat(8192),
      input: {},
      outputSchema: {},
    });
    expect(estimate).toBeGreaterThan(8192);
  });
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
