import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

const names = [
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
const sql = (name: string) =>
  readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8');
const hash = (name: string) => createHash('sha256').update(sql(name)).digest('hex');
function databaseThrough(lastIndex: number) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  names.slice(0, lastIndex + 1).forEach((name) => db.exec(sql(name)));
  return db;
}
function seedHistory(db: DatabaseSync) {
  db.exec(`
    INSERT INTO workspaces(id,slug,name,created_at,updated_at,version) VALUES('w','w','W','t','t',1),('foreign-w','foreign-w','Foreign','t','t',1);
    INSERT INTO users(id,workspace_id,email,status,created_at,updated_at,version) VALUES('u','w','u@test','active','t','t',1),('foreign-u','foreign-w','foreign@test','active','t','t',1);
    INSERT INTO user_roles(workspace_id,user_id,role_id,created_at,created_by) VALUES('w','u','role_owner','t','u'),('foreign-w','foreign-u','role_owner','t','foreign-u');
    INSERT INTO content_brands(id,workspace_id,name,normalized_name,primary_language,created_at,updated_at,version) VALUES('b','w','B','b','de','t','t',1);
    INSERT INTO channel_profiles(id,workspace_id,content_brand_id,name,normalized_name,primary_language,created_at,updated_at,version) VALUES('c','w','b','C','c','de','t','t',1);
    INSERT INTO projects(id,workspace_id,content_brand_id,channel_profile_id,title,format,operating_mode,primary_language,created_at,updated_at,version) VALUES('p','w','b','c','P','SHORT','ASSISTED','de','t','t',1);
    INSERT INTO editorial_artifacts(id,workspace_id,project_id,artifact_type,current_version_id,status,created_at,updated_at,version,created_by,updated_by) VALUES
      ('research','w','p','RESEARCH','research-v1','approved','t','t',2,'u','u'),
      ('storyboard','w','p','STORYBOARD','storyboard-v1','active','t','t',2,'u','u');
    INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,language_code,content_text,source_type,content_hash,created_at,created_by) VALUES
      ('research-v1','w','research',1,'de','research','HUMAN_EDITED','${'a'.repeat(64)}','t','u'),
      ('storyboard-v1','w','storyboard',1,'de','storyboard','HUMAN_EDITED','${'b'.repeat(64)}','t','u');
    INSERT INTO artifact_approvals(id,workspace_id,artifact_version_id,decision,actor_id,actor_role,decided_at) VALUES('research-approval','w','research-v1','APPROVED','u','owner','t');
  `);
}
function audit(db: DatabaseSync, id: string, action: string, resourceId: string, actorId = 'u') {
  db.prepare(
    `INSERT INTO audit_events(id,workspace_id,actor_type,actor_id,actor_role,action,resource_type,resource_id,outcome,request_id,environment,metadata_json,occurred_at,ingested_at)
     VALUES(?,'w','user',?,'owner',?,'editorial_revision_request',?,'success','request','test','{}','t','t')`,
  ).run(id, actorId, action, resourceId);
}

