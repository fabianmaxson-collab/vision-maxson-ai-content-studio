import { createApp, type Bindings } from '../src/app';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { describe, it, expect, vi, afterEach, afterAll } from 'vitest';
import { briefFixture, actor } from './content-brief-revision-fixture';
import {
  ContentBriefRevisionCapacityService,
  loadContentBriefRevisionCapacity,
  loadContentBriefPreDispatchClaim,
  authorizeContentBriefRevisionDispatch,
  contentBriefPreDispatchClaimStatement,
} from '../src/editorial/content-brief-revision-capacity';
import { EditorialExecutionService } from '../src/editorial/execution';
import { loadGovernedTerminalEnvelope } from '../src/editorial/governed-budget';
import { OpenAIResponsesAdapter } from '@vision-maxson/providers/openai';
import * as openAIProvider from '@vision-maxson/providers/openai';
let localFakeProviderCalls = 0;
const fakeProviders: Array<{ mock: { calls: unknown[][] } }> = [];
afterEach(() => {
  for (const spy of fakeProviders.splice(0)) localFakeProviderCalls += spy.mock.calls.length;
  vi.restoreAllMocks();
});
afterAll(() => {
  expect(localFakeProviderCalls).toBe(15);
});
const service = (f: Awaited<ReturnType<typeof briefFixture>>, who = actor) =>
  new ContentBriefRevisionCapacityService(f.d1, who, {
    requestId: 'brief-create-request',
    environment: 'test',
  });
const execution = (f: Awaited<ReturnType<typeof briefFixture>>) =>
  new EditorialExecutionService(f.d1, actor, {
    openAIEnabled: true,
    openAIApiKey: 'test-placeholder',
    openAIBaseUrl: 'https://invalid.test',
    environment: 'test',
    requestId: 'brief-execution',
  });
const command = (capacityId: string) => ({
  mode: 'LOCKED' as const,
  preferredProviderKey: 'openai',
  preferredModelKey: 'gpt-5.6-terra',
  inputArtifactVersionId: 'new-idea-v1',
  creativeRegeneration: false,
  contentBriefRevisionCapacityId: capacityId,
});
const counts = (f: Awaited<ReturnType<typeof briefFixture>>) =>
  [
    'editorial_project_execution_budgets',
    'editorial_execution_envelopes',
    'editorial_content_brief_revision_capacities',
    'audit_events',
    'intelligence_runs',
    'intelligence_run_attempts',
    'editorial_execution_reservations',
    'editorial_artifact_versions',
  ].map((t) => Number(f.database.prepare(`SELECT count(*) n FROM ${t}`).get()!.n));
const briefOutput = (research: string) => ({
  topic: 'Technical history',
  objective: 'Explain',
  audience: 'Learners',
  primaryPlatformId: 'platform',
  secondaryPlatformIds: [],
  productionLanguage: 'de',
  reviewLanguage: 'es',
  format: 'SHORT',
  targetDurationSeconds: 60,
  narrativeAngle: 'Evidence',
  hook: 'Hook',
  tone: 'Factual',
  cta: 'Learn',
  visualDirection: 'Diagram',
  characterVersionIds: [],
  voiceProfileId: null,
  monetizationStrategy: 'None',
  platformConstraints: [],
  editorialConstraints: [],
  researchVersionIds: [research],
  userNotes: '',
});

