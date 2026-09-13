import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  humanFixture,
  humanService,
  actor,
  read,
  snapshot,
  corrupt,
  contentHash,
  type HumanFixture,
} from './content-brief-human-revision-fixture';
import { evaluateEditorialProductionReadiness } from '../src/editorial/readiness';
import { OpenAIResponsesAdapter } from '@vision-maxson/providers/openai';
// Owner-approved text from BLOCK 9EN-R1. Keep independent of the submitted fixture.
const approvedChanges = {
  objective:
    'In einem kurzen, verständlichen Technik-Dokumentarformat die dokumentierte Softwareexception bei einer Zahlenkonvertierung und die Fehlinterpretation von Diagnoseinformationen als Flugdaten erklären. Eine kurze Lehre zum Testen technischer Systeme ausdrücklich als redaktionelle Einordnung formulieren.',
  narrativeAngle:
    'Im Mittelpunkt steht die Konvertierung eines 64-Bit-Gleitkommawerts in eine vorzeichenbehaftete 16-Bit-Ganzzahl, bei der eine interne Softwareexception des Trägheitsreferenzsystems (SRI) auftrat. Der Bordcomputer interpretierte Diagnoseinformationen des ausgefallenen aktiven SRI als Flugdaten und verwendete sie für Flugregelungsberechnungen.',
  hook: 'Zahlenkonvertierung mit Folgen.',
  visualDirection:
    'Schneller, sauberer Tech-Dokumentarstil: Die Kernthese mit dem kurzen Hook sofort als Text und Narration eröffnen. Eine stilisierte Raketenanimation dient als schematische Illustration, nicht als historische Aufnahme. Danach die Datenkonvertierung präzise beschriften: „64-Bit-Gleitkommawert → vorzeichenbehaftete 16-Bit-Ganzzahl“. Eine Exception-Markierung und ein Split-Screen veranschaulichen Diagnoseinformationen und ihre Fehlinterpretation als Flugdaten; keine realen Telemetriedaten oder zusätzlichen Systemdetails erfinden. Falls eine Zeitachse verwendet wird: „H0 = Zündung des Vulcain-Triebwerks“ und „bis ungefähr H0+37 s: Flugführung und Flugbahn normal“. Abschließend eine klar gekennzeichnete Texttafel: „Redaktionelle Lehre: Grenzwerte testen. Exceptions absichern. Systeme ganzheitlich prüfen.“ Diese Lehre ist weder ein historisches Zitat noch eine dem Untersuchungsbericht zugeschriebene Schlussfolgerung.',
  editorialConstraints: [
    'Nicht behaupten, die Konvertierung sei die einzige Ursache des Unfalls gewesen.',
    'Die Kausalkette präzise formulieren: Exception in einem Trägheitsreferenzsystem, Diagnoseinformationen wurden vom Bordcomputer als Flugdaten interpretiert, Flight 501 wich von der Flugbahn ab und zerbrach.',
    'Faktische Eckdaten beibehalten: erster Ariane-5-Start am 4. Juni 1996; Flugführung und Flugbahn waren laut der vorläufigen ESA-Chronologie bis ungefähr H0+37 Sekunden normal. H0 bezeichnet die Zündung des Vulcain-Triebwerks, nicht das Abheben; keine Gleichsetzung mit 37 Sekunden nach dem Abheben.',
    'Keine unbelegte Spekulation über individuelle Schuld oder Motive.',
    'Gérard Le Lanns Einordnung als System-Engineering-Fehler ausdrücklich als seine spätere Interpretation kennzeichnen.',
    'Keine unbelegten Ausschlüsse von Explosions- oder Triebwerksereignissen und keine zusätzlichen Aussagen zur Behandlung der Softwareexception ergänzen.',
    'Allgemeine Empfehlungen zu Tests und Absicherung ausschließlich als redaktionelle Lehre kennzeichnen, nicht als belegte historische Aussage oder Zitat.',
  ],
};
let f: HumanFixture;
let providerSpy: ReturnType<typeof vi.spyOn>;
beforeEach(async () => {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No network permitted'));
  f = await humanFixture();
  providerSpy = vi
    .spyOn(OpenAIResponsesAdapter.prototype, 'execute')
    .mockRejectedValue(new Error('No provider interaction permitted'));
});
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  expect(providerSpy).not.toHaveBeenCalled();
  f?.database.close();
  vi.restoreAllMocks();
});
const create = (key = 'human-key') => humanService(f).create(f.parentId, key, f.edit);
const unchanged = (before: ReturnType<typeof snapshot>, except: string[] = []) => {
  const after = snapshot(f);
  for (const table of Object.keys(before))
    if (!except.includes(table)) expect(after[table], table).toEqual(before[table]);
};
describe('Real SQL human revision atomic graph', () => {
  it('matches the independently approved text exactly, including UTF-8 bytes and Unicode punctuation', () => {
    expect(f.edit.changes).toEqual(approvedChanges);
    for (const field of Object.keys(approvedChanges) as (keyof typeof approvedChanges)[]) {
      expect(new TextEncoder().encode(JSON.stringify(f.edit.changes[field]))).toEqual(
        new TextEncoder().encode(JSON.stringify(approvedChanges[field])),
      );
    }
    const submitted = JSON.stringify(f.edit.changes);
    for (const character of [
      '\u00e4',
      '\u00fc',
      '\u00f6',
      '\u00e9',
      '\u201e',
      '\u201c',
      '\u2192',
    ]) {
      expect(submitted).toContain(character);
    }
    expect(submitted).not.toMatch(/[\u00c3\u00c2\u00c6\u0192]/u);
  });

  it('creates only immutable v3, two exact links, pointer revision 5 and one receipt; preserves history/accounting/readiness', async () => {
    const before = snapshot(f),
      parent = read(f, 'SELECT * FROM editorial_artifact_versions WHERE id=?', f.parentId);
    const expectedContent = {
      ...(JSON.parse(String(parent.content_json)) as Record<string, unknown>),
      ...approvedChanges,
    };
    const result = await create();
    expect(result).toMatchObject({
      versionNumber: 3,
      parentVersionId: f.parentId,
      createdArtifactRevision: 5,
      createdApprovalCount: 0,
      sourceType: 'HUMAN_EDITED',
      intelligenceRunId: null,
      idempotentReplay: false,
    });
    const v = read(f, 'SELECT * FROM editorial_artifact_versions WHERE id=?', result.versionId);
    expect(v).toMatchObject({
      parent_version_id: f.parentId,
      source_type: 'HUMAN_EDITED',
      intelligence_run_id: null,
      language_code: 'de',
      version_number: 3,
      content_hash: contentHash(expectedContent),
    });
    expect(JSON.parse(String(v.content_json))).toEqual(expectedContent);
    expect(read(f, 'SELECT * FROM editorial_artifact_versions WHERE id=?', f.parentId)).toEqual(
      parent,
    );
    expect(
      read(f, "SELECT status,version,current_version_id FROM editorial_artifacts WHERE id='brief'"),
    ).toEqual({ status: 'active', version: 5, current_version_id: result.versionId });
    expect(
      f.database
        .prepare(
          'SELECT dependency_type,source_artifact_version_id,validity_status FROM artifact_dependencies WHERE dependent_artifact_version_id=? ORDER BY dependency_type',
        )
        .all(result.versionId),
    ).toEqual([
      {
        dependency_type: 'GENERATED_FROM',
        source_artifact_version_id: 'new-idea-v1',
        validity_status: 'CURRENT',
      },
      {
        dependency_type: 'USES_RESEARCH',
        source_artifact_version_id: f.command.researchVersionId,
        validity_status: 'CURRENT',
      },
    ]);
    const audit = read(f, 'SELECT * FROM audit_events WHERE id=?', result.auditEventId);
    expect(audit).toMatchObject({
      action: 'editorial.content_brief_human_revision_created',
      resource_type: 'editorial_artifact_version',
      resource_id: result.versionId,
      actor_id: 'owner',
      actor_role: 'owner',
      request_id: 'human-request',
      environment: 'staging',
      before_hash: parent.content_hash,
      after_hash: v.content_hash,
    });
    expect(JSON.parse(String(audit.metadata_json))).toMatchObject({
      humanReviewDecision: 'REVISE',
      revisionRequestId: f.requestId,
      parentVersionId: f.parentId,
      expectedArtifactRevision: 4,
    });
    unchanged(before, [
      'editorial_artifact_versions',
      'editorial_artifacts',
      'artifact_dependencies',
      'audit_events',
    ]);
    for (const table of ['editorial_artifact_versions', 'artifact_dependencies', 'audit_events'])
      expect(snapshot(f)[table]!.slice(0, before[table]!.length)).toEqual(before[table]);
    expect(
      read(
        f,
        "SELECT actual_microusd FROM editorial_execution_reservations WHERE step_key='CONTENT_BRIEF'",
      ).actual_microusd,
    ).toBe(11668);
    expect(
      read(f, 'SELECT status FROM editorial_execution_envelopes WHERE id=?', f.capacity.envelopeId)
        .status,
    ).toBe('CONSUMED');
    expect(f.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    const readiness = () =>
      evaluateEditorialProductionReadiness(f.d1, actor, 'project', 'BEFORE_PRODUCTION_SCRIPT');
    expect((await readiness()).blockers).toEqual(
      expect.arrayContaining(['MISSING_APPROVED_REQUIRED_ARTIFACT', 'OPEN_REVISION_REQUEST']),
    );
    f.database
      .prepare(
        "INSERT INTO artifact_approvals(id,workspace_id,artifact_version_id,decision,actor_id,actor_role,decided_at) VALUES('local-v3-approval','workspace',?,'APPROVED','owner','owner','t')",
      )
      .run(result.versionId);
    f.database.exec(
      "UPDATE editorial_artifacts SET status='approved',version=version+1 WHERE id='brief'",
    );
    expect((await readiness()).blockers).toEqual([]);
  });
  it.each([0, 1, 2, 3, 4, 5])('rolls back failure at batch statement %s', async (index) => {
    const before = snapshot(f);
    f.faults.failIndex = index;
    await expect(create()).rejects.toMatchObject({ status: 500 });
    unchanged(before);
    expect(f.faults.batches).toBe(1);
  });
  it.each([0, 1, 2, 3, 4])(
    'final constraint guard rejects silently omitted statement %s',
    async (index) => {
      const before = snapshot(f);
      f.faults.skipIndex = index;
      await expect(create()).rejects.toMatchObject({ status: 500 });
      unchanged(before);
    },
  );
  it('handles a committed but ambiguous batch with receipt-only recovery and no retry', async () => {
    f.faults.afterCommitThrow = true;
    expect((await create()).idempotentReplay).toBe(true);
    expect(f.faults.batches).toBe(1);
  });
  it('revalidates upstream state inside the atomic batch', async () => {
    f.faults.beforeBatch = () => {
      f.database.exec("UPDATE projects SET version=3 WHERE id='project'");
    };
    const before = snapshot(f);
    await expect(create()).rejects.toMatchObject({ status: 409 });
    unchanged(before, ['projects']);
  });
  it('revalidates active membership inside the batch', async () => {
    f.faults.beforeBatch = () =>
      f.database.exec("UPDATE users SET status='disabled' WHERE id='owner'");
    const before = snapshot(f);
    await expect(create()).rejects.toMatchObject({ status: 409 });
    unchanged(before, ['users']);
  });
  it.each([0, 1, 2])('serializes same-key simultaneous edits, repetition %i', async () => {
    const responses = await Promise.all([create(), create(), create()]);
    expect(responses.filter((r) => !r.idempotentReplay)).toHaveLength(1);
    expect(new Set(responses.map((r) => r.versionId)).size).toBe(1);
    expect(
      read(f, "SELECT count(*) n FROM editorial_artifact_versions WHERE artifact_id='brief'").n,
    ).toBe(3);
  });
  it.each([0, 1, 2])('serializes different-key simultaneous edits, repetition %i', async () => {
    const results = await Promise.allSettled([create('one'), create('two'), create('three')]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      read(f, "SELECT count(*) n FROM editorial_artifact_versions WHERE artifact_id='brief'").n,
    ).toBe(3);
    expect(
      read(
        f,
        "SELECT count(*) n FROM audit_events WHERE action='editorial.content_brief_human_revision_created'",
      ).n,
    ).toBe(1);
  });
  it('durable replay after approval and supersession keeps the creation-time result', async () => {
    const r = await create();
    const before = snapshot(f);
    expect(await create(' human-key ')).toEqual({ ...r, idempotentReplay: true });
    unchanged(before);
    f.database.exec(
      "UPDATE editorial_artifacts SET status='approved',version=version+1 WHERE id='brief'",
    );
    expect((await create()).createdApprovalCount).toBe(0);
    f.database
      .prepare(
        "INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,parent_version_id,language_code,content_text,source_type,content_hash,created_at,created_by) VALUES('later-v4','workspace','brief',4,?,'de','Later','HUMAN_EDITED',?,'t','owner')",
      )
      .run(r.versionId, '8'.repeat(64));
    f.database.exec(
      "UPDATE editorial_artifacts SET current_version_id='later-v4',status='active',version=version+1 WHERE id='brief'",
    );
    const later = snapshot(f);
    expect(await create()).toEqual({ ...r, idempotentReplay: true });
    unchanged(later);
  });
  it.each(['changes', 'revision', 'parent', 'actor', 'new-key'])(
    'rejects conflicting replay %s',
    async (kind) => {
      await create();
      const before = snapshot(f);
      const cmd = structuredClone(f.edit);
      if (kind === 'changes') cmd.changes.hook = 'Changed';
      if (kind === 'revision') cmd.expectedArtifactRevision = 5;
      if (kind === 'actor') {
        f.database.exec(
          "INSERT INTO users(id,workspace_id,email,status,created_at,updated_at) VALUES('another','workspace','another@example.test','active','t','t'); INSERT INTO user_roles(workspace_id,user_id,role_id,created_at,created_by) VALUES('workspace','another','role_owner','t','owner')",
        );
      }
      await expect(
        humanService(f, kind === 'actor' ? { ...actor, id: 'another' } : actor).create(
          kind === 'parent' ? 'brief-v1' : f.parentId,
          kind === 'new-key' ? 'other-key' : 'human-key',
          cmd,
        ),
      ).rejects.toMatchObject({ status: 409 });
      unchanged(before, kind === 'actor' ? ['users', 'user_roles'] : []);
    },
  );
  it.each([
    "'{}'",
    "json_set(metadata_json,'$.result.versionNumber',99)",
    "json_set(metadata_json,'$.newContentHash','" + 'f'.repeat(64) + "')",
  ])('rejects corrupt append-only receipt fixture %s', async (expression) => {
    const r = await create();
    corrupt(
      f,
      'audit_events',
      `UPDATE audit_events SET metadata_json=${expression} WHERE id='${r.auditEventId}'`,
    );
    const before = snapshot(f);
    await expect(create()).rejects.toMatchObject({ status: 500 });
    unchanged(before);
  });
});
const drifts: Array<[string, (f: HumanFixture) => void]> = [
  ['project version', (f) => f.database.exec("UPDATE projects SET version=3 WHERE id='project'")],
  [
    'project status',
    (f) => f.database.exec("UPDATE projects SET status='DRAFT' WHERE id='project'"),
  ],
  [
    'project archived',
    (f) => f.database.exec("UPDATE projects SET archived_at='t' WHERE id='project'"),
  ],
  [
    'revision resolved',
    (f) => {
      corrupt(
        f,
        'editorial_revision_request_resolutions',
        `INSERT INTO editorial_revision_request_resolutions(id,workspace_id,project_id,revision_request_id,status,resolution_artifact_version_id,resolved_by,idempotency_key,command_hash,audit_event_id,resolved_at) VALUES('resolved','workspace','project','${f.requestId}','RESOLVED','storyboard-v1','owner','resolved','${'f'.repeat(64)}','historical-terminal-audit','t')`,
      );
    },
  ],
  [
    'research pointer',
    (f) =>
      f.database.exec(
        "UPDATE editorial_artifacts SET current_version_id='research-v1' WHERE id='research'",
      ),
  ],
  [
    'research revision',
    (f) => f.database.exec("UPDATE editorial_artifacts SET version=version+1 WHERE id='research'"),
  ],
  [
    'research approval',
    (f) =>
      corrupt(
        f,
        'artifact_approvals',
        "UPDATE artifact_approvals SET decision='REJECTED' WHERE id='approval-v2'",
      ),
  ],
  [
    'idea deselected',
    (f) =>
      f.database.exec("UPDATE idea_candidates SET status='CANDIDATE' WHERE id='new-candidate'"),
  ],
  [
    'idea revision',
    (f) => f.database.exec("UPDATE idea_candidates SET version=3 WHERE id='new-candidate'"),
  ],
  [
    'idea pointer',
    (f) =>
      f.database.exec(
        "UPDATE editorial_artifacts SET current_version_id='idea-v1' WHERE id='new-idea'",
      ),
  ],
  [
    'idea approval',
    (f) =>
      corrupt(
        f,
        'artifact_approvals',
        "UPDATE artifact_approvals SET decision='REJECTED' WHERE id='new-idea-approval'",
      ),
  ],
  [
    'lineage stale',
    (f) =>
      f.database.exec(
        "UPDATE artifact_dependencies SET validity_status='STALE' WHERE id='new-lineage'",
      ),
  ],
  [
    'lineage ambiguous',
    (f) =>
      f.database.exec(
        "INSERT INTO artifact_dependencies(id,workspace_id,source_artifact_version_id,dependent_artifact_version_id,dependency_type,validity_status,created_at,updated_at) VALUES('ambiguous','workspace','research-v1','new-idea-v1','GENERATED_FROM','CURRENT','t','t')",
      ),
  ],
  [
    'brief pointer',
    (f) =>
      f.database.exec(
        "UPDATE editorial_artifacts SET current_version_id='brief-v1' WHERE id='brief'",
      ),
  ],
  [
    'brief revision',
    (f) => f.database.exec("UPDATE editorial_artifacts SET version=5 WHERE id='brief'"),
  ],
  [
    'brief approved',
    (f) =>
      f.database
        .prepare(
          "INSERT INTO artifact_approvals(id,workspace_id,artifact_version_id,decision,actor_id,actor_role,decided_at) VALUES('brief-approved','workspace',?,'APPROVED','owner','owner','t')",
        )
        .run(f.parentId),
  ],
  [
    'brief hash',
    (f) =>
      corrupt(
        f,
        'editorial_artifact_versions',
        `UPDATE editorial_artifact_versions SET content_hash='${'d'.repeat(64)}' WHERE id='${f.parentId}'`,
      ),
  ],
  [
    'successor',
    (f) =>
      f.database
        .prepare(
          "INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,parent_version_id,language_code,content_text,source_type,content_hash,created_at,created_by) VALUES('competing-v3','workspace','brief',3,?,'de','Other','HUMAN_EDITED',?,'t','owner')",
        )
        .run(f.parentId, 'd'.repeat(64)),
  ],
  [
    'downstream',
    (f) =>
      f.database
        .prepare(
          "INSERT INTO artifact_dependencies(id,workspace_id,source_artifact_version_id,dependent_artifact_version_id,dependency_type,validity_status,created_at,updated_at) VALUES('downstream','workspace',?,'script-v1','GENERATED_FROM','CURRENT','t','t')",
        )
        .run(f.parentId),
  ],
];
it.each(drifts)('rejects %s drift without new writes', async (_name, mutate) => {
  mutate(f);
  const before = snapshot(f);
  await expect(create()).rejects.toMatchObject({ status: 409 });
  unchanged(before);
  expect(f.faults.batches).toBe(0);
});
it('rejects no-op correction', async () => {
  const before = snapshot(f);
  const changes = Object.fromEntries(
    Object.keys(f.edit.changes).map((key) => [key, f.content[key as keyof typeof f.content]]),
  );
  await expect(
    humanService(f).create(f.parentId, 'noop', { ...f.edit, changes } as typeof f.edit),
  ).rejects.toMatchObject({ status: 422 });
  unchanged(before);
});
it.each(['research-v1', 'extra', 'wrong-duration', 'missing-field'])(
  'strict parent rejects %s',
  async (mode) => {
    const json = { ...f.content } as Record<string, unknown>;
    if (mode === 'research-v1') json.researchVersionIds = ['research-v1'];
    if (mode === 'extra') json.extra = 'unknown';
    if (mode === 'wrong-duration') json.targetDurationSeconds = 61;
    if (mode === 'missing-field') delete json.reviewLanguage;
    corrupt(
      f,
      'editorial_artifact_versions',
      `UPDATE editorial_artifact_versions SET content_json='${JSON.stringify(json)}',content_hash='${contentHash(json)}' WHERE id='${f.parentId}'`,
    );
    const before = snapshot(f);
    await expect(create()).rejects.toMatchObject({ status: 422 });
    unchanged(before);
  },
);
it('replays actual batch SQL under SQLite expression-depth 100 and variable limit 100, including failed CAS rollback', async () => {
  const schema = f.database
    .prepare(
      "SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'",
    )
    .all();
  const before = snapshot(f);
  const columns = Object.fromEntries(
    Object.keys(before).map((table) => [
      table,
      f.database
        .prepare(`PRAGMA table_xinfo(${table})`)
        .all()
        .filter((c) => c.hidden === 0)
        .map((c) => String(c.name)),
    ]),
  );
  const r = await create();
  const script = String.raw`
import json,sqlite3,sys
x=json.load(sys.stdin)
def open_db():
 d=sqlite3.connect(':memory:',isolation_level=None)
 for s in x['schema']:
  if s['type']=='table':d.execute(s['sql'])
 for t,rows in x['before'].items():
  cols=x['columns'][t]
  for row in rows:d.execute('INSERT INTO '+t+'('+','.join(cols)+') VALUES('+','.join('?' for c in cols)+')',[row[c] for c in cols])
 for s in x['schema']:
  if s['type']!='table':d.execute(s['sql'])
 d.execute('PRAGMA foreign_keys=ON')
 d.setlimit(sqlite3.SQLITE_LIMIT_EXPR_DEPTH,100)
 d.setlimit(sqlite3.SQLITE_LIMIT_VARIABLE_NUMBER,100)
 return d
results=[]
for skip in [None,3]:
 d=open_db()
 d.execute('BEGIN IMMEDIATE')
 try:
  for i,sql in enumerate(x['statements']):
   if i!=skip:
    try:d.execute(sql,x['values'][i])
    except sqlite3.OperationalError as e:raise RuntimeError('statement '+str(i)+': '+str(e))
  d.execute('COMMIT')
  assert skip is None
  assert d.execute('SELECT current_version_id FROM editorial_artifacts WHERE id=?',('brief',)).fetchone()[0]==x['versionId']
  results.append('success')
 except sqlite3.IntegrityError as e:
  d.execute('ROLLBACK')
  assert skip==3,str(e)
  assert 'NOT NULL constraint failed: audit_events.id' in str(e),str(e)
  assert d.execute('SELECT current_version_id FROM editorial_artifacts WHERE id=?',('brief',)).fetchone()[0]==x['parentId']
  assert d.execute('SELECT count(*) FROM editorial_artifact_versions WHERE id=?',(x['versionId'],)).fetchone()[0]==0
  results.append('rollback')
 assert d.execute('PRAGMA foreign_key_check').fetchall()==[]
 d.close()
print(json.dumps({'results':results,'expressionDepth':100,'bindLimit':100,'fk':[]}))
`;
  const output = spawnSync('python', ['-c', script], {
    input: JSON.stringify({
      schema,
      before,
      columns,
      statements: f.faults.statements,
      values: f.faults.values,
      versionId: r.versionId,
      parentId: f.parentId,
    }),
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });
  expect(output.status, output.stderr).toBe(0);
  expect(JSON.parse(output.stdout)).toEqual({
    results: ['success', 'rollback'],
    expressionDepth: 100,
    bindLimit: 100,
    fk: [],
  });
});
