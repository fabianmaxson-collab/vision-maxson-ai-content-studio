import { createHash } from 'node:crypto';
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

type ScenarioResult = {
  scenario: string;
  result: {
    oldBudget: { status: string; version: number };
    successorBudget: {
      id: string;
      status: string;
      version: number;
      monetaryCeilingMicroUsd: number;
    };
    canonicalCommittedMicroUsd: number;
    ambiguousExposureMicroUsd: number;
    auditEventId: string;
    idempotentReplay: boolean;
  } | null;
  replay: { auditEventId: string; idempotentReplay: boolean } | null;
  error: string | null;
  sqlBytes: number[];
  bindingCounts: number[];
  state: {
    oldBudget: { status: string; version: number };
    successors: Array<{ id: string; status: string; version: number; monetaryCeiling: number }>;
    receiptCount: number;
    successorEnvelopeCount: number;
    successorReservationCount: number;
    ambiguous: { status: string; reserved: number; actual: number | null };
    foreignKeys: unknown[];
  };
};

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const wrangler = join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const worker = join(here, 'project-budget-rollover-d1-worker.ts');
const sourceMigrations = join(root, 'packages', 'db', 'migrations');
let temporaryRoot = '';
let basePersistence = '';
let configPath = '';

function normalizePath(path: string) {
  return path.replaceAll('\\', '/');
}

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
) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw new Error(`Wrangler exited early (${child.exitCode})\n${logs()}`);
    try {
      const response = await fetch(`${origin}/health`);
      if (response.ok) return;
    } catch {
      // The local Worker is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`Timed out waiting for Wrangler local\n${logs()}`);
}

async function stopWorker(child: ChildProcessWithoutNullStreams) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise<void>((resolveExit) => child.once('exit', () => resolveExit())),
    new Promise<void>((resolveTimeout) => setTimeout(resolveTimeout, 5_000)),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

async function runScenario(scenario: string): Promise<ScenarioResult> {
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
  child.stdout.on('data', (chunk) => (output += String(chunk)));
  child.stderr.on('data', (chunk) => (output += String(chunk)));
  const origin = `http://127.0.0.1:${port}`;
  try {
    await waitForServer(origin, child, () => output);
    const response = await fetch(`${origin}/scenario/${scenario}`, { method: 'POST' });
    const body: ScenarioResult & { fatal?: string } = await response.json();
    if (!response.ok || body.fatal)
      throw new Error(
        `D1 scenario ${scenario} failed: ${body.fatal ?? response.status}\n${output}`,
      );
    return body;
  } finally {
    await stopWorker(child);
  }
}

function deterministicReceiptId(key: string) {
  const payload = JSON.stringify({
    workspaceId: 'workspace',
    operation: 'editorial.execution_budget_rolled_over',
    projectId: 'project',
    idempotencyKey: key,
  });
  return `audit_${createHash('sha256').update(payload).digest('hex')}`;
}

beforeAll(() => {
  temporaryRoot = mkdtempSync(join(tmpdir(), 'vision-maxson-rollover-d1-'));
  basePersistence = join(temporaryRoot, 'base-persistence');
  const migrations = join(temporaryRoot, 'migrations');
  mkdirSync(migrations, { recursive: true });
  const allowed = readdirSync(sourceMigrations)
    .filter((name) => /^(?:000[0-9]|001[0-6])_.*\.sql$/u.test(name))
    .sort();
  expect(allowed.at(0)).toBe('0000_phase_1_data_security_core.sql');
  expect(allowed.at(-1)).toBe('0016_governed_production_script_retry_authorization.sql');
  expect(allowed).toHaveLength(17);
  for (const name of allowed) {
    const target = join(migrations, name);
    if (name === allowed[0]) {
      const descriptor = openSync(target, 'w');
      closeSync(descriptor);
    }
    copyFileSync(join(sourceMigrations, name), target);
  }

  configPath = join(temporaryRoot, 'wrangler.rollover-d1.jsonc');
  writeFileSync(
    configPath,
    JSON.stringify(
      {
        name: 'vision-maxson-rollover-d1-regression',
        main: normalizePath(worker),
        compatibility_date: '2026-09-01',
        compatibility_flags: ['nodejs_compat'],
        d1_databases: [
          {
            binding: 'DB',
            database_name: 'vision-maxson-rollover-d1-regression',
            database_id: '00000000-0000-0000-0000-000000000020',
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
      'vision-maxson-rollover-d1-regression',
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

afterAll(() => {
  const expectedPrefix = join(tmpdir(), 'vision-maxson-rollover-d1-');
  if (!temporaryRoot.startsWith(expectedPrefix)) throw new Error('unsafe D1 test cleanup path');
  rmSync(temporaryRoot, { recursive: true, force: true });
});

describe('ProjectBudgetRolloverService on Wrangler D1 local/workerd', () => {
  it('executes the exact production batch without the D1 expression-depth failure', async () => {
    const result = await runScenario('success');
    expect(result.error).toBeNull();
    expect(result.sqlBytes).toHaveLength(3);
    expect(result.sqlBytes[2]).toBeLessThan(2_000);
    expect(result.bindingCounts).toEqual([5, 9, 20]);
    expect(result.result).toMatchObject({
      oldBudget: { status: 'CONSUMED', version: 2 },
      successorBudget: { status: 'ACTIVE', version: 1, monetaryCeilingMicroUsd: 907875 },
      canonicalCommittedMicroUsd: 423645,
      ambiguousExposureMicroUsd: 321920,
      auditEventId: deterministicReceiptId('d1-success'),
      idempotentReplay: false,
    });
    expect(result.replay).toEqual({
      ...result.result,
      idempotentReplay: true,
    });
    expect(result.state.oldBudget).toEqual({ status: 'CONSUMED', version: 2 });
    expect(result.state.successors).toEqual([
      {
        id: result.result!.successorBudget.id,
        status: 'ACTIVE',
        version: 1,
        monetaryCeiling: 907875,
      },
    ]);
    expect(result.state.receiptCount).toBe(1);
    expect(result.state.successorEnvelopeCount).toBe(0);
    expect(result.state.successorReservationCount).toBe(0);
    expect(result.state.ambiguous).toEqual({ status: 'AMBIGUOUS', reserved: 321920, actual: null });
    expect(result.state.foreignKeys).toEqual([]);
  }, 60_000);

  it.each([
    'historical-drift',
    'missing-statement-1',
    'missing-successor',
    'audit-collision',
    'successor-collision',
  ])(
    'rolls back without partial state for %s',
    async (scenario) => {
      const result = await runScenario(scenario);
      expect(result.result).toBeNull();
      expect(result.error).toBeTruthy();
      expect(result.error).not.toContain('Expression tree is too large');
      expect(result.state.oldBudget).toEqual({ status: 'ACTIVE', version: 1 });
      expect(result.state.successors).toEqual([]);
      expect(result.state.receiptCount).toBe(0);
      expect(result.state.successorEnvelopeCount).toBe(0);
      expect(result.state.successorReservationCount).toBe(0);
      expect(result.state.ambiguous).toEqual({
        status: 'AMBIGUOUS',
        reserved: 321920,
        actual: null,
      });
      expect(result.state.foreignKeys).toEqual([]);
    },
    60_000,
  );
});
