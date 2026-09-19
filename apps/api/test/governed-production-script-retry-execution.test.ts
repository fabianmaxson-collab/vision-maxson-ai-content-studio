import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backup } from 'node:sqlite';
import { Hono } from 'hono';
import { editorialRoutes } from '../src/editorial/routes';
import type { Bindings } from '../src/app';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAIResponsesAdapter } from '@vision-maxson/providers/openai';
import {
  actor as fixtureActor,
  humanFixture,
  humanService,
} from './content-brief-human-revision-fixture';
import { EditorialExecutionService } from '../src/editorial/execution';
import {
  ProductionScriptRetryAuthorizationService,
  productionScriptRetryRequired,
} from '../src/editorial/production-script-retry-authorization';

const migration16 = readFileSync(
  new URL(
    '../../../packages/db/migrations/0016_governed_production_script_retry_authorization.sql',
    import.meta.url,
  ),
  'utf8',
);

type Fixture = Awaited<ReturnType<typeof retryFixture>>;

async function retryFixture(include16 = true) {
  const fixture = await humanFixture();
  const human = await humanService(fixture).create(
    fixture.parentId,
    'human-brief-key',
    fixture.edit,
  );
  fixture.database
    .prepare(
      "INSERT INTO artifact_approvals(id,workspace_id,artifact_version_id,decision,actor_id,actor_role,decided_at) VALUES('human-brief-approval','workspace',?,'APPROVED','owner','owner','t')",
    )
    .run(human.versionId);
  fixture.database.exec(
    "UPDATE editorial_artifacts SET status='approved',version=version+1 WHERE id='brief'",
  );
  const brief = fixture.database
    .prepare(
      "SELECT a.id artifactId,a.version artifactRevision,v.id versionId,v.content_hash contentHash FROM editorial_artifacts a JOIN editorial_artifact_versions v ON v.id=a.current_version_id WHERE a.id='brief'",
    )
    .get()!;

  fixture.database.exec(`
    INSERT INTO prompt_versions(id,prompt_definition_id,version_number,template_text,input_schema_version,output_schema_version,status,content_hash,created_at)
      VALUES('prompt_version_script_short_v1','prompt_script_writer_short',1,'Write the exact approved brief {{context_json}}','script-input-v1','script-output-v1','active','${'6'.repeat(64)}','2026-01-01');
    INSERT INTO ai_provider_models(id,provider_id,model_key,display_name,status,capabilities_json,effective_from,created_at,updated_at,version)
      VALUES('model_openai_gpt_5_6_luna_20260903','provider_openai','gpt-5.6-luna','Luna','available','{"qualityTier":"ECONOMY","costRank":1,"capabilities":["MULTILINGUAL_TEXT","STRUCTURED_OUTPUT","SCRIPT_GENERATION"]}','2026-01-01','t','t',1);
    INSERT INTO ai_pricing_snapshots(id,provider_model_id,currency,input_unit_price,output_unit_price,unit_name,verification_status,effective_from,created_at)
      VALUES('pricing_model_openai_gpt_5_6_luna_20260903','model_openai_gpt_5_6_luna_20260903','USD',0.0000002,0.0000012,'token','externally_verified','2026-01-01','t');
    INSERT INTO editorial_execution_envelopes(id,workspace_id,project_id,profile_key,profile_version,provider_id,provider_model_id,currency,monetary_ceiling_microusd,maximum_calls,status,authorized_by,created_at,updated_at,version)
      VALUES('failed-script-envelope','workspace','project','phase3_short_de_review_es_v1',1,'provider_openai','model_openai_gpt_5_6_luna_20260903','USD',7000,2,'ACTIVE','owner','t','t',1);
    INSERT INTO intelligence_runs(id,workspace_id,project_id,task_type,provider_id,provider_model_id,prompt_version_id,input_artifact_version_id,initiated_by,operating_mode,status,idempotency_key,creative_regeneration_number,safe_metadata_json,pricing_snapshot_id,created_at,updated_at,version)
      VALUES('failed-script-run','workspace','project','SCRIPT_WRITER_SHORT','provider_openai','model_openai_gpt_5_6_luna_20260903','prompt_version_script_short_v1','${String(brief.versionId)}','owner','ASSISTED','RUNNING','failed-script-key',0,'{}','pricing_model_openai_gpt_5_6_luna_20260903','t','t',1);
    INSERT INTO intelligence_run_attempts(id,intelligence_run_id,attempt_number,attempt_kind,status,provider_request_id,error_category,safe_error_detail,safe_metadata_json,started_at,completed_at)
      VALUES('failed-script-attempt','failed-script-run',1,'TECHNICAL','FAILED_PERMANENT','provider-failed-script','PERMANENT','AI execution failed.','{"responseStatus":"completed","actualMicrousd":715,"cachedInputUnits":0,"reasoningOutputUnits":0}','t','t');
    INSERT INTO editorial_execution_reservations(id,envelope_id,workspace_id,project_id,intelligence_run_id,step_key,pricing_snapshot_id,reserved_microusd,actual_microusd,status,created_at,dispatched_at,reconciled_at)
      VALUES('failed-script-reservation','failed-script-envelope','workspace','project','failed-script-run','SCRIPT_WRITER_SHORT','pricing_model_openai_gpt_5_6_luna_20260903',2970,715,'RECONCILED','t','t','t');
    INSERT INTO audit_events(id,workspace_id,actor_type,action,resource_type,resource_id,outcome,request_id,environment,metadata_json,occurred_at,ingested_at)
      VALUES('failed-script-terminal-audit','workspace','system','intelligence.run_failed','intelligence_run','failed-script-run','failure','failed-request','staging','{}','t','t');
    UPDATE intelligence_runs SET status='FAILED_PERMANENT',input_units=1184,output_units=398,actual_cost=0.000715,currency='USD',safe_metadata_json='{"responseStatus":"completed","actualMicrousd":715,"cachedInputUnits":0,"reasoningOutputUnits":0}',error_category='PERMANENT',terminal_audit_event_id='failed-script-terminal-audit',completed_at='t',version=2 WHERE id='failed-script-run';
  `);

  // Local seed normalization only: production manifest SQL is used unchanged.
  // Restore every original trigger and FK enforcement before testing any operation.
  const identities: Record<string, string> = {
    'failed-script-terminal-audit': 'audit_86f12b5c-13a3-4463-aac2-af4a3fa956e7',
    workspace: 'workspace_primary',
    project: 'project_2135b883-8499-48e9-a4a7-bb04b970d72a',
    brief: 'artifact_9cb2f14a-987e-46d7-b9ac-865c22b314d4',
    script: 'artifact_f14775ef-f2ae-41d7-b399-0efa5d597ffd',
    'script-v1': 'artifact_version_4e08bbb7-07bb-4ebe-ac77-96affcdb08f5',
    'new-idea-v1': 'artifact_version_2b4a5d83-78ad-4997-9710-b1090aab994d',
    'failed-script-run': 'intelligence_run_2ddcc4a7-06c2-404e-99cf-3ed8a0a59346',
    'failed-script-attempt': 'attempt_1edfe3ea-09ec-4926-a81e-23d0e4408813',
    'failed-script-reservation': 'execution_reservation_8ebcfa3b-540f-4bff-be0a-d159d5ad1143',
    'failed-script-envelope': 'execution_envelope_d4dd3732-c5e7-4fd1-b9d8-5eae7f503789',
    'provider-failed-script': 'resp_07402c20ff2047dc016aa6936d768487d2aa67ca718ca2746f',
    'failed-script-key':
      'phase3-canonical-production-script-brief-v3-v1-8b6c4a21-437d-4d93-b18a-2ce91f0bde74',
  };
  identities[fixture.requestId] = 'revision_request_ed5a2ca2-403d-44da-9003-41b81487c6d2';
  identities[String(brief.versionId)] = 'artifact_version_c6c3cb0f-9650-4058-a11f-b06f52c95d85';
  identities[fixture.command.researchVersionId] =
    'artifact_version_9760e58c-4562-4fe2-a854-b6ff16881126';
  identities[String(brief.contentHash)] =
    '57ee67a4b1473112bcee01630355bc9f0643ef44f5a1cf16e17cb4776b6877ec';
  const triggers = fixture.database
    .prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger'")
    .all();
  fixture.database.exec('PRAGMA foreign_keys=OFF');
  for (const trigger of triggers)
    fixture.database.exec('DROP TRIGGER "' + String(trigger.name) + '"');
  for (const table of fixture.database
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all()) {
    const name = String(table.name);
    const columns = fixture.database
      .prepare('PRAGMA table_info("' + name + '")')
      .all()
      .filter((c) => c.type === 'TEXT');
    for (const column of columns) {
      const col = String(column.name);
      const rows = fixture.database
        .prepare('SELECT rowid,"' + col + '" value FROM "' + name + '"')
        .all();
      for (const row of rows) {
        if (typeof row.value !== 'string') continue;
        let value = identities[row.value] ?? row.value;
        for (const [oldId, newId] of Object.entries(identities))
          value = value.split(JSON.stringify(oldId)).join(JSON.stringify(newId));
        if (value !== row.value)
          fixture.database
            .prepare('UPDATE "' + name + '" SET "' + col + '"=? WHERE rowid=?')
            .run(value, row.rowid!);
      }
    }
  }
  for (const trigger of triggers) fixture.database.exec(String(trigger.sql));
  fixture.database.exec('PRAGMA foreign_keys=ON');
  if (include16) fixture.database.exec(migration16);
  expect(fixture.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);

  return {
    ...fixture,
    briefVersionId: identities[String(brief.versionId)]!,
    briefHash: identities[String(brief.contentHash)]!,
    briefRevision: Number(brief.artifactRevision),
  };
}

