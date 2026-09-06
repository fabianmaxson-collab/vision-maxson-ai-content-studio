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
function applyMigration0005(db: DatabaseSync) {
  db.exec('BEGIN');
  try {
    db.exec(sql('0005_deterministic_preflight_provenance.sql'));
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

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
  it('reproduces the retired rename-first failure at the old-table drop under runner transaction semantics', () => {
    const db = base();
    db.exec('BEGIN');
    try {
      db.exec(`
        PRAGMA foreign_keys=OFF;
        DROP TRIGGER editorial_versions_no_update;
        DROP TRIGGER editorial_versions_no_delete;
        PRAGMA legacy_alter_table=ON;
        ALTER TABLE editorial_artifact_versions RENAME TO _0005_editorial_artifact_versions_old;
        CREATE TABLE editorial_artifact_versions AS SELECT * FROM _0005_editorial_artifact_versions_old;
      `);
      expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
      expect(
        db
          .prepare(
            "SELECT [table] AS target FROM pragma_foreign_key_list('artifact_approvals') WHERE [from]='artifact_version_id'",
          )
          .get(),
      ).toEqual({ target: '_0005_editorial_artifact_versions_old' });
      expect(() => db.exec('DROP TABLE _0005_editorial_artifact_versions_old')).toThrow(
        /FOREIGN KEY constraint failed/u,
      );
    } finally {
      db.exec('ROLLBACK');
    }
  });
  it('preserves historical values and references without reinterpretation', () => {
    const db = base();
    const before = db.prepare('SELECT * FROM editorial_artifact_versions').get();
    applyMigration0005(db);
    expect(db.prepare('SELECT * FROM editorial_artifact_versions').get()).toEqual(before);
    expect(
      db.prepare("SELECT current_version_id FROM editorial_artifacts WHERE id='a'").get(),
    ).toEqual({ current_version_id: 'v' });
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
  it('preserves every direct and transitive incoming reference under runner transaction semantics', () => {
    const db = base();
    db.exec(`
      INSERT INTO editorial_artifacts(id,workspace_id,project_id,artifact_type,status,created_at,updated_at,version,created_by,updated_by) VALUES
        ('ar','w','p','RESEARCH','active','t','t',1,'u','u'),
        ('ai','w','p','IDEA_CANDIDATE','active','t','t',1,'u','u'),
        ('as','w','p','PRODUCTION_SCRIPT','active','t','t',1,'u','u'),
        ('ab','w','p','STORYBOARD','active','t','t',1,'u','u'),
        ('apf','w','p','PREFLIGHT','active','t','t',1,'u','u');
      INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,parent_version_id,language_code,content_text,source_type,content_hash,source_script_version_id,created_at,created_by) VALUES
        ('vr','w','ar',1,NULL,'de','research','IMPORTED','${'b'.repeat(64)}',NULL,'t','u'),
        ('vi','w','ai',1,NULL,'de','idea','HUMAN_EDITED','${'c'.repeat(64)}',NULL,'t','u'),
        ('vs','w','as',1,'v','de','script','HUMAN_EDITED','${'d'.repeat(64)}',NULL,'t','u'),
        ('vb','w','ab',1,NULL,'de','board','HUMAN_EDITED','${'e'.repeat(64)}','vs','t','u'),
        ('vpf','w','apf',1,NULL,'de','preflight','HUMAN_EDITED','${'f'.repeat(64)}',NULL,'t','u');
      UPDATE editorial_artifacts SET current_version_id=CASE id WHEN 'ar' THEN 'vr' WHEN 'ai' THEN 'vi' WHEN 'as' THEN 'vs' WHEN 'ab' THEN 'vb' WHEN 'apf' THEN 'vpf' ELSE current_version_id END;
      INSERT INTO artifact_dependencies(id,workspace_id,source_artifact_version_id,dependent_artifact_version_id,dependency_type,validity_status,invalidated_by_version_id,created_at,updated_at,version) VALUES('dep','w','v','vs','GENERATED_FROM','INVALIDATED','vi','t','t',2);
      INSERT INTO artifact_status_events(id,workspace_id,artifact_id,artifact_version_id,previous_status,next_status,reason,actor_id,occurred_at) VALUES('se','w','as','vs','draft','active','kept','u','t');
      INSERT INTO research_sources(id,workspace_id,research_version_id,source_type,title,source_reference,verification_status,created_at,created_by) VALUES('rs','w','vr','BOOK','Source','ref','owner_approved','t','u');
      INSERT INTO research_claims(id,workspace_id,research_version_id,source_id,claim_text,evidence_class,created_at,created_by) VALUES('rc','w','vr','rs','Claim','OBSERVED','t','u');
      INSERT INTO idea_candidates(id,workspace_id,project_id,artifact_id,artifact_version_id,title,target_format,status,evidence_class,created_at,updated_at,version,created_by,updated_by) VALUES('ic','w','p','ai','vi','Idea','SHORT','SELECTED','SOURCE_BACKED','t','t',1,'u','u');
      INSERT INTO idea_score_components(id,idea_candidate_id,dimension,score,confidence,evidence_class,explanation,created_at) VALUES('isc','ic','fit',90,0.9,'SOURCE_BACKED','kept','t');
      INSERT INTO script_segments(id,workspace_id,script_version_id,segment_order,content_text,content_hash,word_count,estimated_duration_seconds,created_at) VALUES('ss','w','vs',1,'Segment','${'1'.repeat(64)}',1,1.5,'t');
      INSERT INTO storyboard_scenes(id,workspace_id,storyboard_version_id,scene_order,visual_description,created_at) VALUES('sc','w','vb',1,'Scene','t');
      INSERT INTO scene_script_segments(workspace_id,storyboard_scene_id,script_segment_id,segment_order,created_at) VALUES('w','sc','ss',1,'t');
      INSERT INTO preflight_assessments(id,workspace_id,project_id,artifact_id,artifact_version_id,overall_result,generation_readiness,rule_set_version,assessed_at,assessed_by) VALUES('pa','w','p','apf','vpf','PASS','NOT_READY','rules-v1','t','u');
      INSERT INTO preflight_checks(id,preflight_assessment_id,check_key,result,explanation,evidence_json,created_at) VALUES('pc','pa','graph','PASS','kept','{}','t');
    `);
    const tables = [
      'editorial_artifacts',
      'editorial_artifact_versions',
      'artifact_dependencies',
      'artifact_approvals',
      'artifact_status_events',
      'research_sources',
      'research_claims',
      'idea_candidates',
      'idea_score_components',
      'script_segments',
      'storyboard_scenes',
      'scene_script_segments',
      'preflight_assessments',
      'preflight_checks',
    ];
    const before = Object.fromEntries(
      tables.map((table) => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]),
    );
    applyMigration0005(db);
    for (const table of tables)
      expect(db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).toEqual(before[table]);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE '_0005_%'").all()).toEqual(
      [],
    );
  });

  it('accepts only truthful new deterministic provenance', () => {
    const db = base();
    applyMigration0005(db);
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
    applyMigration0005(db);
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
