import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import {
  closeSync,
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

type CapacityResult = {
  envelope: {
    id: string;
    status: string;
    version: number;
    maximumCalls: number;
    usedCalls: number;
    monetaryCeilingMicroUsd: number;
  };
  auditEventId: string;
  idempotentReplay: boolean;
};
type D1State = {
  envelopes: Array<{
    id: string;
    projectId: string;
    budgetId: string;
    stageKey: string;
    status: string;
    version: number;
    maximumCalls: number;
    ceiling: number;
  }>;
  receipts: Array<{ id: string; resourceId: string; metadataJson: string }>;
  historicalEnvelopes: Array<{ id: string; status: string; version: number }>;
  reservations: Array<{
    id: string;
    budgetId: string;
    reservedMicrousd: number;
    status: string;
  }>;
  runs: Array<{ id: string; projectId: string; status: string }>;
  foreignKeys: unknown[];
};
type ScenarioResult = {
  scenario: string;
  result: CapacityResult | null;
  replay: CapacityResult | null;
  error: string | null;
  sqlBytes: number[];
  bindingCounts: number[];
  queryCount: number;
  state: D1State;
};
type OperationResult = {
  kind: 'result' | 'error' | 'race';
  result?: CapacityResult;
  status?: number;
  error?: string;
  errorClass?: string;
  mutation?: string;
  amount?: number;
  sqlBytes?: number[];
  bindingCounts?: number[];
  queryCount?: number;
  commandVariant?: 'canonical' | 'changed';
  batchReached?: boolean;
};
type ConcurrentResult = {
  scenario: string;
  operations: OperationResult[];
  initialState: D1State;
  state: D1State;
};

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const wrangler = join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const worker = join(here, 'script-critic-capacity-d1-worker.ts');
const sourceMigrations = join(root, 'packages', 'db', 'migrations');
let temporaryRoot = '';
let basePersistence = '';
let configPath = '';

const normalizePath = (path: string) => path.replaceAll('\\', '/');

function wranglerEnvironment() {
  return {
    ...process.env,
    XDG_CONFIG_HOME: join(temporaryRoot, 'wrangler-config'),
    WRANGLER_SEND_METRICS: 'false',
    WRANGLER_LOG_PATH: join(temporaryRoot, 'wrangler.log'),
  };
}

async function availablePort() {
  return await new Promise<number>((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('unable to allocate local test port'));
        return;
      }
      const port = address.port;
      server.close((error) => (error ? reject(error) : resolvePort(port)));
    });
  });
}

async function waitForServer(
  origin: string,
  child: ChildProcessWithoutNullStreams,
  logs: () => string,
  spawnError: () => Error | null,
) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const error = spawnError();
    if (error) throw new Error(`Wrangler process crashed: ${error.message}\n${logs()}`);
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error(
        `Wrangler process crashed (exit=${child.exitCode}, signal=${child.signalCode})\n${logs()}`,
      );
    try {
      const response = await fetch(`${origin}/health`);
      if (response.ok) return;
    } catch {
      // Worker is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`Timed out waiting for Wrangler local\n${logs()}`);
}

