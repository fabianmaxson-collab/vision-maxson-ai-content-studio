import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { governedTerminalBudgetSchema } from '@vision-maxson/contracts';
import {
  governedTerminalStages,
  governedTerminalStagePolicies,
} from '@vision-maxson/providers/execution-profile';
import { taskPolicy } from '@vision-maxson/providers/policy';

const execution = readFileSync(new URL('../src/editorial/execution.ts', import.meta.url), 'utf8');
const governance = readFileSync(
  new URL('../src/editorial/governed-budget.ts', import.meta.url),
  'utf8',
);
const routes = readFileSync(new URL('../src/editorial/routes.ts', import.meta.url), 'utf8');
const adapter = readFileSync(
  new URL('../../../packages/providers/src/openai.ts', import.meta.url),
  'utf8',
);
const preflight = readFileSync(new URL('../src/editorial/preflight.ts', import.meta.url), 'utf8');

const stages = governedTerminalStages.map((stageKey) => ({
  stageKey,
  providerKey: 'openai',
  modelKey: stageKey === 'SCRIPT_CRITIC' ? 'high-model' : 'balanced-model',
  monetaryCeilingMicrousd: 10_000,
}));

describe('governed terminal execution', () => {
  it('defines exactly the five governed terminal stages with one attempt', () => {
    expect(governedTerminalStages).toEqual([
      'TOPIC_RESEARCH',
      'IDEA_GENERATION',
      'CONTENT_BRIEF',
      'SCRIPT_CRITIC',
      'STORYBOARD_PLANNER',
    ]);
    expect(
      governedTerminalStages.every(
        (stage) => governedTerminalStagePolicies[stage].maximumAttempts === 1,
      ),
    ).toBe(true);
    expect(taskPolicy('TOPIC_RESEARCH').minimumQualityTier).toBe('BALANCED');
    expect(taskPolicy('CONTENT_BRIEF').minimumQualityTier).toBe('BALANCED');
    expect(taskPolicy('SCRIPT_CRITIC').minimumQualityTier).toBe('HIGH');
    expect(taskPolicy('STORYBOARD_PLANNER').minimumQualityTier).toBe('BALANCED');
  });

  it('requires one unique envelope declaration per stage within the project ceiling', () => {
    const valid = {
      profileKey: 'phase3_terminal_graph_v1' as const,
      profileVersion: 1 as const,
      monetaryCeilingMicrousd: 50_000,
      stages,
    };
    expect(governedTerminalBudgetSchema.safeParse(valid).success).toBe(true);
    expect(
      governedTerminalBudgetSchema.safeParse({ ...valid, stages: stages.slice(0, 4) }).success,
    ).toBe(false);
    expect(
      governedTerminalBudgetSchema.safeParse({
        ...valid,
        stages: [...stages.slice(0, 4), stages[0]],
      }).success,
    ).toBe(false);
    expect(
      governedTerminalBudgetSchema.safeParse({ ...valid, monetaryCeilingMicrousd: 49_999 }).success,
    ).toBe(false);
  });

  it('authorizes an active project budget and five one-call stage envelopes atomically', () => {
    expect(routes).toContain("'/admin/projects/:projectId/editorial-project-execution-budgets'");
    expect(routes).toContain("requirePermission('providers:admin')");
    expect(governance).toContain('await db.batch([');
    expect(governance).toContain('editorial_project_execution_budgets');
    expect(governance).toContain('project_execution_budget_id');
    expect(governance).toContain('stage_key');
    expect(governance).toMatch(/monetary_ceiling_microusd,maximum_calls[\s\S]*?,1,'ACTIVE'/u);
    expect(governance).toContain('active_governed_budget_conflict');
  });

  it('fails closed through exact upstream validation before run, reservation, or adapter', () => {
    const validation = execution.indexOf('const project = await this.projectContext');
    const modelRouting = execution.indexOf('const selected = routeModel');
    const envelope = execution.indexOf('? await loadGovernedTerminalEnvelope');
    const run = execution.indexOf('const insertRun');
    const adapterConstruction = execution.indexOf('new OpenAIResponsesAdapter');
    expect(validation).toBeGreaterThan(0);
    expect(validation).toBeLessThan(modelRouting);
    expect(modelRouting).toBeLessThan(envelope);
    expect(envelope).toBeLessThan(run);
    expect(run).toBeLessThan(adapterConstruction);
    expect(execution).toContain('Exact approved current ${artifactType} input is required.');
    expect(execution).toContain('The exact approved current Idea must be selected.');
    expect(execution).toContain('Storyboard requires the exact approved current Script Critique.');
  });

  it('persists the canonical task-specific lineage in the terminal batch', () => {
    expect(execution).toContain("dependencyType: 'GENERATED_FROM'");
    expect(execution).toContain("dependencyType: 'USES_RESEARCH'");
    expect(execution).toContain("dependencyType: 'EVALUATES_SOURCE'");
    expect(execution).toContain("dependencyType: 'INFORMED_BY'");
    expect(execution).toContain('for (const edge of lineage)');
    expect(execution).toContain('edge.dependencyType');
    expect(execution).toContain('Content Brief Research provenance is invalid.');
    expect(execution).toContain('Script Critique provenance is invalid.');
  });

  it('reserves before adapter construction and keeps one SDK attempt', () => {
    expect(execution.indexOf('reservationStatement(this.db')).toBeLessThan(
      execution.indexOf('new OpenAIResponsesAdapter'),
    );
    expect(execution).toContain('governedTerminalStagePolicies[task]');
    expect(governance).toContain('calculateGovernedReservation(row, stage.stageKey)');
    expect(adapter).toContain('maxRetries: 0');
    expect(adapter).toContain('{ timeout: request.timeoutMs, maxRetries: 0 }');
  });

  it('retains idempotent replay, terminal reconciliation, invalidation, and no provider Preflight', () => {
    expect(execution).toContain('Idempotency key is already bound to a different command.');
    expect(execution).toContain('idempotentReplay: true');
    expect(execution).toContain("status='AMBIGUOUS'");
    expect(execution).toContain("reconciled ? 'RECONCILED' : 'AMBIGUOUS'");
    expect(execution).toContain('invalidationFor(dependent.artifactType)');
    expect(execution).toContain("generation_readiness='NOT_READY'");
    expect(preflight).toContain('evaluateTerminalGraph(g)');
    expect(execution).toContain('Preflight is deterministic and cannot use a provider.');
  });
});