function fake(f: Awaited<ReturnType<typeof briefFixture>>, inputUnits = 10, outputUnits = 20) {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('real network forbidden'));
  const spy = vi.spyOn(OpenAIResponsesAdapter.prototype, 'execute').mockResolvedValue({
    output: briefOutput(f.command.researchVersionId),
    usage: {
      inputUnits,
      outputUnits,
      cachedInputUnits: 0,
      reasoningOutputUnits: 0,
      unitName: 'token',
    },
    providerRequestId: 'fake-brief',
    safeMetadata: {},
  });
  fakeProviders.push(spy);
  return spy;
}
describe('Content Brief revision authorization', () => {
  it('creates only budget envelope receipt audit, durable replay and conflicting commands', async () => {
    const f = await briefFixture();
    try {
      const before = counts(f);
      const r = await service(f).authorize(f.requestId, 'capacity-key', f.command);
      expect(counts(f).map((v, i) => v - before[i]!)).toEqual([1, 1, 1, 1, 0, 0, 0, 0]);
      expect(await service(f).authorize(f.requestId, 'capacity-key', f.command)).toEqual({
        ...r,
        idempotentReplay: true,
      });
      await expect(
        service(f).authorize(f.requestId, 'capacity-key', {
          ...f.command,
          expectedProjectVersion: 3,
        }),
      ).rejects.toMatchObject({ status: 409 });
      await expect(
        service(f).authorize(f.requestId, 'different-key', f.command),
      ).rejects.toMatchObject({ status: 409 });
      expect(counts(f).map((v, i) => v - before[i]!)).toEqual([1, 1, 1, 1, 0, 0, 0, 0]);
    } finally {
      f.database.close();
    }
  });
  it('allows one fake provider dispatch and immutable replacement Brief with exact lineage', async () => {
    const f = await briefFixture();
    try {
      const old = f.database
        .prepare("SELECT * FROM editorial_artifact_versions WHERE id='brief-v1'")
        .get();
      const r = await service(f).authorize(f.requestId, 'capacity-key', f.command);
      const adapter = fake(f);
      const result = await execution(f).execute(
        'project',
        'CONTENT_BRIEF',
        command(r.capacityId),
        'execution-key',
      );
      expect(result.run.status).toBe('SUCCEEDED');
      expect(adapter).toHaveBeenCalledTimes(1);
      expect(
        f.database.prepare("SELECT * FROM editorial_artifact_versions WHERE id='brief-v1'").get(),
      ).toEqual(old);
      const v = f.database
        .prepare('SELECT * FROM editorial_artifact_versions WHERE id=?')
        .get(String(result.run.outputArtifactVersionId));
      expect(v).toMatchObject({ parent_version_id: 'brief-v1', source_type: 'AI_GENERATED' });
      expect(
        f.database.prepare("SELECT status FROM editorial_artifacts WHERE id='brief'").get(),
      ).toEqual({ status: 'active' });
      expect(
        f.database
          .prepare(
            'SELECT source_artifact_version_id,dependency_type FROM artifact_dependencies WHERE dependent_artifact_version_id=? ORDER BY dependency_type',
          )
          .all(String(result.run.outputArtifactVersionId)),
      ).toEqual([
        { source_artifact_version_id: 'new-idea-v1', dependency_type: 'GENERATED_FROM' },
        {
          source_artifact_version_id: f.command.researchVersionId,
          dependency_type: 'USES_RESEARCH',
        },
      ]);
      expect(
        f.database
          .prepare('SELECT status FROM editorial_revision_requests WHERE id=?')
          .get(f.requestId),
      ).toEqual({ status: 'OPEN' });
      expect(
        f.database
          .prepare(
            "SELECT count(*) n FROM audit_events WHERE action='editorial.content_brief_revision_capacity_consumed'",
          )
          .get(),
      ).toEqual({ n: 1 });
      expect(f.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      expect(
        (
          await execution(f).execute(
            'project',
            'CONTENT_BRIEF',
            command(r.capacityId),
            'execution-key',
          )
        ).idempotentReplay,
      ).toBe(true);
      await expect(
        execution(f).execute('project', 'CONTENT_BRIEF', command(r.capacityId), 'second-key'),
      ).rejects.toThrow();
      expect(adapter).toHaveBeenCalledTimes(1);
    } finally {
      f.database.close();
    }
  });
  it('isolates wrong stages and selectors without provider calls', async () => {
    const f = await briefFixture();
    try {
      const r = await service(f).authorize(f.requestId, 'capacity-key', f.command);
      const adapter = fake(f);
      for (const task of ['IDEA_GENERATION', 'STORYBOARD_PLANNER'] as const)
        await expect(
          execution(f).execute('project', task, command(r.capacityId), 'wrong-' + task),
        ).rejects.toThrow();
      for (const selector of [
        { ideaRevisionCapacityId: r.capacityId },
        { remediationId: r.capacityId },
      ])
        await expect(
          execution(f).execute(
            'project',
            'CONTENT_BRIEF',
            { ...command(r.capacityId), ...selector },
            'cross',
          ),
        ).rejects.toThrow();
      expect(adapter).not.toHaveBeenCalled();
    } finally {
      f.database.close();
    }
  });
  it.each([true, false])('serializes concurrent creation, same key=%s', async (same) => {
    const f = await briefFixture();
    try {
      const out = await Promise.allSettled([
        service(f).authorize(f.requestId, 'first', f.command),
        service(f).authorize(f.requestId, same ? 'first' : 'second', f.command),
      ]);
      expect(out.filter((x) => x.status === 'fulfilled')).toHaveLength(same ? 2 : 1);
      expect(
        f.database
          .prepare('SELECT count(*) n FROM editorial_content_brief_revision_capacities')
          .get(),
      ).toEqual({ n: 1 });
    } finally {
      f.database.close();
    }
  });
  it('concurrent execution has one dispatch', async () => {
    const f = await briefFixture();
    try {
      const r = await service(f).authorize(f.requestId, 'capacity-key', f.command);
      const a = fake(f);
      const results = await Promise.allSettled([
        execution(f).execute('project', 'CONTENT_BRIEF', command(r.capacityId), 'first-exec'),
        execution(f).execute('project', 'CONTENT_BRIEF', command(r.capacityId), 'second-exec'),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(a).toHaveBeenCalledTimes(1);
    } finally {
      f.database.close();
    }
  });
  it('rejects RBAC and cross workspace', async () => {
    const f = await briefFixture();
    try {
      await expect(
        service(f, { ...actor, roles: ['viewer'] }).authorize(f.requestId, 'key', f.command),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        service(f, { id: 'other-user', workspaceId: 'other', roles: ['owner'] }).authorize(
          f.requestId,
          'key',
          f.command,
        ),
      ).rejects.toMatchObject({ status: 404 });
    } finally {
      f.database.close();
    }
  });
  it('rejects schema 0014 before any write', async () => {
    const f = await briefFixture(false);
    try {
      await expect(service(f).authorize(f.requestId, 'key', f.command)).rejects.toMatchObject({
        status: 422,
      });
    } finally {
      f.database.close();
    }
  });
  it.each([
    "UPDATE projects SET version=3 WHERE id='project'",
    "UPDATE projects SET status='DRAFT' WHERE id='project'",
    "UPDATE idea_candidates SET status='CANDIDATE',version=version+1 WHERE id='new-candidate'",
    "UPDATE idea_candidates SET version=3 WHERE id='new-candidate'",
    "UPDATE editorial_artifacts SET version=version+1 WHERE id='new-idea'",
    "UPDATE editorial_artifacts SET version=version+1 WHERE id='research'",
    "UPDATE editorial_artifacts SET version=version+1 WHERE id='brief'",
    "UPDATE artifact_dependencies SET validity_status='STALE',version=version+1 WHERE id='new-lineage'",
    "UPDATE ai_provider_models SET status='inactive' WHERE id='model_openai_gpt_5_6_terra_20260903'",
    "UPDATE ai_provider_models SET version=version+1 WHERE id='model_openai_gpt_5_6_terra_20260903'",
    "UPDATE ai_providers SET status='inactive' WHERE id='provider_openai'",
    "UPDATE prompt_definitions SET status='inactive' WHERE id='prompt_content_brief'",
  ])('rejects stale preclaim binding: %s', async (sql) => {
    const f = await briefFixture();
    try {
      const r = await service(f).authorize(f.requestId, 'key', f.command);
      f.database.exec(sql);
      const before = counts(f);
      await expect(
        loadContentBriefRevisionCapacity(
          f.d1,
          actor,
          'project',
          r.capacityId,
          'new-idea-v1',
          'test',
        ),
      ).rejects.toThrow();
      expect(counts(f)).toEqual(before);
    } finally {
      f.database.close();
    }
  });
});

const statementSql = (s: D1PreparedStatement) => (s as unknown as { sql: string }).sql;
it('zero-provider recovery is bounded, durable and executable once', async () => {
  const f = await briefFixture();
  try {
    const admin = service(f);
    const c = await admin.authorize(f.requestId, 'capacity-key', f.command);
    const adapter = fake(f);
    const original = f.d1.batch.bind(f.d1);
    let injected = false;
    vi.spyOn(f.d1, 'batch').mockImplementation(async (statements) => {
      if (!injected && statementSql(statements[0]!).includes("SET status='DISPATCHED'")) {
        injected = true;
        f.database.exec("UPDATE projects SET version=3 WHERE id='project'");
      }
      return original(statements);
    });
    await expect(
      execution(f).execute('project', 'CONTENT_BRIEF', command(c.capacityId), 'failure'),
    ).rejects.toThrow();
    expect(adapter).not.toHaveBeenCalled();
    const run = f.database
      .prepare("SELECT * FROM intelligence_runs WHERE idempotency_key='failure'")
      .get()!;
    const reservation = f.database
      .prepare('SELECT * FROM editorial_execution_reservations WHERE intelligence_run_id=?')
      .get(run.id!)!;
    expect(reservation).toMatchObject({
      status: 'CANCELLED',
      actual_microusd: 0,
      dispatched_at: null,
    });
    assertZeroProviderTerminal(f, String(run.id), c.capacityId, 'ELIGIBILITY_REJECTED');
    expect(
      (await execution(f).execute('project', 'CONTENT_BRIEF', command(c.capacityId), 'failure'))
        .idempotentReplay,
    ).toBe(true);
    await expect(
      execution(f).execute('project', 'CONTENT_BRIEF', command(c.capacityId), 'failure-other-key'),
    ).rejects.toThrow();
    expect(adapter).not.toHaveBeenCalled();
    const rc = {
      expectedFailedRunId: String(run.id),
      expectedFailedReservationId: String(reservation.id),
      expectedProjectVersion: 3,
    };
    const r = await admin.recover(c.capacityId, 'recovery', rc);
    expect(r.budgetId).toBe(c.budgetId);
    expect((await admin.recover(c.capacityId, 'recovery', rc)).idempotentReplay).toBe(true);
    await expect(admin.recover(c.capacityId, 'recovery-second', rc)).rejects.toMatchObject({
      status: 409,
    });
    const result = await execution(f).execute(
      'project',
      'CONTENT_BRIEF',
      command(c.capacityId),
      'after-recovery',
    );
    expect(result.run.status).toBe('SUCCEEDED');
    expect(adapter).toHaveBeenCalledTimes(1);
    expect(
      f.database
        .prepare('SELECT * FROM editorial_execution_reservations WHERE id=?')
        .get(reservation.id!),
    ).toEqual(reservation);
    expect(f.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally {
    f.database.close();
  }
});
it.each([0, 1, 2, 3])('authorization rollback at statement %i', async (index) => {
  const f = await briefFixture();
  try {
    const before = counts(f);
    const original = f.d1.batch.bind(f.d1);
    vi.spyOn(f.d1, 'batch').mockImplementationOnce((statements) =>
      original([
        ...statements.slice(0, index),
        f.d1.prepare('INSERT INTO no_such_table VALUES(1)'),
      ]),
    );
    await expect(service(f).authorize(f.requestId, 'key', f.command)).rejects.toThrow();
    expect(counts(f)).toEqual(before);
  } finally {
    f.database.close();
  }
});
it.each([0, 1, 2, 3])(
  'dispatch rollback at statement %i has zero provider calls',
  async (index) => {
    const f = await briefFixture();
    try {
      const c = await service(f).authorize(f.requestId, 'key', f.command);
      const adapter = fake(f);
      const original = f.d1.batch.bind(f.d1);
      let failed = false;
      vi.spyOn(f.d1, 'batch').mockImplementation((statements) => {
        if (!failed && statementSql(statements[0]!).includes("SET status='DISPATCHED'")) {
          failed = true;
          return original([
            ...statements.slice(0, index),
            f.d1.prepare('INSERT INTO no_such_table VALUES(1)'),
          ]);
        }
        return original(statements);
      });
      await expect(
        execution(f).execute('project', 'CONTENT_BRIEF', command(c.capacityId), 'exec'),
      ).rejects.toThrow();
      expect(adapter).not.toHaveBeenCalled();
      const failedRun = f.database
        .prepare("SELECT id FROM intelligence_runs WHERE idempotency_key='exec'")
        .get()!;
      const failedReservation = assertZeroProviderTerminal(
        f,
        String(failedRun.id),
        c.capacityId,
        null,
      );
      expect(
        (await execution(f).execute('project', 'CONTENT_BRIEF', command(c.capacityId), 'exec'))
          .idempotentReplay,
      ).toBe(true);
      await expect(
        execution(f).execute('project', 'CONTENT_BRIEF', command(c.capacityId), 'different-exec'),
      ).rejects.toThrow();
      // A rolled-back SQL fault is not proof of an eligibility rejection. Recovery stays restricted.
      await expect(
        service(f).recover(c.capacityId, 'recover', {
          expectedProjectVersion: 2,
          expectedFailedRunId: String(failedRun.id),
          expectedFailedReservationId: String(failedReservation.id),
        }),
      ).rejects.toMatchObject({ status: 409 });
      expect(adapter).not.toHaveBeenCalled();
      expect(
        f.database
          .prepare(
            "SELECT count(*) n FROM audit_events WHERE action='editorial.content_brief_revision_capacity_consumed'",
          )
          .get(),
      ).toEqual({ n: 0 });
      expect(
        f.database
          .prepare(
            "SELECT count(*) n FROM intelligence_run_attempts WHERE intelligence_run_id IN (SELECT id FROM intelligence_runs WHERE idempotency_key='exec')",
          )
          .get(),
      ).toEqual({ n: 0 });
    } finally {
      f.database.close();
    }
  },
);
it('lost dispatch confirmation never invokes or recovers provider', async () => {
  const f = await briefFixture();
  try {
    const c = await service(f).authorize(f.requestId, 'key', f.command);
    const adapter = fake(f);
    const original = f.d1.batch.bind(f.d1);
    let failed = false;
    vi.spyOn(f.d1, 'batch').mockImplementation(async (statements) => {
      const result = await original(statements);
      if (!failed && statementSql(statements[0]!).includes("SET status='DISPATCHED'")) {
        failed = true;
        throw new Error('confirmation lost');
      }
      return result;
    });
    await expect(
      execution(f).execute('project', 'CONTENT_BRIEF', command(c.capacityId), 'exec'),
    ).rejects.toThrow();
    expect(adapter).not.toHaveBeenCalled();
    expect(
      (await execution(f).execute('project', 'CONTENT_BRIEF', command(c.capacityId), 'exec'))
        .idempotentReplay,
    ).toBe(true);
    await expect(
      execution(f).execute('project', 'CONTENT_BRIEF', command(c.capacityId), 'new-exec'),
    ).rejects.toThrow();
    expect(adapter).not.toHaveBeenCalled();
    const r = f.database
      .prepare('SELECT * FROM editorial_execution_reservations WHERE envelope_id=?')
      .get(c.envelopeId)!;
    await expect(
      service(f).recover(c.capacityId, 'recovery', {
        expectedProjectVersion: 2,
        expectedFailedRunId: String(r.intelligence_run_id),
        expectedFailedReservationId: String(r.id),
      }),
    ).rejects.toThrow();
  } finally {
    f.database.close();
  }
});
it.each([
  [0, 0, 0],
  [10, 20, 260],
  [100960, 0, 201920],
  [100961, 0, 201922],
])('preserves actual microUSD for %i/%i', async (input, output, expected) => {
  const f = await briefFixture();
  try {
    const c = await service(f).authorize(f.requestId, 'key', f.command);
    fake(f, input, output);
    await execution(f).execute('project', 'CONTENT_BRIEF', command(c.capacityId), 'exec');
    expect(
      f.database
        .prepare(
          'SELECT reserved_microusd,actual_microusd,status FROM editorial_execution_reservations WHERE envelope_id=?',
        )
        .get(c.envelopeId),
    ).toEqual({
      reserved_microusd: 201920,
      actual_microusd: expected,
      status: expected > 201920 ? 'AMBIGUOUS' : 'RECONCILED',
    });
  } finally {
    f.database.close();
  }
});
it.each(['invalid-output', 'wrong-research', 'lineage-drift', 'persistence-failure'])(
  'does not publish partial Brief after %s',
  async (kind) => {
    const f = await briefFixture();
    try {
      const c = await service(f).authorize(f.requestId, 'key', f.command);
      const adapter = fake(f);
      const before = f.database.prepare("SELECT * FROM editorial_artifacts WHERE id='brief'").get();
      const prior = f.database.prepare('SELECT * FROM artifact_dependencies ORDER BY id').all();
      const result = {
        output: briefOutput(f.command.researchVersionId),
        usage: {
          inputUnits: 10,
          outputUnits: 20,
          cachedInputUnits: 0,
          reasoningOutputUnits: 0,
          unitName: 'token',
        },
        providerRequestId: 'fake-result',
        safeMetadata: {},
      };
      adapter.mockImplementation(() => {
        if (kind === 'lineage-drift')
          f.database.exec("UPDATE projects SET version=3 WHERE id='project'");
        return Promise.resolve({
          ...result,
          output:
            kind === 'invalid-output'
              ? {}
              : kind === 'wrong-research'
                ? { ...result.output, researchVersionIds: ['research-v1'] }
                : result.output,
        });
      });
      if (kind === 'persistence-failure') {
        const original = f.d1.batch.bind(f.d1);
        vi.spyOn(f.d1, 'batch').mockImplementation((statements) =>
          original(
            statements.some((x) =>
              statementSql(x).includes('INSERT INTO editorial_artifact_versions'),
            )
              ? [...statements, f.d1.prepare('INSERT INTO no_such_table VALUES(1)')]
              : statements,
          ),
        );
      }
      await expect(
        execution(f).execute('project', 'CONTENT_BRIEF', command(c.capacityId), 'exec'),
      ).rejects.toThrow();
      expect(adapter).toHaveBeenCalledTimes(1);
      expect(
        f.database.prepare("SELECT * FROM editorial_artifacts WHERE id='brief'").get(),
      ).toEqual(before);
      expect(f.database.prepare('SELECT * FROM artifact_dependencies ORDER BY id').all()).toEqual(
        prior,
      );
      expect(
        f.database
          .prepare(
            'SELECT actual_microusd FROM editorial_execution_reservations WHERE envelope_id=?',
          )
          .get(c.envelopeId),
      ).toEqual({ actual_microusd: 260 });
    } finally {
      f.database.close();
    }
  },
);

it.each([false, true])(
  'executes real SQL with SQLITE_LIMIT_EXPR_DEPTH=100, recovery=%s',
  async (recovery) => {
    const f = await briefFixture();
    try {
      const objects = f.database
        .prepare(
          "SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid",
        )
        .all();
      const data = objects
        .filter((o) => o.type === 'table')
        .map((o) => ({
          name: o.name,
          rows: f.database.prepare(`SELECT * FROM ${String(o.name)}`).all(),
        }));
      const batches: Array<Array<{ sql: string; values: unknown[] }>> = [];
      const original = f.d1.batch.bind(f.d1);
      const failures: number[] = [];
      let injected = false;
      vi.spyOn(f.d1, 'batch').mockImplementation(async (statements) => {
        if (
          recovery &&
          !injected &&
          statementSql(statements[0]!).includes("SET status='DISPATCHED'")
        ) {
          injected = true;
          const sql = "UPDATE projects SET version=3 WHERE id='project'";
          f.database.exec(sql);
          batches.push([{ sql, values: [] }]);
        }
        const index = batches.length;
        batches.push(
          statements.map((s) => ({
            sql: statementSql(s),
            values: (s as unknown as { values: unknown[] }).values,
          })),
        );
        try {
          return await original(statements);
        } catch (error) {
          failures.push(index);
          throw error;
        }
      });
      const c = await service(f).authorize(f.requestId, 'depth-capacity', f.command);
      fake(f);
      if (recovery) {
        await expect(
          execution(f).execute('project', 'CONTENT_BRIEF', command(c.capacityId), 'depth-failed'),
        ).rejects.toThrow();
        const r = f.database
          .prepare('SELECT * FROM editorial_execution_reservations WHERE envelope_id=?')
          .get(c.envelopeId)!;
        await service(f).recover(c.capacityId, 'depth-recovery', {
          expectedProjectVersion: 3,
          expectedFailedRunId: String(r.intelligence_run_id),
          expectedFailedReservationId: String(r.id),
        });
      }
      await execution(f).execute('project', 'CONTENT_BRIEF', command(c.capacityId), 'depth-exec');
      const python = `import sys,json,sqlite3
p=json.load(sys.stdin);d=sqlite3.connect(':memory:')
for o in p['objects']:
 if o['type']=='table':d.execute(o['sql'])
for t in p['data']:
 for r in t['rows']:
  r={k:v for k,v in r.items() if k in [x[1] for x in d.execute('PRAGMA table_info('+t['name']+')')]}
  d.execute('INSERT INTO '+t['name']+'('+','.join(r.keys())+') VALUES('+','.join('?' for _ in r)+')',list(r.values()))
for o in p['objects']:
 if o['type']!='table':d.execute(o['sql'])
d.commit();d.execute('PRAGMA foreign_keys=ON');d.setlimit(sqlite3.SQLITE_LIMIT_EXPR_DEPTH,100)
assert d.getlimit(sqlite3.SQLITE_LIMIT_EXPR_DEPTH)==100
for index,batch in enumerate(p['batches']):
 try:
  with d:
   for s in batch:d.execute(s['sql'],s['values'])
  assert index not in p['failures']
 except sqlite3.DatabaseError as err:
  assert index in p['failures'] and 'content_brief_revision' in str(err),str(err)
assert d.execute('PRAGMA foreign_key_check').fetchall()==[]
assert d.execute("SELECT COUNT(*) FROM editorial_content_brief_revision_capacities").fetchone()[0]==1
assert d.execute("SELECT COUNT(*) FROM intelligence_runs WHERE idempotency_key='depth-exec' AND status='SUCCEEDED'").fetchone()[0]==1
print('EXPR_DEPTH_100_RUNTIME_PASS')`;
      const result = spawnSync('python', ['-c', python], {
        input: JSON.stringify({ objects, data, batches, failures }),
        encoding: 'utf8',
        maxBuffer: 8 * 1024 * 1024,
      });
      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe('EXPR_DEPTH_100_RUNTIME_PASS');
    } finally {
      f.database.close();
    }
  },
);

const accessIdentity = {
  issuer: 'https://team.cloudflareaccess.com',
  subject: 'owner-subject',
  email: 'owner@example.test',
};
function revisionBindings(db: D1Database): Bindings {
  return {
    ENVIRONMENT: 'staging',
    RELEASE_VERSION: 'test',
    ACCESS_TEAM_DOMAIN: accessIdentity.issuer,
    ACCESS_AUD: '1234567890123456',
    APP_ORIGIN: 'https://staging.vision.directormaxson.com',
    OWNER_BOOTSTRAP_ENABLED: 'false',
    BOOTSTRAP_OWNER_EMAIL: accessIdentity.email,
    TOKEN_ENCRYPTION_KEY: 'unused',
    OPENAI_PROVIDER_ENABLED: 'false',
    AI_PROVIDER_CONNECTIVITY_DIAGNOSTIC_ENABLED: 'false',
    DB: db,
    ASSETS: {} as Fetcher,
  };
}
function revisionPost(db: D1Database, path: string, body: unknown, idempotencyKey = 'route-key') {
  return createApp(() => Promise.resolve(accessIdentity)).request(
    path,
    {
      method: 'POST',
      headers: {
        Origin: 'https://staging.vision.directormaxson.com',
        'Content-Type': 'application/json',
        'Cf-Access-Jwt-Assertion': 'verified-by-test-double',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(body),
    },
    revisionBindings(db),
  );
}

it('HTTP contract creation replay conflicts and no override', async () => {
  const f = await briefFixture();
  try {
    const url = `/api/v1/editorial-revision-requests/${f.requestId}/content-brief-generation-capacity`;
    expect((await revisionPost(f.d1, url, f.command)).status).toBe(201);
    expect((await revisionPost(f.d1, url, f.command)).status).toBe(200);
    expect(
      (await revisionPost(f.d1, url, { ...f.command, expectedProjectVersion: 3 })).status,
    ).toBe(409);
    expect((await revisionPost(f.d1, url, f.command, 'new-key')).status).toBe(409);
    expect(
      (await revisionPost(f.d1, url, { ...f.command, maximumCalls: 2 }, 'invalid')).status,
    ).toBe(422);
  } finally {
    f.database.close();
  }
});
it.each([
  'idea_version_id',
  'research_content_hash',
  'binding_json',
  'policy_snapshot_json',
  'expected_idea_candidate_revision',
  'expected_idea_artifact_revision',
  'brief_artifact_id',
  'expected_current_brief_version_id',
  'expected_brief_artifact_revision',
  'request_id',
  'stage_key',
  'profile_key',
  'monetary_ceiling_microusd',
  'research_approval_id',
  'idea_approval_id',
  'result_json',
])('SQL guard rejects corrupt receipt %s atomically', async (field) => {
  const f = await briefFixture();
  try {
    const before = counts(f),
      original = f.d1.batch.bind(f.d1);
    vi.spyOn(f.d1, 'batch').mockImplementationOnce((statements) => {
      const last = statements.at(-1) as unknown as { sql: string; values: unknown[] };
      const columns = last.sql.slice(last.sql.indexOf('(') + 1, last.sql.indexOf(')')).split(',');
      last.values[columns.indexOf(field) + 1] = field.endsWith('_json') ? '{}' : 'corrupt';
      return original(statements);
    });
    await expect(service(f).authorize(f.requestId, 'key', f.command)).rejects.toThrow();
    expect(counts(f)).toEqual(before);
  } finally {
    f.database.close();
  }
});
it('upgrade preserves rows, protected project and historical graph', async () => {
  const f = await briefFixture(false);
  try {
    f.database.exec(
      "INSERT INTO projects(id,workspace_id,content_brand_id,channel_profile_id,title,status,format,operating_mode,primary_language,created_at,updated_at,version) VALUES('protected-tim','workspace','brand','channel','Tim protected','DRAFT','SHORT','ASSISTED','de','t','t',1)",
    );
    const tables = [
      'projects',
      'editorial_artifacts',
      'editorial_artifact_versions',
      'artifact_dependencies',
      'artifact_approvals',
      'editorial_revision_requests',
      'intelligence_runs',
      'intelligence_run_attempts',
      'editorial_execution_reservations',
    ];
    const snapshot = () =>
      tables.map((t) => f.database.prepare(`SELECT * FROM ${t} ORDER BY id`).all());
    const before = snapshot();
    f.database.exec(
      readFileSync(
        new URL(
          '../../../packages/db/migrations/0015_governed_content_brief_revision_capacity.sql',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    expect(snapshot()).toEqual(before);
    await service(f).authorize(f.requestId, 'key', f.command);
    expect(snapshot()).toEqual(before);
    expect(f.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally {
    f.database.close();
  }
});
it('unknown cost retains reservation exposure', async () => {
  const f = await briefFixture();
  try {
    const c = await service(f).authorize(f.requestId, 'key', f.command);
    fake(f).mockRejectedValue(new Error('provider response unavailable'));
    await expect(
      execution(f).execute('project', 'CONTENT_BRIEF', command(c.capacityId), 'unknown-cost'),
    ).rejects.toThrow();
    expect(
      f.database
        .prepare(
          'SELECT status,reserved_microusd,actual_microusd FROM editorial_execution_reservations WHERE envelope_id=?',
        )
        .get(c.envelopeId),
    ).toEqual({ status: 'AMBIGUOUS', reserved_microusd: 201920, actual_microusd: null });
  } finally {
    f.database.close();
  }
});

// Simulate historical corruption with the original guards restored before the API reads it.
function driftFixture(f: Awaited<ReturnType<typeof briefFixture>>, sql: string) {
  const triggers = f.database
    .prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger'")
    .all();
  for (const t of triggers) f.database.exec(`DROP TRIGGER ${String(t.name)}`);
  try {
    f.database.exec(sql);
  } finally {
    for (const t of triggers) f.database.exec(String(t.sql));
  }
}
it.each([
  "UPDATE editorial_artifacts SET current_version_id='research-v1' WHERE id='research'",
  "UPDATE artifact_approvals SET decision='REJECTED' WHERE id='approval-v2'",
  "UPDATE artifact_approvals SET decision='REJECTED' WHERE id='new-idea-approval'",
  "UPDATE editorial_artifacts SET current_version_id='idea-v1' WHERE id='new-idea'",
  "UPDATE editorial_artifact_versions SET content_hash='dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd' WHERE id='new-idea-v1'",
  "UPDATE editorial_artifact_versions SET content_hash='dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd' WHERE artifact_id='research' AND version_number=2",
  "DELETE FROM artifact_dependencies WHERE id='new-lineage'",
  "INSERT INTO artifact_dependencies(id,workspace_id,source_artifact_version_id,dependent_artifact_version_id,dependency_type,validity_status,created_at,updated_at) VALUES('ambiguous-lineage','workspace','research-v1','new-idea-v1','GENERATED_FROM','CURRENT','t','t')",
  "UPDATE artifact_dependencies SET source_artifact_version_id='research-v1' WHERE id='new-lineage'",
  "UPDATE ai_pricing_snapshots SET input_unit_price=0.000003 WHERE id='pricing_model_openai_gpt_5_6_terra_20260903'",
  "UPDATE ai_pricing_snapshots SET verification_status='stale' WHERE id='pricing_model_openai_gpt_5_6_terra_20260903'",
  "UPDATE ai_provider_models SET capabilities_json='{}' WHERE id='model_openai_gpt_5_6_terra_20260903'",
  "UPDATE ai_provider_models SET model_key='different' WHERE id='model_openai_gpt_5_6_terra_20260903'",
  "UPDATE prompt_versions SET template_text='drift' WHERE id='prompt_version_content_brief_v1'",
  "INSERT INTO editorial_revision_request_resolutions(id,workspace_id,project_id,revision_request_id,status,resolution_artifact_version_id,resolved_by,idempotency_key,command_hash,audit_event_id,resolved_at) SELECT 'closed-resolution',workspace_id,project_id,id,'RESOLVED','brief-v1','owner','resolution-key',printf('%064d',0),'historical-terminal-audit','t' FROM editorial_revision_requests",
])('rejects changed binding before claim: %s', async (sql) => {
  const f = await briefFixture();
  try {
    const c = await service(f).authorize(f.requestId, 'key', f.command);
    driftFixture(f, sql);
    const before = counts(f);
    const a = fake(f);
    await expect(
      execution(f).execute('project', 'CONTENT_BRIEF', command(c.capacityId), 'exec'),
    ).rejects.toThrow();
    expect(counts(f)).toEqual(before);
    expect(a).not.toHaveBeenCalled();
  } finally {
    f.database.close();
  }
});
it('rejects source drift arriving inside the claim transaction', async () => {
  const f = await briefFixture();
  try {
    const c = await service(f).authorize(f.requestId, 'key', f.command);
    const a = fake(f),
      before = counts(f),
      original = f.d1.batch.bind(f.d1);
    vi.spyOn(f.d1, 'batch').mockImplementationOnce((statements) => {
      f.database.exec("UPDATE projects SET version=3 WHERE id='project'");
      return original(statements);
    });
    await expect(
      execution(f).execute('project', 'CONTENT_BRIEF', command(c.capacityId), 'exec'),
    ).rejects.toThrow();
    expect(counts(f)).toEqual(before);
    expect(a).not.toHaveBeenCalled();
  } finally {
    f.database.close();
  }
});
it.each([
  'missing-proof',
  'positive-cost',
  'started',
  'wrong-error',
  'missing-audit',
  'output',
  'attempt',
])('recovery rejects incomplete evidence: %s', async (kind) => {
  const f = await briefFixture();
  try {
    const admin = service(f);
    const c = await admin.authorize(f.requestId, 'key', f.command);
    const a = fake(f),
      original = f.d1.batch.bind(f.d1);
    let changed = false;
    vi.spyOn(f.d1, 'batch').mockImplementation((statements) => {
      if (!changed && statementSql(statements[0]!).includes("SET status='DISPATCHED'")) {
        changed = true;
        f.database.exec("UPDATE projects SET version=3 WHERE id='project'");
      }
      return original(statements);
    });
    await expect(
      execution(f).execute('project', 'CONTENT_BRIEF', command(c.capacityId), 'exec'),
    ).rejects.toThrow();
    expect(a).not.toHaveBeenCalled();
    const r = f.database
      .prepare('SELECT * FROM editorial_execution_reservations WHERE envelope_id=?')
      .get(c.envelopeId)!;
    const run = String(r.intelligence_run_id);
    const mutation: Record<string, string> = {
      'missing-proof': `UPDATE intelligence_runs SET safe_metadata_json='{}' WHERE id='${run}'`,
      'positive-cost': `UPDATE intelligence_runs SET actual_cost=0.001 WHERE id='${run}'`,
      started: `UPDATE intelligence_runs SET started_at='t' WHERE id='${run}'`,
      'wrong-error': `UPDATE intelligence_runs SET safe_error_detail='wrong' WHERE id='${run}'`,
      'missing-audit': `UPDATE intelligence_runs SET terminal_audit_event_id=NULL WHERE id='${run}'`,
      output: `UPDATE intelligence_runs SET output_artifact_version_id='brief-v1' WHERE id='${run}'`,
      attempt: `INSERT INTO intelligence_run_attempts(id,intelligence_run_id,attempt_number,attempt_kind,status,started_at) VALUES('unexpected-attempt','${run}',1,'TECHNICAL','RUNNING','t')`,
    };
    driftFixture(f, mutation[kind]!);
    const before = counts(f);
    await expect(
      admin.recover(c.capacityId, 'recovery', {
        expectedFailedRunId: run,
        expectedFailedReservationId: String(r.id),
        expectedProjectVersion: 3,
      }),
    ).rejects.toThrow();
    expect(counts(f)).toEqual(before);
  } finally {
    f.database.close();
  }
});

function assertZeroProviderTerminal(
  f: Awaited<ReturnType<typeof briefFixture>>,
  runId: string,
  capacityId: string,
  rejection: 'ELIGIBILITY_REJECTED' | null,
) {
  const run = f.database.prepare('SELECT * FROM intelligence_runs WHERE id=?').get(runId)!;
  const reservation = f.database
    .prepare('SELECT * FROM editorial_execution_reservations WHERE intelligence_run_id=?')
    .get(runId)!;
  expect(run).toMatchObject({
    status: 'FAILED_PERMANENT',
    input_units: 0,
    output_units: 0,
    actual_cost: 0,
    started_at: null,
    output_artifact_version_id: null,
  });
  expect(reservation).toMatchObject({
    status: 'CANCELLED',
    actual_microusd: 0,
    dispatched_at: null,
  });
  expect(run.completed_at).toBeTypeOf('string');
  expect(reservation.reconciled_at).toBeTypeOf('string');
  expect(
    f.database
      .prepare('SELECT count(*) n FROM intelligence_run_attempts WHERE intelligence_run_id=?')
      .get(runId),
  ).toEqual({ n: 0 });
  const metadata = JSON.parse(String(run.safe_metadata_json)) as Record<string, unknown>;
  expect(metadata).toMatchObject({
    dispatchAuthorized: false,
    providerCalls: 0,
    contentBriefRevisionCapacityId: capacityId,
  });
  expect(metadata.commandHash).toBeTypeOf('string');
  if (rejection) expect(metadata.preDispatchFailure).toBe(rejection);
  else
    expect(metadata).toMatchObject({
      dispatchAuthorizationOutcome: 'NOT_COMMITTED',
      providerAdapterInvoked: false,
    });
  const audits = f.database
    .prepare(
      "SELECT id,action,outcome FROM audit_events WHERE resource_id=? AND action='intelligence.run_failed'",
    )
    .all(runId);
  expect(audits).toEqual([
    { id: run.terminal_audit_event_id, action: 'intelligence.run_failed', outcome: 'failure' },
  ]);
  expect(f.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  return reservation;
}

it('F1: post-claim direct-update failure point is eliminated, with one dispatch and no replay dispatch', async () => {
  const f = await briefFixture();
  try {
    const c = await service(f).authorize(f.requestId, 'capacity', f.command);
    const adapter = fake(f);
    const prepare = f.d1.prepare.bind(f.d1);
    let injected = false;
    vi.spyOn(f.d1, 'prepare').mockImplementation((sql) => {
      const statement = prepare(sql);
      if (
        sql.includes("UPDATE editorial_execution_envelopes SET status='CONSUMED'") &&
        sql.includes('>= maximum_calls')
      ) {
        const run = statement.run.bind(statement);
        vi.spyOn(statement, 'run').mockImplementation(() => {
          const reserved = f.database
            .prepare('SELECT count(*) n FROM editorial_execution_reservations WHERE envelope_id=?')
            .get(c.envelopeId);
          if (reserved?.n === 1 && !f.database.isTransaction) {
            injected = true;
            throw new Error('post-claim outside update failure');
          }
          return run();
        });
      }
      return statement;
    });
    const result = await execution(f).execute(
      'project',
      'CONTENT_BRIEF',
      command(c.capacityId),
      'post-claim',
    );
    expect(injected).toBe(false);
    expect(result.run.status).toBe('SUCCEEDED');
    expect(adapter).toHaveBeenCalledTimes(1);
    expect(
      (await execution(f).execute('project', 'CONTENT_BRIEF', command(c.capacityId), 'post-claim'))
        .idempotentReplay,
    ).toBe(true);
    await expect(
      execution(f).execute('project', 'CONTENT_BRIEF', command(c.capacityId), 'post-claim-new'),
    ).rejects.toThrow();
    const r = f.database
      .prepare('SELECT * FROM editorial_execution_reservations WHERE envelope_id=?')
      .get(c.envelopeId)!;
    await expect(
      service(f).recover(c.capacityId, 'recovery', {
        expectedProjectVersion: 2,
        expectedFailedRunId: String(r.intelligence_run_id),
        expectedFailedReservationId: String(r.id),
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(adapter).toHaveBeenCalledTimes(1);
    expect(
      f.database
        .prepare('SELECT status,maximum_calls FROM editorial_execution_envelopes WHERE id=?')
        .get(c.envelopeId),
    ).toEqual({ status: 'CONSUMED', maximum_calls: 1 });
  } finally {
    f.database.close();
  }
});

it.each([0, 1, 2, 3])(
  'F1: claim rollback after statement %i leaves no consumed authorization or replay side effects',
  async (index) => {
    const f = await briefFixture();
    try {
      const c = await service(f).authorize(f.requestId, 'capacity', f.command);
      const before = counts(f),
        adapter = fake(f),
        batch = f.d1.batch.bind(f.d1);
      vi.spyOn(f.d1, 'batch').mockImplementation((statements) =>
        batch(
          statements.some((s) =>
            statementSql(s).includes('INSERT OR IGNORE INTO intelligence_runs'),
          )
            ? [
                ...statements.slice(0, index + 1),
                f.d1.prepare('INSERT INTO no_such_table VALUES(1)'),
              ]
            : statements,
        ),
      );
      for (const key of ['claim-failure', 'claim-failure', 'different-key']) {
        await expect(
          execution(f).execute('project', 'CONTENT_BRIEF', command(c.capacityId), key),
        ).rejects.toThrow();
        expect(counts(f)).toEqual(before);
      }
      await expect(
        service(f).recover(c.capacityId, 'recover', {
          expectedProjectVersion: 2,
          expectedFailedRunId: 'missing-run',
          expectedFailedReservationId: 'missing-reservation',
        }),
      ).rejects.toThrow();
      expect(counts(f)).toEqual(before);
      expect(
        f.database
          .prepare('SELECT status,version FROM editorial_execution_envelopes WHERE id=?')
          .get(c.envelopeId),
      ).toEqual({ status: 'ACTIVE', version: 1 });
      expect(adapter).not.toHaveBeenCalled();
      expect(f.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      f.database.close();
    }
  },
);

it.each([false, true])(
  'F2: ordinary loader only discovers ordinary profile, ordinary eligible=%s',
  async (ordinary) => {
    const f = await briefFixture();
    try {
      const c = await service(f).authorize(f.requestId, 'capacity', f.command);
      if (ordinary)
        f.database.exec(`INSERT INTO editorial_execution_envelopes
      (id,workspace_id,project_id,profile_key,profile_version,provider_id,provider_model_id,currency,
      monetary_ceiling_microusd,maximum_calls,status,authorized_by,created_at,updated_at,project_execution_budget_id,stage_key)
      SELECT 'ordinary-eligible',workspace_id,project_id,profile_key,profile_version,provider_id,provider_model_id,currency,
      monetary_ceiling_microusd,maximum_calls,'ACTIVE',authorized_by,created_at,updated_at,project_execution_budget_id,stage_key
      FROM editorial_execution_envelopes WHERE id='original-brief-envelope'`);
      const before = counts(f),
        adapter = fake(f);
      const load = () =>
        loadGovernedTerminalEnvelope(f.d1, actor, 'project', 'CONTENT_BRIEF', {
          providerKey: 'openai',
          modelKey: 'gpt-5.6-terra',
        });
      if (ordinary) expect(await load()).toMatchObject({ id: 'ordinary-eligible' });
      else {
        await expect(load()).rejects.toThrow('An active governed stage envelope is required.');
        const ordinaryCommand: Parameters<EditorialExecutionService['execute']>[2] = command(
          c.capacityId,
        );
        delete ordinaryCommand.contentBriefRevisionCapacityId;
        await expect(
          execution(f).execute('project', 'CONTENT_BRIEF', ordinaryCommand, 'no-selector'),
        ).rejects.toThrow('An active governed stage envelope is required.');
      }
      expect(counts(f)).toEqual(before);
      expect(adapter).not.toHaveBeenCalled();
      expect(
        f.database
          .prepare('SELECT status,version FROM editorial_execution_envelopes WHERE id=?')
          .get(c.envelopeId),
      ).toEqual({ status: 'ACTIVE', version: 1 });
      expect(f.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      f.database.close();
    }
  },
);

it.each([
  ['creation-invalid', 422, 'Invalid Content Brief revision capacity request.'],
  ['state-invalid', 409, 'content_brief_revision_ineligible'],
  ['recovery-invalid', 422, 'Invalid Content Brief revision recovery request.'],
  ['recovery-ineligible', 409, 'content_brief_revision_capacity_not_recoverable'],
  ['schema-incompatible', 422, 'content_brief_revision_schema_unavailable'],
  ['policy-incompatible', 422, 'content_brief_revision_policy_unavailable'],
  ['selector-invalid', 422, 'El comando de IA no es v\u00e1lido.'],
  ['selector-unknown', 409, 'content_brief_revision_execution_binding_invalid'],
] as const)('F3: Brief HTTP error body for %s', async (kind, status, detail) => {
  const f = await briefFixture(kind !== 'schema-incompatible');
  try {
    fake(f);
    let url = `/api/v1/editorial-revision-requests/${f.requestId}/content-brief-generation-capacity`;
    let body: unknown = f.command;
    if (kind === 'creation-invalid') body = { ...f.command, maximumCalls: 2 };
    if (kind === 'state-invalid') body = { ...f.command, expectedProjectVersion: 3 };
    if (kind.startsWith('recovery-')) {
      const c = await new ContentBriefRevisionCapacityService(f.d1, actor, {
        environment: 'staging',
        requestId: 'creation',
      }).authorize(f.requestId, 'capacity', f.command);
      url = `/api/v1/editorial-content-brief-revision-capacities/${c.capacityId}/recover`;
      body =
        kind === 'recovery-invalid'
          ? {}
          : {
              expectedProjectVersion: 2,
              expectedFailedRunId: 'missing-run',
              expectedFailedReservationId: 'missing-reservation',
            };
    }
    if (kind === 'policy-incompatible')
      f.database.exec(
        "UPDATE ai_provider_models SET status='inactive' WHERE id='model_openai_gpt_5_6_terra_20260903'",
      );
    if (kind.startsWith('selector-')) {
      url = '/api/v1/projects/project/content-brief/generate';
      body = {
        ...command('unknown-capacity'),
        ...(kind === 'selector-invalid' ? { mode: 'AUTO' } : {}),
      };
    }
    const auditsBefore = f.database.prepare('SELECT count(*) n FROM audit_events').get();
    const response = await revisionPost(f.d1, url, body);
    expect(response.status).toBe(status);
    const problem = await response.json();
    expect(problem).toMatchObject({ detail });
    expect(JSON.stringify(problem)).not.toMatch(/Idea revision|idea_revision/);
    expect(f.database.prepare('SELECT count(*) n FROM audit_events').get()).toEqual(auditsBefore);
  } finally {
    f.database.close();
  }
});

it('F2: a future special profile cannot become ordinary authorization', async () => {
  const f = await briefFixture();
  try {
    f.database.exec(`
      INSERT INTO editorial_project_execution_budgets(id,workspace_id,project_id,profile_key,profile_version,currency,monetary_ceiling_microusd,status,authorized_by,created_at,updated_at)
      SELECT 'future-budget',workspace_id,project_id,'future_special_profile',1,currency,monetary_ceiling_microusd,status,authorized_by,created_at,updated_at FROM editorial_project_execution_budgets WHERE id='original-budget';
      INSERT INTO editorial_execution_envelopes(id,workspace_id,project_id,profile_key,profile_version,provider_id,provider_model_id,currency,monetary_ceiling_microusd,maximum_calls,status,authorized_by,created_at,updated_at,project_execution_budget_id,stage_key)
      SELECT 'future-envelope',workspace_id,project_id,'future_special_profile',1,provider_id,provider_model_id,currency,monetary_ceiling_microusd,maximum_calls,'ACTIVE',authorized_by,created_at,updated_at,'future-budget',stage_key FROM editorial_execution_envelopes WHERE id='original-brief-envelope';
    `);
    await expect(
      loadGovernedTerminalEnvelope(f.d1, actor, 'project', 'CONTENT_BRIEF', {
        providerKey: 'openai',
        modelKey: 'gpt-5.6-terra',
      }),
    ).rejects.toThrow('An active governed stage envelope is required.');
    expect(f.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally {
    f.database.close();
  }
});

it.each(['authorize', 'recover'] as const)(
  'F3: unexpected %s error keeps Brief terminology',
  async (operation) => {
    const f = await briefFixture();
    try {
      vi.spyOn(ContentBriefRevisionCapacityService.prototype, operation).mockRejectedValueOnce(
        new Error('local storage failure'),
      );
      const path =
        operation === 'authorize'
          ? `/api/v1/editorial-revision-requests/${f.requestId}/content-brief-generation-capacity`
          : '/api/v1/editorial-content-brief-revision-capacities/missing-capacity/recover';
      const body =
        operation === 'authorize'
          ? f.command
          : {
              expectedProjectVersion: 2,
              expectedFailedRunId: 'missing-run',
              expectedFailedReservationId: 'missing-reservation',
            };
      const before = counts(f);
      const response = await revisionPost(f.d1, path, body);
      expect(response.status).toBe(500);
      expect(await response.json()).toMatchObject({
        detail:
          operation === 'authorize'
            ? 'Content Brief revision capacity authorization failed.'
            : 'Content Brief revision recovery failed.',
      });
      expect(counts(f)).toEqual(before);
    } finally {
      f.database.close();
    }
  },
);

it('F1: adapter construction failure after claim terminalizes without dispatch or recovery bypass', async () => {
  const f = await briefFixture();
  try {
    const c = await service(f).authorize(f.requestId, 'capacity', f.command);
    const adapter = fake(f);
    vi.spyOn(openAIProvider, 'OpenAIResponsesAdapter').mockImplementation(function () {
      throw new Error('local adapter construction failure');
    });
    await expect(
      execution(f).execute(
        'project',
        'CONTENT_BRIEF',
        command(c.capacityId),
        'constructor-failure',
      ),
    ).rejects.toThrow('content_brief_revision_dispatch_not_committed');
    const run = f.database
      .prepare("SELECT id FROM intelligence_runs WHERE idempotency_key='constructor-failure'")
      .get()!;
    const reservation = assertZeroProviderTerminal(f, String(run.id), c.capacityId, null);
    expect(
      (
        await execution(f).execute(
          'project',
          'CONTENT_BRIEF',
          command(c.capacityId),
          'constructor-failure',
        )
      ).idempotentReplay,
    ).toBe(true);
    await expect(
      execution(f).execute('project', 'CONTENT_BRIEF', command(c.capacityId), 'new-key'),
    ).rejects.toThrow();
    await expect(
      service(f).recover(c.capacityId, 'recover', {
        expectedProjectVersion: 2,
        expectedFailedRunId: String(run.id),
        expectedFailedReservationId: String(reservation.id),
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(adapter).not.toHaveBeenCalled();
  } finally {
    f.database.close();
  }
});

// These probes pause the first request after COMMIT, before any catch or dispatch code.
// A pending Promise has no timers/I/O: abandoning it models process loss, not a retry.
async function pauseAfterBriefClaim(
  f: Awaited<ReturnType<typeof briefFixture>>,
  capacityId: string,
  key = 'resume',
) {
  let signal!: () => void, release!: () => void;
  const committed = new Promise<void>((resolve) => {
    signal = resolve;
  });
  const batch = f.d1.batch.bind(f.d1);
  const spy = vi.spyOn(f.d1, 'batch').mockImplementation(async (statements) => {
    const result = await batch(statements);
    if (
      statements.some((s) => statementSql(s).includes('INSERT OR IGNORE INTO intelligence_runs'))
    ) {
      signal();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    }
    return result;
  });
  const original = execution(f).execute('project', 'CONTENT_BRIEF', command(capacityId), key);
  await committed;
  spy.mockRestore();
  const run = f.database
    .prepare('SELECT * FROM intelligence_runs WHERE idempotency_key=?')
    .get(key)!;
  return {
    run,
    finish: async () => {
      release();
      return original;
    },
  };
}
function resumeAdapter(f: Awaited<ReturnType<typeof briefFixture>>) {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('real network forbidden'));
  return vi.spyOn(OpenAIResponsesAdapter.prototype, 'execute').mockResolvedValue({
    output: briefOutput(f.command.researchVersionId),
    usage: {
      inputUnits: 10,
      outputUnits: 20,
      cachedInputUnits: 0,
      reasoningOutputUnits: 0,
      unitName: 'token',
    },
    providerRequestId: 'fake-resumed-brief',
    safeMetadata: {},
  });
}
function assertResumedAuthority(
  f: Awaited<ReturnType<typeof briefFixture>>,
  c: { capacityId: string; envelopeId: string },
  runId: string,
) {
  expect(
    f.database
      .prepare('SELECT status,version FROM editorial_execution_envelopes WHERE id=?')
      .get(c.envelopeId),
  ).toEqual({ status: 'CONSUMED', version: 2 });
  expect(
    f.database
      .prepare('SELECT count(*) n FROM editorial_execution_reservations WHERE envelope_id=?')
      .get(c.envelopeId),
  ).toEqual({ n: 1 });
  expect(
    f.database
      .prepare('SELECT count(*) n FROM intelligence_run_attempts WHERE intelligence_run_id=?')
      .get(runId),
  ).toEqual({ n: 1 });
  expect(
    f.database
      .prepare(
        "SELECT count(*) n FROM audit_events WHERE action='editorial.content_brief_revision_capacity_consumed' AND resource_id=?",
      )
      .get(c.capacityId),
  ).toEqual({ n: 1 });
  const run = f.database.prepare('SELECT * FROM intelligence_runs WHERE id=?').get(runId)!;
  expect(run.status).toBe('SUCCEEDED');
  const version = f.database
    .prepare('SELECT * FROM editorial_artifact_versions WHERE id=?')
    .get(run.output_artifact_version_id!)!;
  expect(version.parent_version_id).toBe('brief-v1');
  expect(
    f.database
      .prepare(
        'SELECT dependency_type,source_artifact_version_id FROM artifact_dependencies WHERE dependent_artifact_version_id=? ORDER BY dependency_type',
      )
      .all(version.id!),
  ).toEqual([
    { dependency_type: 'GENERATED_FROM', source_artifact_version_id: 'new-idea-v1' },
    { dependency_type: 'USES_RESEARCH', source_artifact_version_id: f.command.researchVersionId },
  ]);
  expect(
    f.database
      .prepare("SELECT status,current_version_id FROM editorial_artifacts WHERE id='brief'")
      .get(),
  ).toEqual({ status: 'active', current_version_id: version.id });
  expect(
    f.database
      .prepare('SELECT count(*) n FROM artifact_approvals WHERE artifact_version_id=?')
      .get(version.id!),
  ).toEqual({ n: 0 });
  expect(f.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
}

it('R3: claim COMMIT with lost confirmation resumes the exact Run without another claim', async () => {
  const f = await briefFixture();
  try {
    const c = await service(f).authorize(f.requestId, 'capacity', f.command),
      adapter = resumeAdapter(f),
      batch = f.d1.batch.bind(f.d1);
    let claims = 0;
    vi.spyOn(f.d1, 'batch').mockImplementation(async (statements) => {
      const result = await batch(statements);
      if (
        statements.some((s) => statementSql(s).includes('INSERT OR IGNORE INTO intelligence_runs'))
      ) {
        claims++;
        throw new Error('claim committed; confirmation lost');
      }
      return result;
    });
    const result = await execution(f).execute(
      'project',
      'CONTENT_BRIEF',
      command(c.capacityId),
      'lost-confirmation',
    );
    expect(claims).toBe(1);
    expect(adapter).toHaveBeenCalledTimes(1);
    assertResumedAuthority(f, c, String(result.run.id));
    expect(
      (
        await execution(f).execute(
          'project',
          'CONTENT_BRIEF',
          command(c.capacityId),
          'lost-confirmation',
        )
      ).idempotentReplay,
    ).toBe(true);
    expect(adapter).toHaveBeenCalledTimes(1);
  } finally {
    f.database.close();
  }
});
it('R3: process loss after claim, same-key later resume, different-key rejection, QUEUED recovery denied', async () => {
  const f = await briefFixture();
  try {
    const c = await service(f).authorize(f.requestId, 'capacity', f.command),
      adapter = resumeAdapter(f),
      paused = await pauseAfterBriefClaim(f, c.capacityId);
    const before = counts(f),
      reservation = f.database
        .prepare('SELECT * FROM editorial_execution_reservations WHERE envelope_id=?')
        .get(c.envelopeId)!;
    expect(
      await loadContentBriefPreDispatchClaim(
        f.d1,
        actor,
        'project',
        c.capacityId,
        'new-idea-v1',
        'test',
        String(paused.run.id),
        'resume',
        (JSON.parse(String(paused.run.safe_metadata_json)) as { commandHash: string }).commandHash,
      ),
    ).toMatchObject({
      classification: 'CLAIMED_NOT_DISPATCHED',
      runId: paused.run.id,
      reservationId: reservation.id,
    });
    await expect(
      execution(f).execute('project', 'CONTENT_BRIEF', command(c.capacityId), 'different-key'),
    ).rejects.toThrow();
    await expect(
      service(f).recover(c.capacityId, 'recovery', {
        expectedProjectVersion: 2,
        expectedFailedRunId: String(paused.run.id),
        expectedFailedReservationId: String(reservation.id),
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(counts(f)).toEqual(before);
    expect(adapter).not.toHaveBeenCalled();
    const batch = vi.spyOn(f.d1, 'batch');
    const result = await execution(f).execute(
      'project',
      'CONTENT_BRIEF',
      command(c.capacityId),
      'resume',
    );
    expect(result.run.id).toBe(paused.run.id);
    expect(adapter).toHaveBeenCalledTimes(1);
    expect(
      batch.mock.calls.some(([ss]) =>
        ss.some((s) => statementSql(s).includes('INSERT OR IGNORE INTO intelligence_runs')),
      ),
    ).toBe(false);
    assertResumedAuthority(f, c, String(paused.run.id));
    const terminal = f.database
      .prepare('SELECT * FROM intelligence_runs WHERE id=?')
      .get(paused.run.id!);
    expect((await paused.finish()).idempotentReplay).toBe(true);
    expect(
      f.database.prepare('SELECT * FROM intelligence_runs WHERE id=?').get(paused.run.id!),
    ).toEqual(terminal);
    expect(adapter).toHaveBeenCalledTimes(1);
  } finally {
    f.database.close();
  }
});
it.each(Array.from({ length: 20 }, (_, i) => i))(
  'R3: same-key concurrent resume race %i has a single durable dispatch owner',
  async () => {
    const f = await briefFixture();
    try {
      const c = await service(f).authorize(f.requestId, 'capacity', f.command),
        adapter = resumeAdapter(f),
        paused = await pauseAfterBriefClaim(f, c.capacityId);
      let arrivals = 0;
      let releaseDispatch!: () => void;
      const bothResumers = new Promise<void>((resolve) => {
        releaseDispatch = resolve;
      });
      const batch = f.d1.batch.bind(f.d1);
      vi.spyOn(f.d1, 'batch').mockImplementation(async (statements) => {
        if (statementSql(statements[0]!).includes("SET status='DISPATCHED'")) {
          arrivals++;
          if (arrivals === 2) releaseDispatch();
          await bothResumers;
        }
        return batch(statements);
      });
      const results = await Promise.allSettled([
        execution(f).execute('project', 'CONTENT_BRIEF', command(c.capacityId), 'resume'),
        execution(f).execute('project', 'CONTENT_BRIEF', command(c.capacityId), 'resume'),
      ]);
      expect(
        results.some((r) => r.status === 'fulfilled' && r.value.run.status === 'SUCCEEDED'),
      ).toBe(true);
      expect(arrivals).toBe(2);
      expect(adapter).toHaveBeenCalledTimes(1);
      assertResumedAuthority(f, c, String(paused.run.id));
      expect(
        f.database
          .prepare("SELECT count(*) n FROM intelligence_runs WHERE idempotency_key='resume'")
          .get(),
      ).toEqual({ n: 1 });
      await paused.finish();
      expect(adapter).toHaveBeenCalledTimes(1);
    } finally {
      f.database.close();
    }
  },
);
it('R3: existing dispatch/attempt is replayed without provider, terminal replay also never dispatches', async () => {
  const f = await briefFixture();
  try {
    const c = await service(f).authorize(f.requestId, 'capacity', f.command),
      adapter = resumeAdapter(f),
      paused = await pauseAfterBriefClaim(f, c.capacityId);
    await authorizeContentBriefRevisionDispatch(
      f.d1,
      actor,
      'project',
      c.capacityId,
      String(paused.run.id),
      'other-request',
      {
        idempotencyKey: 'resume',
        commandHash: String(
          (JSON.parse(String(paused.run.safe_metadata_json)) as { commandHash: string })
            .commandHash,
        ),
        ideaVersionId: 'new-idea-v1',
        environment: 'test',
      },
    );
    const before = counts(f);
    expect(
      (await execution(f).execute('project', 'CONTENT_BRIEF', command(c.capacityId), 'resume')).run
        .status,
    ).toBe('RUNNING');
    expect(counts(f)).toEqual(before);
    expect(adapter).not.toHaveBeenCalled();
    const reservation = f.database
      .prepare('SELECT * FROM editorial_execution_reservations WHERE envelope_id=?')
      .get(c.envelopeId)!;
    await expect(
      service(f).recover(c.capacityId, 'recover', {
        expectedProjectVersion: 2,
        expectedFailedRunId: String(paused.run.id),
        expectedFailedReservationId: String(reservation.id),
      }),
    ).rejects.toThrow();
    await paused.finish();
    expect(adapter).not.toHaveBeenCalled();
  } finally {
    f.database.close();
  }
});
it.each([
  [
    'reservation-owner',
    "UPDATE editorial_execution_reservations SET workspace_id='other' WHERE intelligence_run_id=:run",
  ],
  [
    'command-hash',
    "UPDATE intelligence_runs SET safe_metadata_json=json_set(safe_metadata_json,'$.commandHash',printf('%064d',7)) WHERE id=:run",
  ],
  ['started', "UPDATE intelligence_runs SET started_at='t' WHERE id=:run"],
  ['completed', "UPDATE intelligence_runs SET completed_at='t' WHERE id=:run"],
  ['output', "UPDATE intelligence_runs SET output_artifact_version_id='brief-v1' WHERE id=:run"],
  [
    'provider-evidence',
    "UPDATE intelligence_runs SET safe_metadata_json=json_set(safe_metadata_json,'$.providerRequestId','possible-provider-request') WHERE id=:run",
  ],
  [
    'dispatch-marker',
    "UPDATE editorial_execution_reservations SET dispatched_at='t' WHERE intelligence_run_id=:run",
  ],
  ['wrong-input', "UPDATE intelligence_runs SET input_artifact_version_id='idea-v1' WHERE id=:run"],
  ['wrong-key', "UPDATE intelligence_runs SET idempotency_key='other-key' WHERE id=:run"],
  [
    'wrong-budget',
    "UPDATE editorial_execution_reservations SET project_execution_budget_id='original-budget' WHERE intelligence_run_id=:run",
  ],
  [
    'terminal-audit',
    "UPDATE intelligence_runs SET terminal_audit_event_id='historical-terminal-audit' WHERE id=:run",
  ],
  [
    'attempt',
    "INSERT INTO intelligence_run_attempts(id,intelligence_run_id,attempt_number,attempt_kind,status,safe_metadata_json,started_at) VALUES('possible-attempt',:run,1,'TECHNICAL','RUNNING','{}','t')",
  ],
] as const)('R3: inconsistent/possible-dispatch claim %s never resumes', async (_, sql) => {
  const f = await briefFixture();
  try {
    const c = await service(f).authorize(f.requestId, 'capacity', f.command),
      adapter = resumeAdapter(f),
      paused = await pauseAfterBriefClaim(f, c.capacityId);
    driftFixture(f, sql.replaceAll(':run', `'${String(paused.run.id)}'`));
    const before = counts(f),
      ir = f.database.prepare('SELECT * FROM intelligence_runs WHERE id=?').get(paused.run.id!);
    await expect(
      execution(f).execute('project', 'CONTENT_BRIEF', command(c.capacityId), 'resume'),
    ).rejects.toThrow();
    expect(adapter).not.toHaveBeenCalled();
    expect(counts(f)).toEqual(before);
    expect(
      f.database.prepare('SELECT * FROM intelligence_runs WHERE id=?').get(paused.run.id!),
    ).toEqual(ir);
  } finally {
    f.database.close();
  }
});
it.each([
  "UPDATE projects SET version=3 WHERE id='project'",
  "UPDATE projects SET status='DRAFT' WHERE id='project'",
  "UPDATE editorial_artifacts SET current_version_id='research-v1' WHERE id='research'",
  "UPDATE editorial_artifacts SET version=version+1 WHERE id='research'",
  "UPDATE artifact_approvals SET decision='REJECTED' WHERE id='approval-v2'",
  "UPDATE editorial_artifact_versions SET content_hash=printf('%064d',7) WHERE artifact_id='research' AND version_number=2",
  "UPDATE idea_candidates SET status='CANDIDATE' WHERE id='new-candidate'",
  "UPDATE idea_candidates SET version=version+1 WHERE id='new-candidate'",
  "UPDATE editorial_artifacts SET version=version+1 WHERE id='new-idea'",
  "UPDATE artifact_approvals SET decision='REJECTED' WHERE id='new-idea-approval'",
  "UPDATE artifact_dependencies SET validity_status='STALE' WHERE id='new-lineage'",
  "UPDATE editorial_artifacts SET version=version+1 WHERE id='brief'",
  "UPDATE ai_providers SET status='inactive' WHERE id='provider_openai'",
  "UPDATE ai_provider_models SET version=version+1 WHERE model_key='gpt-5.6-terra'",
  "UPDATE prompt_versions SET template_text='changed' WHERE id='prompt_version_content_brief_v1'",
  "UPDATE ai_pricing_snapshots SET input_unit_price=0.000003 WHERE id='pricing_model_openai_gpt_5_6_terra_20260903'",
  "UPDATE editorial_project_execution_budgets SET status='CANCELLED' WHERE profile_key='phase3_content_brief_revision_v1'",
  "UPDATE editorial_artifacts SET current_version_id='idea-v1' WHERE id='new-idea'",
  "UPDATE editorial_artifact_versions SET content_hash=printf('%064d',7) WHERE id='new-idea-v1'",
  "UPDATE editorial_artifacts SET current_version_id='idea-v1' WHERE id='brief'",
  "INSERT INTO editorial_revision_request_resolutions(id,workspace_id,project_id,revision_request_id,status,resolution_artifact_version_id,resolved_by,idempotency_key,command_hash,audit_event_id,resolved_at) SELECT 'closed-resolution',workspace_id,project_id,id,'RESOLVED','brief-v1','owner','resolution-key',printf('%064d',0),'historical-terminal-audit','t' FROM editorial_revision_requests",
] as const)(
  'R3: resumed authoritative drift rejects and terminalizes without provider: %s',
  async (sql) => {
    const f = await briefFixture();
    try {
      const c = await service(f).authorize(f.requestId, 'capacity', f.command),
        adapter = resumeAdapter(f),
        paused = await pauseAfterBriefClaim(f, c.capacityId);
      driftFixture(f, sql);
      await expect(
        execution(f).execute('project', 'CONTENT_BRIEF', command(c.capacityId), 'resume'),
      ).rejects.toThrow();
      expect(adapter).not.toHaveBeenCalled();
      assertZeroProviderTerminal(f, String(paused.run.id), c.capacityId, 'ELIGIBILITY_REJECTED');
      expect(
        (await execution(f).execute('project', 'CONTENT_BRIEF', command(c.capacityId), 'resume'))
          .idempotentReplay,
      ).toBe(true);
      expect(adapter).not.toHaveBeenCalled();
    } finally {
      f.database.close();
    }
  },
);

it('R3: unreadable dispatch-owner confirmation does not overwrite a winning Run', async () => {
  const f = await briefFixture();
  try {
    const c = await service(f).authorize(f.requestId, 'capacity', f.command),
      adapter = resumeAdapter(f),
      paused = await pauseAfterBriefClaim(f, c.capacityId);
    const batch = f.d1.batch.bind(f.d1),
      prepare = f.d1.prepare.bind(f.d1);
    let lost = false;
    vi.spyOn(f.d1, 'batch').mockImplementation(async (ss) => {
      const result = await batch(ss);
      if (!lost && statementSql(ss[0]!).includes("SET status='DISPATCHED'")) {
        lost = true;
        throw new Error('dispatch committed but confirmation lost');
      }
      return result;
    });
    vi.spyOn(f.d1, 'prepare').mockImplementation((sql) => {
      if (lost && sql.includes('own_attempt')) throw new Error('owner read unavailable');
      return prepare(sql);
    });
    const result = await execution(f).execute(
      'project',
      'CONTENT_BRIEF',
      command(c.capacityId),
      'resume',
    );
    expect(result.run.status).toBe('RUNNING');
    expect(result.idempotentReplay).toBe(true);
    expect(adapter).not.toHaveBeenCalled();
    const run = f.database
      .prepare('SELECT * FROM intelligence_runs WHERE id=?')
      .get(paused.run.id!)!;
    expect(run.terminal_audit_event_id).toBeNull();
    expect(run.completed_at).toBeNull();
    expect(
      f.database
        .prepare(
          'SELECT status,actual_microusd FROM editorial_execution_reservations WHERE envelope_id=?',
        )
        .get(c.envelopeId),
    ).toEqual({ status: 'DISPATCHED', actual_microusd: null });
    expect(
      (await execution(f).execute('project', 'CONTENT_BRIEF', command(c.capacityId), 'resume'))
        .idempotentReplay,
    ).toBe(true);
    expect(adapter).not.toHaveBeenCalled();
  } finally {
    f.database.close();
  }
});
it('R3: conflicting Run for the same claimed capacity cannot be resumed', async () => {
  const f = await briefFixture();
  try {
    const c = await service(f).authorize(f.requestId, 'capacity', f.command),
      adapter = resumeAdapter(f),
      paused = await pauseAfterBriefClaim(f, c.capacityId);
    const columns = f.database
      .prepare('PRAGMA table_info(intelligence_runs)')
      .all()
      .map((row) => String(row.name));
    const values = columns.map((col) =>
      col === 'id' ? "'conflicting-run'" : col === 'idempotency_key' ? "'conflicting-key'" : col,
    );
    driftFixture(
      f,
      `INSERT INTO intelligence_runs(${columns.join(',')}) SELECT ${values.join(',')} FROM intelligence_runs WHERE id='${String(paused.run.id)}'`,
    );
    const before = counts(f);
    await expect(
      execution(f).execute('project', 'CONTENT_BRIEF', command(c.capacityId), 'resume'),
    ).rejects.toThrow('content_brief_revision_claim_not_resumable');
    expect(counts(f)).toEqual(before);
    expect(adapter).not.toHaveBeenCalled();
  } finally {
    f.database.close();
  }
});
it('R3: exact pre-dispatch proof and atomic terminal guard execute at expression depth 100', async () => {
  const f = await briefFixture();
  try {
    const c = await service(f).authorize(f.requestId, 'capacity', f.command),
      paused = await pauseAfterBriefClaim(f, c.capacityId);
    const hash = (JSON.parse(String(paused.run.safe_metadata_json)) as { commandHash: string })
      .commandHash;
    const statements = [false, true].map((guard) =>
      contentBriefPreDispatchClaimStatement(
        f.d1,
        actor,
        'project',
        c.capacityId,
        'new-idea-v1',
        'test',
        String(paused.run.id),
        'resume',
        hash,
        guard,
      ),
    );
    const objects = f.database
      .prepare(
        "SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid",
      )
      .all();
    const data = objects
      .filter((o) => o.type === 'table')
      .map((o) => ({
        name: o.name,
        rows: f.database.prepare(`SELECT * FROM ${String(o.name)}`).all(),
      }));
    const script = `import sys,json,sqlite3
p=json.load(sys.stdin);d=sqlite3.connect(':memory:')
for o in p['objects']:
 if o['type']=='table':d.execute(o['sql'])
for t in p['data']:
 for r in t['rows']:
  r={k:v for k,v in r.items() if k in [x[1] for x in d.execute('PRAGMA table_info('+t['name']+')')]}
  d.execute('INSERT INTO '+t['name']+'('+','.join(r.keys())+') VALUES('+','.join('?' for _ in r)+')',list(r.values()))
for o in p['objects']:
 if o['type']!='table':d.execute(o['sql'])
d.commit();d.execute('PRAGMA foreign_keys=ON');d.setlimit(sqlite3.SQLITE_LIMIT_EXPR_DEPTH,100)
assert d.getlimit(sqlite3.SQLITE_LIMIT_EXPR_DEPTH)==100
for s in p['queries']:assert len(d.execute(s['sql'],s['values']).fetchall())==1
assert d.execute('PRAGMA foreign_key_check').fetchall()==[]
print('RESUME_EXPR_DEPTH_100_PASS')`;
    const queries = statements.map((s) => ({
      sql: statementSql(s),
      values: (s as unknown as { values: unknown[] }).values,
    }));
    const result = spawnSync('python', ['-c', script], {
      input: JSON.stringify({ objects, data, queries }),
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe('RESUME_EXPR_DEPTH_100_PASS');
  } finally {
    f.database.close();
  }
});
it.each(['commandHash', 'idempotencyKey'] as const)(
  'R3: identity drift at dispatch CAS (%s) cannot invoke provider or rewrite evidence',
  async (field) => {
    const f = await briefFixture();
    try {
      const c = await service(f).authorize(f.requestId, 'capacity', f.command),
        adapter = resumeAdapter(f),
        paused = await pauseAfterBriefClaim(f, c.capacityId);
      const batch = f.d1.batch.bind(f.d1);
      let injected = false;
      let expectedRun: unknown;
      vi.spyOn(f.d1, 'batch').mockImplementation((ss) => {
        if (!injected && statementSql(ss[0]!).includes("SET status='DISPATCHED'")) {
          injected = true;
          driftFixture(
            f,
            field === 'commandHash'
              ? `UPDATE intelligence_runs SET safe_metadata_json=json_set(safe_metadata_json,'$.commandHash',printf('%064d',7)) WHERE id='${String(paused.run.id)}'`
              : `UPDATE intelligence_runs SET idempotency_key='changed-key' WHERE id='${String(paused.run.id)}'`,
          );
          expectedRun = f.database
            .prepare('SELECT * FROM intelligence_runs WHERE id=?')
            .get(paused.run.id!);
        }
        return batch(ss);
      });
      await expect(
        execution(f).execute('project', 'CONTENT_BRIEF', command(c.capacityId), 'resume'),
      ).rejects.toThrow();
      expect(injected).toBe(true);
      expect(adapter).not.toHaveBeenCalled();
      expect(
        f.database.prepare('SELECT * FROM intelligence_runs WHERE id=?').get(paused.run.id!),
      ).toEqual(expectedRun);
      expect(
        f.database
          .prepare(
            'SELECT status,actual_microusd,dispatched_at FROM editorial_execution_reservations WHERE envelope_id=?',
          )
          .get(c.envelopeId),
      ).toEqual({ status: 'RESERVED', actual_microusd: null, dispatched_at: null });
      expect(
        f.database
          .prepare('SELECT count(*) n FROM intelligence_run_attempts WHERE intelligence_run_id=?')
          .get(paused.run.id!),
      ).toEqual({ n: 0 });
    } finally {
      f.database.close();
    }
  },
);