const actor = { ...fixtureActor, workspaceId: 'workspace_primary' };
const authorization = (fixture: Fixture, selectedActor = actor) =>
  new ProductionScriptRetryAuthorizationService(fixture.d1, selectedActor, {
    requestId: 'retry-authorization-request',
    environment: 'staging',
  });

const execution = (fixture: Fixture) =>
  new EditorialExecutionService(fixture.d1, actor, {
    openAIEnabled: true,
    openAIApiKey: 'local-test-placeholder',
    openAIBaseUrl: 'https://invalid.test',
    requestId: 'retry-execution-request',
    environment: 'staging',
  });

const command = (fixture: Fixture, capacityId?: string) => ({
  mode: 'LOCKED' as const,
  preferredProviderKey: 'openai',
  preferredModelKey: 'gpt-5.6-luna',
  inputArtifactVersionId: fixture.briefVersionId,
  creativeRegeneration: false,
  ...(capacityId ? { productionScriptRetryAuthorizationId: capacityId } : {}),
});

async function expectValidEligibilityAtExpressionDepth100(database: Fixture['database']) {
  const path = join(tmpdir(), `phase3-retry-depth-${randomUUID()}.sqlite`);
  try {
    await backup(database, path);
    const script = String.raw`
import sqlite3, sys
connection = sqlite3.connect(sys.argv[1], cached_statements=0)
connection.setlimit(sqlite3.SQLITE_LIMIT_EXPR_DEPTH, 100)
assert connection.execute("SELECT count(*) FROM production_script_legacy_incident_live").fetchone() == (1,)
assert connection.execute("SELECT count(*) FROM production_script_retry_execution_eligible").fetchone() == (1,)
assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
print("expression_depth=100 valid_path=pass")
`;
    const commands = process.platform === 'win32' ? ['python', 'python3'] : ['python3', 'python'];
    const results = commands.map((command) =>
      spawnSync(command, ['-c', script, path], { encoding: 'utf8' }),
    );
    const result = results.find((candidate) => candidate.status !== null);
    expect(result, results.map((candidate) => candidate.error?.message).join('\n')).toBeDefined();
    expect(result?.status, `${result?.stdout ?? ''}\n${result?.stderr ?? ''}`).toBe(0);
    expect(result?.stdout).toContain('expression_depth=100 valid_path=pass');
  } finally {
    unlinkSync(path);
  }
}
afterEach(() => vi.restoreAllMocks());

