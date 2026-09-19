import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, type Bindings } from '../src/app';
import { OpenAIResponsesAdapter } from '@vision-maxson/providers/openai';
import { productionScriptHumanRevisionSchema } from '@vision-maxson/contracts';
import { ProductionScriptHumanRevisionService } from '../src/editorial/production-script-human-revision';
import {
  humanFixture,
  humanService,
  actor,
  snapshot,
  contentHash,
  corrupt,
  type HumanFixture,
} from './content-brief-human-revision-fixture';
let f: HumanFixture;
let briefId: string;
let provider: ReturnType<typeof vi.spyOn>;
const content = {
  title: 'Zahlenkonvertierung mit Folgen.',
  languageCode: 'de',
  segments: [
    { order: 1, text: 'Eine Zahlenkonvertierung mit Folgen.' },
    { order: 2, text: 'Redaktionelle Lehre: Grenzwerte testen.' },
  ],
};
const command = { baseVersionId: 'script-v2', ...content };
const context = {
  requestId: 'human-script-request',
  environment: 'staging',
  accessIssuer: 'https://team.cloudflareaccess.com',
  accessSubject: 'owner-subject',
};
const service = (who = actor) => new ProductionScriptHumanRevisionService(f.d1, who, context);
const row = (sql: string, ...values: (string | number | null)[]) =>
  f.database.prepare(sql).get(...values)!;
