import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import { createApp, type Bindings } from '../src/app';
import { governedImportedResearchRevisionSchema } from '@vision-maxson/contracts';
import { evaluateEditorialProductionReadiness } from '../src/editorial/readiness';
import type { EditorialActor } from '../src/editorial/repository';
import { EditorialRevisionService } from '../src/editorial/revision';
import {
  GovernedResearchRevisionService,
  researchRevisionSchemaReady,
} from '../src/editorial/research-revision';
const migrations = [
  '0000_phase_1_data_security_core.sql',
  '0001_phase_2_product_channel_monetization.sql',
  '0002_phase_3_editorial_intelligence.sql',
  '0003_editorial_execution_budgets.sql',
  '0004_terminal_pipeline_hardening.sql',
  '0005_deterministic_preflight_provenance.sql',
  '0006_storyboard_v2_contract_hardening.sql',
  '0007_governed_remediation_capacity.sql',
  '0008_remediation_evidence_expression_depth.sql',
  '0009_storyboard_continuity_prompt_v3.sql',
  '0010_governed_chained_remediation_v2.sql',
  '0011_chained_remediation_diagnostic_evidence_compatibility.sql',
  '0012_governed_editorial_revision_requests.sql',
  '0013_governed_imported_research_revision.sql',
] as const;
const migration = (name: string) =>
  readFileSync(new URL(`../../../packages/db/migrations/${name}`, import.meta.url), 'utf8');