describe('governed Production Script retry', () => {
  it('fails closed on schema 0015 before authorization or provider work', async () => {
    const fixture = await retryFixture(false);
    try {
      const before = fixture.database.prepare('SELECT count(*) n FROM intelligence_runs').get();
      await expect(
        authorization(fixture).attestLegacy(
          'project_2135b883-8499-48e9-a4a7-bb04b970d72a',
          'authorization-key',
        ),
      ).rejects.toMatchObject({ status: 422 });
      await expect(
        execution(fixture).execute(
          'project_2135b883-8499-48e9-a4a7-bb04b970d72a',
          'SCRIPT_WRITER_SHORT',
          command(fixture),
          'new-key',
        ),
      ).rejects.toMatchObject({ status: 422 });
      expect(fixture.database.prepare('SELECT count(*) n FROM intelligence_runs').get()).toEqual(
        before,
      );
    } finally {
      fixture.database.close();
    }
  });

  it('authorizes exactly one owner-admin retry with durable idempotency', async () => {
    const fixture = await retryFixture();
    try {
      expect(
        await productionScriptRetryRequired(
          fixture.d1,
          actor,
          'project_2135b883-8499-48e9-a4a7-bb04b970d72a',
          {
            briefVersionId: fixture.briefVersionId,
          },
        ),
      ).toBe(true);
      const result = await authorization(fixture).attestLegacy(
        'project_2135b883-8499-48e9-a4a7-bb04b970d72a',
        'authorization-key',
      );
      expect(result).toMatchObject({
        profileKey: 'phase3_production_script_retry_v1',
        monetaryCeilingMicrousd: 2970,
        maximumCalls: 1,
        idempotentReplay: false,
      });
      expect(
        await authorization(fixture).attestLegacy(
          'project_2135b883-8499-48e9-a4a7-bb04b970d72a',
          'authorization-key',
        ),
      ).toEqual({
        ...result,
        idempotentReplay: true,
      });
      await expect(
        authorization(fixture).attestLegacy(
          'project_2135b883-8499-48e9-a4a7-bb04b970d72a',
          'different-key',
        ),
      ).rejects.toMatchObject({ status: 409 });
      await expect(
        authorization(fixture, { ...actor, roles: ['admin'] }).attestLegacy(
          'project_2135b883-8499-48e9-a4a7-bb04b970d72a',
          'forbidden',
        ),
      ).rejects.toMatchObject({ status: 403 });
      expect(
        fixture.database
          .prepare(
            "SELECT count(*) n FROM editorial_project_execution_budgets WHERE profile_key='phase3_production_script_retry_v1'",
          )
          .get(),
      ).toEqual({ n: 1 });
      expect(
        fixture.database
          .prepare(
            "SELECT count(*) n FROM audit_events WHERE action='editorial.legacy_remediation_attested'",
          )
          .get(),
      ).toEqual({ n: 1 });
    } finally {
      fixture.database.close();
    }
  });

  it.each([
    ['another workspace', 'SELECT 1', { ...actor, workspaceId: 'other-workspace' }],

    [
      'unapproved Brief',
      "UPDATE editorial_artifacts SET status='active' WHERE id='artifact_9cb2f14a-987e-46d7-b9ac-865c22b314d4'",
      actor,
    ],
    [
      'missing provider dispatch evidence',
      "UPDATE intelligence_run_attempts SET provider_request_id=NULL WHERE id='attempt_1edfe3ea-09ec-4926-a81e-23d0e4408813'",
      actor,
    ],

    [
      'failed Run input drift',
      "UPDATE intelligence_runs SET input_artifact_version_id='artifact_version_4e08bbb7-07bb-4ebe-ac77-96affcdb08f5' WHERE id='intelligence_run_2ddcc4a7-06c2-404e-99cf-3ed8a0a59346'",
      actor,
    ],
    [
      'provider model drift',
      "UPDATE ai_provider_models SET status='inactive' WHERE id='model_openai_gpt_5_6_luna_20260903'",
      actor,
    ],

    [
      'pricing verification drift',
      "UPDATE ai_pricing_snapshots SET verification_status='unverified' WHERE id='pricing_model_openai_gpt_5_6_luna_20260903'",
      actor,
    ],
  ] as const)(
    'rejects %s without economic or provider side effects',
    async (_name, sql, selectedActor) => {
      const fixture = await retryFixture();
      try {
        if (sql !== 'SELECT 1') fixture.database.exec(sql);
        const provider = vi.spyOn(OpenAIResponsesAdapter.prototype, 'execute');
        await expect(
          authorization(fixture, selectedActor).attestLegacy(
            'project_2135b883-8499-48e9-a4a7-bb04b970d72a',
            'rejected-authorization',
          ),
        ).rejects.toThrow();
        expect(provider).not.toHaveBeenCalled();
        expect(
          fixture.database
            .prepare('SELECT count(*) n FROM editorial_production_script_retry_capacities')
            .get(),
        ).toEqual({ n: 0 });
        expect(
          fixture.database
            .prepare(
              "SELECT count(*) n FROM editorial_project_execution_budgets WHERE profile_key='phase3_production_script_retry_v1'",
            )
            .get(),
        ).toEqual({ n: 0 });
        expect(
          fixture.database
            .prepare(
              "SELECT count(*) n FROM audit_events WHERE action='editorial.legacy_remediation_attested'",
            )
            .get(),
        ).toEqual({ n: 0 });
      } finally {
        fixture.database.close();
      }
    },
  );
  describe.each(['before claim', 'after claim'] as const)('policy drift %s', (window) => {
    it.each([
      [
        'model availability',
        "UPDATE ai_provider_models SET status='inactive',version=version+1 WHERE id='model_openai_gpt_5_6_luna_20260903'",
      ],
      [
        'model version',
        "UPDATE ai_provider_models SET version=version+1 WHERE id='model_openai_gpt_5_6_luna_20260903'",
      ],
      [
        'available model capabilities',
        "UPDATE ai_provider_models SET capabilities_json=json_set(capabilities_json,'$.costRank',2) WHERE id='model_openai_gpt_5_6_luna_20260903'",
      ],
      [
        'provider availability',
        "UPDATE ai_providers SET status='disabled' WHERE id='provider_openai'",
      ],
      ['provider version', "UPDATE ai_providers SET version=version+1 WHERE id='provider_openai'"],
      [
        'prompt definition version',
        "UPDATE prompt_definitions SET version=version+1 WHERE id='prompt_script_writer_short'",
      ],
      [
        'pricing verification',
        "UPDATE ai_pricing_snapshots SET verification_status='unverified' WHERE id='pricing_model_openai_gpt_5_6_luna_20260903'",
      ],
    ])('blocks %s without adapter dispatch', async (_label, sql) => {
      const fixture = await retryFixture();
      try {
        const capacity = await authorization(fixture).attestLegacy(
          'project_2135b883-8499-48e9-a4a7-bb04b970d72a',
          'policy-authorization',
        );
        const receipt = fixture.database
          .prepare('SELECT * FROM editorial_production_script_retry_capacities WHERE id=?')
          .get(capacity.capacityId);
        const legacy = fixture.database
          .prepare(
            "SELECT * FROM editorial_execution_envelopes WHERE id='execution_envelope_d4dd3732-c5e7-4fd1-b9d8-5eae7f503789'",
          )
          .get();
        const oldReservation = fixture.database
          .prepare(
            "SELECT * FROM editorial_execution_reservations WHERE id='execution_reservation_8ebcfa3b-540f-4bff-be0a-d159d5ad1143'",
          )
          .get();
        const runCount = Number(
          fixture.database.prepare('SELECT count(*) n FROM intelligence_runs').get()!.n,
        );
        const adapter = vi
          .spyOn(OpenAIResponsesAdapter.prototype, 'execute')
          .mockRejectedValue(new Error('Adapter must never be invoked'));
        const network = vi
          .spyOn(globalThis, 'fetch')
          .mockRejectedValue(new Error('Network forbidden'));
        let injected = false;
        fixture.faults.beforeBatch = () => {
          const needle =
            window === 'before claim'
              ? 'production_script_retry_claim_changed'
              : 'production_script_retry_dispatch_changed';
          if (
            injected ||
            !fixture.faults.statements.some((statement) => statement.includes(needle))
          )
            return;
          // This callback runs after all service reads, immediately before the real SQLite transaction.
          const reservations = fixture.database
            .prepare('SELECT * FROM editorial_execution_reservations WHERE envelope_id=?')
            .all(capacity.envelopeId);
          expect(reservations).toHaveLength(window === 'before claim' ? 0 : 1);
          if (window === 'after claim')
            expect(reservations[0]).toMatchObject({ status: 'RESERVED', reserved_microusd: 2970 });
          fixture.database.exec(sql);
          injected = true;
        };
        await expect(
          execution(fixture).execute(
            'project_2135b883-8499-48e9-a4a7-bb04b970d72a',
            'SCRIPT_WRITER_SHORT',
            command(fixture, capacity.capacityId),
            'policy-execution',
          ),
        ).rejects.toThrow();
        expect(injected).toBe(true);
        expect(adapter).toHaveBeenCalledTimes(0);
        expect(network).toHaveBeenCalledTimes(0);
        expect(
          fixture.database
            .prepare('SELECT * FROM editorial_production_script_retry_capacities WHERE id=?')
            .get(capacity.capacityId),
        ).toEqual(receipt);
        expect(
          fixture.database
            .prepare(
              "SELECT * FROM editorial_execution_envelopes WHERE id='execution_envelope_d4dd3732-c5e7-4fd1-b9d8-5eae7f503789'",
            )
            .get(),
        ).toEqual(legacy);
        expect(
          fixture.database
            .prepare(
              "SELECT * FROM editorial_execution_reservations WHERE id='execution_reservation_8ebcfa3b-540f-4bff-be0a-d159d5ad1143'",
            )
            .get(),
        ).toEqual(oldReservation);
        const claimed = window === 'after claim';
        expect(
          Number(fixture.database.prepare('SELECT count(*) n FROM intelligence_runs').get()!.n),
        ).toBe(runCount + Number(claimed));
        const reservations = fixture.database
          .prepare('SELECT * FROM editorial_execution_reservations WHERE envelope_id=?')
          .all(capacity.envelopeId);
        expect(reservations).toHaveLength(Number(claimed));
        if (claimed)
          expect(reservations[0]).toMatchObject({
            status: 'RESERVED',
            dispatched_at: null,
            reserved_microusd: 2970,
          });
        expect(
          fixture.database
            .prepare('SELECT status,version FROM editorial_execution_envelopes WHERE id=?')
            .get(capacity.envelopeId),
        ).toEqual({ status: claimed ? 'CONSUMED' : 'ACTIVE', version: claimed ? 2 : 1 });
        expect(
          fixture.database
            .prepare(
              "SELECT count(*) n FROM audit_events WHERE action='editorial.legacy_remediation_claimed'",
            )
            .get(),
        ).toEqual({ n: Number(claimed) });
        expect(
          fixture.database
            .prepare(
              "SELECT count(*) n FROM audit_events WHERE action='editorial.legacy_remediation_dispatch_authorized'",
            )
            .get(),
        ).toEqual({ n: 0 });
        expect(
          fixture.database
            .prepare(
              "SELECT count(*) n FROM intelligence_run_attempts WHERE intelligence_run_id IN (SELECT id FROM intelligence_runs WHERE idempotency_key='policy-execution')",
            )
            .get(),
        ).toEqual({ n: 0 });
        expect(fixture.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      } finally {
        fixture.database.close();
      }
    });
  });

  it.each(['before claim', 'after claim'] as const)(
    'rejects stale effective reasoning controls %s',
    async (window) => {
      const fixture = await retryFixture();
      try {
        const capacity = await authorization(fixture).attestLegacy(
          'project_2135b883-8499-48e9-a4a7-bb04b970d72a',
          'control-authorization',
        );
        const adapter = vi
          .spyOn(OpenAIResponsesAdapter.prototype, 'execute')
          .mockRejectedValue(new Error('No dispatch'));
        let injected = false;
        fixture.faults.beforeBatch = () => {
          const needle =
            window === 'before claim'
              ? 'production_script_retry_claim_changed'
              : 'production_script_retry_dispatch_changed';
          const index = fixture.faults.statements.findIndex((sql) => sql.includes(needle));
          if (injected || index < 0) return;
          const values = fixture.faults.values[index]!;
          const policyJson = values.at(-1);
          if (typeof policyJson !== 'string') throw new Error('Expected execution policy JSON');
          const policy = JSON.parse(policyJson) as unknown[];
          policy[7] = 'high';
          values[values.length - 1] = JSON.stringify(policy);
          injected = true;
        };
        await expect(
          execution(fixture).execute(
            'project_2135b883-8499-48e9-a4a7-bb04b970d72a',
            'SCRIPT_WRITER_SHORT',
            command(fixture, capacity.capacityId),
            'wrong-effective-policy',
          ),
        ).rejects.toThrow();
        expect(injected).toBe(true);
        expect(adapter).toHaveBeenCalledTimes(0);
        expect(
          fixture.database
            .prepare(
              "SELECT count(*) n FROM audit_events WHERE action='editorial.legacy_remediation_dispatch_authorized'",
            )
            .get(),
        ).toEqual({ n: 0 });
        expect(
          fixture.database
            .prepare('SELECT count(*) n FROM editorial_execution_reservations WHERE envelope_id=?')
            .get(capacity.envelopeId),
        ).toEqual({ n: window === 'before claim' ? 0 : 1 });
      } finally {
        fixture.database.close();
      }
    },
  );

  it('permits only one concurrent execution for an unchanged authorization', async () => {
    const fixture = await retryFixture();
    try {
      const capacity = await authorization(fixture).attestLegacy(
        'project_2135b883-8499-48e9-a4a7-bb04b970d72a',
        'concurrent-execution-authorization',
      );
      const adapter = vi.spyOn(OpenAIResponsesAdapter.prototype, 'execute').mockResolvedValue({
        output: {
          title: 'Replacement Script',
          languageCode: 'de',
          segments: [{ order: 1, text: 'Verified replacement narration.' }],
        },
        usage: {
          inputUnits: 100,
          outputUnits: 100,
          cachedInputUnits: 0,
          reasoningOutputUnits: 0,
          unitName: 'token',
        },
        providerRequestId: 'fake-concurrent-provider-id',
        safeMetadata: {},
      });
      const results = await Promise.allSettled([
        execution(fixture).execute(
          'project_2135b883-8499-48e9-a4a7-bb04b970d72a',
          'SCRIPT_WRITER_SHORT',
          command(fixture, capacity.capacityId),
          'concurrent-execution-a',
        ),
        execution(fixture).execute(
          'project_2135b883-8499-48e9-a4a7-bb04b970d72a',
          'SCRIPT_WRITER_SHORT',
          command(fixture, capacity.capacityId),
          'concurrent-execution-b',
        ),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
      expect(adapter).toHaveBeenCalledTimes(1);
      expect(
        fixture.database
          .prepare('SELECT count(*) n FROM editorial_execution_reservations WHERE envelope_id=?')
          .get(capacity.envelopeId),
      ).toEqual({ n: 1 });
      expect(
        fixture.database
          .prepare(
            "SELECT count(*) n FROM audit_events WHERE action='editorial.legacy_remediation_dispatch_authorized'",
          )
          .get(),
      ).toEqual({ n: 1 });
      expect(fixture.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      fixture.database.close();
    }
  });

  it('requires the receipt, atomically dispatches once and persists the replacement Script', async () => {
    const fixture = await retryFixture();
    try {
      const capacity = await authorization(fixture).attestLegacy(
        'project_2135b883-8499-48e9-a4a7-bb04b970d72a',
        'authorization-key',
      );
      await expectValidEligibilityAtExpressionDepth100(fixture.database);
      await expect(
        execution(fixture).execute(
          'project_2135b883-8499-48e9-a4a7-bb04b970d72a',
          'SCRIPT_WRITER_SHORT',
          command(fixture),
          'missing-auth',
        ),
      ).rejects.toMatchObject({ status: 409 });
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockRejectedValue(new Error('network forbidden'));
      const provider = vi.spyOn(OpenAIResponsesAdapter.prototype, 'execute').mockResolvedValue({
        output: {
          title: 'Replacement Script',
          languageCode: 'de',
          segments: [{ order: 1, text: 'Verified replacement narration.' }],
        },
        usage: {
          inputUnits: 100,
          outputUnits: 100,
          cachedInputUnits: 0,
          reasoningOutputUnits: 0,
          unitName: 'token',
        },
        providerRequestId: 'provider-retry',
        safeMetadata: {},
      });
      await expect(
        execution(fixture).execute(
          'project_2135b883-8499-48e9-a4a7-bb04b970d72a',
          'SCRIPT_WRITER_SHORT',
          command(fixture, capacity.capacityId),
          'phase3-canonical-production-script-brief-v3-v1-8b6c4a21-437d-4d93-b18a-2ce91f0bde74',
        ),
      ).rejects.toThrow();
      expect(provider).not.toHaveBeenCalled();
      expect(
        fixture.database
          .prepare(
            "SELECT status,maximum_calls FROM editorial_execution_envelopes WHERE id='execution_envelope_d4dd3732-c5e7-4fd1-b9d8-5eae7f503789'",
          )
          .get(),
      ).toEqual({ status: 'ACTIVE', maximum_calls: 2 });
      expect(
        fixture.database
          .prepare(
            "SELECT count(*) n FROM editorial_execution_reservations WHERE envelope_id='execution_envelope_d4dd3732-c5e7-4fd1-b9d8-5eae7f503789'",
          )
          .get(),
      ).toEqual({ n: 1 });
      const result = await execution(fixture).execute(
        'project_2135b883-8499-48e9-a4a7-bb04b970d72a',
        'SCRIPT_WRITER_SHORT',
        command(fixture, capacity.capacityId),
        'retry-execution-key',
      );
      expect(result.run.status).toBe('SUCCEEDED');
      expect(provider).toHaveBeenCalledTimes(1);
      expect(fetchSpy).not.toHaveBeenCalled();
      const reservation = fixture.database
        .prepare('SELECT * FROM editorial_execution_reservations WHERE envelope_id=?')
        .get(capacity.envelopeId)!;
      expect(reservation).toMatchObject({
        project_execution_budget_id: capacity.budgetId,
        reserved_microusd: 2970,
        status: 'RECONCILED',
      });
      expect(
        fixture.database
          .prepare('SELECT status FROM editorial_execution_envelopes WHERE id=?')
          .get(capacity.envelopeId),
      ).toEqual({ status: 'CONSUMED' });
      expect(
        fixture.database
          .prepare('SELECT count(*) n FROM intelligence_run_attempts WHERE intelligence_run_id=?')
          .get(String(result.run.id)),
      ).toEqual({ n: 1 });
      expect(
        fixture.database
          .prepare(
            "SELECT count(*) n FROM audit_events WHERE action='editorial.legacy_remediation_claimed'",
          )
          .get(),
      ).toEqual({ n: 1 });
      expect(
        fixture.database
          .prepare(
            "SELECT count(*) n FROM audit_events WHERE action='editorial.legacy_remediation_dispatch_authorized'",
          )
          .get(),
      ).toEqual({ n: 1 });
      const version = fixture.database
        .prepare('SELECT * FROM editorial_artifact_versions WHERE id=?')
        .get(String(result.run.outputArtifactVersionId))!;
      expect(version).toMatchObject({
        parent_version_id: 'artifact_version_4e08bbb7-07bb-4ebe-ac77-96affcdb08f5',
        source_type: 'AI_GENERATED',
      });
      expect(
        fixture.database
          .prepare(
            'SELECT dependency_type FROM artifact_dependencies WHERE dependent_artifact_version_id=?',
          )
          .get(String(result.run.outputArtifactVersionId)),
      ).toEqual({ dependency_type: 'GENERATED_FROM' });
      expect(
        (
          await execution(fixture).execute(
            'project_2135b883-8499-48e9-a4a7-bb04b970d72a',
            'SCRIPT_WRITER_SHORT',
            command(fixture, capacity.capacityId),
            'retry-execution-key',
          )
        ).idempotentReplay,
      ).toBe(true);
      expect(provider).toHaveBeenCalledTimes(1);
      await expect(
        execution(fixture).execute(
          'project_2135b883-8499-48e9-a4a7-bb04b970d72a',
          'SCRIPT_WRITER_SHORT',
          command(fixture, capacity.capacityId),
          'second-execution-key',
        ),
      ).rejects.toThrow();
      expect(provider).toHaveBeenCalledTimes(1);
      expect(fixture.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      fixture.database.close();
    }
  });
  it('allows only one concurrent authorization and preserves the failed legacy capacity', async () => {
    const fixture = await retryFixture();
    try {
      const outcomes = await Promise.allSettled([
        authorization(fixture).attestLegacy(
          'project_2135b883-8499-48e9-a4a7-bb04b970d72a',
          'concurrent-authorization-a',
        ),
        authorization(fixture).attestLegacy(
          'project_2135b883-8499-48e9-a4a7-bb04b970d72a',
          'concurrent-authorization-b',
        ),
      ]);
      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
      expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
      expect(
        fixture.database
          .prepare('SELECT count(*) n FROM editorial_production_script_retry_capacities')
          .get(),
      ).toEqual({ n: 1 });
      expect(
        fixture.database
          .prepare(
            "SELECT status,maximum_calls FROM editorial_execution_envelopes WHERE id='execution_envelope_d4dd3732-c5e7-4fd1-b9d8-5eae7f503789'",
          )
          .get(),
      ).toEqual({ status: 'ACTIVE', maximum_calls: 2 });
      expect(
        fixture.database
          .prepare(
            "SELECT status,actual_microusd FROM editorial_execution_reservations WHERE id='execution_reservation_8ebcfa3b-540f-4bff-be0a-d159d5ad1143'",
          )
          .get(),
      ).toEqual({ status: 'RECONCILED', actual_microusd: 715 });
    } finally {
      fixture.database.close();
    }
  });

  it('fails closed after authorization when the exact project snapshot drifts', async () => {
    const fixture = await retryFixture();
    try {
      const capacity = await authorization(fixture).attestLegacy(
        'project_2135b883-8499-48e9-a4a7-bb04b970d72a',
        'authorization-key',
      );
      fixture.database.exec(
        "UPDATE projects SET version=version+1 WHERE id='project_2135b883-8499-48e9-a4a7-bb04b970d72a'",
      );
      const provider = vi.spyOn(OpenAIResponsesAdapter.prototype, 'execute');
      await expect(
        execution(fixture).execute(
          'project_2135b883-8499-48e9-a4a7-bb04b970d72a',
          'SCRIPT_WRITER_SHORT',
          command(fixture, capacity.capacityId),
          'drifted-execution-key',
        ),
      ).rejects.toMatchObject({ status: 409 });
      expect(provider).not.toHaveBeenCalled();
      expect(
        fixture.database
          .prepare('SELECT count(*) n FROM editorial_execution_reservations WHERE envelope_id=?')
          .get(capacity.envelopeId),
      ).toEqual({ n: 0 });
      expect(
        fixture.database
          .prepare('SELECT status FROM editorial_execution_envelopes WHERE id=?')
          .get(capacity.envelopeId),
      ).toEqual({ status: 'ACTIVE' });
    } finally {
      fixture.database.close();
    }
  });
});

const canonicalProject = 'project_2135b883-8499-48e9-a4a7-bb04b970d72a';
const canonicalRun = 'intelligence_run_2ddcc4a7-06c2-404e-99cf-3ed8a0a59346';
function stateCounts(f: Fixture) {
  return [
    'editorial_legacy_remediation_attestations',
    'editorial_production_script_retry_capacities',
    'editorial_project_execution_budgets',
    'editorial_execution_envelopes',
    'editorial_legacy_remediation_claims',
    'intelligence_runs',
    'intelligence_run_attempts',
    'editorial_execution_reservations',
    'audit_events',
  ].map((t) => f.database.prepare('SELECT count(*) n FROM ' + t).get()!.n);
}
function localApp(f: Fixture, roles: typeof actor.roles = ['owner']) {
  const app = new Hono<{
    Bindings: Bindings;
    Variables: {
      user: typeof actor;
      requestId: string;
      identity: { issuer: string; subject: string; email: string };
    };
  }>();
  app.use('*', async (c, next) => {
    c.set('user', { ...actor, roles });
    c.set('requestId', 'local-http');
    c.set('identity', { issuer: 'local', subject: 'local', email: 'owner@example.test' });
    await next();
  });
  app.route('/api/v1', editorialRoutes);
  return { app, env: { DB: f.d1, ENVIRONMENT: 'staging' } as Bindings };
}
describe('legacy attestation closed incident and isolation', () => {
  it.each([
    [
      'generic schema failure',
      "UPDATE intelligence_runs SET error_category='SCHEMA_VALIDATION',safe_error_detail='failed',safe_metadata_json='{}' WHERE id='" +
        canonicalRun +
        "'; UPDATE intelligence_run_attempts SET error_category='SCHEMA_VALIDATION',safe_error_detail='failed',safe_metadata_json='{}' WHERE intelligence_run_id='" +
        canonicalRun +
        "'",
    ],
    [
      'provider failure',
      "UPDATE intelligence_runs SET error_category='AUTHENTICATION' WHERE id='" +
        canonicalRun +
        "'",
    ],
    [
      'pre-dispatch failure',
      "UPDATE intelligence_run_attempts SET provider_request_id=NULL WHERE intelligence_run_id='" +
        canonicalRun +
        "'",
    ],
    [
      'wrong task',
      "UPDATE intelligence_runs SET task_type='SCRIPT_CRITIC' WHERE id='" + canonicalRun + "'",
    ],
    ['arbitrary terminal history', 'SELECT 1'],
  ])('generic authorization never falls back: %s', async (_name, sql) => {
    const f = await retryFixture();
    try {
      f.database.exec(sql);
      const before = stateCounts(f);
      const adapter = vi.spyOn(OpenAIResponsesAdapter.prototype, 'execute');
      await expect(
        authorization(f).authorize(canonicalProject, 'generic-key'),
      ).rejects.toMatchObject({
        status: 422,
        message: 'structured_remediation_evidence_unavailable',
      });
      expect(stateCounts(f)).toEqual(before);
      expect(adapter).toHaveBeenCalledTimes(0);
      expect(
        f.database.prepare('SELECT * FROM production_script_retry_eligible_failures').all(),
      ).toEqual([]);
    } finally {
      f.database.close();
    }
  });
  it.each([
    [
      'closed revision is prohibited by existing schema',
      "UPDATE editorial_revision_requests SET status='CLOSED'",
    ],
    ['project version', "UPDATE projects SET version=3 WHERE id='" + canonicalProject + "'"],
    [
      'project language',
      "UPDATE projects SET primary_language='en' WHERE id='" + canonicalProject + "'",
    ],
    [
      'Brief approval',
      "UPDATE editorial_artifacts SET status='active' WHERE artifact_type='CONTENT_BRIEF'",
    ],
    [
      'Brief hash',
      "UPDATE editorial_artifact_versions SET content_hash='" +
        '0'.repeat(64) +
        "' WHERE id='artifact_version_c6c3cb0f-9650-4058-a11f-b06f52c95d85'",
    ],
    [
      'Brief source',
      "UPDATE editorial_artifact_versions SET source_type='IMPORTED' WHERE id='artifact_version_c6c3cb0f-9650-4058-a11f-b06f52c95d85'",
    ],
    [
      'Brief version',
      "UPDATE editorial_artifacts SET current_version_id=NULL WHERE artifact_type='CONTENT_BRIEF'",
    ],
    [
      'Script checkpoint',
      "UPDATE editorial_artifacts SET current_version_id=NULL WHERE artifact_type='PRODUCTION_SCRIPT'",
    ],
    [
      'lineage',
      "UPDATE artifact_dependencies SET validity_status='STALE' WHERE dependent_artifact_version_id='artifact_version_c6c3cb0f-9650-4058-a11f-b06f52c95d85'",
    ],
    [
      'provider request',
      "UPDATE intelligence_run_attempts SET provider_request_id='other-response' WHERE intelligence_run_id='" +
        canonicalRun +
        "'",
    ],
    ['provider identity', "UPDATE ai_providers SET key='other' WHERE id='provider_openai'"],
    [
      'model identity',
      "UPDATE ai_provider_models SET model_key='other' WHERE id='model_openai_gpt_5_6_luna_20260903'",
    ],
    ['usage', "UPDATE intelligence_runs SET input_units=1185 WHERE id='" + canonicalRun + "'"],
    ['cost', "UPDATE intelligence_runs SET actual_cost=0.000716 WHERE id='" + canonicalRun + "'"],
    [
      'historical key',
      "UPDATE intelligence_runs SET idempotency_key='wrong-key' WHERE id='" + canonicalRun + "'",
    ],
    [
      'provider completion missing',
      "UPDATE intelligence_run_attempts SET safe_metadata_json='{}' WHERE intelligence_run_id='" +
        canonicalRun +
        "'",
    ],
    [
      'unexpected structured cause',
      "UPDATE intelligence_runs SET safe_metadata_json=json_set(safe_metadata_json,'$.persistenceFailure','claimed') WHERE id='" +
        canonicalRun +
        "'",
    ],
    [
      'policy',
      "UPDATE ai_provider_models SET status='inactive' WHERE id='model_openai_gpt_5_6_luna_20260903'",
    ],
  ])('rejects live incident drift or immutable-source tampering: %s', async (_name, sql) => {
    const f = await retryFixture();
    try {
      // Existing source immutability is also a valid rejection; do not disable production guards.
      let sourceRejected = false;
      try {
        f.database.exec(sql);
      } catch {
        sourceRejected = true;
      }
      const before = stateCounts(f);
      const adapter = vi.spyOn(OpenAIResponsesAdapter.prototype, 'execute');
      if (!sourceRejected)
        await expect(
          authorization(f).attestLegacy(canonicalProject, 'drift-key'),
        ).rejects.toThrow();
      expect(stateCounts(f)).toEqual(before);
      expect(adapter).toHaveBeenCalledTimes(0);
    } finally {
      f.database.close();
    }
  });
  it.each(['{', '[]', 'null', '{"runId":"other"}', '{"amount":2970}', '{"reason":"failed"}'])(
    'rejects invalid HTTP body %s',
    async (body) => {
      const f = await retryFixture();
      try {
        const { app, env } = localApp(f);
        const before = stateCounts(f);
        const response = await app.request(
          '/api/v1/projects/' + canonicalProject + '/scripts/legacy-remediation-attestations',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'http-key' },
            body,
          },
          env,
        );
        expect(response.status).toBe(422);
        expect(stateCounts(f)).toEqual(before);
      } finally {
        f.database.close();
      }
    },
  );
  it.each([['admin'], ['operator']] as const)('rejects non-owner HTTP roles %s', async (role) => {
    const f = await retryFixture();
    try {
      const { app, env } = localApp(f, [role]);
      const before = stateCounts(f);
      const response = await app.request(
        '/api/v1/projects/' + canonicalProject + '/scripts/legacy-remediation-attestations',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'http-key' },
          body: '{}',
        },
        env,
      );
      expect(response.status).toBe(403);
      expect(stateCounts(f)).toEqual(before);
    } finally {
      f.database.close();
    }
  });
  it('returns 201 then 200 without duplicate funding through the real route', async () => {
    const f = await retryFixture();
    try {
      const { app, env } = localApp(f);
      const before = stateCounts(f);
      const adapter = vi.spyOn(OpenAIResponsesAdapter.prototype, 'execute');
      for (const status of [201, 200]) {
        const response = await app.request(
          '/api/v1/projects/' + canonicalProject + '/scripts/legacy-remediation-attestations',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'http-key' },
            body: '{}',
          },
          env,
        );
        expect(response.status).toBe(status);
      }
      expect(stateCounts(f).map((v, i) => Number(v) - Number(before[i]))).toEqual([
        1, 1, 1, 1, 0, 0, 0, 0, 1,
      ]);
      expect(adapter).not.toHaveBeenCalled();
    } finally {
      f.database.close();
    }
  });
  it('same-key race creates one attestation and one exact replay', async () => {
    const f = await retryFixture();
    try {
      const before = stateCounts(f);
      const results = await Promise.all([
        authorization(f).attestLegacy(canonicalProject, 'same-key'),
        authorization(f).attestLegacy(canonicalProject, 'same-key'),
      ]);
      expect(results.map((r) => r.idempotentReplay).sort()).toEqual([false, true]);
      expect(results[0].attestationId).toBe(results[1].attestationId);
      expect(stateCounts(f).map((v, i) => Number(v) - Number(before[i]))).toEqual([
        1, 1, 1, 1, 0, 0, 0, 0, 1,
      ]);
    } finally {
      f.database.close();
    }
  });
  it.each([0, 1, 2, 3, 4, 5, 6])(
    'rolls back attestation batch failure at statement %s',
    async (index) => {
      const f = await retryFixture();
      try {
        const before = stateCounts(f);
        f.faults.failIndex = index;
        await expect(
          authorization(f).attestLegacy(canonicalProject, 'fault-key'),
        ).rejects.toThrow();
        expect(stateCounts(f)).toEqual(before);
      } finally {
        f.database.close();
      }
    },
  );
  it('preserves append-only attestation and rejects the failed historical key', async () => {
    const f = await retryFixture();
    try {
      await expect(
        authorization(f).attestLegacy(
          canonicalProject,
          'phase3-canonical-production-script-brief-v3-v1-8b6c4a21-437d-4d93-b18a-2ce91f0bde74',
        ),
      ).rejects.toMatchObject({ status: 409 });
      const result = await authorization(f).attestLegacy(canonicalProject, 'new-attestation');
      expect(result.authorizationBasis).toBe('LEGACY_OWNER_ATTESTED_EXCEPTION');
      expect(() =>
        f.database
          .prepare(
            'UPDATE editorial_legacy_remediation_attestations SET evidence_json=? WHERE id=?',
          )
          .run('{}', result.attestationId),
      ).toThrow();
      expect(() =>
        f.database
          .prepare('DELETE FROM editorial_legacy_remediation_attestations WHERE id=?')
          .run(result.attestationId),
      ).toThrow();
      await expect(
        execution(f).execute(
          canonicalProject,
          'SCRIPT_WRITER_SHORT',
          command(f, result.capacityId),
          'new-attestation',
        ),
      ).rejects.toThrow();
      expect(
        f.database.prepare('SELECT count(*) n FROM editorial_legacy_remediation_claims').get(),
      ).toEqual({ n: 0 });
    } finally {
      f.database.close();
    }
  });
  it.each(['before claim', 'after claim'])(
    'blocks historical evidence drift %s',
    async (window) => {
      const f = await retryFixture();
      try {
        const c = await authorization(f).attestLegacy(canonicalProject, 'history-key');
        const adapter = vi.spyOn(OpenAIResponsesAdapter.prototype, 'execute');
        let changed = false;
        f.faults.beforeBatch = () => {
          if (
            changed ||
            !f.faults.statements.some((s) =>
              s.includes(
                window === 'before claim'
                  ? 'production_script_retry_claim_changed'
                  : 'production_script_retry_dispatch_changed',
              ),
            )
          )
            return;
          f.database
            .prepare('UPDATE intelligence_runs SET input_units=1185 WHERE id=?')
            .run(canonicalRun);
          changed = true;
        };
        await expect(
          execution(f).execute(
            canonicalProject,
            'SCRIPT_WRITER_SHORT',
            command(f, c.capacityId),
            'drift-execution',
          ),
        ).rejects.toThrow();
        expect(changed).toBe(true);
        expect(adapter).not.toHaveBeenCalled();
        expect(
          f.database
            .prepare('SELECT count(*) n FROM editorial_execution_reservations WHERE envelope_id=?')
            .get(c.envelopeId),
        ).toEqual({ n: window === 'before claim' ? 0 : 1 });
      } finally {
        f.database.close();
      }
    },
  );
});

