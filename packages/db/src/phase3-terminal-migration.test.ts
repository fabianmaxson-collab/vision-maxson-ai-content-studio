import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

const migrationFiles = [
  '../migrations/0000_phase_1_data_security_core.sql',
  '../migrations/0001_phase_2_product_channel_monetization.sql',
  '../migrations/0002_phase_3_editorial_intelligence.sql',
  '../migrations/0003_editorial_execution_budgets.sql',
] as const;
const migration0004 = readFileSync(
  new URL('../migrations/0004_terminal_pipeline_hardening.sql', import.meta.url),
  'utf8',
);
const migration0005 = readFileSync(
  new URL('../migrations/0005_deterministic_preflight_provenance.sql', import.meta.url),
  'utf8',
);
function databaseThrough0003() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  for (const file of migrationFiles) db.exec(readFileSync(new URL(file, import.meta.url), 'utf8'));
  return db;
}
function seedFoundation(db: DatabaseSync) {
  db.exec(`
    INSERT INTO workspaces(id,slug,name,created_at,updated_at,version) VALUES('w1','w1','Workspace','now','now',1);
    INSERT INTO users(id,workspace_id,email,status,created_at,updated_at,version) VALUES('u1','w1','owner@example.test','active','now','now',1);
    INSERT INTO content_brands(id,workspace_id,name,normalized_name,primary_language,created_at,updated_at,version) VALUES('b1','w1','Brand','brand','de','now','now',1);
    INSERT INTO channel_profiles(id,workspace_id,content_brand_id,name,normalized_name,primary_language,created_at,updated_at,version) VALUES('c1','w1','b1','Channel','channel','de','now','now',1);
    INSERT INTO projects(id,workspace_id,content_brand_id,channel_profile_id,title,format,operating_mode,primary_language,created_at,updated_at,version) VALUES('p1','w1','b1','c1','Tim','SHORT','ASSISTED','de','now','now',1);
    INSERT INTO ai_providers(id,key,display_name,status,adapter_version,created_at,updated_at,version) VALUES('provider_openai','openai','OpenAI','configured','v1','now','now',1);
    INSERT INTO ai_provider_models(id,provider_id,model_key,display_name,status,capabilities_json,effective_from,created_at,updated_at,version) VALUES('model_luna','provider_openai','gpt-5.6-luna','Luna','available','{}','now','now','now',1);
    INSERT INTO ai_pricing_snapshots(id,provider_model_id,currency,input_unit_price,output_unit_price,unit_name,verification_status,effective_from,created_at) VALUES('price1','model_luna','USD',0.0000001,0.0000002,'token','externally_verified','now','now');
  `);
}
function seedGermanHistory(db: DatabaseSync) {
  seedFoundation(db);
  db.exec(`
    INSERT INTO intelligence_runs(id,workspace_id,project_id,task_type,provider_id,provider_model_id,initiated_by,operating_mode,status,idempotency_key,creative_regeneration_number,safe_metadata_json,created_at,updated_at,version)
      VALUES('intelligence_run_adba3aca-dcc7-4ec1-820b-af11a3137ef5','w1','p1','SCRIPT_WRITER_SHORT','provider_openai','model_luna','u1','ASSISTED','SUCCEEDED','script-key',0,'{}','t1','t2',2);
    INSERT INTO intelligence_runs(id,workspace_id,project_id,task_type,provider_id,provider_model_id,initiated_by,operating_mode,status,idempotency_key,creative_regeneration_number,safe_metadata_json,created_at,updated_at,version)
      VALUES('intelligence_run_b7a8e977-dc46-45a6-86bf-e5fce828fe28','w1','p1','REVIEW_TRANSLATION_ES','provider_openai','model_luna','u1','ASSISTED','SUCCEEDED','review-key',0,'{}','t3','t4',2);
    INSERT INTO audit_events(id,workspace_id,actor_type,actor_id,actor_role,action,resource_type,resource_id,outcome,request_id,environment,metadata_json,occurred_at,ingested_at)
      VALUES('audit_script','w1','user','u1','owner','intelligence.run_completed','intelligence_run','intelligence_run_adba3aca-dcc7-4ec1-820b-af11a3137ef5','success','req1','staging','{}','t2','t2');
    INSERT INTO audit_events(id,workspace_id,actor_type,actor_id,actor_role,action,resource_type,resource_id,outcome,request_id,environment,metadata_json,occurred_at,ingested_at)
      VALUES('audit_review','w1','user','u1','owner','intelligence.run_completed','intelligence_run','intelligence_run_b7a8e977-dc46-45a6-86bf-e5fce828fe28','success','req2','staging','{}','t4','t4');
    INSERT INTO editorial_artifacts(id,workspace_id,project_id,artifact_type,current_version_id,status,created_at,updated_at,version,created_by,updated_by)
      VALUES('artifact_152509d0-5614-4e40-97cc-8aac437418b8','w1','p1','CONTENT_BRIEF','artifact_version_170405f4-872c-41ef-89fb-1e722a50945d','approved','t0','t0',1,'u1','u1');
    INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,language_code,content_text,source_type,content_hash,created_at,created_by)
      VALUES('artifact_version_170405f4-872c-41ef-89fb-1e722a50945d','w1','artifact_152509d0-5614-4e40-97cc-8aac437418b8',1,'de','Brief','HUMAN_EDITED','70235f5136ee40a10a86fd22f8fb62ce6675980f93e00304ad16e0ebcb3b0cc4','t0','u1');
    INSERT INTO editorial_artifacts(id,workspace_id,project_id,artifact_type,current_version_id,status,created_at,updated_at,version,created_by,updated_by)
      VALUES('artifact_9df7a892-4320-4e0c-b492-c36727d9dfda','w1','p1','PRODUCTION_SCRIPT','artifact_version_363bbd43-2cdc-4ead-a80c-d6f935a5b97c','approved','t1','t2',1,'u1','u1');
    INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,language_code,content_text,source_type,intelligence_run_id,content_hash,created_at,created_by)
      VALUES('artifact_version_363bbd43-2cdc-4ead-a80c-d6f935a5b97c','w1','artifact_9df7a892-4320-4e0c-b492-c36727d9dfda',1,'de','German script','AI_GENERATED','intelligence_run_adba3aca-dcc7-4ec1-820b-af11a3137ef5','ad9d85becf44f57cf8ee3c99d88e79e29917fabe569cd7cb0b90946db17578d8','t1','u1');
    INSERT INTO editorial_artifacts(id,workspace_id,project_id,artifact_type,current_version_id,status,created_at,updated_at,version,created_by,updated_by)
      VALUES('artifact_6321ea0f-211c-46db-bd9e-49f6d305d989','w1','p1','REVIEW_TRANSLATION','artifact_version_21166ee6-e640-4f99-a066-c3d0962e01f0','active','t3','t4',1,'u1','u1');
    INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,language_code,content_text,source_type,intelligence_run_id,content_hash,source_script_version_id,created_at,created_by)
      VALUES('artifact_version_21166ee6-e640-4f99-a066-c3d0962e01f0','w1','artifact_6321ea0f-211c-46db-bd9e-49f6d305d989',1,'es','Spanish review','AI_GENERATED','intelligence_run_b7a8e977-dc46-45a6-86bf-e5fce828fe28','8ed0953eccd1bbb4a3a921f11e888f41e4999edf2cfec222570d82e33255ba5c','artifact_version_363bbd43-2cdc-4ead-a80c-d6f935a5b97c','t3','u1');
    INSERT INTO artifact_approvals(id,workspace_id,artifact_version_id,decision,actor_id,actor_role,decided_at) VALUES
      ('approval_brief','w1','artifact_version_170405f4-872c-41ef-89fb-1e722a50945d','APPROVED','u1','owner','t0'),
      ('approval_script','w1','artifact_version_363bbd43-2cdc-4ead-a80c-d6f935a5b97c','APPROVED','u1','owner','t2');
    INSERT INTO artifact_dependencies(id,workspace_id,source_artifact_version_id,dependent_artifact_version_id,dependency_type,validity_status,created_at,updated_at,version) VALUES
      ('dependency_32850304-54a6-4822-aa30-c52bcc803ce3','w1','artifact_version_170405f4-872c-41ef-89fb-1e722a50945d','artifact_version_363bbd43-2cdc-4ead-a80c-d6f935a5b97c','GENERATED_FROM','CURRENT','t1','t2',1),
      ('dependency_518124ed-c9e0-4e1b-bf60-fe7f059488d6','w1','artifact_version_363bbd43-2cdc-4ead-a80c-d6f935a5b97c','artifact_version_21166ee6-e640-4f99-a066-c3d0962e01f0','GENERATED_FROM','CURRENT','t3','t4',1);
    INSERT INTO editorial_execution_envelopes(id,workspace_id,project_id,profile_key,profile_version,provider_id,provider_model_id,currency,monetary_ceiling_microusd,maximum_calls,status,authorized_by,created_at,updated_at,version)
      VALUES('execution_envelope_18b0f92c-43b1-4875-9fc4-915fcc095f78','w1','p1','phase3_short_de_review_es_v1',1,'provider_openai','model_luna','USD',7000,2,'ACTIVE','u1','t0','t4',1);
    INSERT INTO editorial_execution_reservations(id,envelope_id,workspace_id,project_id,intelligence_run_id,step_key,pricing_snapshot_id,reserved_microusd,actual_microusd,status,created_at,dispatched_at,reconciled_at)
      VALUES('reservation_script','execution_envelope_18b0f92c-43b1-4875-9fc4-915fcc095f78','w1','p1','intelligence_run_adba3aca-dcc7-4ec1-820b-af11a3137ef5','SCRIPT_WRITER_SHORT','price1',2970,620,'RECONCILED','t1','t1','t2');
    INSERT INTO editorial_execution_reservations(id,envelope_id,workspace_id,project_id,intelligence_run_id,step_key,pricing_snapshot_id,reserved_microusd,actual_microusd,status,created_at,dispatched_at,reconciled_at)
      VALUES('reservation_review','execution_envelope_18b0f92c-43b1-4875-9fc4-915fcc095f78','w1','p1','intelligence_run_b7a8e977-dc46-45a6-86bf-e5fce828fe28','REVIEW_TRANSLATION_ES','price1',3277,700,'RECONCILED','t3','t3','t4');
    UPDATE editorial_execution_envelopes SET status='CONSUMED',version=3 WHERE id='execution_envelope_18b0f92c-43b1-4875-9fc4-915fcc095f78';
  `);
  const insertSegment = db.prepare(
    `INSERT INTO script_segments(id,workspace_id,script_version_id,segment_order,content_text,content_hash,word_count,created_at) VALUES(?,'w1','artifact_version_363bbd43-2cdc-4ead-a80c-d6f935a5b97c',?,?,?,1,'t2')`,
  );
  for (let order = 1; order <= 9; order += 1)
    insertSegment.run(`segment_${order}`, order, `Segment ${order}`, String(order).repeat(64));
}