class Statement {
  private values: SQLInputValue[] = [];
  constructor(
    private database: DatabaseSync,
    private sql: string,
  ) {}
  bind(...values: SQLInputValue[]) {
    this.values = values;
    return this;
  }
  first<T>() {
    return Promise.resolve((this.database.prepare(this.sql).get(...this.values) as T) ?? null);
  }
  all<T>() {
    return Promise.resolve({ results: this.database.prepare(this.sql).all(...this.values) as T[] });
  }
  run() {
    const r = this.database.prepare(this.sql).run(...this.values);
    return Promise.resolve({ meta: { changes: Number(r.changes) } });
  }
}
class AtomicD1 {
  constructor(readonly database: DatabaseSync) {}
  prepare(sql: string) {
    return new Statement(this.database, sql);
  }
  private queue: Promise<unknown> = Promise.resolve();
  batch(statements: Statement[]) {
    const result = this.queue.then(() => this.transact(statements));
    this.queue = result.catch(() => undefined);
    return result;
  }
  private async transact(statements: Statement[]) {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec('COMMIT');
      return results;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}
const actor: EditorialActor = { id: 'owner', workspaceId: 'workspace', roles: ['owner'] };
function fixture(evidence = true, includeRevisionSchema = true, schemaVersion = 13) {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys=ON');
  migrations
    .filter((name) => Number(name.slice(0, 4)) <= (includeRevisionSchema ? schemaVersion : 11))
    .forEach((name) => database.exec(migration(name)));
  database.exec(`
    INSERT INTO workspaces(id,slug,name,created_at,updated_at,version) VALUES('workspace','workspace','Workspace','t','t',1),('other','other','Other','t','t',1);
    INSERT INTO users(id,workspace_id,email,status,created_at,updated_at,version) VALUES('owner','workspace','owner@example.test','active','t','t',1),('viewer','workspace','viewer@example.test','active','t','t',1),('other-user','other','other@example.test','active','t','t',1);
    INSERT INTO user_roles(workspace_id,user_id,role_id,created_at,created_by) VALUES('workspace','owner','role_owner','t','owner'),('workspace','viewer','role_viewer','t','owner'),('other','other-user','role_owner','t','other-user');
    INSERT INTO access_identities(id,workspace_id,user_id,issuer,subject,email,last_seen_at,created_at,updated_at,version) VALUES('identity-owner','workspace','owner','https://team.cloudflareaccess.com','owner-subject','owner@example.test','t','t','t',1);
    INSERT INTO content_brands(id,workspace_id,name,normalized_name,primary_language,created_at,updated_at,version) VALUES('brand','workspace','Brand','brand','de','t','t',1);
    INSERT INTO channel_profiles(id,workspace_id,content_brand_id,name,normalized_name,primary_language,created_at,updated_at,version) VALUES('channel','workspace','brand','Channel','channel','de','t','t',1);
    INSERT INTO projects(id,workspace_id,content_brand_id,channel_profile_id,title,status,format,operating_mode,primary_language,created_at,updated_at,version) VALUES('project','workspace','brand','channel','Project','ANALYZING','SHORT','ASSISTED','de','t','t',2);
    INSERT INTO editorial_artifacts(id,workspace_id,project_id,artifact_type,current_version_id,status,created_at,updated_at,version,created_by,updated_by) VALUES
      ('research','workspace','project','RESEARCH','research-v1','approved','t','t',2,'owner','owner'),
      ('idea','workspace','project','IDEA_CANDIDATE','idea-v1','approved','t','t',2,'owner','owner'),
      ('brief','workspace','project','CONTENT_BRIEF','brief-v1','approved','t','t',2,'owner','owner'),
      ('script','workspace','project','PRODUCTION_SCRIPT','script-v1','approved','t','t',2,'owner','owner'),
      ('critique','workspace','project','SCRIPT_CRITIQUE','critique-v1','approved','t','t',2,'owner','owner'),
      ('storyboard','workspace','project','STORYBOARD','storyboard-v1','active','t','t',2,'owner','owner');
    INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,language_code,content_text,content_json,source_type,content_hash,created_at,created_by) VALUES
      ('research-v1','workspace','research',1,'de','research',NULL,'HUMAN_EDITED','${'1'.repeat(64)}','t','owner'),
      ('idea-v1','workspace','idea',1,'de','idea',NULL,'HUMAN_EDITED','${'0'.repeat(64)}','t','owner'),
      ('brief-v1','workspace','brief',1,'de',NULL,'{"researchVersionIds":["research-v1"]}','HUMAN_EDITED','${'2'.repeat(64)}','t','owner'),
      ('script-v1','workspace','script',1,'de','script',NULL,'HUMAN_EDITED','${'3'.repeat(64)}','t','owner'),
      ('critique-v1','workspace','critique',1,'de','critique',NULL,'HUMAN_EDITED','${'4'.repeat(64)}','t','owner'),
      ('storyboard-v1','workspace','storyboard',1,'de','storyboard',NULL,'HUMAN_EDITED','${'5'.repeat(64)}','t','owner');
    INSERT INTO artifact_approvals(id,workspace_id,artifact_version_id,decision,actor_id,actor_role,decided_at) VALUES
      ('approve-research','workspace','research-v1','APPROVED','owner','owner','t'),
      ('approve-idea','workspace','idea-v1','APPROVED','owner','owner','t'),
      ('approve-brief','workspace','brief-v1','APPROVED','owner','owner','t'),
      ('approve-script','workspace','script-v1','APPROVED','owner','owner','t'),
      ('approve-critique','workspace','critique-v1','APPROVED','owner','owner','t');
    INSERT INTO artifact_dependencies(id,workspace_id,source_artifact_version_id,dependent_artifact_version_id,dependency_type,validity_status,created_at,updated_at,version) VALUES
      ('dep-ri','workspace','research-v1','idea-v1','GENERATED_FROM','CURRENT','t','t',1),
      ('dep-ib','workspace','idea-v1','brief-v1','GENERATED_FROM','CURRENT','t','t',1),
      ('dep-rb','workspace','research-v1','brief-v1','USES_RESEARCH','CURRENT','t','t',1),
      ('dep-bs','workspace','brief-v1','script-v1','GENERATED_FROM','CURRENT','t','t',1),
      ('dep-sc','workspace','script-v1','critique-v1','EVALUATES_SOURCE','CURRENT','t','t',1),
      ('dep-sb','workspace','script-v1','storyboard-v1','GENERATED_FROM','CURRENT','t','t',1),
      ('dep-cb','workspace','critique-v1','storyboard-v1','INFORMED_BY','CURRENT','t','t',1);
    INSERT INTO idea_candidates(id,workspace_id,project_id,artifact_id,artifact_version_id,title,target_format,status,evidence_class,created_at,updated_at,version,created_by,updated_by) VALUES('idea-candidate','workspace','project','idea','idea-v1','Idea','SHORT','SELECTED','UNKNOWN','t','t',1,'owner','owner');
    INSERT INTO intelligence_runs(id,workspace_id,project_id,task_type,initiated_by,operating_mode,status,idempotency_key,creative_regeneration_number,safe_metadata_json,created_at,updated_at,version) VALUES('successful-storyboard-run','workspace','project','STORYBOARD_PLANNER','owner','ASSISTED','QUEUED','historical-key',0,'{}','t','t',1);
    INSERT INTO audit_events(id,workspace_id,actor_type,actor_id,actor_role,action,resource_type,resource_id,outcome,request_id,environment,metadata_json,occurred_at,ingested_at) VALUES('historical-terminal-audit','workspace','system',NULL,NULL,'intelligence.run_completed','intelligence_run','successful-storyboard-run','success','historical-request','test','{}','t','t');
    UPDATE intelligence_runs SET status='SUCCEEDED',terminal_audit_event_id='historical-terminal-audit',updated_at='t2',version=2 WHERE id='successful-storyboard-run';
  `);
  if (evidence)
    database.exec(`
      INSERT INTO research_sources(id,workspace_id,research_version_id,source_type,title,source_reference,verification_status,created_at,created_by) VALUES('source-v1','workspace','research-v1','ARCHIVE','Source','reference','owner_approved','t','owner');
      INSERT INTO research_claims(id,workspace_id,research_version_id,source_id,claim_text,evidence_class,created_at,created_by) VALUES('claim-v1','workspace','research-v1','source-v1','Concrete event','OBSERVED','t','owner');
    `);
  else
    database.exec(
      `INSERT INTO research_claims(id,workspace_id,research_version_id,claim_text,evidence_class,created_at,created_by) VALUES('claim-v1','workspace','research-v1','Unresolved event','AI_INFERENCE','t','owner')`,
    );
  const d1 = new AtomicD1(database) as unknown as D1Database;
  return { database, d1 };
}
const service = (d1: D1Database, selectedActor: EditorialActor = actor) =>
  new EditorialRevisionService(d1, selectedActor, { requestId: 'request-id', environment: 'test' });
const command = {
  targetStage: 'RESEARCH' as const,
  reasonCode: 'UNRESOLVED_CENTRAL_EVENT' as const,
  comment: 'Establish the concrete documented event.',
  expectedArtifactRevision: 2,
};
const count = (database: DatabaseSync, table: string) =>
  Number(database.prepare(`SELECT COUNT(*) count FROM ${table}`).get()!.count);

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

const imported = governedImportedResearchRevisionSchema.parse({
  expectedResearchArtifactId: 'research',
  expectedParentVersionId: 'research-v1',
  expectedArtifactRevision: 2,
  languageCode: 'de',
  summary: 'Verified evidence',
  sources: [
    {
      key: 'source-1',
      sourceType: 'ARCHIVE',
      title: 'Record',
      sourceReference: 'Shelf 1',
      retrievedAt: '2026-09-01T00:00:00Z',
      verificationStatus: 'owner_approved',
      contentHash: 'a'.repeat(64),
    },
  ],
  claims: [
    {
      claimText: 'Café opened',
      sourceKey: 'source-1',
      evidenceClass: 'OBSERVED',
      excerpt: 'Recorded event',
      confidence: 1,
    },
  ],
});
const importer = (d1: D1Database, selectedActor: EditorialActor = actor) =>
  new GovernedResearchRevisionService(d1, selectedActor, {
    requestId: 'import-request',
    environment: 'test',
  });
async function open(schemaVersion = 13) {
  const f = fixture(true, true, schemaVersion);
  const r = await service(f.d1).request('storyboard-v1', 'request-key', command);
  return { ...f, requestId: String(r.id) };
}
const tables = [
  'editorial_artifacts',
  'editorial_artifact_versions',
  'research_sources',
  'research_claims',
  'artifact_dependencies',
  'artifact_approvals',
  'audit_events',
  'editorial_revision_requests',
  'editorial_revision_request_resolutions',
  'editorial_research_revision_imports',
  'intelligence_runs',
  'intelligence_run_attempts',
  'editorial_execution_reservations',
  'preflight_assessments',
  'preflight_checks',
];
const snapshot = (db: DatabaseSync) =>
  Object.fromEntries(
    tables.map((t) => [t, db.prepare('SELECT * FROM ' + t + ' ORDER BY id').all()]),
  );
function oneSuccess(db: DatabaseSync) {
  expect(
    db
      .prepare(
        "SELECT count(*) count FROM editorial_artifact_versions WHERE parent_version_id='research-v1'",
      )
      .get(),
  ).toEqual({ count: 1 });
  expect(count(db, 'editorial_research_revision_imports')).toBe(1);
  expect(
    db
      .prepare(
        "SELECT count(*) count FROM audit_events WHERE action='editorial.research_revision_imported'",
      )
      .get(),
  ).toEqual({ count: 1 });
  expect(count(db, 'research_sources')).toBe(2);
  expect(count(db, 'research_claims')).toBe(2);
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
}
class InterleavedD1 extends AtomicD1 {
  arrivals = 0;
  private release!: () => void;
  private barrier = new Promise<void>((resolve) => {
    this.release = resolve;
  });
  override async batch(statements: Statement[]) {
    this.arrivals++;
    if (this.arrivals === 2) this.release();
    await this.barrier;
    return super.batch(statements);
  }
}
function tamper(
  db: DatabaseSync,
  match: string,
  mutate: (values: SQLInputValue[]) => void,
): D1Database {
  const real = new AtomicD1(db);
  return {
    prepare(sql: string) {
      const stmt = real.prepare(sql);
      const bind = stmt.bind.bind(stmt);
      stmt.bind = (...values: SQLInputValue[]) => {
        if (sql.includes(match)) mutate(values);
        return bind(...values);
      };
      return stmt;
    },
    batch: (stmts: Statement[]) => real.batch(stmts),
  } as unknown as D1Database;
}
describe('governed Research revision executable regression matrix', () => {
  it('same key with changed semantic payload conflicts without any extra persistence', async () => {
    const f = await open();
    await importer(f.d1).create(f.requestId, 'same-key', imported);
    const before = snapshot(f.database);
    await expect(
      importer(f.d1).create(f.requestId, 'same-key', { ...imported, summary: 'Changed meaning' }),
    ).rejects.toThrow('research_revision_idempotency_conflict');
    expect(snapshot(f.database)).toEqual(before);
    oneSuccess(f.database);
  });
  it('canonical normalization makes omitted/null source fields and equivalent claims replay identically', async () => {
    const f = await open();
    const first = await importer(f.d1).create(f.requestId, 'same-key', imported);
    const equivalent = governedImportedResearchRevisionSchema.parse({
      ...imported,
      sources: [{ ...imported.sources[0], sourceUrl: undefined, publishedAt: undefined }],
      claims: [
        { ...imported.claims[0], claimText: 'CAFE\u0301\t opened'.replace('\\u0301', '\u0301') },
      ],
    });
    const before = snapshot(f.database);
    expect(await importer(f.d1).create(f.requestId, 'same-key', equivalent)).toEqual({
      ...first,
      idempotentReplay: true,
    });
    expect(snapshot(f.database)).toEqual(before);
    expect(
      f.database
        .prepare('SELECT claim_text FROM research_claims WHERE research_version_id=?')
        .get(first.versionId),
    ).toEqual({ claim_text: 'Café opened' });
  });
  for (const same of [true, false])
    it(
      same
        ? 'same-key interleaved requests produce one write and one replay'
        : 'different-key interleaved requests produce one winner and a controlled conflict',
      async () => {
        const f = await open();
        const race = new InterleavedD1(f.database);
        const db = race as unknown as D1Database;
        const results = await Promise.allSettled([
          importer(db).create(f.requestId, 'key-one', imported),
          importer(db).create(f.requestId, same ? 'key-one' : 'key-two', imported),
        ]);
        expect(race.arrivals).toBe(2);
        if (same) {
          expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
          const values = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
          expect(values.map((v) => v.idempotentReplay).sort()).toEqual([false, true]);
          expect(values[0]?.versionId).toBe(values[1]?.versionId);
        } else {
          expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
          const failure = results.find((r) => r.status === 'rejected');
          expect(failure?.status === 'rejected' && String(failure.reason)).toContain(
            'research_revision_successor_conflict',
          );
        }
        oneSuccess(f.database);
      },
    );
  it('late audit correlation failure rolls back all evidence, pointers, invalidations, audit and receipt', async () => {
    const f = await open();
    const before = snapshot(f.database);
    const db = tamper(f.database, 'INSERT INTO audit_events', (values) => {
      values[9] = '{}';
    });
    await expect(importer(db).create(f.requestId, 'bad-audit', imported)).rejects.toThrow(
      'research_revision_import_audit_invalid',
    );
    expect(snapshot(f.database)).toEqual(before);
  });
  it('inactive actor is rejected before any persistence', async () => {
    const f = await open();
    f.database.exec("UPDATE users SET status='disabled' WHERE id='owner'");
    const before = snapshot(f.database);
    await expect(importer(f.d1).create(f.requestId, 'inactive', imported)).rejects.toThrow(
      'research_revision_not_allowed',
    );
    expect(snapshot(f.database)).toEqual(before);
  });
  it('exact HTTP route rejects an authenticated viewer without editorial:write', async () => {
    const f = await open();
    f.database.exec("UPDATE access_identities SET user_id='viewer' WHERE id='identity-owner'");
    const before = snapshot(f.database);
    const response = await revisionPost(
      f.d1,
      '/api/v1/editorial-revision-requests/' + f.requestId + '/research-revision',
      imported,
    );
    expect(response.status).toBe(403);
    expect(snapshot(f.database)).toEqual(before);
  });
  it('resolved request rejects import without writes', async () => {
    const f = await open();
    f.database.exec(
      "INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,parent_version_id,language_code,content_text,source_type,content_hash,created_at,created_by) VALUES('storyboard-v2','workspace','storyboard',2,'storyboard-v1','de','Replacement','HUMAN_EDITED','" +
        'e'.repeat(64) +
        "','t','owner'); UPDATE editorial_artifacts SET current_version_id='storyboard-v2',status='approved',version=3 WHERE id='storyboard'; INSERT INTO artifact_approvals(id,workspace_id,artifact_version_id,decision,actor_id,actor_role,decided_at) VALUES('approve-sb2','workspace','storyboard-v2','APPROVED','owner','owner','t');",
    );
    f.database
      .prepare(
        "INSERT INTO audit_events(id,workspace_id,actor_type,actor_id,actor_role,action,resource_type,resource_id,outcome,request_id,environment,metadata_json,occurred_at,ingested_at) VALUES('resolve-audit','workspace','user','owner','owner','editorial.revision_request_resolved','editorial_revision_request',?,'success','http','test','{}','t','t')",
      )
      .run(f.requestId);
    f.database
      .prepare(
        "INSERT INTO editorial_revision_request_resolutions(id,workspace_id,project_id,revision_request_id,status,resolution_artifact_version_id,resolved_by,idempotency_key,command_hash,audit_event_id,resolved_at) VALUES('resolution','workspace','project',?,'RESOLVED','storyboard-v2','owner','resolution-key',?,'resolve-audit','t')",
      )
      .run(f.requestId, 'b'.repeat(64));
    const before = snapshot(f.database);
    await expect(importer(f.d1).create(f.requestId, 'closed', imported)).rejects.toThrow(
      'revision_request_already_resolved',
    );
    expect(snapshot(f.database)).toEqual(before);
  });
  it('rejects Research from another project and request from another workspace', async () => {
    const f = await open();
    f.database.exec(
      "INSERT INTO projects(id,workspace_id,content_brand_id,channel_profile_id,title,status,format,operating_mode,primary_language,created_at,updated_at,version) VALUES('other-project','workspace','brand','channel','Other','ANALYZING','SHORT','ASSISTED','de','t','t',1); INSERT INTO editorial_artifacts(id,workspace_id,project_id,artifact_type,current_version_id,status,created_at,updated_at,version) VALUES('other-research','workspace','other-project','RESEARCH','other-research-v1','active','t','t',1); INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,language_code,content_text,source_type,content_hash,created_at,created_by) VALUES('other-research-v1','workspace','other-research',1,'de','Other','IMPORTED','" +
        'f'.repeat(64) +
        "','t','owner');",
    );
    const before = snapshot(f.database);
    await expect(
      importer(f.d1).create(f.requestId, 'wrong-project', {
        ...imported,
        expectedResearchArtifactId: 'other-research',
        expectedParentVersionId: 'other-research-v1',
        expectedArtifactRevision: 1,
      }),
    ).rejects.toThrow('research_artifact_not_found');
    await expect(
      importer(f.d1, { id: 'other-user', workspaceId: 'other', roles: ['owner'] }).create(
        f.requestId,
        'wrong-workspace',
        imported,
      ),
    ).rejects.toThrow('revision_request_not_found');
    expect(snapshot(f.database)).toEqual(before);
  });
  it('persists multiple sources and exact many-to-one links without approvals or readiness escalation', async () => {
    const f = await open();
    const historical = f.database
      .prepare("SELECT * FROM editorial_artifact_versions WHERE id='research-v1'")
      .get();
    const approvals = f.database.prepare('SELECT * FROM artifact_approvals ORDER BY id').all();
    const input = governedImportedResearchRevisionSchema.parse({
      ...imported,
      sources: [
        imported.sources[0],
        {
          ...imported.sources[0],
          key: 'source-2',
          sourceReference: 'Shelf 2',
          contentHash: 'b'.repeat(64),
        },
      ],
      claims: [
        imported.claims[0],
        { ...imported.claims[0], claimText: 'Another observation' },
        { ...imported.claims[0], sourceKey: 'source-2' },
      ],
    });
    const result = await importer(f.d1).create(f.requestId, 'multi', input);
    expect(
      f.database
        .prepare(
          'SELECT s.source_key,count(c.id) uses FROM research_sources s JOIN research_claims c ON c.source_id=s.id AND c.research_version_id=s.research_version_id AND c.workspace_id=s.workspace_id WHERE s.research_version_id=? GROUP BY s.id ORDER BY s.source_key',
        )
        .all(result.versionId),
    ).toEqual([
      { source_key: 'source-1', uses: 2 },
      { source_key: 'source-2', uses: 1 },
    ]);
    expect(
      f.database
        .prepare(
          'SELECT count(*) count FROM research_claims WHERE research_version_id=? AND source_id IS NULL',
        )
        .get(result.versionId),
    ).toEqual({ count: 0 });
    expect(
      f.database.prepare("SELECT * FROM editorial_artifact_versions WHERE id='research-v1'").get(),
    ).toEqual(historical);
    expect(f.database.prepare('SELECT * FROM artifact_approvals ORDER BY id').all()).toEqual(
      approvals,
    );
    expect(
      f.database
        .prepare('SELECT status FROM editorial_revision_requests WHERE id=?')
        .get(f.requestId),
    ).toEqual({ status: 'OPEN' });
    expect(
      f.database
        .prepare(
          "SELECT validity_status FROM artifact_dependencies WHERE id IN ('dep-ri','dep-rb')",
        )
        .all(),
    ).toEqual([{ validity_status: 'STALE' }, { validity_status: 'STALE' }]);
    const readiness = await evaluateEditorialProductionReadiness(
      f.d1,
      actor,
      'project',
      'BEFORE_PRODUCTION_SCRIPT',
    );
    expect(readiness.ready).toBe(false);
    expect(readiness.blockers.length).toBeGreaterThan(0);
    expect(f.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
  it('true schema 0012 with editorial and revision history upgrades unchanged to 0013', async () => {
    const f = await open(12);
    expect(await researchRevisionSchemaReady(f.d1)).toBe(false);
    const before = Object.fromEntries(
      tables
        .filter((t) => t !== 'editorial_research_revision_imports')
        .map((t) => [t, f.database.prepare('SELECT * FROM ' + t + ' ORDER BY id').all()]),
    );
    await expect(importer(f.d1).create(f.requestId, 'pre-upgrade', imported)).rejects.toThrow(
      'research_revision_schema_unavailable',
    );
    f.database.exec(migration('0013_governed_imported_research_revision.sql'));
    expect(await researchRevisionSchemaReady(f.d1)).toBe(true);
    for (const [t, rows] of Object.entries(before))
      expect(f.database.prepare('SELECT * FROM ' + t + ' ORDER BY id').all()).toEqual(rows);
    expect(f.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
  for (const field of [
    'empty',
    'missing',
    'versionId',
    'auditEventId',
    'researchArtifactId',
    'contentHash',
    'parentVersionId',
    'versionNumber',
    'projectId',
    'receiptId',
    'revisionRequestId',
    'bad-json',
    'expected_artifact_revision',
  ])
    it('runtime refuses corrupted receipt: ' + field, async () => {
      const f = await open();
      await importer(f.d1).create(f.requestId, 'replay-key', imported);
      const before = snapshot(f.database);
      const real = new AtomicD1(f.database);
      const db = {
        prepare(sql: string) {
          const stmt = real.prepare(sql);
          if (sql.includes('SELECT i.*')) {
            const first = stmt.first.bind(stmt);
            stmt.first = async <T>() => {
              const row = await first<Record<string, unknown>>();
              if (!row) return null;
              const parsed: Record<string, unknown> = JSON.parse(String(row.result_json)) as Record<
                string,
                unknown
              >;
              if (field === 'empty') row.result_json = '{}';
              else if (field === 'bad-json') row.result_json = '{';
              else if (field === 'expected_artifact_revision') row.expected_artifact_revision = 999;
              else {
                if (field === 'missing') delete parsed.versionId;
                else
                  parsed[field] =
                    field === 'versionNumber'
                      ? 999
                      : field === 'contentHash'
                        ? 'f'.repeat(64)
                        : 'wrong-id';
                row.result_json = JSON.stringify(parsed);
              }
              return row as T;
            };
          }
          return stmt;
        },
        batch: (stmts: Statement[]) => real.batch(stmts),
      } as unknown as D1Database;
      await expect(importer(db).create(f.requestId, 'replay-key', imported)).rejects.toThrow(
        'research_revision_receipt_invalid',
      );
      expect(snapshot(f.database)).toEqual(before);
    });
  it('HTTP sanitizes a late database trigger error', async () => {
    const f = await open();
    const before = snapshot(f.database);
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const response = await revisionPost(
        tamper(f.database, 'INSERT INTO audit_events', (v) => {
          v[9] = '{}';
        }),
        '/api/v1/editorial-revision-requests/' + f.requestId + '/research-revision',
        imported,
      );
      expect(response.status).toBe(500);
      expect(JSON.stringify(await response.json())).not.toMatch(
        /SQLITE|research_revision_import_audit_invalid|metadata_json|stack/,
      );
      expect(snapshot(f.database)).toEqual(before);
    } finally {
      log.mockRestore();
    }
  });
});
