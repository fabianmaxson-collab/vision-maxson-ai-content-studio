import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import { createApp, type Bindings } from '../src/app';
import { revisionRequestSchema } from '@vision-maxson/contracts';
import { EditorialExecutionService } from '../src/editorial/execution';
import { DeterministicPreflightService } from '../src/editorial/preflight';
import { evaluateEditorialProductionReadiness } from '../src/editorial/readiness';
import { EditorialRepository, type EditorialActor } from '../src/editorial/repository';
import { EditorialRevisionService } from '../src/editorial/revision';

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
  async batch(statements: Statement[]) {
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
function fixture(evidence = true, includeRevisionSchema = true) {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys=ON');
  (includeRevisionSchema ? migrations : migrations.slice(0, -1)).forEach((name) =>
    database.exec(migration(name)),
  );
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

describe('governed editorial revision requests', () => {
  it('creates the canonical request and audit atomically without changing successful execution history', async () => {
    const { database, d1 } = fixture();
    const result = await service(d1).request('storyboard-v1', 'revision-key', command);
    expect(result).toMatchObject({
      status: 'OPEN',
      targetStage: 'RESEARCH',
      reasonCode: 'UNRESOLVED_CENTRAL_EVENT',
      idempotentReplay: false,
    });
    expect(count(database, 'editorial_revision_requests')).toBe(1);
    expect(
      database
        .prepare(
          "SELECT action,resource_id resourceId FROM audit_events WHERE action='editorial.revision_requested'",
        )
        .get(),
    ).toEqual({ action: 'editorial.revision_requested', resourceId: result.id });
    expect(
      database
        .prepare("SELECT status FROM intelligence_runs WHERE id='successful-storyboard-run'")
        .get(),
    ).toEqual({ status: 'SUCCEEDED' });
    expect(count(database, 'artifact_approvals')).toBe(5);
    expect(
      database.prepare("SELECT status FROM editorial_artifacts WHERE id='storyboard'").get(),
    ).toEqual({ status: 'active' });
  });

  it('replays the same command once and rejects key reuse for another command', async () => {
    const { database, d1 } = fixture();
    const first = await service(d1).request('storyboard-v1', 'revision-key', command);
    const replay = await service(d1).request('storyboard-v1', 'revision-key', command);
    expect(replay).toMatchObject({
      id: first.id,
      auditEventId: first.auditEventId,
      idempotentReplay: true,
    });
    await expect(
      service(d1).request('storyboard-v1', 'revision-key', {
        ...command,
        reasonCode: 'STORYBOARD_REVISION_REQUIRED',
      }),
    ).rejects.toThrow('revision_request_idempotency_conflict');
    expect(count(database, 'editorial_revision_requests')).toBe(1);
    expect(
      database
        .prepare(
          "SELECT COUNT(*) count FROM audit_events WHERE action='editorial.revision_requested'",
        )
        .get(),
    ).toEqual({ count: 1 });
  });

  it('collapses concurrent duplicate requests to one request and one audit', async () => {
    const { database, d1 } = fixture();
    const [a, b] = await Promise.all([
      service(d1).request('storyboard-v1', 'concurrent-key', command),
      service(d1).request('storyboard-v1', 'concurrent-key', command),
    ]);
    expect(a.id).toBe(b.id);
    expect([a.idempotentReplay, b.idempotentReplay].sort()).toEqual([false, true]);
    expect(count(database, 'editorial_revision_requests')).toBe(1);
    expect(
      database
        .prepare(
          "SELECT COUNT(*) count FROM audit_events WHERE action='editorial.revision_requested'",
        )
        .get(),
    ).toEqual({ count: 1 });
  });

  it('rejects different-key duplicate open requests without duplicate creation audit', async () => {
    const { database, d1 } = fixture();
    await service(d1).request('storyboard-v1', 'first-open-key', command);
    await expect(service(d1).request('storyboard-v1', 'second-open-key', command)).rejects.toThrow(
      'revision_request_already_open',
    );
    await expect(
      service(d1).request('storyboard-v1', 'third-open-key', {
        ...command,
        reasonCode: 'STORYBOARD_REVISION_REQUIRED',
      }),
    ).rejects.toThrow('revision_request_already_open');
    expect(count(database, 'editorial_revision_requests')).toBe(1);
    expect(
      database
        .prepare(
          "SELECT COUNT(*) count FROM audit_events WHERE action='editorial.revision_requested'",
        )
        .get(),
    ).toEqual({ count: 1 });
  });

  it('serializes concurrent different-key requests to one open request and one audit', async () => {
    const { database, d1 } = fixture();
    const results = await Promise.allSettled([
      service(d1).request('storyboard-v1', 'different-key-a', command),
      service(d1).request('storyboard-v1', 'different-key-b', {
        ...command,
        reasonCode: 'STORYBOARD_REVISION_REQUIRED',
      }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(
      String(
        (results.find((result) => result.status === 'rejected') as PromiseRejectedResult).reason,
      ),
    ).toContain('revision_request_already_open');
    expect(count(database, 'editorial_revision_requests')).toBe(1);
    expect(
      database
        .prepare(
          "SELECT COUNT(*) count FROM audit_events WHERE action='editorial.revision_requested'",
        )
        .get(),
    ).toEqual({ count: 1 });
  });

  it.each([
    [
      'viewer',
      { id: 'viewer', workspaceId: 'workspace', roles: ['viewer' as const] },
      'storyboard-v1',
      command,
      'revision_request_not_allowed',
    ],
    [
      'wrong workspace',
      { id: 'other-user', workspaceId: 'other', roles: ['owner' as const] },
      'storyboard-v1',
      command,
      'artifact_version_not_found',
    ],
    [
      'stale artifact revision',
      actor,
      'storyboard-v1',
      { ...command, expectedArtifactRevision: 1 },
      'revision_request_version_conflict',
    ],
  ])(
    'rejects %s without request or audit',
    async (_label, selectedActor, versionId, input, error) => {
      const { database, d1 } = fixture();
      await expect(
        service(d1, selectedActor).request(versionId, 'denied-key', input),
      ).rejects.toThrow(error);
      expect(count(database, 'editorial_revision_requests')).toBe(0);
      expect(
        database
          .prepare(
            "SELECT COUNT(*) count FROM audit_events WHERE action='editorial.revision_requested'",
          )
          .get(),
      ).toEqual({ count: 0 });
    },
  );

  it('rejects stale versions and unsupported reviewed artifact types without persistence', async () => {
    const stale = fixture();
    stale.database.exec(
      `INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,language_code,content_text,source_type,content_hash,created_at,created_by) VALUES('storyboard-old','workspace','storyboard',2,'de','old','HUMAN_EDITED','${'7'.repeat(64)}','t0','owner')`,
    );
    await expect(service(stale.d1).request('storyboard-old', 'stale-key', command)).rejects.toThrow(
      'stale_version_cannot_request_revision',
    );

    const unsupported = fixture();
    await expect(
      service(unsupported.d1).request('research-v1', 'unsupported-key', command),
    ).rejects.toThrow('revision_reviewed_artifact_type_unsupported');
    expect(count(stale.database, 'editorial_revision_requests')).toBe(0);
    expect(count(unsupported.database, 'editorial_revision_requests')).toBe(0);
  });
  it('blocks approval of the reviewed current version without creating REJECTED semantics', async () => {
    const { database, d1 } = fixture();
    await service(d1).request('storyboard-v1', 'revision-key', command);
    await expect(
      new EditorialRepository(d1, actor).approve('storyboard-v1', 'APPROVED', null),
    ).rejects.toThrow('open_revision_request_blocks_approval');
    expect(
      database
        .prepare(
          "SELECT COUNT(*) count FROM artifact_approvals WHERE artifact_version_id='storyboard-v1'",
        )
        .get(),
    ).toEqual({ count: 0 });
    expect(
      database
        .prepare("SELECT COUNT(*) count FROM artifact_approvals WHERE decision='REJECTED'")
        .get(),
    ).toEqual({ count: 0 });
  });

  it('does not resolve merely because a new Research version exists', async () => {
    const { database, d1 } = fixture();
    const request = await service(d1).request('storyboard-v1', 'revision-key', command);
    database.exec(`
      INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,parent_version_id,language_code,content_text,source_type,content_hash,created_at,created_by) VALUES('research-v2','workspace','research',2,'research-v1','de','new research','HUMAN_EDITED','${'6'.repeat(64)}','t2','owner');
      UPDATE editorial_artifacts SET current_version_id='research-v2',status='approved',version=3 WHERE id='research';
      INSERT INTO artifact_approvals(id,workspace_id,artifact_version_id,decision,actor_id,actor_role,decided_at) VALUES('approve-research-v2','workspace','research-v2','APPROVED','owner','owner','t2');
    `);
    await expect(
      service(d1).resolve(String(request.id), 'resolution-key', {
        resolutionArtifactVersionId: 'storyboard-v1',
      }),
    ).rejects.toThrow('revision_request_resolution_storyboard_invalid');
    expect(count(database, 'editorial_revision_request_resolutions')).toBe(0);
  });

  it('resolves explicitly only after approved replacement evidence reaches a new current Storyboard', async () => {
    const { database, d1 } = fixture();
    const request = await service(d1).request('storyboard-v1', 'revision-key', command);
    database.exec(`
      INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,parent_version_id,language_code,content_text,content_json,source_type,content_hash,created_at,created_by) VALUES
        ('research-v2','workspace','research',2,'research-v1','de','new research',NULL,'HUMAN_EDITED','${'8'.repeat(64)}','t2','owner'),
        ('idea-v2','workspace','idea',2,'idea-v1','de','new idea',NULL,'HUMAN_EDITED','${'7'.repeat(64)}','t2','owner'),
        ('brief-v2','workspace','brief',2,'brief-v1','de',NULL,'{"researchVersionIds":["research-v2"]}','HUMAN_EDITED','${'9'.repeat(64)}','t2','owner'),
        ('script-v2','workspace','script',2,'script-v1','de','new script',NULL,'HUMAN_EDITED','${'a'.repeat(64)}','t2','owner'),
        ('critique-v2','workspace','critique',2,'critique-v1','de','new critique',NULL,'HUMAN_EDITED','${'b'.repeat(64)}','t2','owner'),
        ('storyboard-v2','workspace','storyboard',2,'storyboard-v1','de','new storyboard',NULL,'HUMAN_EDITED','${'c'.repeat(64)}','t2','owner');
      UPDATE editorial_artifacts SET current_version_id='research-v2',status='approved',version=3 WHERE id='research';
      UPDATE editorial_artifacts SET current_version_id='idea-v2',status='approved',version=3 WHERE id='idea';
      UPDATE idea_candidates SET status='REJECTED',updated_at='t2',updated_by='owner',version=2 WHERE id='idea-candidate';
      INSERT INTO idea_candidates(id,workspace_id,project_id,artifact_id,artifact_version_id,title,target_format,status,evidence_class,created_at,updated_at,version,created_by,updated_by) VALUES('idea-candidate-v2','workspace','project','idea','idea-v2','New idea','SHORT','SELECTED','UNKNOWN','t2','t2',1,'owner','owner');
      UPDATE editorial_artifacts SET current_version_id='brief-v2',status='approved',version=3 WHERE id='brief';
      UPDATE editorial_artifacts SET current_version_id='script-v2',status='approved',version=3 WHERE id='script';
      UPDATE editorial_artifacts SET current_version_id='critique-v2',status='approved',version=3 WHERE id='critique';
      UPDATE editorial_artifacts SET current_version_id='storyboard-v2',status='approved',version=3 WHERE id='storyboard';
      INSERT INTO artifact_approvals(id,workspace_id,artifact_version_id,decision,actor_id,actor_role,decided_at) VALUES
        ('approve-research-v2','workspace','research-v2','APPROVED','owner','owner','t2'),
        ('approve-idea-v2','workspace','idea-v2','APPROVED','owner','owner','t2'),
        ('approve-brief-v2','workspace','brief-v2','APPROVED','owner','owner','t2'),
        ('approve-script-v2','workspace','script-v2','APPROVED','owner','owner','t2'),
        ('approve-critique-v2','workspace','critique-v2','APPROVED','owner','owner','t2'),
        ('approve-storyboard-v2','workspace','storyboard-v2','APPROVED','owner','owner','t2');
      INSERT INTO research_sources(id,workspace_id,research_version_id,source_type,title,source_reference,verification_status,created_at,created_by) VALUES('source-v2','workspace','research-v2','ARCHIVE','New source','new-reference','owner_approved','t2','owner');
      INSERT INTO research_claims(id,workspace_id,research_version_id,source_id,claim_text,evidence_class,created_at,created_by) VALUES('claim-v2','workspace','research-v2','source-v2','Resolved event','OBSERVED','t2','owner');
      INSERT INTO artifact_dependencies(id,workspace_id,source_artifact_version_id,dependent_artifact_version_id,dependency_type,validity_status,created_at,updated_at,version) VALUES
        ('dep-ri-v2','workspace','research-v2','idea-v2','GENERATED_FROM','CURRENT','t2','t2',1),
        ('dep-ib-v2','workspace','idea-v2','brief-v2','GENERATED_FROM','CURRENT','t2','t2',1),
        ('dep-rb-v2','workspace','research-v2','brief-v2','USES_RESEARCH','CURRENT','t2','t2',1),
        ('dep-bs-v2','workspace','brief-v2','script-v2','GENERATED_FROM','CURRENT','t2','t2',1),
        ('dep-sc-v2','workspace','script-v2','critique-v2','EVALUATES_SOURCE','CURRENT','t2','t2',1),
        ('dep-sb-v2','workspace','script-v2','storyboard-v2','GENERATED_FROM','CURRENT','t2','t2',1),
        ('dep-cb-v2','workspace','critique-v2','storyboard-v2','INFORMED_BY','CURRENT','t2','t2',1);
    `);
    const resolved = await service(d1).resolve(String(request.id), 'resolution-key', {
      resolutionArtifactVersionId: 'storyboard-v2',
    });
    expect(resolved).toMatchObject({
      revisionRequestId: request.id,
      status: 'RESOLVED',
      resolutionArtifactVersionId: 'storyboard-v2',
      idempotentReplay: false,
    });
    expect(
      database
        .prepare(`SELECT status FROM editorial_revision_requests WHERE id=?`)
        .get(request.id as string),
    ).toEqual({ status: 'OPEN' });
    expect(count(database, 'editorial_revision_request_resolutions')).toBe(1);
    expect(
      database
        .prepare(
          `SELECT COUNT(*) count FROM audit_events WHERE action='editorial.revision_request_resolved'`,
        )
        .get(),
    ).toEqual({ count: 1 });
    const replay = await service(d1).resolve(String(request.id), 'resolution-key', {
      resolutionArtifactVersionId: 'storyboard-v2',
    });
    expect(replay).toMatchObject({ id: resolved.id, idempotentReplay: true });
    await expect(
      service(d1).resolve(String(request.id), 'resolution-key', {
        resolutionArtifactVersionId: 'storyboard-v1',
      }),
    ).rejects.toThrow('revision_resolution_idempotency_conflict');
    await expect(
      service(d1).resolve(String(request.id), 'second-resolution-key', {
        resolutionArtifactVersionId: 'storyboard-v2',
      }),
    ).rejects.toThrow('revision_request_already_resolved');
    expect(count(database, 'editorial_revision_request_resolutions')).toBe(1);
    expect(
      database
        .prepare("SELECT COUNT(*) count FROM editorial_artifact_versions WHERE id='storyboard-v1'")
        .get(),
    ).toEqual({ count: 1 });
    await expect(
      evaluateEditorialProductionReadiness(d1, actor, 'project', 'BEFORE_PREFLIGHT'),
    ).resolves.toMatchObject({ ready: true, blockers: [] });
  });
});

describe('deterministic editorial production readiness', () => {
  it('blocks canonical-style unresolved research and permits verified approved evidence', async () => {
    const unresolved = fixture(false);
    const blocked = await evaluateEditorialProductionReadiness(
      unresolved.d1,
      actor,
      'project',
      'BEFORE_PRODUCTION_SCRIPT',
    );
    expect(blocked.ready).toBe(false);
    expect(blocked.blockers).toEqual(['MISSING_REQUIRED_RESEARCH_EVIDENCE']);
    expect(blocked.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('FUTURE_SCHEMA_WORK')]),
    );
    const verified = fixture(true);
    await expect(
      evaluateEditorialProductionReadiness(
        verified.d1,
        actor,
        'project',
        'BEFORE_PRODUCTION_SCRIPT',
      ),
    ).resolves.toMatchObject({ ready: true, blockers: [] });
    await expect(
      evaluateEditorialProductionReadiness(verified.d1, actor, 'project', 'BEFORE_STORYBOARD'),
    ).resolves.toMatchObject({ ready: true, blockers: [] });
  });

  it('resolves only the authoritative selected Idea among multiple stored candidates', async () => {
    const { database, d1 } = fixture(true);
    database.exec(`
      INSERT INTO editorial_artifacts(id,workspace_id,project_id,artifact_type,current_version_id,status,created_at,updated_at,version,created_by,updated_by) VALUES
        ('idea-a','workspace','project','IDEA_CANDIDATE','idea-a-v1','active','t','t',1,'owner','owner'),
        ('idea-c','workspace','project','IDEA_CANDIDATE','idea-c-v1','approved','t','t',2,'owner','owner');
      INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,language_code,content_text,source_type,content_hash,created_at,created_by) VALUES
        ('idea-a-v1','workspace','idea-a',1,'de','unselected A','HUMAN_EDITED','${'d'.repeat(64)}','t','owner'),
        ('idea-c-v1','workspace','idea-c',1,'de','unselected C','HUMAN_EDITED','${'e'.repeat(64)}','t','owner');
      INSERT INTO artifact_approvals(id,workspace_id,artifact_version_id,decision,actor_id,actor_role,decided_at)
        VALUES('approve-idea-c','workspace','idea-c-v1','APPROVED','owner','owner','t');
      INSERT INTO idea_candidates(id,workspace_id,project_id,artifact_id,artifact_version_id,title,target_format,status,evidence_class,created_at,updated_at,version,created_by,updated_by) VALUES
        ('candidate-a','workspace','project','idea-a','idea-a-v1','A','SHORT','CANDIDATE','UNKNOWN','t','t',1,'owner','owner'),
        ('candidate-c','workspace','project','idea-c','idea-c-v1','C','SHORT','REJECTED','UNKNOWN','t','t',1,'owner','owner');
      UPDATE editorial_artifacts SET status='approved' WHERE id='storyboard';
      INSERT INTO artifact_approvals(id,workspace_id,artifact_version_id,decision,actor_id,actor_role,decided_at)
        VALUES('approve-storyboard','workspace','storyboard-v1','APPROVED','owner','owner','t');
      PRAGMA reverse_unordered_selects=ON;
    `);
    expect(
      database
        .prepare("SELECT id FROM editorial_artifacts WHERE artifact_type='IDEA_CANDIDATE' LIMIT 1")
        .get(),
    ).not.toEqual({ id: 'idea' });
    for (const checkpoint of [
      'BEFORE_STORYBOARD',
      'BEFORE_PREFLIGHT',
      'BEFORE_REVISION_RESOLUTION',
    ] as const)
      await expect(
        evaluateEditorialProductionReadiness(d1, actor, 'project', checkpoint),
      ).resolves.toMatchObject({ ready: true, blockers: [] });
  });

  it('fails closed with zero selected Ideas and structurally prevents multiple selections', async () => {
    const missing = fixture(true);
    missing.database.exec("UPDATE idea_candidates SET status='REJECTED' WHERE id='idea-candidate'");
    expect(
      (
        await evaluateEditorialProductionReadiness(
          missing.d1,
          actor,
          'project',
          'BEFORE_STORYBOARD',
        )
      ).ready,
    ).toBe(false);

    const multiple = fixture(true);
    multiple.database.exec(`
      INSERT INTO editorial_artifacts(id,workspace_id,project_id,artifact_type,current_version_id,status,created_at,updated_at,version,created_by,updated_by)
        VALUES('idea-second','workspace','project','IDEA_CANDIDATE','idea-second-v1','approved','t','t',2,'owner','owner');
      INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,language_code,content_text,source_type,content_hash,created_at,created_by)
        VALUES('idea-second-v1','workspace','idea-second',1,'de','second','HUMAN_EDITED','${'f'.repeat(64)}','t','owner');
    `);
    expect(() =>
      multiple.database.exec(
        "INSERT INTO idea_candidates(id,workspace_id,project_id,artifact_id,artifact_version_id,title,target_format,status,evidence_class,created_at,updated_at,version,created_by,updated_by) VALUES('candidate-second','workspace','project','idea-second','idea-second-v1','Second','SHORT','SELECTED','UNKNOWN','t','t',1,'owner','owner')",
      ),
    ).toThrow(/UNIQUE constraint failed/u);
  });

  it('blocks an open revision and stale or invalidated current dependency', async () => {
    const open = fixture();
    await service(open.d1).request('storyboard-v1', 'revision-key', command);
    expect(
      (await evaluateEditorialProductionReadiness(open.d1, actor, 'project', 'BEFORE_STORYBOARD'))
        .blockers,
    ).toContain('OPEN_REVISION_REQUEST');
    const stale = fixture();
    stale.database.exec(
      "UPDATE artifact_dependencies SET validity_status='STALE' WHERE id='dep-sc'",
    );
    expect(
      (await evaluateEditorialProductionReadiness(stale.d1, actor, 'project', 'BEFORE_STORYBOARD'))
        .blockers,
    ).toContain('STALE_OR_INVALIDATED_UPSTREAM_DEPENDENCY');
    const invalidated = fixture();
    invalidated.database.exec(
      "UPDATE artifact_dependencies SET validity_status='INVALIDATED',invalidated_at='t2',invalidated_by_version_id='research-v1' WHERE id='dep-sc'",
    );
    expect(
      (
        await evaluateEditorialProductionReadiness(
          invalidated.d1,
          actor,
          'project',
          'BEFORE_STORYBOARD',
        )
      ).blockers,
    ).toContain('STALE_OR_INVALIDATED_UPSTREAM_DEPENDENCY');
  });

  it('fails before Run, attempt, reservation or provider configuration at both checkpoints', async () => {
    for (const task of ['SCRIPT_WRITER_SHORT', 'STORYBOARD_PLANNER'] as const) {
      const { database, d1 } = fixture(false);
      const before = {
        runs: count(database, 'intelligence_runs'),
        attempts: count(database, 'intelligence_run_attempts'),
        reservations: count(database, 'editorial_execution_reservations'),
      };
      const execution = new EditorialExecutionService(d1, actor, {
        openAIEnabled: false,
        openAIBaseUrl: 'https://example.invalid',
      });
      await expect(
        execution.execute(
          'project',
          task,
          {
            mode: 'LOCKED',
            inputArtifactVersionId: task === 'STORYBOARD_PLANNER' ? 'script-v1' : 'brief-v1',
            creativeRegeneration: false,
          },
          `key-${task}`,
        ),
      ).rejects.toThrow('editorial_production_not_ready');
      expect({
        runs: count(database, 'intelligence_runs'),
        attempts: count(database, 'intelligence_run_attempts'),
        reservations: count(database, 'editorial_execution_reservations'),
      }).toEqual(before);
    }
  });

  it('blocks deterministic Preflight before any Preflight persistence', async () => {
    const { database, d1 } = fixture();
    await service(d1).request('storyboard-v1', 'revision-key', command);
    await expect(
      new DeterministicPreflightService(d1, actor, 'request', 'test').calculate('project'),
    ).rejects.toThrow('OPEN_REVISION_REQUEST');
    expect(
      database
        .prepare("SELECT COUNT(*) count FROM editorial_artifacts WHERE artifact_type='PREFLIGHT'")
        .get(),
    ).toEqual({ count: 0 });
    expect(count(database, 'preflight_assessments')).toBe(0);
    expect(count(database, 'preflight_checks')).toBe(0);
  });

  it('keeps readiness guards ahead of provider configuration, reservation, Run and adapter construction', () => {
    const source = readFileSync(new URL('../src/editorial/execution.ts', import.meta.url), 'utf8');
    const guard = source.indexOf('assertEditorialProductionReady(');
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(source.indexOf('this.config.openAIEnabled'));
    expect(guard).toBeLessThan(source.indexOf('const insertRun'));
    expect(guard).toBeLessThan(source.indexOf('reservationStatement(this.db'));
    expect(guard).toBeLessThan(source.indexOf('new OpenAIResponsesAdapter'));
  });
});

describe('BLOCK 9BZ checkpoint scoping and capability guards', () => {
  it('accepts only RESEARCH in the public revision target contract', () => {
    expect(revisionRequestSchema.safeParse(command).success).toBe(true);
    for (const targetStage of [
      'IDEA',
      'CONTENT_BRIEF',
      'PRODUCTION_SCRIPT',
      'REVIEW_TRANSLATION',
      'SCRIPT_CRITIQUE',
      'STORYBOARD',
      'PREFLIGHT',
    ])
      expect(revisionRequestSchema.safeParse({ ...command, targetStage }).success).toBe(false);
  });

  it('does not infer centrality from one unrelated evidenced claim', async () => {
    const { database, d1 } = fixture(true);
    database.exec(
      `INSERT INTO research_claims(id,workspace_id,research_version_id,claim_text,evidence_class,created_at,created_by)
       VALUES('claim-unresolved','workspace','research-v1','Actual unresolved prerequisite','UNKNOWN','t','owner')`,
    );
    const result = await evaluateEditorialProductionReadiness(
      d1,
      actor,
      'project',
      'BEFORE_PRODUCTION_SCRIPT',
    );
    expect(result.ready).toBe(false);
    expect(result.blockers).toEqual(['MISSING_REQUIRED_RESEARCH_EVIDENCE']);
    expect(result.blockers).not.toContain('UNRESOLVED_CENTRAL_SUBJECT');
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('FUTURE_SCHEMA_WORK')]),
    );
  });

  it('allows replacement Storyboard generation while old Storyboard lineage is stale, then requires replacement lineage before Preflight', async () => {
    const { database, d1 } = fixture(true);
    database.exec(`
      INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,parent_version_id,language_code,content_text,content_json,source_type,content_hash,created_at,created_by) VALUES
        ('research-v2','workspace','research',2,'research-v1','de','new research',NULL,'HUMAN_EDITED','${'8'.repeat(64)}','t2','owner'),
        ('idea-v2','workspace','idea',2,'idea-v1','de','new idea',NULL,'HUMAN_EDITED','${'7'.repeat(64)}','t2','owner'),
        ('brief-v2','workspace','brief',2,'brief-v1','de',NULL,'{"researchVersionIds":["research-v2"]}','HUMAN_EDITED','${'9'.repeat(64)}','t2','owner'),
        ('script-v2','workspace','script',2,'script-v1','de','new script',NULL,'HUMAN_EDITED','${'a'.repeat(64)}','t2','owner'),
        ('critique-v2','workspace','critique',2,'critique-v1','de','new critique',NULL,'HUMAN_EDITED','${'b'.repeat(64)}','t2','owner');
      UPDATE editorial_artifacts SET current_version_id='research-v2',status='approved',version=3 WHERE id='research';
      UPDATE editorial_artifacts SET current_version_id='idea-v2',status='approved',version=3 WHERE id='idea';
      UPDATE idea_candidates SET status='REJECTED',updated_at='t2',updated_by='owner',version=2 WHERE id='idea-candidate';
      INSERT INTO idea_candidates(id,workspace_id,project_id,artifact_id,artifact_version_id,title,target_format,status,evidence_class,created_at,updated_at,version,created_by,updated_by) VALUES('idea-candidate-v2','workspace','project','idea','idea-v2','New idea','SHORT','SELECTED','UNKNOWN','t2','t2',1,'owner','owner');
      UPDATE editorial_artifacts SET current_version_id='brief-v2',status='approved',version=3 WHERE id='brief';
      UPDATE editorial_artifacts SET current_version_id='script-v2',status='approved',version=3 WHERE id='script';
      UPDATE editorial_artifacts SET current_version_id='critique-v2',status='approved',version=3 WHERE id='critique';
      INSERT INTO artifact_approvals(id,workspace_id,artifact_version_id,decision,actor_id,actor_role,decided_at) VALUES
        ('approve-research-v2','workspace','research-v2','APPROVED','owner','owner','t2'),
        ('approve-idea-v2','workspace','idea-v2','APPROVED','owner','owner','t2'),
        ('approve-brief-v2','workspace','brief-v2','APPROVED','owner','owner','t2'),
        ('approve-script-v2','workspace','script-v2','APPROVED','owner','owner','t2'),
        ('approve-critique-v2','workspace','critique-v2','APPROVED','owner','owner','t2');
      INSERT INTO research_sources(id,workspace_id,research_version_id,source_type,title,source_reference,verification_status,created_at,created_by)
        VALUES('source-v2','workspace','research-v2','ARCHIVE','New source','new-reference','owner_approved','t2','owner');
      INSERT INTO research_claims(id,workspace_id,research_version_id,source_id,claim_text,evidence_class,created_at,created_by)
        VALUES('claim-v2','workspace','research-v2','source-v2','Resolved evidence','OBSERVED','t2','owner');
      INSERT INTO artifact_dependencies(id,workspace_id,source_artifact_version_id,dependent_artifact_version_id,dependency_type,validity_status,created_at,updated_at,version) VALUES
        ('dep-ri-v2','workspace','research-v2','idea-v2','GENERATED_FROM','CURRENT','t2','t2',1),
        ('dep-ib-v2','workspace','idea-v2','brief-v2','GENERATED_FROM','CURRENT','t2','t2',1),
        ('dep-rb-v2','workspace','research-v2','brief-v2','USES_RESEARCH','CURRENT','t2','t2',1),
        ('dep-bs-v2','workspace','brief-v2','script-v2','GENERATED_FROM','CURRENT','t2','t2',1),
        ('dep-sc-v2','workspace','script-v2','critique-v2','EVALUATES_SOURCE','CURRENT','t2','t2',1);
      UPDATE artifact_dependencies SET validity_status='STALE',updated_at='t2',version=2
        WHERE id IN ('dep-sb','dep-cb');
    `);
    await expect(
      evaluateEditorialProductionReadiness(d1, actor, 'project', 'BEFORE_STORYBOARD'),
    ).resolves.toMatchObject({ ready: true, blockers: [] });
    const beforePreflight = await evaluateEditorialProductionReadiness(
      d1,
      actor,
      'project',
      'BEFORE_PREFLIGHT',
    );
    expect(beforePreflight.ready).toBe(false);
    expect(beforePreflight.blockers).toContain('MISSING_EXACT_DEPENDENCY_LINKAGE');

    database.exec(`
      INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,parent_version_id,language_code,content_text,source_type,content_hash,created_at,created_by)
        VALUES('storyboard-v2','workspace','storyboard',2,'storyboard-v1','de','replacement storyboard','HUMAN_EDITED','${'c'.repeat(64)}','t3','owner');
      UPDATE editorial_artifacts SET current_version_id='storyboard-v2',status='approved',version=3 WHERE id='storyboard';
      INSERT INTO artifact_approvals(id,workspace_id,artifact_version_id,decision,actor_id,actor_role,decided_at)
        VALUES('approve-storyboard-v2','workspace','storyboard-v2','APPROVED','owner','owner','t3');
      INSERT INTO artifact_dependencies(id,workspace_id,source_artifact_version_id,dependent_artifact_version_id,dependency_type,validity_status,created_at,updated_at,version) VALUES
        ('dep-sb-v2','workspace','script-v2','storyboard-v2','GENERATED_FROM','CURRENT','t3','t3',1),
        ('dep-cb-v2','workspace','critique-v2','storyboard-v2','INFORMED_BY','CURRENT','t3','t3',1);
    `);
    await expect(
      evaluateEditorialProductionReadiness(d1, actor, 'project', 'BEFORE_PREFLIGHT'),
    ).resolves.toMatchObject({ ready: true, blockers: [] });
    expect(
      database
        .prepare("SELECT COUNT(*) count FROM editorial_artifact_versions WHERE id='storyboard-v1'")
        .get(),
    ).toEqual({ count: 1 });
  });

  it('fails closed with a controlled schema capability error on schema 0011 before persistence', async () => {
    const { database, d1 } = fixture(true, false);
    const before = {
      artifacts: count(database, 'editorial_artifacts'),
      versions: count(database, 'editorial_artifact_versions'),
      runs: count(database, 'intelligence_runs'),
      attempts: count(database, 'intelligence_run_attempts'),
      reservations: count(database, 'editorial_execution_reservations'),
      approvals: count(database, 'artifact_approvals'),
      audits: count(database, 'audit_events'),
    };
    await expect(
      evaluateEditorialProductionReadiness(d1, actor, 'project', 'BEFORE_PRODUCTION_SCRIPT'),
    ).rejects.toThrow('editorial_revision_schema_unavailable');
    await expect(service(d1).request('storyboard-v1', 'schema-0011-key', command)).rejects.toThrow(
      'editorial_revision_schema_unavailable',
    );
    await expect(
      new EditorialRepository(d1, actor).approve('script-v1', 'APPROVED', null),
    ).rejects.toThrow('editorial_revision_schema_unavailable');
    await expect(
      new DeterministicPreflightService(d1, actor, 'request', 'test').calculate('project'),
    ).rejects.toThrow('editorial_revision_schema_unavailable');
    const execution = new EditorialExecutionService(d1, actor, {
      openAIEnabled: false,
      openAIBaseUrl: 'https://example.invalid',
    });
    await expect(
      execution.execute(
        'project',
        'SCRIPT_WRITER_SHORT',
        {
          mode: 'LOCKED',
          inputArtifactVersionId: 'brief-v1',
          creativeRegeneration: false,
        },
        'schema-0011-execution',
      ),
    ).rejects.toThrow('editorial_revision_schema_unavailable');
    expect({
      artifacts: count(database, 'editorial_artifacts'),
      versions: count(database, 'editorial_artifact_versions'),
      runs: count(database, 'intelligence_runs'),
      attempts: count(database, 'intelligence_run_attempts'),
      reservations: count(database, 'editorial_execution_reservations'),
      approvals: count(database, 'artifact_approvals'),
      audits: count(database, 'audit_events'),
    }).toEqual(before);
  });

  it('collapses concurrent conflicting commands without duplicate request or audit', async () => {
    const { database, d1 } = fixture();
    const results = await Promise.allSettled([
      service(d1).request('storyboard-v1', 'conflicting-key', command),
      service(d1).request('storyboard-v1', 'conflicting-key', {
        ...command,
        reasonCode: 'STORYBOARD_REVISION_REQUIRED',
      }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(count(database, 'editorial_revision_requests')).toBe(1);
    expect(
      database
        .prepare(
          "SELECT COUNT(*) count FROM audit_events WHERE action='editorial.revision_requested'",
        )
        .get(),
    ).toEqual({ count: 1 });
  });
});

describe('BLOCK 9BZ revision resolution lineage', () => {
  it('rejects an approved replacement Storyboard until the full revised current chain is linked', async () => {
    const { database, d1 } = fixture(true);
    const request = await service(d1).request('storyboard-v1', 'lineage-request-key', command);
    database.exec(`
      INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,parent_version_id,language_code,content_text,source_type,content_hash,created_at,created_by) VALUES
        ('research-v2','workspace','research',2,'research-v1','de','new research','HUMAN_EDITED','${'d'.repeat(64)}','t2','owner'),
        ('storyboard-v2','workspace','storyboard',2,'storyboard-v1','de','replacement storyboard','HUMAN_EDITED','${'e'.repeat(64)}','t2','owner');
      UPDATE editorial_artifacts SET current_version_id='research-v2',status='approved',version=3 WHERE id='research';
      UPDATE editorial_artifacts SET current_version_id='storyboard-v2',status='approved',version=3 WHERE id='storyboard';
      INSERT INTO artifact_approvals(id,workspace_id,artifact_version_id,decision,actor_id,actor_role,decided_at) VALUES
        ('approve-research-v2','workspace','research-v2','APPROVED','owner','owner','t2'),
        ('approve-storyboard-v2','workspace','storyboard-v2','APPROVED','owner','owner','t2');
      INSERT INTO research_sources(id,workspace_id,research_version_id,source_type,title,source_reference,verification_status,created_at,created_by)
        VALUES('source-v2','workspace','research-v2','ARCHIVE','New source','new-reference','owner_approved','t2','owner');
      INSERT INTO research_claims(id,workspace_id,research_version_id,source_id,claim_text,evidence_class,created_at,created_by)
        VALUES('claim-v2','workspace','research-v2','source-v2','Resolved evidence','OBSERVED','t2','owner');
    `);
    await expect(
      service(d1).resolve(String(request.id), 'lineage-resolution-key', {
        resolutionArtifactVersionId: 'storyboard-v2',
      }),
    ).rejects.toThrow('revision_request_not_resolved');
    expect(count(database, 'editorial_revision_request_resolutions')).toBe(0);
    expect(
      database
        .prepare(
          "SELECT COUNT(*) count FROM audit_events WHERE action='editorial.revision_request_resolved'",
        )
        .get(),
    ).toEqual({ count: 0 });
  });
});
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

class FailingRevisionD1 extends AtomicD1 {
  override prepare(sql: string) {
    if (sql.includes('FROM editorial_revision_requests WHERE workspace_id=? AND idempotency_key=?'))
      throw new Error(
        'SQLITE_CONSTRAINT: no such table editorial_revision_requests at C:\\unsafe\\database.sql',
      );
    return super.prepare(sql);
  }
}

describe('BLOCK 9CB revision route validation and error safety', () => {
  it('accepts bounded valid route IDs and rejects malformed or oversized IDs before mutation', async () => {
    const valid = fixture();
    const created = await revisionPost(
      valid.d1,
      '/api/v1/editorial-artifact-versions/storyboard-v1/request-revision',
      command,
    );
    expect(created.status).toBe(201);

    const validRequest = fixture();
    const notFound = await revisionPost(
      validRequest.d1,
      '/api/v1/editorial-revision-requests/revision_request_missing/resolve',
      { resolutionArtifactVersionId: 'storyboard-v2' },
    );
    expect(notFound.status).toBe(404);

    for (const id of ['storyboard.v1', 'x'.repeat(101)]) {
      const invalid = fixture();
      const response = await revisionPost(
        invalid.d1,
        `/api/v1/editorial-artifact-versions/${id}/request-revision`,
        command,
      );
      expect(response.status).toBe(422);
      expect(count(invalid.database, 'editorial_revision_requests')).toBe(0);
    }
    const invalidResolution = fixture();
    const response = await revisionPost(
      invalidResolution.d1,
      `/api/v1/editorial-revision-requests/${'r'.repeat(101)}/resolve`,
      { resolutionArtifactVersionId: 'storyboard-v2' },
    );
    expect(response.status).toBe(422);
    expect(count(invalidResolution.database, 'editorial_revision_request_resolutions')).toBe(0);
  });

  it('preserves controlled domain details and redacts unexpected database errors', async () => {
    const domain = fixture();
    const controlled = await revisionPost(
      domain.d1,
      '/api/v1/editorial-revision-requests/revision_request_missing/resolve',
      { resolutionArtifactVersionId: 'storyboard-v2' },
    );
    expect(await controlled.json()).toMatchObject({
      status: 404,
      detail: 'revision_request_not_found',
    });

    const failed = fixture();
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = await revisionPost(
      new FailingRevisionD1(failed.database) as unknown as D1Database,
      '/api/v1/editorial-artifact-versions/storyboard-v1/request-revision',
      command,
      'unexpected-error-key',
    );
    expect(response.status).toBe(500);
    const serialized = JSON.stringify(await response.json());
    expect(serialized).toContain('The request could not be completed.');
    expect(serialized).not.toMatch(
      /SQLite|SQLITE_|no such table|constraint|editorial_revision_requests|CREATE TABLE|trigger|unsafe\\database/u,
    );
    expect(JSON.stringify(log.mock.calls)).not.toMatch(
      /SQLITE_|no such table|editorial_revision_requests|unsafe\\database/u,
    );
    expect(count(failed.database, 'editorial_revision_requests')).toBe(0);
    expect(
      failed.database
        .prepare(
          "SELECT COUNT(*) count FROM audit_events WHERE action='editorial.revision_requested'",
        )
        .get(),
    ).toEqual({ count: 0 });
    log.mockRestore();
  });
});