describe('legacy database binding and partial-write protection', () => {
  it.each([
    'workspace_id',
    'project_id',
    'revision_request_id',
    'brief_artifact_id',
    'brief_version_id',
    'brief_content_hash',
    'script_artifact_id',
    'expected_current_script_version_id',
    'failed_run_id',
    'failed_attempt_id',
    'failed_reservation_id',
    'failed_envelope_id',
    'provider_request_id',
    'terminal_audit_id',
    'provider_id',
    'provider_model_id',
    'budget_id',
    'envelope_id',
    'policy_snapshot_json',
    'evidence_json',
    'incident_code',
    'evidence_gap',
    'authorization_basis',
    'environment',
  ])('rejects tampered attestation binding %s', async (field) => {
    const f = await retryFixture();
    try {
      const before = stateCounts(f);
      const adapter = vi.spyOn(OpenAIResponsesAdapter.prototype, 'execute');
      let injected = false;
      f.faults.beforeBatch = () => {
        const i = f.faults.statements.findIndex((sql) =>
          sql.startsWith('INSERT INTO editorial_legacy_remediation_attestations('),
        );
        if (i < 0) return;
        const names = f.faults.statements[i]!.split('(')[1]!.split(')')[0]!.split(',');
        const j = names.indexOf(field);
        expect(j).toBeGreaterThanOrEqual(0);
        f.faults.values[i]![j] = field.endsWith('_json')
          ? '{}'
          : field === 'brief_content_hash'
            ? '0'.repeat(64)
            : 'tampered';
        injected = true;
      };
      await expect(
        authorization(f).attestLegacy(canonicalProject, 'tampered-key'),
      ).rejects.toThrow();
      expect(injected).toBe(true);
      expect(stateCounts(f)).toEqual(before);
      expect(adapter).not.toHaveBeenCalled();
    } finally {
      f.database.close();
    }
  });
  it.each([1, 2, 3, 4, 5])('rejects skipped attestation write %s', async (i) => {
    const f = await retryFixture();
    try {
      const before = stateCounts(f);
      f.faults.skipIndex = i;
      await expect(authorization(f).attestLegacy(canonicalProject, 'skip-key')).rejects.toThrow();
      expect(stateCounts(f)).toEqual(before);
    } finally {
      f.database.close();
    }
  });
  it.each([
    'INSERT INTO editorial_legacy_remediation_claims',
    'INSERT INTO audit_events',
    'UPDATE editorial_execution_envelopes',
  ])('rolls back incomplete claim missing %s', async (needle) => {
    const f = await retryFixture();
    try {
      const c = await authorization(f).attestLegacy(canonicalProject, 'claim-key');
      const before = stateCounts(f);
      const adapter = vi.spyOn(OpenAIResponsesAdapter.prototype, 'execute');
      let injected = false;
      f.faults.beforeBatch = () => {
        if (
          !f.faults.statements.some((sql) => sql.includes('production_script_retry_claim_changed'))
        )
          return;
        const index = f.faults.statements.findIndex((sql) => sql.startsWith(needle));
        expect(index).toBeGreaterThanOrEqual(0);
        f.faults.skipIndex = index;
        injected = true;
      };
      await expect(
        execution(f).execute(
          canonicalProject,
          'SCRIPT_WRITER_SHORT',
          command(f, c.capacityId),
          'incomplete-claim',
        ),
      ).rejects.toThrow();
      expect(injected).toBe(true);
      expect(stateCounts(f)).toEqual(before);
      expect(adapter).not.toHaveBeenCalled();
      expect(
        f.database
          .prepare('SELECT status FROM editorial_execution_envelopes WHERE id=?')
          .get(c.envelopeId),
      ).toEqual({ status: 'ACTIVE' });
    } finally {
      f.database.close();
    }
  });
  it.each(['budget', 'envelope'])('rejects equivalent pre-existing dedicated %s', async (kind) => {
    const f = await retryFixture();
    try {
      const sql =
        kind === 'budget'
          ? "INSERT INTO editorial_project_execution_budgets(id,workspace_id,project_id,profile_key,profile_version,currency,monetary_ceiling_microusd,status,authorized_by,created_at,updated_at,version) VALUES('duplicate','workspace_primary','" +
            canonicalProject +
            "','phase3_production_script_retry_v1',1,'USD',2970,'ACTIVE','owner','t','t',1)"
          : "INSERT INTO editorial_execution_envelopes(id,workspace_id,project_id,profile_key,profile_version,provider_id,provider_model_id,currency,monetary_ceiling_microusd,maximum_calls,status,authorized_by,created_at,updated_at,version) VALUES('duplicate','workspace_primary','" +
            canonicalProject +
            "','phase3_production_script_retry_v1',1,'provider_openai','model_openai_gpt_5_6_luna_20260903','USD',2970,2,'ACTIVE','owner','t','t',1)";
      f.database.exec(sql);
      const before = stateCounts(f);
      await expect(
        authorization(f).attestLegacy(canonicalProject, 'duplicate-funding'),
      ).rejects.toThrow();
      expect(stateCounts(f)).toEqual(before);
    } finally {
      f.database.close();
    }
  });
  it('rejects missing key and cross-project replay', async () => {
    const f = await retryFixture();
    try {
      const { app, env } = localApp(f);
      const before = stateCounts(f);
      const response = await app.request(
        '/api/v1/projects/' + canonicalProject + '/scripts/legacy-remediation-attestations',
        { method: 'POST', body: '{}' },
        env,
      );
      expect(response.status).toBe(422);
      expect(stateCounts(f)).toEqual(before);
      await authorization(f).attestLegacy(canonicalProject, 'replay-key');
      const after = stateCounts(f);
      await expect(
        authorization(f).attestLegacy('protected-tim', 'replay-key'),
      ).rejects.toMatchObject({ status: 404 });
      expect(stateCounts(f)).toEqual(after);
    } finally {
      f.database.close();
    }
  });
});

