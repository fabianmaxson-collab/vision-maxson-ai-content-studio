import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
const files = [
  '0000_phase_1_data_security_core.sql',
  '0001_phase_2_product_channel_monetization.sql',
  '0002_phase_3_editorial_intelligence.sql',
  '0003_editorial_execution_budgets.sql',
  '0004_terminal_pipeline_hardening.sql',
];
const sql = (name: string) =>
  readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8');
function base() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  for (const f of files) db.exec(sql(f));
  db.exec(`
 INSERT INTO workspaces(id,slug,name,created_at,updated_at,version) VALUES('w','w','W','t','t',1);
 INSERT INTO users(id,workspace_id,email,status,created_at,updated_at,version) VALUES('u','w','u@test','active','t','t',1);
 INSERT INTO content_brands(id,workspace_id,name,normalized_name,primary_language,created_at,updated_at,version) VALUES('b','w','B','b','de','t','t',1);
 INSERT INTO channel_profiles(id,workspace_id,content_brand_id,name,normalized_name,primary_language,created_at,updated_at,version) VALUES('c','w','b','C','c','de','t','t',1);
 INSERT INTO projects(id,workspace_id,content_brand_id,channel_profile_id,title,format,operating_mode,primary_language,created_at,updated_at,version) VALUES('p','w','b','c','P','SHORT','ASSISTED','de','t','t',1);
 INSERT INTO editorial_artifacts(id,workspace_id,project_id,artifact_type,status,created_at,updated_at,version,created_by,updated_by) VALUES('a','w','p','CONTENT_BRIEF','approved','t','t',1,'u','u');
 INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,language_code,content_text,source_type,content_hash,created_at,created_by) VALUES('v','w','a',1,'de','bytes','HUMAN_EDITED','${'a'.repeat(64)}','t','u');
 UPDATE editorial_artifacts SET current_version_id='v' WHERE id='a';
 INSERT INTO artifact_approvals(id,workspace_id,artifact_version_id,decision,actor_id,actor_role,decided_at) VALUES('ap','w','v','APPROVED','u','owner','t');
 `);
  return db;
}
describe('migration 0005 deterministic provenance', () => {
  it('preserves historical values and references without reinterpretation', () => {
    const db = base();
    const before = db.prepare('SELECT * FROM editorial_artifact_versions').get();
    db.exec(sql('0005_deterministic_preflight_provenance.sql'));
    expect(db.prepare('SELECT * FROM editorial_artifact_versions').get()).toEqual(before);
    expect(
      db.prepare("SELECT current_version_id FROM editorial_artifacts WHERE id='a'").get(),
    ).toEqual({ current_version_id: 'v' });
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
  it('accepts only truthful new deterministic provenance', () => {
    const db = base();
    db.exec(sql('0005_deterministic_preflight_provenance.sql'));
    expect(() =>
      db.exec(
        `INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,parent_version_id,language_code,content_text,source_type,intelligence_run_id,content_hash,created_at,created_by) VALUES('v2','w','a',2,'v','de','result','DETERMINISTIC',NULL,'${'b'.repeat(64)}','t','u')`,
      ),
    ).not.toThrow();
    expect(() =>
      db.exec(
        `INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,parent_version_id,language_code,content_text,source_type,intelligence_run_id,content_hash,created_at,created_by) VALUES('v3','w','a',3,'v2','de','bad','DETERMINISTIC','missing','${'c'.repeat(64)}','t','u')`,
      ),
    ).toThrow();
  });
  it('retains AI_GENERATED run requirement and HUMAN_EDITED/IMPORTED semantics', () => {
    const db = base();
    db.exec(sql('0005_deterministic_preflight_provenance.sql'));
    expect(() =>
      db.exec(
        `INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,parent_version_id,language_code,content_text,source_type,content_hash,created_at,created_by) VALUES('bad','w','a',2,'v','de','bad','AI_GENERATED','${'d'.repeat(64)}','t','u')`,
      ),
    ).toThrow();
    for (const [i, source] of ['HUMAN_EDITED', 'IMPORTED'].entries())
      expect(() =>
        db.exec(
          `INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,parent_version_id,language_code,content_text,source_type,content_hash,created_at,created_by) VALUES('ok${i}','w','a',${i + 2},'v','de','ok${i}','${source}','${String(i + 5).repeat(64)}','t','u')`,
        ),
      ).not.toThrow();
  });
});
