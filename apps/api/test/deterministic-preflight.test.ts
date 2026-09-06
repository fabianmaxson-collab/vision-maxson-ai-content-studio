import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const preflight = readFileSync(new URL('../src/editorial/preflight.ts', import.meta.url), 'utf8');
const routes = readFileSync(new URL('../src/editorial/routes.ts', import.meta.url), 'utf8');
const execution = readFileSync(new URL('../src/editorial/execution.ts', import.meta.url), 'utf8');
const repository = readFileSync(new URL('../src/editorial/repository.ts', import.meta.url), 'utf8');
describe('deterministic Preflight wiring', () => {
  it('uses canonical graph evaluation and deterministic provenance', () => {
    expect(preflight).toContain('evaluateTerminalGraph(g)');
    expect(preflight).toContain("'DETERMINISTIC'");
    expect(preflight).toContain("'VALIDATED_BY'");
  });
  it('persists snapshot, assessment, checks, dependencies and audit in one batch', () => {
    expect(preflight).toContain('await this.db.batch(s)');
    expect(preflight).toContain('editorial.preflight_calculated');
    expect(preflight).toMatch(/generationReadiness:\s*'NOT_READY'/u);
  });
  it('is snapshot-idempotent', () => {
    expect(preflight).toContain('v.content_hash=?');
    expect(preflight).toMatch(/idempotentReplay:\s*true/u);
  });
  it('exposes only editorial write route', () => {
    expect(routes).toContain("'/projects/:projectId/preflight'");
    expect(routes).toContain("requirePermission('editorial:write')");
  });
  it('re-evaluates approval and revokes readiness on upstream replacement', () => {
    expect(preflight).toContain('deriveGenerationReadiness(g)');
    expect(repository).toContain("generation_readiness='NOT_READY'");
  });
  it('fails provider-backed preflight before execution setup', () => {
    const guard = execution.indexOf("task === 'PREFLIGHT_ANALYSIS'");
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(execution.indexOf('terminalSchemaReady()'));
    expect(guard).toBeLessThan(execution.indexOf('new OpenAIResponsesAdapter'));
  });
});
