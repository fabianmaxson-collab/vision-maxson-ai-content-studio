import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
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
  readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8');
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
  return database;
}

function request(db: DatabaseSync) {
  db.exec(
    "INSERT INTO audit_events(id,workspace_id,actor_type,actor_id,actor_role,action,resource_type,resource_id,outcome,request_id,environment,metadata_json,occurred_at,ingested_at) VALUES('request-audit','workspace','user','owner','owner','editorial.revision_requested','editorial_revision_request','request','success','http','test','{}','t','t');",
  );
  db.prepare(
    "INSERT INTO editorial_revision_requests(id,workspace_id,project_id,reviewed_artifact_id,reviewed_artifact_version_id,reviewed_artifact_revision,target_stage,target_baseline_version_id,reason_code,status,actor_id,actor_role,idempotency_key,command_hash,audit_event_id,created_at) VALUES('request','workspace','project','storyboard','storyboard-v1',2,'RESEARCH','research-v1','UNRESOLVED_CENTRAL_EVENT','OPEN','owner','owner','request-key',?,'request-audit','t')",
  ).run('a'.repeat(64));
}
const result = {
  receiptId: 'receipt',
  revisionRequestId: 'request',
  projectId: 'project',
  researchArtifactId: 'research',
  parentVersionId: 'research-v1',
  versionId: 'research-v2',
  versionNumber: 2,
  contentHash: 'b'.repeat(64),
  auditEventId: 'import-audit',
};
const metadata = {
  workspaceId: 'workspace',
  revisionRequestId: 'request',
  projectId: 'project',
  researchArtifactId: 'research',
  parentVersionId: 'research-v1',
  newVersionId: 'research-v2',
  targetStage: 'RESEARCH',
  reasonCode: 'UNRESOLVED_CENTRAL_EVENT',
};
function ready(meta: unknown = metadata, actorId = 'owner', role = 'owner') {
  const db = fixture();
  request(db);
  db.prepare(
    "INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,parent_version_id,language_code,content_text,source_type,content_hash,created_at,created_by) VALUES('research-v2','workspace','research',2,'research-v1','de','Imported','IMPORTED',?,'t2','owner')",
  ).run(result.contentHash);
  db.exec(
    "UPDATE editorial_artifacts SET current_version_id='research-v2',status='active',version=3 WHERE id='research'",
  );
  db.prepare(
    "INSERT INTO audit_events(id,workspace_id,actor_type,actor_id,actor_role,action,resource_type,resource_id,outcome,request_id,environment,metadata_json,occurred_at,ingested_at) VALUES('import-audit','workspace','user',?,?,'editorial.research_revision_imported','editorial_revision_request','request','success','http','test',?,'t','t')",
  ).run(actorId, role, JSON.stringify(meta));
  return db;
}
function receipt(db: DatabaseSync, value: unknown = result) {
  return db
    .prepare(
      "INSERT INTO editorial_research_revision_imports(id,workspace_id,project_id,revision_request_id,research_artifact_id,parent_research_version_id,new_research_version_id,expected_artifact_revision,actor_id,actor_role,audit_event_id,idempotency_key,command_hash,result_json,environment,created_at) VALUES('receipt','workspace','project','request','research','research-v1','research-v2',2,'owner','owner','import-audit','import-key',?,?,'test','t')",
    )
    .run('c'.repeat(64), JSON.stringify(value));
}
describe('migration 0013 receipt and audit guarantees', () => {
  it('fresh 0000–0013 replay accepts a fully correlated receipt and enforces append-only uniqueness', () => {
    const db = ready();
    receipt(db);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(() => receipt(db)).toThrow();
    expect(() =>
      db.exec("UPDATE editorial_research_revision_imports SET result_json='{}'"),
    ).toThrow('append-only');
    expect(() => db.exec('DELETE FROM editorial_research_revision_imports')).toThrow('append-only');
  });
  it('true 0012 upgrade preserves every historical table including approvals, versions, dependencies and OPEN request', () => {
    const db = fixture(true, true, 12);
    request(db);
    const names = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()
      .map((r) => String(r.name));
    const before = Object.fromEntries(
      names.map((n) => [n, db.prepare('SELECT * FROM "' + n + '"').all()]),
    );
    expect(
      db
        .prepare(
          "SELECT count(*) count FROM sqlite_master WHERE name='editorial_revision_requests'",
        )
        .get(),
    ).toEqual({ count: 1 });
    expect(
      db
        .prepare(
          "SELECT count(*) count FROM sqlite_master WHERE name='editorial_research_revision_imports'",
        )
        .get(),
    ).toEqual({ count: 0 });
    db.exec(migration('0013_governed_imported_research_revision.sql'));
    for (const name of names)
      expect(db.prepare('SELECT * FROM "' + name + '"').all()).toEqual(before[name]);
    expect(
      db.prepare("SELECT status FROM editorial_revision_requests WHERE id='request'").get(),
    ).toEqual({ status: 'OPEN' });
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
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
    'extra',
  ])
    it('rejects result JSON ' + field, () => {
      const db = ready();
      const bad: Record<string, unknown> = { ...result };
      if (field === 'missing') delete bad.versionId;
      else if (field === 'versionNumber') bad[field] = 99;
      else bad[field] = field === 'contentHash' ? 'd'.repeat(64) : 'wrong';
      expect(() => receipt(db, field === 'empty' ? {} : bad)).toThrow(
        'research_revision_import_result_invalid',
      );
      expect(
        db.prepare('SELECT count(*) count FROM editorial_research_revision_imports').get(),
      ).toEqual({ count: 0 });
    });
  for (const field of ['empty', ...Object.keys(metadata)])
    it('rejects missing or mismatched audit metadata ' + field, () => {
      for (const missing of [false, true]) {
        const bad: Record<string, unknown> = { ...metadata };
        if (missing) delete bad[field];
        else bad[field] = 'wrong';
        const db = ready(field === 'empty' ? {} : bad);
        expect(() => receipt(db)).toThrow('research_revision_import_audit_invalid');
        expect(
          db.prepare('SELECT count(*) count FROM editorial_research_revision_imports').get(),
        ).toEqual({ count: 0 });
      }
    });
  for (const [actor, role] of [
    ['viewer', 'owner'],
    ['owner', 'operator'],
  ])
    it('rejects mismatched audit actor/role ' + actor + '/' + role, () => {
      const db = ready(metadata, actor, role);
      expect(() => receipt(db)).toThrow('research_revision_import_audit_invalid');
    });
});