async function waitForClose(closed: Promise<void>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      closed.then(() => true),
      new Promise<boolean>((resolveTimeout) => {
        timer = setTimeout(() => resolveTimeout(false), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function stopWorker(child: ChildProcessWithoutNullStreams, closed: Promise<void>) {
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  if (await waitForClose(closed, 5_000)) return;
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  if (!(await waitForClose(closed, 5_000)))
    throw new Error(`Wrangler process ${child.pid} did not close after SIGKILL`);
}

async function withWorker<T>(scenario: string, run: (origin: string) => Promise<T>) {
  const persistence = join(temporaryRoot, `scenario-${scenario}`);
  cpSync(basePersistence, persistence, { recursive: true });
  const port = await availablePort();
  const child = spawn(
    process.execPath,
    [
      wrangler,
      'dev',
      '--local',
      '--ip',
      '127.0.0.1',
      '--port',
      String(port),
      '--persist-to',
      persistence,
      '--config',
      configPath,
      '--log-level',
      'error',
    ],
    { cwd: root, env: wranglerEnvironment(), stdio: 'pipe' },
  );
  let output = '';
  let processError: Error | null = null;
  child.once('error', (error) => (processError = error));
  const closed = new Promise<void>((resolveClose) => child.once('close', () => resolveClose()));
  child.stdout.on('data', (chunk) => (output += String(chunk)));
  child.stderr.on('data', (chunk) => (output += String(chunk)));
  const origin = `http://127.0.0.1:${port}`;
  try {
    await waitForServer(
      origin,
      child,
      () => output,
      () => processError,
    );
    return await run(origin);
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${output}`, {
      cause: error,
    });
  } finally {
    await stopWorker(child, closed);
  }
}

async function json<T>(response: Response, label: string) {
  const body: T & { fatal?: string } = await response.json();
  if (!response.ok || body.fatal)
    throw new Error(`${label} failed: ${body.fatal ?? response.status}`);
  return body;
}

async function runScenario(scenario: string): Promise<ScenarioResult> {
  return withWorker(scenario, async (origin) =>
    json<ScenarioResult>(
      await fetch(`${origin}/scenario/${scenario}`, { method: 'POST' }),
      `D1 scenario ${scenario}`,
    ),
  );
}

async function runConcurrentScenario(scenario: string): Promise<ConcurrentResult> {
  return withWorker(`concurrent-${scenario}`, async (origin) => {
    const setup = await json<{ ready: boolean; initialState: D1State }>(
      await fetch(`${origin}/setup/${scenario}`, { method: 'POST' }),
      `D1 setup ${scenario}`,
    );
    const [first, second] = await Promise.all([
      fetch(`${origin}/operation/${scenario}/a`, { method: 'POST' }),
      fetch(`${origin}/operation/${scenario}/b`, { method: 'POST' }),
    ]);
    const operations = await Promise.all([
      json<OperationResult>(first, `D1 operation ${scenario}/a`),
      json<OperationResult>(second, `D1 operation ${scenario}/b`),
    ]);
    const state = await json<D1State>(
      await fetch(`${origin}/state/${scenario}`),
      `D1 state ${scenario}`,
    );
    return { scenario, operations, initialState: setup.initialState, state };
  });
}

beforeAll(() => {
  temporaryRoot = mkdtempSync(join(tmpdir(), 'vision-maxson-critic-capacity-d1-'));
  basePersistence = join(temporaryRoot, 'base-persistence');
  const migrations = join(temporaryRoot, 'migrations');
  mkdirSync(migrations, { recursive: true });
  const allowed = readdirSync(sourceMigrations)
    .filter((name) => /^(?:000[0-9]|001[0-6])_.*\.sql$/u.test(name))
    .sort();
  expect(allowed).toHaveLength(17);
  expect(allowed.at(-1)).toBe('0016_governed_production_script_retry_authorization.sql');
  for (const name of allowed) {
    const target = join(migrations, name);
    if (name === allowed[0]) {
      const descriptor = openSync(target, 'w');
      closeSync(descriptor);
    }
    copyFileSync(join(sourceMigrations, name), target);
  }

  configPath = join(temporaryRoot, 'wrangler.critic-capacity.jsonc');
  writeFileSync(
    configPath,
    JSON.stringify(
      {
        name: 'vision-maxson-critic-capacity-regression',
        main: normalizePath(worker),
        compatibility_date: '2026-09-01',
        compatibility_flags: ['nodejs_compat'],
        d1_databases: [
          {
            binding: 'DB',
            database_name: 'vision-maxson-critic-capacity-regression',
            database_id: '00000000-0000-0000-0000-000000000025',
            migrations_dir: normalizePath(migrations),
          },
        ],
      },
      null,
      2,
    ),
  );

  const migration = spawnSync(
    process.execPath,
    [
      wrangler,
      'd1',
      'migrations',
      'apply',
      'vision-maxson-critic-capacity-regression',
      '--local',
      '--persist-to',
      basePersistence,
      '--config',
      configPath,
    ],
    { cwd: root, env: wranglerEnvironment(), encoding: 'utf8' },
  );
  if (migration.status !== 0)
    throw new Error(`D1 local migration replay failed\n${migration.stdout}\n${migration.stderr}`);
}, 120_000);

afterAll(async () => {
  const expectedPrefix = join(tmpdir(), 'vision-maxson-critic-capacity-d1-');
  if (!temporaryRoot.startsWith(expectedPrefix)) throw new Error('unsafe D1 test cleanup path');
  let lastError: unknown;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      rmSync(temporaryRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolveWait) => setTimeout(resolveWait, 500));
    }
  }
  throw lastError;
});

function expectIntegrity(state: D1State) {
  expect(state.foreignKeys).toEqual([]);
  expect(state.reservations.filter((reservation) => reservation.status === 'AMBIGUOUS')).toEqual(
    [],
  );
}

function winningOperation(value: ConcurrentResult) {
  return value.operations.find((operation) => operation.kind === 'result');
}

describe('ScriptCriticCapacityService on Wrangler D1 local/workerd', () => {
  it('runs the production D1 batch and exact replay with bounded expression scale', async () => {
    const value = await runScenario('success');
    expect(value.error).toBeNull();
    expect(value.sqlBytes).toEqual([3772, 4128, 4149]);
    expect(value.bindingCounts).toEqual([13, 22, 15]);
    expect(Math.max(...value.bindingCounts)).toBeLessThanOrEqual(100);
    expect(value.queryCount).toBe(6);
    expect(value.result).toMatchObject({
      envelope: {
        status: 'ACTIVE',
        version: 1,
        maximumCalls: 1,
        usedCalls: 0,
        monetaryCeilingMicroUsd: 403840,
      },
      idempotentReplay: false,
    });
    expect(value.replay).toEqual({ ...value.result, idempotentReplay: true });
    expect(value.state.envelopes).toEqual([
      {
        id: value.result!.envelope.id,
        projectId: 'project',
        budgetId: 'budget-successor',
        stageKey: 'SCRIPT_CRITIC',
        status: 'ACTIVE',
        version: 1,
        maximumCalls: 1,
        ceiling: 403840,
      },
    ]);
    expect(value.state.receipts).toHaveLength(1);
    expect(value.state.reservations).toEqual([]);
    expect(value.state.runs).toEqual([]);
    expectIntegrity(value.state);
  }, 60_000);

  it.each(['audit-failure', 'final-failure'])(
    'rolls back unknown %s storage failures without flattening them to conflict',
    async (scenario) => {
      const value = await runScenario(scenario);
      expect(value.result).toBeNull();
      expect(value.error).not.toBeNull();
      expect(value.error).not.toBe('script_critic_capacity_conflict');
      expect(value.state.envelopes).toEqual([]);
      expect(value.state.receipts).toEqual([]);
      expect(value.state.reservations).toEqual([]);
      expect(value.state.runs).toEqual([]);
      expectIntegrity(value.state);
    },
    60_000,
  );

  it('handles simultaneous same-key same-command requests as one write plus replay', async () => {
    const value = await runConcurrentScenario('same-key-same-command');
    expect(value.operations.map((operation) => operation.kind)).toEqual(['result', 'result']);
    const results = value.operations.map((operation) => operation.result!);
    expect(results.map((result) => result.idempotentReplay).sort()).toEqual([false, true]);
    expect(results[0]!.envelope.id).toBe(results[1]!.envelope.id);
    expect(value.state.envelopes).toHaveLength(1);
    expect(value.state.receipts).toHaveLength(1);
    expect(value.state.reservations).toEqual([]);
    expectIntegrity(value.state);
  }, 60_000);

  it.each([
    ['same-key-changed-command-canonical-first', 'canonical'],
    ['same-key-changed-command-changed-first', 'changed'],
  ] as const)(
    'makes two fresh changed commands deterministic when %s wins',
    async (scenario, expectedWinner) => {
      const value = await runConcurrentScenario(scenario);
      const winners = value.operations.filter((operation) => operation.kind === 'result');
      const losers = value.operations.filter((operation) => operation.kind === 'error');
      expect(value.initialState.envelopes).toEqual([]);
      expect(value.initialState.receipts).toEqual([]);
      expect(value.initialState.reservations).toEqual([]);
      expect(value.initialState.runs).toEqual([]);
      expect(value.operations.map((operation) => operation.batchReached)).toEqual([true, true]);
      expect(winners).toEqual([expect.objectContaining({ commandVariant: expectedWinner })]);
      expect(losers).toEqual([
        expect.objectContaining({
          commandVariant: expectedWinner === 'canonical' ? 'changed' : 'canonical',
          status: 409,
          error: 'script_critic_capacity_idempotency_conflict',
          errorClass: 'ScriptCriticCapacityError',
        }),
      ]);
      expect(value.state.envelopes).toHaveLength(1);
      expect(value.state.receipts).toHaveLength(1);
      const metadata = JSON.parse(value.state.receipts[0]!.metadataJson) as {
        historicalEnvelopeId: string;
      };
      expect(metadata.historicalEnvelopeId).toBe(
        expectedWinner === 'canonical' ? 'historical-critic' : 'historical-critic-changed',
      );
      expect(value.state.reservations).toEqual([]);
      expect(value.state.runs).toEqual([]);
      expect(value.state.historicalEnvelopes).toEqual([
        { id: 'historical-critic', status: 'CONSUMED', version: 2 },
        { id: 'historical-critic-changed', status: 'CONSUMED', version: 2 },
      ]);
      expectIntegrity(value.state);
    },
    60_000,
  );

  it('allows exactly one winner for simultaneous different keys on one capacity', async () => {
    const value = await runConcurrentScenario('different-keys-same-capacity');
    expect(value.operations.filter((operation) => operation.kind === 'result')).toHaveLength(1);
    const conflicts = value.operations.filter((operation) => operation.kind === 'error');
    expect(conflicts).toEqual([
      expect.objectContaining({ status: 409, errorClass: 'ScriptCriticCapacityError' }),
    ]);
    expect([
      'script_critic_capacity_conflict',
      'script_critic_capacity_snapshot_invalid',
    ]).toContain(conflicts[0]!.error);
    expect(value.state.envelopes).toHaveLength(1);
    expect(value.state.receipts).toHaveLength(1);
    expect(value.state.reservations).toEqual([]);
    expectIntegrity(value.state);
  }, 60_000);

  it('scopes the same simultaneous key independently across two projects', async () => {
    const value = await runConcurrentScenario('cross-project-same-key');
    expect(value.operations.map((operation) => operation.kind)).toEqual(['result', 'result']);
    expect(value.operations.map((operation) => operation.result!.idempotentReplay)).toEqual([
      false,
      false,
    ]);
    expect(new Set(value.operations.map((operation) => operation.result!.envelope.id)).size).toBe(
      2,
    );
    expect(value.state.envelopes).toHaveLength(2);
    expect(new Set(value.state.envelopes.map((envelope) => envelope.projectId))).toEqual(
      new Set(['project', 'project-b']),
    );
    expect(value.state.receipts).toHaveLength(2);
    expect(value.state.reservations).toEqual([]);
    expectIntegrity(value.state);
  }, 60_000);

  it.each([
    ['reservation-low', 100000],
    ['reservation-high', 600000],
  ] as const)(
    'fails closed when a simultaneous %s reservation wins before capacity provisioning',
    async (scenario, amount) => {
      const value = await runConcurrentScenario(scenario);
      expect(value.operations.filter((operation) => operation.kind === 'race')).toEqual([
        expect.objectContaining({ mutation: 'reservation', amount }),
      ]);
      const conflicts = value.operations.filter((operation) => operation.kind === 'error');
      expect(conflicts).toEqual([
        expect.objectContaining({ status: 409, errorClass: 'ScriptCriticCapacityError' }),
      ]);
      expect([
        'script_critic_capacity_conflict',
        'script_critic_capacity_snapshot_invalid',
      ]).toContain(conflicts[0]!.error);
      expect(value.state.envelopes).toEqual([
        expect.objectContaining({ stageKey: 'CONTENT_BRIEF', ceiling: amount }),
      ]);
      expect(value.state.receipts).toEqual([]);
      expect(value.state.reservations).toEqual([
        expect.objectContaining({ reservedMicrousd: amount, status: 'RESERVED' }),
      ]);
      expect(value.state.runs).toHaveLength(1);
      expectIntegrity(value.state);
    },
    60_000,
  );

  it('lets the database enforce a single active envelope in the simultaneous race', async () => {
    const value = await runConcurrentScenario('active-envelope-race');
    expect(value.operations.filter((operation) => operation.kind === 'race')).toEqual([
      expect.objectContaining({ mutation: 'active-envelope' }),
    ]);
    const conflicts = value.operations.filter((operation) => operation.kind === 'error');
    expect(conflicts).toEqual([
      expect.objectContaining({ status: 409, errorClass: 'ScriptCriticCapacityError' }),
    ]);
    expect([
      'script_critic_capacity_conflict',
      'script_critic_capacity_snapshot_invalid',
    ]).toContain(conflicts[0]!.error);
    expect(value.state.envelopes).toEqual([
      expect.objectContaining({
        id: 'active-race-envelope',
        stageKey: 'SCRIPT_CRITIC',
        status: 'ACTIVE',
      }),
    ]);
    expect(value.state.receipts).toEqual([]);
    expect(value.state.reservations).toEqual([]);
    expectIntegrity(value.state);
  }, 60_000);

  it('keeps every winning workerd batch within D1 limits', async () => {
    const value = await runConcurrentScenario('different-keys-same-capacity');
    const winner = winningOperation(value);
    expect(winner?.bindingCounts).toEqual([13, 22, 15]);
    expect(winner?.sqlBytes).toHaveLength(3);
    expect(Math.max(...(winner?.bindingCounts ?? []))).toBeLessThanOrEqual(100);
    expect(winner?.sqlBytes?.every((bytes) => bytes > 0)).toBe(true);
    expect(
      Math.max(...value.operations.map((operation) => operation.queryCount ?? 0)),
    ).toBeLessThanOrEqual(7);
  }, 60_000);
});

type HttpResponse = { status: number; body: Record<string, unknown> };
type HttpMetrics = {
  constructionCount: number;
  metrics: Array<{
    flow: string;
    batchReached: boolean;
    queryCount: number;
    bindings: number[];
    sqlBytes: number[];
  }>;
  state: D1State | null;
};
const capacityPath = (projectId: string) =>
  `/api/v1/admin/projects/${projectId}/editorial-script-critic-capacities`;
const canonicalCommand = {
  successorBudgetId: 'budget-successor',
  expectedBudgetVersion: 1,
  expectedBudgetStatus: 'ACTIVE',
  consumedHistoricalEnvelopeId: 'historical-critic',
  reason: 'REPLACEMENT_SCRIPT_CRITIC_CAPACITY',
};
const changedHttpCommand = {
  ...canonicalCommand,
  consumedHistoricalEnvelopeId: 'historical-critic-changed',
};
const otherProjectCommand = {
  ...canonicalCommand,
  successorBudgetId: 'budget-successor-b',
  consumedHistoricalEnvelopeId: 'historical-critic-b',
};
const defaultCommand = {
  ...canonicalCommand,
  successorBudgetId: 'project_execution_budget_e00c938b-5621-4ce4-ae74-eea07d9b5529',
  consumedHistoricalEnvelopeId: 'execution_envelope_cf4d27f4-2296-4b0d-9ba7-7893bd21dc38',
};

async function setupHttp(origin: string, scenario: string) {
  return json<{ ready: boolean; initialState: D1State | null }>(
    await fetch(`${origin}/setup/http-${scenario}`, { method: 'POST' }),
    `HTTP route setup ${scenario}`,
  );
}

async function postCapacity(
  origin: string,
  projectId: string,
  key: string,
  command: Record<string, unknown>,
  token = 'owner',
  headers: Record<string, string> = {},
  query = '',
): Promise<HttpResponse> {
  const response = await fetch(`${origin}${capacityPath(projectId)}${query}`, {
    method: 'POST',
    headers: {
      Origin: 'http://localhost',
      'Cf-Access-Jwt-Assertion': token,
      'Content-Type': 'application/json',
      'Idempotency-Key': key,
      ...headers,
    },
    body: JSON.stringify(command),
  });
  return { status: response.status, body: await response.json() };
}

async function httpMetrics(origin: string) {
  return json<HttpMetrics>(await fetch(`${origin}/state/http-route`), 'HTTP route metrics');
}

async function awaitConstruction(origin: string) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if ((await httpMetrics(origin)).constructionCount >= 1) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
  throw new Error('first HTTP request did not reach production service construction');
}

async function runHttpPair(
  scenario: string,
  first: { projectId: string; command: Record<string, unknown>; key: string },
  second: { projectId: string; command: Record<string, unknown>; key: string },
) {
  return withWorker(`http-${scenario}`, async (origin) => {
    const setup = await setupHttp(origin, scenario);
    const firstPending = postCapacity(origin, first.projectId, first.key, first.command);
    await awaitConstruction(origin);
    const secondPending = postCapacity(origin, second.projectId, second.key, second.command);
    const responses = await Promise.all([firstPending, secondPending]);
    return { setup, responses, metrics: await httpMetrics(origin) };
  });
}

function assertSingleGovernedCapacity(value: Awaited<ReturnType<typeof runHttpPair>>) {
  const state = value.metrics.state!;
  expect(value.setup.initialState!.envelopes).toEqual([]);
  expect(value.setup.initialState!.receipts).toEqual([]);
  expect(value.metrics.constructionCount).toBe(2);
  expect(value.metrics.metrics.map((metric) => metric.batchReached)).toEqual([true, true]);
  expect(state.envelopes).toHaveLength(1);
  expect(state.receipts).toHaveLength(1);
  expect(state.reservations).toEqual([]);
  expect(state.runs).toEqual([]);
  expect(state.historicalEnvelopes).toEqual([
    { id: 'historical-critic', status: 'CONSUMED', version: 2 },
    { id: 'historical-critic-changed', status: 'CONSUMED', version: 2 },
  ]);
  expectIntegrity(state);
  for (const metric of value.metrics.metrics) {
    expect(Math.max(...metric.bindings, 0)).toBeLessThanOrEqual(100);
    expect(metric.bindings.length).toBeLessThanOrEqual(150);
    expect(metric.queryCount).toBeLessThanOrEqual(250);
  }
}

describe('actual production Script Critic capacity HTTP route on workerd D1', () => {
  it.each([
    ['same-key-changed-command-canonical-first', 'historical-critic'],
    ['same-key-changed-command-changed-first', 'historical-critic-changed'],
  ] as const)(
    'maps changed-command %s to 201/409',
    async (scenario, expectedHistorical) => {
      const value = await runHttpPair(
        scenario,
        { projectId: 'project', command: canonicalCommand, key: 'shared-http-key' },
        { projectId: 'project', command: changedHttpCommand, key: 'shared-http-key' },
      );
      expect(value.responses.map((response) => response.status).sort()).toEqual([201, 409]);
      expect(value.responses.find((response) => response.status === 409)?.body.detail).toBe(
        'script_critic_capacity_idempotency_conflict',
      );
      const metadata = JSON.parse(value.metrics.state!.receipts[0]!.metadataJson) as {
        historicalEnvelopeId: string;
      };
      expect(metadata.historicalEnvelopeId).toBe(expectedHistorical);
      assertSingleGovernedCapacity(value);
    },
    60_000,
  );

  it('maps two fresh same-command requests to 201/200 replay', async () => {
    const value = await runHttpPair(
      'same-key-same-command',
      { projectId: 'project', command: canonicalCommand, key: 'shared-http-key' },
      { projectId: 'project', command: canonicalCommand, key: 'shared-http-key' },
    );
    expect(value.responses.map((response) => response.status).sort()).toEqual([200, 201]);
    expect(value.responses.find((response) => response.status === 200)?.body.idempotentReplay).toBe(
      true,
    );
    expect(value.responses.find((response) => response.status === 201)?.body.idempotentReplay).toBe(
      false,
    );
    assertSingleGovernedCapacity(value);
  }, 60_000);

  it('maps different keys competing for one capacity to 201/409', async () => {
    const value = await runHttpPair(
      'different-keys-same-capacity',
      { projectId: 'project', command: canonicalCommand, key: 'http-key-a' },
      { projectId: 'project', command: canonicalCommand, key: 'http-key-b' },
    );
    expect(value.responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect([
      'script_critic_capacity_conflict',
      'script_critic_capacity_snapshot_invalid',
    ]).toContain(value.responses.find((response) => response.status === 409)?.body.detail);
    assertSingleGovernedCapacity(value);
  }, 60_000);

  it('isolates the same key across projects through HTTP', async () => {
    const value = await runHttpPair(
      'cross-project-same-key',
      { projectId: 'project', command: canonicalCommand, key: 'shared-http-key' },
      { projectId: 'project-b', command: otherProjectCommand, key: 'shared-http-key' },
    );
    expect(value.responses.map((response) => response.status)).toEqual([201, 201]);
    expect(value.metrics.state!.envelopes).toHaveLength(2);
    expect(value.metrics.state!.receipts).toHaveLength(2);
    expect(new Set(value.metrics.state!.envelopes.map((envelope) => envelope.projectId))).toEqual(
      new Set(['project', 'project-b']),
    );
    expect(new Set(value.metrics.state!.envelopes.map((envelope) => envelope.id)).size).toBe(2);
    expect(value.metrics.state!.reservations).toEqual([]);
    expect(value.metrics.state!.runs).toEqual([]);
    expectIntegrity(value.metrics.state!);
  }, 60_000);

  it('preserves default production policy and HTTP contract without injection', async () => {
    await withWorker('http-default', async (origin) => {
      await setupHttp(origin, 'default');
      const response = await postCapacity(
        origin,
        'project_2135b883-8499-48e9-a4a7-bb04b970d72a',
        'default-http-key',
        defaultCommand,
      );
      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({ idempotentReplay: false });
      expect((await httpMetrics(origin)).constructionCount).toBe(0);
    });
  }, 60_000);

  it('retains scope 404, RBAC 403 and invalid identity 401', async () => {
    await withWorker('http-security', async (origin) => {
      await setupHttp(origin, 'scope');
      const foreign = await postCapacity(origin, 'foreign-project', 'scope-key', canonicalCommand);
      expect(foreign.status).toBe(404);
      const viewer = await postCapacity(
        origin,
        'project',
        'viewer-key',
        canonicalCommand,
        'viewer',
      );
      expect(viewer.status).toBe(403);
      const invalid = await postCapacity(
        origin,
        'project',
        'identity-key',
        canonicalCommand,
        'invalid',
      );
      expect(invalid.status).toBe(401);
      const metric = await httpMetrics(origin);
      expect(metric.constructionCount).toBe(1);
      expect(metric.state!.envelopes).toEqual([]);
      expect(metric.state!.receipts).toEqual([]);
    });
  }, 60_000);

  it('sanitizes unexpected storage error as HTTP 500', async () => {
    await withWorker('http-storage', async (origin) => {
      await setupHttp(origin, 'storage');
      const response = await postCapacity(origin, 'project', 'storage-key', canonicalCommand);
      expect(response.status).toBe(500);
      expect(response.body).toMatchObject({
        title: 'Internal Server Error',
        detail: 'The request could not be completed.',
      });
      expect(JSON.stringify(response.body)).not.toContain('forced_audit_failure');
      const metric = await httpMetrics(origin);
      expect(metric.state!.envelopes).toEqual([]);
      expect(metric.state!.receipts).toEqual([]);
      expectIntegrity(metric.state!);
    });
  }, 60_000);

  it('keeps the application-construction factory non-selectable by HTTP data', async () => {
    await withWorker('http-factory-safety', async (origin) => {
      await setupHttp(origin, 'factory-safety');
      const invalid = await postCapacity(origin, 'project', 'factory-invalid-key', {
        ...canonicalCommand,
        policy: 'changed',
        factory: 'changed',
      });
      expect(invalid.status).toBe(422);
      expect((await httpMetrics(origin)).constructionCount).toBe(0);
      const response = await postCapacity(
        origin,
        'project',
        'factory-safety-key',
        canonicalCommand,
        'owner',
        { 'X-Test-Policy': 'changed', 'X-Test-Factory': 'changed' },
        '?policy=changed&factory=changed',
      );
      expect(response.status).toBe(201);
      const metric = await httpMetrics(origin);
      expect(metric.constructionCount).toBe(1);
      expect(metric.state!.envelopes).toHaveLength(1);
      expect(metric.state!.receipts).toHaveLength(1);
    });
  }, 60_000);
});
