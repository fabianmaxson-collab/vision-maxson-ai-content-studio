import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { governedRemediationCapacitySchema } from '@vision-maxson/contracts';
const service = readFileSync(
  new URL('../src/editorial/governed-remediation.ts', import.meta.url),
  'utf8',
);
const routes = readFileSync(new URL('../src/editorial/routes.ts', import.meta.url), 'utf8');
const migration = readFileSync(
  new URL(
    '../../../packages/db/migrations/0007_governed_remediation_capacity.sql',
    import.meta.url,
  ),
  'utf8',
);
const valid = {
  workspaceId: 'workspace_primary',
  originalProjectExecutionBudgetId: 'budget_old',
  expectedOriginalBudgetVersion: 1,
  expectedOriginalBudgetStatus: 'ACTIVE',
  historicalReservationId: 'reservation_old',
  historicalRunId: 'run_old',
  historicalEnvelopeId: 'envelope_old',
  remediationStage: 'STORYBOARD_PLANNER',
  providerKey: 'openai',
  modelKey: 'gpt-5.6-terra',
  remediationCeilingMicrousd: 321920,
  maximumCalls: 1,
  remediationProfileKey: 'phase3_storyboard_remediation_v1',
  remediationProfileVersion: 1,
  reasonCategory: 'PROVIDER_OUTPUT_SCHEMA_VALIDATION_AMBIGUOUS',
} as const;
describe('governed remediation capacity', () => {
  it('accepts only the exact bounded Storyboard policy', () => {
    expect(governedRemediationCapacitySchema.safeParse(valid).success).toBe(true);
    for (const bad of [
      { ...valid, remediationStage: 'SCRIPT_CRITIC' },
      { ...valid, modelKey: 'gpt-5.6-sol' },
      { ...valid, remediationCeilingMicrousd: 321921 },
      { ...valid, maximumCalls: 2 },
    ])
      expect(governedRemediationCapacitySchema.safeParse(bad).success).toBe(false);
  });
  it('requires providers admin and explicit idempotency', () => {
    expect(routes).toContain("'/admin/projects/:projectId/editorial-remediation-capacities'");
    expect(routes).toContain("requirePermission('providers:admin')");
    expect(routes).toContain("c.req.header('Idempotency-Key')");
  });
  it('gates every immutable historical link before its atomic batch', () => {
    for (const token of [
      "run.status='FAILED_PERMANENT'",
      "run.error_category='SCHEMA_VALIDATION'",
      "r.status='AMBIGUOUS'",
      'r.actual_microusd IS NULL',
      'r.dispatched_at IS NOT NULL',
      "olde.status='CONSUMED'",
      'olde.maximum_calls=1',
      'ob.version=?',
      "p.status='configured'",
      "m.status='available'",
    ])
      expect(service).toContain(token);
    expect(service.indexOf('remediation_historical_evidence_invalid')).toBeLessThan(
      service.indexOf('this.db.batch(['),
    );
  });
  it('creates capacity, envelope, remediation linkage, and audit in one batch only', () => {
    expect(service).toContain('this.db.batch([');
    expect(service).toContain('INSERT INTO editorial_project_execution_budgets');
    expect(service).toContain('INSERT INTO editorial_execution_envelopes');
    expect(service).toContain('INSERT INTO editorial_execution_remediations');
    expect(service).toContain('editorial.remediation_capacity_authorized');
    expect(service).not.toContain('INSERT INTO editorial_execution_reservations');
    expect(service).not.toContain('INSERT INTO intelligence_runs');
    expect(service).not.toContain('OpenAIResponsesAdapter');
  });
  it('preserves history and isolates ambiguity by a separate budget', () => {
    expect(service).not.toMatch(
      /UPDATE (intelligence_runs|intelligence_run_attempts|editorial_execution_reservations|editorial_execution_envelopes|editorial_project_execution_budgets)/u,
    );
    expect(migration).toContain('remediation_project_execution_budget_id');
    expect(migration).toContain('historical_reservation_id');
    expect(migration).toContain("profile_key='phase3_storyboard_remediation_v1'");
  });
  it('is unique, idempotent, and concurrency safe', () => {
    expect(migration).toContain('UNIQUE(workspace_id,idempotency_key)');
    expect(migration).toContain('UNIQUE(historical_reservation_id,profile_key,profile_version)');
    expect(service).toContain('remediation_idempotency_conflict');
    expect(service).toContain('remediation_already_exists');
    expect(service).toMatch(/const concurrent = await this\.replay/u);
  });
  it('stores the exact no-retry policy and never weakens the old guard', () => {
    for (const token of [
      'maximum_attempts',
      'sdk_max_retries',
      'fallback_enabled',
      'creative_regeneration_enabled',
      'external_research_enabled',
      'human_approval_required',
    ])
      expect(migration).toContain(token);
    expect(migration).not.toContain('DROP TRIGGER editorial_execution_reservation_ambiguous_guard');
  });
});