describe('legacy atomic schema capability', () => {
  it.each(['attestation', 'claim', 'dispatch'])(
    'rolls back when a required guard disappears at %s',
    async (phase) => {
      const f = await retryFixture();
      try {
        const c =
          phase === 'attestation'
            ? null
            : await authorization(f).attestLegacy(canonicalProject, 'schema-key');
        const before = stateCounts(f);
        const adapter = vi.spyOn(OpenAIResponsesAdapter.prototype, 'execute');
        let injected = false;
        f.faults.beforeBatch = () => {
          const needle =
            phase === 'attestation'
              ? 'legacy_attestation_incomplete'
              : phase === 'claim'
                ? 'production_script_retry_claim_changed'
                : 'production_script_retry_dispatch_changed';
          if (injected || !f.faults.statements.some((sql) => sql.includes(needle))) return;
          f.database.exec('DROP TRIGGER legacy_remediation_attestation_no_delete');
          injected = true;
        };
        await expect(
          c
            ? execution(f).execute(
                canonicalProject,
                'SCRIPT_WRITER_SHORT',
                command(f, c.capacityId),
                'schema-execution',
              )
            : authorization(f).attestLegacy(canonicalProject, 'schema-key'),
        ).rejects.toThrow();
        expect(injected).toBe(true);
        expect(adapter).not.toHaveBeenCalled();
        if (phase !== 'dispatch') expect(stateCounts(f)).toEqual(before);
        else {
          expect(
            f.database.prepare('SELECT count(*) n FROM editorial_legacy_remediation_claims').get(),
          ).toEqual({ n: 1 });
          expect(
            f.database
              .prepare('SELECT status FROM editorial_execution_envelopes WHERE id=?')
              .get(c!.envelopeId),
          ).toEqual({ status: 'CONSUMED' });
        }
      } finally {
        f.database.close();
      }
    },
  );
});