beforeEach(async () => {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No network'));
  f = await humanFixture();
  const brief = await humanService(f).create(f.parentId, 'human-brief', f.edit);
  briefId = brief.versionId;
  f.database
    .prepare(
      "INSERT INTO artifact_approvals(id,workspace_id,artifact_version_id,decision,actor_id,actor_role,decided_at) VALUES('human-brief-approval','workspace',?,'APPROVED','owner','owner','t')",
    )
    .run(briefId);
  f.database.exec(
    "UPDATE editorial_artifacts SET status='approved',version=version+1 WHERE id='brief'",
  );
  f.database.exec(
    readFileSync(
      new URL(
        '../../../packages/db/migrations/0016_governed_production_script_retry_authorization.sql',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  f.database
    .prepare(
      `INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,parent_version_id,language_code,content_text,content_json,source_type,intelligence_run_id,content_hash,created_at,created_by) VALUES('script-v2','workspace','script',2,'script-v1','de','Original Script',?,'AI_GENERATED','successful-storyboard-run',?,'t','owner')`,
    )
    .run(
      JSON.stringify({
        title: 'Original',
        languageCode: 'de',
        segments: [{ order: 1, text: 'Original Script' }],
      }),
      'a'.repeat(64),
    );
  f.database.exec(
    "UPDATE editorial_artifacts SET current_version_id='script-v2',status='active',version=4 WHERE id='script'",
  );
  f.database
    .prepare(
      "INSERT INTO artifact_dependencies(id,workspace_id,source_artifact_version_id,dependent_artifact_version_id,dependency_type,validity_status,created_at,updated_at,version) VALUES('brief-script-v2','workspace',?,'script-v2','GENERATED_FROM','CURRENT','t','t',1)",
    )
    .run(briefId);
  if (!row("SELECT count(*) n FROM editorial_artifacts WHERE id='translation'").n) {
    f.database
      .exec(`INSERT INTO editorial_artifacts(id,workspace_id,project_id,artifact_type,status,created_at,updated_at,version) VALUES('translation','workspace','project','REVIEW_TRANSLATION','approved','t','t',2);
    INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,language_code,content_text,source_type,source_script_version_id,content_hash,created_at,created_by) VALUES('translation-v1','workspace','translation',1,'es','Histórico','HUMAN_EDITED','script-v1','${'b'.repeat(64)}','t','owner');
    UPDATE editorial_artifacts SET current_version_id='translation-v1' WHERE id='translation';
    INSERT INTO artifact_dependencies(id,workspace_id,source_artifact_version_id,dependent_artifact_version_id,dependency_type,validity_status,created_at,updated_at,version) VALUES('dep-st','workspace','script-v1','translation-v1','GENERATED_FROM','CURRENT','t','t',1);`);
  }
  f.database.exec(
    "UPDATE artifact_dependencies SET validity_status=CASE WHEN id='dep-sb' THEN 'REAPPROVAL_REQUIRED' ELSE 'REGENERATION_REQUIRED' END,invalidated_by_version_id='script-v2',invalidated_at='t2',updated_at='t2',version=version+1 WHERE id IN ('dep-st','dep-sc','dep-sb')",
  );
  f.faults.batches = 0;
  provider = vi
    .spyOn(OpenAIResponsesAdapter.prototype, 'execute')
    .mockRejectedValue(new Error('No provider'));
});
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  expect(provider).not.toHaveBeenCalled();
  f?.database.close();
  vi.restoreAllMocks();
});
function post(body: unknown = command, authenticated = true) {
  const bindings = {
    ENVIRONMENT: 'staging',
    RELEASE_VERSION: 'test',
    ACCESS_TEAM_DOMAIN: context.accessIssuer,
    ACCESS_AUD: '1234567890123456',
    APP_ORIGIN: 'https://staging.vision.directormaxson.com',
    OWNER_BOOTSTRAP_ENABLED: 'false',
    BOOTSTRAP_OWNER_EMAIL: 'owner@example.test',
    TOKEN_ENCRYPTION_KEY: 'unused',
    OPENAI_PROVIDER_ENABLED: 'false',
    AI_PROVIDER_CONNECTIVITY_DIAGNOSTIC_ENABLED: 'false',
    DB: f.d1,
    ASSETS: {} as Fetcher,
  } as Bindings;
  return createApp(() =>
    Promise.resolve({
      issuer: context.accessIssuer,
      subject: context.accessSubject,
      email: 'owner@example.test',
    }),
  ).request(
    '/api/v1/projects/project/scripts/human-revision',
    {
      method: 'POST',
      headers: {
        Origin: bindings.APP_ORIGIN,
        'Content-Type': 'application/json',
        ...(authenticated ? { 'Cf-Access-Jwt-Assertion': 'test' } : {}),
      },
      body: JSON.stringify(body),
    },
    bindings,
  );
}
it('creates exact append-only unapproved human v3 with segments, lineage, audit and historical invalidation rebinding', async () => {
  const before = snapshot(f);
  const response = await post();
  expect(response.status, await response.clone().text()).toBe(201);
  const result = await response.json<{
    versionId: string;
    auditEventId: string;
    contentHash: string;
  }>();
  const v = row('SELECT * FROM editorial_artifact_versions WHERE id=?', result.versionId);
  expect(v).toMatchObject({
    artifact_id: 'script',
    version_number: 3,
    parent_version_id: 'script-v2',
    language_code: 'de',
    source_type: 'HUMAN_EDITED',
    intelligence_run_id: null,
    content_json: JSON.stringify(content),
    content_text: content.segments.map((s) => s.text).join('\n\n'),
    content_hash: contentHash(content),
    created_by: 'owner',
  });
  expect(
    row("SELECT current_version_id,status,version FROM editorial_artifacts WHERE id='script'"),
  ).toEqual({ current_version_id: result.versionId, status: 'active', version: 5 });
  expect(row("SELECT * FROM editorial_artifact_versions WHERE id='script-v2'")).toEqual(
    before.editorial_artifact_versions!.find((r) => r.id === 'script-v2'),
  );
  expect(
    f.database
      .prepare(
        'SELECT segment_order,content_text,content_hash FROM script_segments WHERE script_version_id=? ORDER BY segment_order',
      )
      .all(result.versionId),
  ).toEqual(
    content.segments.map((s) => ({
      segment_order: s.order,
      content_text: s.text,
      content_hash: contentHash(s.text),
    })),
  );
  expect(
    f.database
      .prepare(
        'SELECT source_artifact_version_id,dependency_type,validity_status FROM artifact_dependencies WHERE dependent_artifact_version_id=?',
      )
      .all(result.versionId),
  ).toEqual([
    {
      source_artifact_version_id: briefId,
      dependency_type: 'GENERATED_FROM',
      validity_status: 'CURRENT',
    },
  ]);
  for (const [id, state] of [
    ['dep-st', 'REGENERATION_REQUIRED'],
    ['dep-sc', 'REGENERATION_REQUIRED'],
    ['dep-sb', 'REAPPROVAL_REQUIRED'],
  ])
    expect(
      row(
        'SELECT validity_status,invalidated_by_version_id FROM artifact_dependencies WHERE id=?',
        id!,
      ),
    ).toEqual({ validity_status: state, invalidated_by_version_id: result.versionId });
  expect(
    row('SELECT count(*) n FROM artifact_approvals WHERE artifact_version_id=?', result.versionId)
      .n,
  ).toBe(0);
  const audit = row('SELECT * FROM audit_events WHERE id=?', result.auditEventId);
  expect(audit).toMatchObject({
    action: 'editorial.production_script_human_revised',
    actor_id: 'owner',
    actor_role: 'owner',
    environment: 'staging',
    resource_id: result.versionId,
  });
  expect(JSON.parse(String(audit.metadata_json))).toMatchObject({
    authoritativeBriefVersionId: briefId,
    oldVersionId: 'script-v2',
    newVersionId: result.versionId,
    revisionRequestId: f.requestId,
    segmentCount: 2,
  });
  const after = snapshot(f);
  for (const table of Object.keys(before).filter(
    (t) =>
      ![
        'editorial_artifacts',
        'editorial_artifact_versions',
        'script_segments',
        'artifact_dependencies',
        'audit_events',
      ].includes(t),
  ))
    expect(after[table], table).toEqual(before[table]);
  expect(after.audit_events!.length - before.audit_events!.length).toBe(1);
  expect(after.editorial_artifacts!.filter((r) => r.id !== 'script')).toEqual(
    before.editorial_artifacts!.filter((r) => r.id !== 'script'),
  );
  expect(f.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  const once = snapshot(f);
  expect((await post()).status).toBe(409);
  expect(snapshot(f)).toEqual(once);
});
it.each([
  'artifactId',
  'briefVersionId',
  'source_type',
  'versionNumber',
  'approvalState',
  'contentHash',
  'dependencyState',
  'workspaceId',
  'projectId',
])('rejects unexpected %s without writes', async (field) => {
  const before = snapshot(f);
  expect((await post({ ...command, [field]: 'override' })).status).toBe(422);
  expect(snapshot(f)).toEqual(before);
});
it.each([
  { segments: [] },
  {
    segments: [
      { order: 1, text: 'x' },
      { order: 1, text: 'y' },
    ],
  },
  { segments: [{ order: 2, text: 'x' }] },
  { segments: [{ order: 1, text: ' ' }] },
  { segments: [{ order: 1, text: 'x', source: 'override' }] },
  { title: ' ' },
  { languageCode: 'invalid_language' },
])('rejects invalid content %j', async (change) => {
  const before = snapshot(f);
  expect((await post({ ...command, ...change })).status).toBe(422);
  expect(snapshot(f)).toEqual(before);
});
it.each(['viewer', 'admin', 'operator', 'disabled', 'no-membership', 'unauthenticated'])(
  'requires authenticated active Owner: %s',
  async (mode) => {
    if (['viewer', 'admin', 'operator'].includes(mode))
      f.database
        .prepare("UPDATE user_roles SET role_id=? WHERE user_id='owner'")
        .run('role_' + mode);
    if (mode === 'disabled') f.database.exec("UPDATE users SET status='disabled' WHERE id='owner'");
    if (mode === 'no-membership') f.database.exec("DELETE FROM user_roles WHERE user_id='owner'");
    const before = snapshot(f);
    expect([401, 403]).toContain((await post(command, mode !== 'unauthenticated')).status);
    expect(snapshot(f)).toEqual(before);
  },
);
it.each(['script-v1', 'brief-v1', 'unknown'])(
  'rejects stale/non-Script base %s',
  async (baseVersionId) => {
    const before = snapshot(f);
    await expect(service().create('project', { ...command, baseVersionId })).rejects.toThrow(
      'base_not_current',
    );
    expect(snapshot(f)).toEqual(before);
  },
);
it('rejects cross-project and cross-workspace', async () => {
  const before = snapshot(f);
  await expect(service().create('protected-tim', command)).rejects.toThrow();
  await expect(
    service({ ...actor, workspaceId: 'other' }).create('project', command),
  ).rejects.toThrow();
  expect(snapshot(f)).toEqual(before);
});
it.each([
  "UPDATE editorial_artifacts SET status='active' WHERE id='brief'",
  "DELETE FROM artifact_approvals WHERE id='human-brief-approval'",
  "UPDATE editorial_artifacts SET current_version_id='brief-v1' WHERE id='brief'",
  "UPDATE projects SET primary_language='es' WHERE id='project'",
])('rejects initial source drift %s', async (sql) => {
  if (sql.startsWith('DELETE FROM artifact_approvals')) corrupt(f, 'artifact_approvals', sql);
  else f.database.exec(sql);
  const before = snapshot(f);
  await expect(service().create('project', command)).rejects.toThrow();
  expect(snapshot(f)).toEqual(before);
});
it.each([
  "UPDATE editorial_artifacts SET version=version+1 WHERE id='brief'",
  "UPDATE editorial_artifacts SET version=version+1 WHERE id='script'",
  "DELETE FROM artifact_approvals WHERE id='human-brief-approval'",
  "UPDATE users SET status='disabled' WHERE id='owner'",
  "DELETE FROM user_roles WHERE user_id='owner'",
  "UPDATE access_identities SET subject='different' WHERE id='identity-owner'",
  "UPDATE projects SET status='DRAFT' WHERE id='project'",
  "UPDATE artifact_dependencies SET version=version+1 WHERE id='dep-sc'",
])('atomically rejects concurrent drift: %s', async (sql) => {
  let concurrent: ReturnType<typeof snapshot>;
  f.faults.beforeBatch = () => {
    if (sql.startsWith('DELETE FROM artifact_approvals')) corrupt(f, 'artifact_approvals', sql);
    else f.database.exec(sql);
    concurrent = snapshot(f);
  };
  await expect(service().create('project', command)).rejects.toThrow('atomic_write_unconfirmed');
  expect(snapshot(f)).toEqual(concurrent!);
});
it('rejects Brief provenance drift', async () => {
  corrupt(
    f,
    'editorial_artifact_versions',
    `UPDATE editorial_artifact_versions SET source_type='IMPORTED' WHERE id='${briefId}'`,
  );
  const before = snapshot(f);
  await expect(service().create('project', command)).rejects.toThrow('source_invalid');
  expect(snapshot(f)).toEqual(before);
});
it('invalidates CURRENT downstream as well as historical invalidations', async () => {
  f.database.exec(
    "UPDATE artifact_dependencies SET source_artifact_version_id='script-v2',validity_status='CURRENT',invalidated_at=NULL,invalidated_by_version_id=NULL WHERE id='dep-sc'",
  );
  const result = await service().create('project', command);
  expect(
    row(
      "SELECT validity_status,invalidated_by_version_id FROM artifact_dependencies WHERE id='dep-sc'",
    ),
  ).toEqual({
    validity_status: 'REGENERATION_REQUIRED',
    invalidated_by_version_id: result.versionId,
  });
});
it.each(
  Array.from({ length: 9 }, (_, index) => index + 8).flatMap((index) =>
    (['failIndex', 'skipIndex'] as const).map((mode) => ({ index, mode })),
  ),
)('rollback on $mode at mutation $index', async ({ index, mode }) => {
  f.faults[mode] = index;
  const before = snapshot(f);
  await expect(service().create('project', command)).rejects.toThrow('atomic_write_unconfirmed');
  expect(f.faults.statements[index]).toMatch(/^(INSERT|UPDATE)/u);
  expect(snapshot(f)).toEqual(before);
  expect(f.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
});
it('contract preserves supplied text and rejects client metadata inside segments', () => {
  expect(productionScriptHumanRevisionSchema.parse(command)).toEqual(command);
});

it.each([60, 60.5])(
  'accepts unchanged REAL duration %s with numeric semantic equality',
  async (duration) => {
    corrupt(
      f,
      'editorial_artifact_versions',
      `UPDATE editorial_artifact_versions SET estimated_duration_seconds=${duration} WHERE id='script-v2'`,
    );
    expect(
      row(
        "SELECT typeof(estimated_duration_seconds) storage FROM editorial_artifact_versions WHERE id='script-v2'",
      ).storage,
    ).toBe('real');
    const result = await service().create('project', command);
    expect(result.versionNumber).toBe(3);
    expect(f.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  },
);

it('fails closed when REAL duration changes from 60 to 61 concurrently', async () => {
  corrupt(
    f,
    'editorial_artifact_versions',
    "UPDATE editorial_artifact_versions SET estimated_duration_seconds=60.0 WHERE id='script-v2'",
  );
  let concurrent: ReturnType<typeof snapshot>;
  f.faults.beforeBatch = () => {
    corrupt(
      f,
      'editorial_artifact_versions',
      "UPDATE editorial_artifact_versions SET estimated_duration_seconds=61.0 WHERE id='script-v2'",
    );
    concurrent = snapshot(f);
  };
  await expect(service().create('project', command)).rejects.toThrow('atomic_write_unconfirmed');
  expect(snapshot(f)).toEqual(concurrent!);
});

it('fails closed when a NULL duration becomes numeric concurrently', async () => {
  expect(
    row(
      "SELECT estimated_duration_seconds value FROM editorial_artifact_versions WHERE id='script-v2'",
    ).value,
  ).toBeNull();
  let concurrent: ReturnType<typeof snapshot>;
  f.faults.beforeBatch = () => {
    corrupt(
      f,
      'editorial_artifact_versions',
      "UPDATE editorial_artifact_versions SET estimated_duration_seconds=60.0 WHERE id='script-v2'",
    );
    concurrent = snapshot(f);
  };
  await expect(service().create('project', command)).rejects.toThrow('atomic_write_unconfirmed');
  expect(snapshot(f)).toEqual(concurrent!);
});

it('does not coerce numeric-looking TEXT to a number in snapshot comparison', () => {
  const internal = service() as unknown as {
    guard: (
      sql: string,
      values: unknown[],
      columns: string[],
      expected: Array<Record<string, string | number | null>>,
    ) => D1PreparedStatement;
  };
  expect(() => internal.guard('SELECT 60 value', [], ['value'], [{ value: '60' }]).run()).toThrow();
});

it('allows at most one of two simultaneous revisions from the same base', async () => {
  const outcomes = await Promise.allSettled([
    service().create('project', command),
    service().create('project', { ...command, title: 'Alternative human edit' }),
  ]);
  expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
  expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
  expect(
    row("SELECT count(*) n FROM editorial_artifact_versions WHERE artifact_id='script'").n,
  ).toBe(3);
  expect(
    row(
      "SELECT count(*) n FROM audit_events WHERE action='editorial.production_script_human_revised'",
    ).n,
  ).toBe(1);
  expect(f.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
});

it('does not repeat the batch after an ambiguous post-commit transport result', async () => {
  f.faults.afterCommitThrow = true;
  await expect(service().create('project', command)).rejects.toThrow(
    'atomic_write_unconfirmed_do_not_retry',
  );
  expect(f.faults.batches).toBe(1);
  expect(
    row("SELECT count(*) n FROM editorial_artifact_versions WHERE artifact_id='script'").n,
  ).toBe(3);
  expect(
    row(
      "SELECT count(*) n FROM audit_events WHERE action='editorial.production_script_human_revised'",
    ).n,
  ).toBe(1);
});
it('rejects a deleted authenticated identity without any write', async () => {
  f.database.exec("UPDATE access_identities SET deleted_at='t' WHERE id='identity-owner'");
  const before = snapshot(f);
  await expect(service().create('project', command)).rejects.toThrow('membership_invalid');
  expect(snapshot(f)).toEqual(before);
});
it('rejects a valid language that differs from the project and Brief', async () => {
  const before = snapshot(f);
  await expect(service().create('project', { ...command, languageCode: 'es' })).rejects.toThrow(
    'source_invalid',
  );
  expect(snapshot(f)).toEqual(before);
});
it('rejects concurrent invalidation of canonical upstream lineage', async () => {
  let concurrent: ReturnType<typeof snapshot>;
  f.faults.beforeBatch = () => {
    f.database
      .prepare(
        "UPDATE artifact_dependencies SET validity_status='STALE' WHERE dependent_artifact_version_id=?",
      )
      .run(briefId);
    concurrent = snapshot(f);
  };
  await expect(service().create('project', command)).rejects.toThrow('atomic_write_unconfirmed');
  expect(snapshot(f)).toEqual(concurrent!);
});
it.each([false, true])(
  'revokes persisted Preflight readiness atomically; skip=%s',
  async (skip) => {
    f.database
      .exec(`INSERT INTO editorial_artifacts(id,workspace_id,project_id,artifact_type,status,created_at,updated_at,version) VALUES('preflight','workspace','project','PREFLIGHT','active','t','t',1);
    INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,language_code,content_json,source_type,content_hash,created_at,created_by) VALUES('preflight-v1','workspace','preflight',1,'de','{}','DETERMINISTIC','${'d'.repeat(64)}','t','owner');
    UPDATE editorial_artifacts SET current_version_id='preflight-v1' WHERE id='preflight';
    INSERT INTO artifact_dependencies(id,workspace_id,source_artifact_version_id,dependent_artifact_version_id,dependency_type,validity_status,created_at,updated_at,version) VALUES('dep-sp','workspace','script-v2','preflight-v1','VALIDATED_BY','CURRENT','t','t',1);
    INSERT INTO preflight_assessments(id,workspace_id,project_id,artifact_id,artifact_version_id,overall_result,generation_readiness,rule_set_version,assessed_at,assessed_by) VALUES('assessment','workspace','project','preflight','preflight-v1','PASS','READY_FOR_GENERATION','v1','t','owner');`);
    const before = snapshot(f);
    // dep-sc, dep-sb, dep-sp are ordered by ID: preflight update follows dep-sp.
    if (skip) f.faults.skipIndex = 16;
    if (skip) {
      await expect(service().create('project', command)).rejects.toThrow(
        'atomic_write_unconfirmed',
      );
      expect(f.faults.statements[16]).toContain('UPDATE preflight_assessments');
      expect(snapshot(f)).toEqual(before);
    } else {
      await service().create('project', command);
      expect(
        row("SELECT generation_readiness FROM preflight_assessments WHERE id='assessment'")
          .generation_readiness,
      ).toBe('NOT_READY');
    }
  },
);