describe('migration 0012 governed editorial revision requests', () => {
  it('is additive, forward-only and leaves migrations 0000-0011 unchanged', () => {
    const before = Object.fromEntries(names.slice(0, -1).map((name) => [name, hash(name)]));
    const migration = sql(names.at(-1)!);
    expect(migration).not.toMatch(/^(?:DROP|ALTER|UPDATE|DELETE)\b/gmu);
    expect(migration).toContain('CREATE TABLE editorial_revision_requests');
    expect(migration).toContain('CREATE TABLE editorial_revision_request_resolutions');
    expect(migration).toContain("reason_code IN ('UNRESOLVED_CENTRAL_EVENT'");
    expect(migration).toContain("status TEXT DEFAULT 'OPEN' NOT NULL CHECK(status='OPEN')");
    expect(Object.fromEntries(names.slice(0, -1).map((name) => [name, hash(name)]))).toEqual(
      before,
    );
  });

  it('replays 0000-0012 with indexes, guards and clean foreign keys', () => {
    const db = databaseThrough(names.length - 1);
    expect(
      db
        .prepare(
          "SELECT COUNT(*) count FROM sqlite_master WHERE type='table' AND name IN ('editorial_revision_requests','editorial_revision_request_resolutions')",
        )
        .get(),
    ).toEqual({ count: 2 });
    expect(
      db
        .prepare(
          "SELECT COUNT(*) count FROM sqlite_master WHERE type='trigger' AND name GLOB 'editorial_revision_*'",
        )
        .get(),
    ).toEqual({ count: 13 });
    expect(
      db
        .prepare(
          `SELECT COUNT(*) count FROM sqlite_master WHERE type='index' AND name IN ('editorial_revision_requests_project_idx','editorial_revision_requests_reviewed_idx','editorial_revision_request_resolutions_project_idx')`,
        )
        .get(),
    ).toEqual({ count: 3 });
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('upgrades 0011 to 0012 without changing historical data', () => {
    const db = databaseThrough(names.length - 2);
    seedHistory(db);
    const tables = [
      'projects',
      'editorial_artifacts',
      'editorial_artifact_versions',
      'artifact_approvals',
    ];
    const before = Object.fromEntries(
      tables.map((table) => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]),
    );
    db.exec(sql(names.at(-1)!));
    for (const table of tables)
      expect(db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).toEqual(before[table]);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('enforces scope, idempotency, audit correlation and append-only history', () => {
    const db = databaseThrough(names.length - 2);
    seedHistory(db);
    db.exec(sql(names.at(-1)!));
    audit(db, 'audit-request', 'editorial.revision_requested', 'request-1');
    const insert = `INSERT INTO editorial_revision_requests(id,workspace_id,project_id,reviewed_artifact_id,reviewed_artifact_version_id,reviewed_artifact_revision,target_stage,target_baseline_version_id,reason_code,comment,status,actor_id,actor_role,idempotency_key,command_hash,audit_event_id,created_at)
      VALUES('request-1','w','p','storyboard','storyboard-v1',2,'RESEARCH','research-v1','UNRESOLVED_CENTRAL_EVENT','Needs evidence','OPEN','u','owner','key-1','${'c'.repeat(64)}','audit-request','t')`;
    expect(() => db.exec(insert)).not.toThrow();
    expect(() =>
      db.exec("UPDATE editorial_revision_requests SET comment='changed' WHERE id='request-1'"),
    ).toThrow(/append-only/u);
    expect(() => db.exec("DELETE FROM editorial_revision_requests WHERE id='request-1'")).toThrow(
      /append-only/u,
    );
    audit(db, 'audit-duplicate', 'editorial.revision_requested', 'request-2');
    expect(() =>
      db.exec(
        insert.replaceAll('request-1', 'request-2').replace('audit-request', 'audit-duplicate'),
      ),
    ).toThrow(/revision_request_already_open/u);
    audit(db, 'audit-downstream', 'editorial.revision_requested', 'request-downstream');
    expect(() =>
      db.exec(
        `INSERT INTO editorial_revision_requests(id,workspace_id,project_id,reviewed_artifact_id,reviewed_artifact_version_id,reviewed_artifact_revision,target_stage,target_baseline_version_id,reason_code,comment,status,actor_id,actor_role,idempotency_key,command_hash,audit_event_id,created_at)
         VALUES('request-downstream','w','p','research','research-v1',2,'STORYBOARD','storyboard-v1','EDITORIAL_DIRECTION_CHANGE',NULL,'OPEN','u','owner','key-downstream','${'d'.repeat(64)}','audit-downstream','t')`,
      ),
    ).toThrow(/revision_reviewed_artifact_type_unsupported/u);
    db.exec(`
      INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,parent_version_id,language_code,content_text,source_type,content_hash,created_at,created_by)
      VALUES('storyboard-v2','w','storyboard',2,'storyboard-v1','de','storyboard v2','HUMAN_EDITED','${'e'.repeat(64)}','t2','u');
      UPDATE editorial_artifacts SET current_version_id='storyboard-v2',status='approved',version=3 WHERE id='storyboard';
      INSERT INTO artifact_approvals(id,workspace_id,artifact_version_id,decision,actor_id,actor_role,decided_at)
        VALUES('storyboard-v2-approval','w','storyboard-v2','APPROVED','u','owner','t2');
    `);
    audit(db, 'audit-resolution', 'editorial.revision_request_resolved', 'request-1');
    db.exec(
      `INSERT INTO editorial_revision_request_resolutions(id,workspace_id,project_id,revision_request_id,status,resolution_artifact_version_id,resolution_evidence_json,resolved_by,idempotency_key,command_hash,audit_event_id,resolved_at)
       VALUES('resolution-1','w','p','request-1','RESOLVED','storyboard-v2','{}','u','resolution-key','${'f'.repeat(64)}','audit-resolution','t2')`,
    );
    expect(() =>
      db.exec(
        "UPDATE editorial_revision_request_resolutions SET resolved_at='changed' WHERE id='resolution-1'",
      ),
    ).toThrow(/append-only/u);
    expect(() =>
      db.exec("DELETE FROM editorial_revision_request_resolutions WHERE id='resolution-1'"),
    ).toThrow(/append-only/u);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
  it('enforces one open request and actor/resolver workspace scope at D1 level', () => {
    const db = databaseThrough(names.length - 2);
    seedHistory(db);
    db.exec(sql(names.at(-1)!));
    const request = (id: string, key: string, actorId: string, auditId: string) =>
      `INSERT INTO editorial_revision_requests(id,workspace_id,project_id,reviewed_artifact_id,reviewed_artifact_version_id,reviewed_artifact_revision,target_stage,target_baseline_version_id,reason_code,comment,status,actor_id,actor_role,idempotency_key,command_hash,audit_event_id,created_at)
       VALUES('${id}','w','p','storyboard','storyboard-v1',2,'RESEARCH','research-v1','UNRESOLVED_CENTRAL_EVENT',NULL,'OPEN','${actorId}','owner','${key}','${'3'.repeat(64)}','${auditId}','t')`;

    audit(db, 'audit-request', 'editorial.revision_requested', 'request-1');
    db.exec(request('request-1', 'key-1', 'u', 'audit-request'));
    audit(db, 'audit-second', 'editorial.revision_requested', 'request-2');
    expect(() => db.exec(request('request-2', 'key-2', 'u', 'audit-second'))).toThrow(
      /revision_request_already_open/u,
    );

    const foreignRequestDb = databaseThrough(names.length - 2);
    seedHistory(foreignRequestDb);
    foreignRequestDb.exec(sql(names.at(-1)!));
    audit(
      foreignRequestDb,
      'audit-foreign-request',
      'editorial.revision_requested',
      'foreign-request',
      'foreign-u',
    );
    expect(() =>
      foreignRequestDb.exec(
        request('foreign-request', 'foreign-key', 'foreign-u', 'audit-foreign-request'),
      ),
    ).toThrow(/revision_request_actor_scope_invalid/u);
    expect(
      foreignRequestDb.prepare('SELECT COUNT(*) count FROM editorial_revision_requests').get(),
    ).toEqual({ count: 0 });

    db.exec(`
      INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,parent_version_id,language_code,content_text,source_type,content_hash,created_at,created_by)
      VALUES('storyboard-v2','w','storyboard',2,'storyboard-v1','de','replacement','HUMAN_EDITED','${'4'.repeat(64)}','t2','u');
      UPDATE editorial_artifacts SET current_version_id='storyboard-v2',status='approved',version=3 WHERE id='storyboard';
      INSERT INTO artifact_approvals(id,workspace_id,artifact_version_id,decision,actor_id,actor_role,decided_at)
      VALUES('storyboard-v2-approval','w','storyboard-v2','APPROVED','u','owner','t2');
    `);
    audit(
      db,
      'audit-foreign-resolution',
      'editorial.revision_request_resolved',
      'request-1',
      'foreign-u',
    );
    expect(() =>
      db.exec(
        `INSERT INTO editorial_revision_request_resolutions(id,workspace_id,project_id,revision_request_id,status,resolution_artifact_version_id,resolution_evidence_json,resolved_by,idempotency_key,command_hash,audit_event_id,resolved_at)
         VALUES('foreign-resolution','w','p','request-1','RESOLVED','storyboard-v2','{}','foreign-u','resolution-key','${'5'.repeat(64)}','audit-foreign-resolution','t2')`,
      ),
    ).toThrow(/revision_request_resolver_scope_invalid/u);
    expect(
      db.prepare('SELECT COUNT(*) count FROM editorial_revision_request_resolutions').get(),
    ).toEqual({ count: 0 });
  });

  it('rejects NULL and cross-project baselines, unsupported reviewed types, and target mismatch', () => {
    const db = databaseThrough(names.length - 2);
    seedHistory(db);
    db.exec(sql(names.at(-1)!));
    const row = (
      id: string,
      reviewedArtifactId: string,
      reviewedVersionId: string,
      stage: string,
      baseline: string,
    ) =>
      `INSERT INTO editorial_revision_requests(id,workspace_id,project_id,reviewed_artifact_id,reviewed_artifact_version_id,reviewed_artifact_revision,target_stage,target_baseline_version_id,reason_code,comment,status,actor_id,actor_role,idempotency_key,command_hash,audit_event_id,created_at)
       VALUES('${id}','w','p','${reviewedArtifactId}','${reviewedVersionId}',2,'${stage}',${baseline},'UNRESOLVED_CENTRAL_EVENT',NULL,'OPEN','u','owner','${id}-key','${'1'.repeat(64)}','${id}-audit','t')`;

    audit(db, 'null-audit', 'editorial.revision_requested', 'null');
    expect(() => db.exec(row('null', 'storyboard', 'storyboard-v1', 'RESEARCH', 'NULL'))).toThrow(
      /NOT NULL constraint failed/u,
    );

    audit(db, 'unsupported-audit', 'editorial.revision_requested', 'unsupported');
    expect(() =>
      db.exec(row('unsupported', 'research', 'research-v1', 'RESEARCH', "'research-v1'")),
    ).toThrow(/revision_reviewed_artifact_type_unsupported/u);

    audit(db, 'mismatch-audit', 'editorial.revision_requested', 'mismatch');
    expect(() =>
      db.exec(row('mismatch', 'storyboard', 'storyboard-v1', 'STORYBOARD', "'research-v1'")),
    ).toThrow(/CHECK constraint failed/u);

    db.exec(`
      INSERT INTO projects(id,workspace_id,content_brand_id,channel_profile_id,title,format,operating_mode,primary_language,created_at,updated_at,version)
        VALUES('other-project','w','b','c','Other','SHORT','ASSISTED','de','t','t',1);
      INSERT INTO editorial_artifacts(id,workspace_id,project_id,artifact_type,current_version_id,status,created_at,updated_at,version,created_by,updated_by)
        VALUES('other-research','w','other-project','RESEARCH','other-research-v1','approved','t','t',2,'u','u');
      INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,language_code,content_text,source_type,content_hash,created_at,created_by)
        VALUES('other-research-v1','w','other-research',1,'de','other','HUMAN_EDITED','${'2'.repeat(64)}','t','u');
    `);
    audit(db, 'cross-audit', 'editorial.revision_requested', 'cross');
    expect(() =>
      db.exec(row('cross', 'storyboard', 'storyboard-v1', 'RESEARCH', "'other-research-v1'")),
    ).toThrow(/revision_request_baseline_invalid/u);
    expect(db.prepare('SELECT COUNT(*) count FROM editorial_revision_requests').get()).toEqual({
      count: 0,
    });
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
});