describe('legacy editorial terminal state exclusions', () => {
  it('rejects a persisted resolution even though revision receipt stays OPEN', async () => {
    const f = await retryFixture(false);
    try {
      // Seed only the pre-0016 resolution boundary; restore all original guards before exercise.
      const triggers = f.database
        .prepare(
          "SELECT name,sql FROM sqlite_master WHERE type='trigger' AND tbl_name='editorial_revision_request_resolutions'",
        )
        .all();
      for (const t of triggers) f.database.exec('DROP TRIGGER ' + String(t.name));
      f.database
        .exec(`INSERT INTO editorial_revision_request_resolutions(id,workspace_id,project_id,revision_request_id,status,resolution_artifact_version_id,resolved_by,idempotency_key,command_hash,audit_event_id,resolved_at)
      SELECT 'seed-resolution',workspace_id,project_id,id,'RESOLVED',reviewed_artifact_version_id,actor_id,'seed-resolution-key',command_hash,audit_event_id,'t' FROM editorial_revision_requests`);
      for (const t of triggers) f.database.exec(String(t.sql));
      f.database.exec(migration16);
      const before = stateCounts(f);
      await expect(
        authorization(f).attestLegacy(canonicalProject, 'resolved-key'),
      ).rejects.toThrow();
      expect(stateCounts(f)).toEqual(before);
      expect(f.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      f.database.close();
    }
  });
  it('rejects any durable Script successor while checkpoint pointer is unchanged', async () => {
    const f = await retryFixture();
    try {
      f.database
        .exec(`INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,parent_version_id,content_text,content_json,content_hash,language_code,source_type,intelligence_run_id,created_by,created_at)
      SELECT 'seed-successor',workspace_id,artifact_id,version_number+1,id,'Different successor fixture',NULL,'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',language_code,'IMPORTED',NULL,created_by,created_at FROM editorial_artifact_versions WHERE id='artifact_version_4e08bbb7-07bb-4ebe-ac77-96affcdb08f5'`);
      const before = stateCounts(f);
      await expect(
        authorization(f).attestLegacy(canonicalProject, 'successor-key'),
      ).rejects.toThrow();
      expect(stateCounts(f)).toEqual(before);
      expect(f.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      f.database.close();
    }
  });
});

describe('workspace-bound current Owner authorization', () => {
  const moveOwner = (f: Fixture) =>
    f.database.exec(
      "INSERT INTO workspaces(id,slug,name,created_at,updated_at) VALUES('other-workspace','other-workspace','Other','t','t'); UPDATE users SET workspace_id='other-workspace' WHERE id='owner'; UPDATE user_roles SET workspace_id='other-workspace' WHERE user_id='owner';",
    );
  const successfulAdapter = () =>
    vi.spyOn(OpenAIResponsesAdapter.prototype, 'execute').mockResolvedValue({
      output: {
        title: 'Local replacement',
        languageCode: 'de',
        segments: [{ order: 1, text: 'Local replacement.' }],
      },
      usage: {
        inputUnits: 100,
        outputUnits: 100,
        cachedInputUnits: 0,
        reasoningOutputUnits: 0,
        unitName: 'token',
      },
      providerRequestId: 'local-provider',
      safeMetadata: {},
    });
  it.each([
    ['workspace move', moveOwner],
    [
      'Owner removal',
      (f: Fixture) =>
        f.database.exec(
          "DELETE FROM user_roles WHERE user_id='owner' AND workspace_id='workspace_primary'",
        ),
    ],
    [
      'user disable',
      (f: Fixture) => f.database.exec("UPDATE users SET status='disabled' WHERE id='owner'"),
    ],
  ] as const)('blocks claim after %s without partial economic state', async (_name, mutate) => {
    const f = await retryFixture();
    try {
      const capacity = await authorization(f).attestLegacy(
        canonicalProject,
        'owner-drift-attestation',
      );
      const before = stateCounts(f);
      const adapter = successfulAdapter();
      let changed = false;
      f.faults.beforeBatch = () => {
        if (
          changed ||
          !f.faults.statements.some((sql) => sql.includes('production_script_retry_claim_changed'))
        )
          return;
        mutate(f);
        changed = true;
      };
      await expect(
        execution(f).execute(
          canonicalProject,
          'SCRIPT_WRITER_SHORT',
          command(f, capacity.capacityId),
          'owner-drift-execution',
        ),
      ).rejects.toThrow();
      expect(changed).toBe(true);
      expect(adapter).not.toHaveBeenCalled();
      expect(stateCounts(f)).toEqual(before);
      expect(
        f.database
          .prepare('SELECT status FROM editorial_execution_envelopes WHERE id=?')
          .get(capacity.envelopeId),
      ).toEqual({ status: 'ACTIVE' });
    } finally {
      f.database.close();
    }
  });
  it.each([
    ['workspace move', moveOwner],
    [
      'Owner removal',
      (f: Fixture) =>
        f.database.exec(
          "DELETE FROM user_roles WHERE user_id='owner' AND workspace_id='workspace_primary'",
        ),
    ],
    [
      'user disable',
      (f: Fixture) => f.database.exec("UPDATE users SET status='disabled' WHERE id='owner'"),
    ],
  ] as const)('blocks dispatch after durable claim on %s', async (_name, mutate) => {
    const f = await retryFixture();
    try {
      const capacity = await authorization(f).attestLegacy(
        canonicalProject,
        'post-claim-attestation',
      );
      const adapter = successfulAdapter();
      let changed = false;
      f.faults.beforeBatch = () => {
        if (
          changed ||
          !f.faults.statements.some((sql) =>
            sql.includes('production_script_retry_dispatch_changed'),
          )
        )
          return;
        mutate(f);
        changed = true;
      };
      await expect(
        execution(f).execute(
          canonicalProject,
          'SCRIPT_WRITER_SHORT',
          command(f, capacity.capacityId),
          'post-claim-execution',
        ),
      ).rejects.toThrow();
      expect(changed).toBe(true);
      expect(adapter).not.toHaveBeenCalled();
      expect(
        f.database.prepare('SELECT count(*) n FROM editorial_legacy_remediation_claims').get(),
      ).toEqual({ n: 1 });
      expect(
        f.database
          .prepare('SELECT count(*) n FROM intelligence_runs WHERE idempotency_key=?')
          .get('post-claim-execution'),
      ).toEqual({ n: 1 });
      expect(
        f.database
          .prepare('SELECT count(*) n FROM editorial_execution_reservations WHERE envelope_id=?')
          .get(capacity.envelopeId),
      ).toEqual({ n: 1 });
      expect(
        f.database
          .prepare('SELECT status FROM editorial_execution_envelopes WHERE id=?')
          .get(capacity.envelopeId),
      ).toEqual({ status: 'CONSUMED' });
      expect(
        f.database
          .prepare(
            "SELECT count(*) n FROM audit_events WHERE action='editorial.legacy_remediation_dispatch_authorized'",
          )
          .get(),
      ).toEqual({ n: 0 });
    } finally {
      f.database.close();
    }
  });
  it('accepts only the capacity workspace when Owner memberships exist in two workspaces', async () => {
    const f = await retryFixture();
    try {
      f.database.exec(
        "INSERT INTO workspaces(id,slug,name,created_at,updated_at) VALUES('other-workspace','other-workspace','Other','t','t'); INSERT INTO user_roles(workspace_id,user_id,role_id,created_at) VALUES('other-workspace','owner','role_owner','t')",
      );
      const capacity = await authorization(f).attestLegacy(
        canonicalProject,
        'dual-membership-attestation',
      );
      const adapter = successfulAdapter();
      const result = await execution(f).execute(
        canonicalProject,
        'SCRIPT_WRITER_SHORT',
        command(f, capacity.capacityId),
        'dual-membership-execution',
      );
      expect(result.run.status).toBe('SUCCEEDED');
      expect(adapter).toHaveBeenCalledTimes(1);
    } finally {
      f.database.close();
    }
  });
});