describe('migration 0004 terminal pipeline hardening', () => {
  it('replays migrations 0000 through 0004 from an empty database', () => {
    const db = databaseThrough0003();
    expect(() => db.exec(migration0004)).not.toThrow();
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {
      name: string;
    }[];
    expect(tables.map((row) => row.name)).toContain('editorial_project_execution_budgets');
  });

  it('preserves the exact German E2E envelope, reservations, outputs and audit linkage', () => {
    const db = databaseThrough0003();
    seedGermanHistory(db);
    const envelopeBefore = db
      .prepare("SELECT * FROM editorial_execution_envelopes WHERE id LIKE 'execution_envelope_%'")
      .get();
    const reservationsBefore = db
      .prepare('SELECT * FROM editorial_execution_reservations ORDER BY id')
      .all();
    const artifactHistoryBefore = db.prepare('SELECT * FROM editorial_artifacts ORDER BY id').all();
    const versionHistoryBefore = db
      .prepare('SELECT * FROM editorial_artifact_versions ORDER BY id')
      .all();
    const approvalsBefore = db.prepare('SELECT * FROM artifact_approvals ORDER BY id').all();
    const dependenciesBefore = db.prepare('SELECT * FROM artifact_dependencies ORDER BY id').all();
    const segmentsBefore = db.prepare('SELECT * FROM script_segments ORDER BY segment_order').all();
    db.exec(migration0004);
    db.exec('BEGIN');
    db.exec(migration0005);
    db.exec('COMMIT');
    expect(db.prepare('SELECT * FROM editorial_artifacts ORDER BY id').all()).toEqual(
      artifactHistoryBefore,
    );
    expect(db.prepare('SELECT * FROM editorial_artifact_versions ORDER BY id').all()).toEqual(
      versionHistoryBefore,
    );
    expect(db.prepare('SELECT * FROM artifact_approvals ORDER BY id').all()).toEqual(
      approvalsBefore,
    );
    expect(db.prepare('SELECT * FROM artifact_dependencies ORDER BY id').all()).toEqual(
      dependenciesBefore,
    );
    expect(db.prepare('SELECT * FROM script_segments ORDER BY segment_order').all()).toEqual(
      segmentsBefore,
    );
    const envelope = db
      .prepare(
        "SELECT * FROM editorial_execution_envelopes WHERE id='execution_envelope_18b0f92c-43b1-4875-9fc4-915fcc095f78'",
      )
      .get() as Record<string, unknown>;
    expect({ ...envelope, project_execution_budget_id: undefined, stage_key: undefined }).toEqual({
      ...(envelopeBefore as Record<string, unknown>),
      project_execution_budget_id: undefined,
      stage_key: undefined,
    });
    expect(envelope.project_execution_budget_id).toBeNull();
    expect(envelope.stage_key).toBeNull();
    const reservations = db
      .prepare('SELECT * FROM editorial_execution_reservations ORDER BY id')
      .all() as Record<string, unknown>[];
    expect(reservations).toHaveLength(2);
    expect(
      reservations.map((row) => {
        const copy = { ...row };
        delete copy.project_execution_budget_id;
        return copy;
      }),
    ).toEqual(reservationsBefore);
    expect(reservations.every((row) => row.project_execution_budget_id === null)).toBe(true);
    expect(
      db
        .prepare(
          "SELECT terminal_audit_event_id FROM intelligence_runs WHERE id='intelligence_run_adba3aca-dcc7-4ec1-820b-af11a3137ef5'",
        )
        .get(),
    ).toEqual({ terminal_audit_event_id: 'audit_script' });
    expect(
      db
        .prepare(
          "SELECT content_text FROM editorial_artifact_versions WHERE id='artifact_version_363bbd43-2cdc-4ead-a80c-d6f935a5b97c'",
        )
        .get(),
    ).toEqual({ content_text: 'German script' });
    expect(
      db
        .prepare(
          "SELECT content_text FROM editorial_artifact_versions WHERE id='artifact_version_21166ee6-e640-4f99-a066-c3d0962e01f0'",
        )
        .get(),
    ).toEqual({ content_text: 'Spanish review' });
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('preserves exactly the historical maximum_calls domain', () => {
    expect(migration0004).toContain('maximum_calls=2');
    expect(migration0004).toContain('maximum_calls=1');
    expect(migration0004).not.toMatch(/PREFLIGHT_ANALYSIS/);
  });

  it.each([
    [
      'duplicate singleton',
      "INSERT INTO editorial_artifacts(id,workspace_id,project_id,artifact_type,status,created_at,updated_at,version) VALUES('a1','w1','p1','RESEARCH','active','now','now',1),('a2','w1','p1','RESEARCH','active','now','now',1)",
      'migration_0004_duplicate_singleton',
    ],
    [
      'duplicate selected idea',
      "INSERT INTO editorial_artifacts(id,workspace_id,project_id,artifact_type,status,created_at,updated_at,version) VALUES('ia1','w1','p1','IDEA_CANDIDATE','active','now','now',1),('ia2','w1','p1','IDEA_CANDIDATE','active','now','now',1); INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,language_code,content_text,source_type,content_hash,created_at,created_by) VALUES('iv1','w1','ia1',1,'de','a','HUMAN_EDITED','cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc','now','u1'),('iv2','w1','ia2',1,'de','b','HUMAN_EDITED','dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd','now','u1'); INSERT INTO idea_candidates(id,workspace_id,project_id,artifact_id,artifact_version_id,title,target_format,status,evidence_class,created_at,updated_at,version,created_by,updated_by) VALUES('i1','w1','p1','ia1','iv1','one','SHORT','SELECTED','UNKNOWN','now','now',1,'u1','u1'),('i2','w1','p1','ia2','iv2','two','SHORT','SELECTED','UNKNOWN','now','now',1,'u1','u1')",
      'migration_0004_duplicate_selected_idea',
    ],
  ])('fires preflight and fails before rebuild for %s', (_name, badSql, expected) => {
    const db = databaseThrough0003();
    seedFoundation(db);
    db.exec(badSql);
    expect(() => db.exec(migration0004)).toThrow(new RegExp(expected));
    expect(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='editorial_project_execution_budgets'",
        )
        .get(),
    ).toBeUndefined();
    expect(db.prepare('SELECT COUNT(*) AS count FROM editorial_execution_envelopes').get()).toEqual(
      { count: 0 },
    );
  });
});
