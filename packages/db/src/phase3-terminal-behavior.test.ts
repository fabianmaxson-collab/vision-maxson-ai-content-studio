import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';

const files = [
  '../migrations/0000_phase_1_data_security_core.sql',
  '../migrations/0001_phase_2_product_channel_monetization.sql',
  '../migrations/0002_phase_3_editorial_intelligence.sql',
  '../migrations/0003_editorial_execution_budgets.sql',
  '../migrations/0004_terminal_pipeline_hardening.sql',
] as const;
let db: DatabaseSync;
function foundation() {
  db.exec(`
    INSERT INTO workspaces(id,slug,name,created_at,updated_at,version) VALUES('w1','w1','Workspace','now','now',1),('w2','w2','Other','now','now',1);
    INSERT INTO users(id,workspace_id,email,status,created_at,updated_at,version) VALUES('u1','w1','owner@example.test','active','now','now',1);
    INSERT INTO content_brands(id,workspace_id,name,normalized_name,primary_language,created_at,updated_at,version) VALUES('b1','w1','Brand','brand','de','now','now',1);
    INSERT INTO channel_profiles(id,workspace_id,content_brand_id,name,normalized_name,primary_language,created_at,updated_at,version) VALUES('c1','w1','b1','Channel','channel','de','now','now',1);
    INSERT INTO projects(id,workspace_id,content_brand_id,channel_profile_id,title,format,operating_mode,primary_language,created_at,updated_at,version) VALUES('p1','w1','b1','c1','Project','SHORT','ASSISTED','de','now','now',1);
    INSERT INTO ai_providers(id,key,display_name,status,adapter_version,created_at,updated_at,version) VALUES('provider1','openai','OpenAI','configured','v1','now','now',1);
    INSERT INTO ai_provider_models(id,provider_id,model_key,display_name,status,capabilities_json,effective_from,created_at,updated_at,version) VALUES('model1','provider1','gpt-5.6-luna','Luna','available','{}','now','now','now',1);
    INSERT INTO ai_pricing_snapshots(id,provider_model_id,currency,input_unit_price,output_unit_price,unit_name,verification_status,effective_from,created_at) VALUES('price1','model1','USD',0.1,0.2,'token','externally_verified','now','now');
  `);
}
function run(id: string) {
  db.prepare(
    `INSERT INTO intelligence_runs(id,workspace_id,project_id,task_type,provider_id,provider_model_id,initiated_by,operating_mode,status,idempotency_key,creative_regeneration_number,safe_metadata_json,created_at,updated_at,version) VALUES(?,'w1','p1','SCRIPT_WRITER_SHORT','provider1','model1','u1','ASSISTED','QUEUED',?,0,'{}','now','now',1)`,
  ).run(id, `key-${id}`);
}
function budget(id = 'budget1', ceiling = 7000) {
  db.prepare(
    `INSERT INTO editorial_project_execution_budgets(id,workspace_id,project_id,profile_key,profile_version,currency,monetary_ceiling_microusd,status,authorized_by,created_at,updated_at,version) VALUES(?,'w1','p1','terminal',1,'USD',?,'ACTIVE','u1','now','now',1)`,
  ).run(id, ceiling);
}
function envelope(id: string, stage: string, ceiling = 5000) {
  db.prepare(
    `INSERT INTO editorial_execution_envelopes(id,workspace_id,project_id,profile_key,profile_version,provider_id,provider_model_id,currency,monetary_ceiling_microusd,maximum_calls,status,authorized_by,created_at,updated_at,version,project_execution_budget_id,stage_key) VALUES(?,'w1','p1','terminal',1,'provider1','model1','USD',?,1,'ACTIVE','u1','now','now',1,'budget1',?)`,
  ).run(id, ceiling, stage);
}
function reserve(id: string, envelopeId: string, runId: string, step: string, amount: number) {
  db.prepare(
    `INSERT INTO editorial_execution_reservations(id,envelope_id,workspace_id,project_id,intelligence_run_id,step_key,pricing_snapshot_id,reserved_microusd,status,created_at,project_execution_budget_id) VALUES(?,?,'w1','p1',?,?,'price1',?,'RESERVED','now','budget1')`,
  ).run(id, envelopeId, runId, step, amount);
}

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  for (const file of files) db.exec(readFileSync(new URL(file, import.meta.url), 'utf8'));
  foundation();
});

describe('migration 0004 governed budget behavior', () => {
  it('rejects mixed linkage and preserves only historical maximum_calls=2', () => {
    const base = `INSERT INTO editorial_execution_envelopes(id,workspace_id,project_id,profile_key,profile_version,provider_id,provider_model_id,currency,monetary_ceiling_microusd,maximum_calls,status,authorized_by,created_at,updated_at,version,project_execution_budget_id,stage_key) VALUES`;
    expect(() =>
      db.exec(
        base +
          `('bad1','w1','p1','x',1,'provider1','model1','USD',1000,2,'ACTIVE','u1','now','now',1,NULL,'SCRIPT_WRITER_SHORT')`,
      ),
    ).toThrow(/CHECK constraint/u);
    expect(() =>
      db.exec(
        base +
          `('bad2','w1','p1','x',1,'provider1','model1','USD',1000,1,'ACTIVE','u1','now','now',1,NULL,NULL)`,
      ),
    ).toThrow(/CHECK constraint/u);
    expect(() =>
      db.exec(
        base +
          `('bad3','w1','p1','x',1,'provider1','model1','USD',1000,3,'ACTIVE','u1','now','now',1,NULL,NULL)`,
      ),
    ).toThrow(/CHECK constraint/u);
    expect(() =>
      db.exec(
        base +
          `('legacy','w1','p1','x',1,'provider1','model1','USD',1000,2,'ACTIVE','u1','now','now',1,NULL,NULL)`,
      ),
    ).not.toThrow();
  });

  it('requires governed envelopes to match an active project budget and one call', () => {
    budget();
    envelope('e1', 'SCRIPT_WRITER_SHORT');
    expect(() => envelope('e2', 'SCRIPT_WRITER_SHORT')).toThrow(/UNIQUE constraint/u);
    expect(() =>
      db.exec(
        `INSERT INTO editorial_execution_envelopes(id,workspace_id,project_id,profile_key,profile_version,provider_id,provider_model_id,currency,monetary_ceiling_microusd,maximum_calls,status,authorized_by,created_at,updated_at,version,project_execution_budget_id,stage_key) VALUES('e3','w1','p1','terminal',1,'provider1','model1','USD',1000,2,'ACTIVE','u1','now','now',1,'budget1','IDEA_GENERATION')`,
      ),
    ).toThrow(/CHECK constraint/u);
  });

  it('uses actual reconciled cost without double counting reserved cost', () => {
    budget();
    envelope('e1', 'SCRIPT_WRITER_SHORT', 5000);
    envelope('e2', 'REVIEW_TRANSLATION_ES', 4000);
    run('run1');
    run('run2');
    reserve('r1', 'e1', 'run1', 'SCRIPT_WRITER_SHORT', 5000);
    db.exec(
      `UPDATE editorial_execution_reservations SET status='DISPATCHED',dispatched_at='t' WHERE id='r1'; UPDATE editorial_execution_reservations SET status='RECONCILED',actual_microusd=1200,reconciled_at='t' WHERE id='r1'`,
    );
    expect(() => reserve('r2', 'e2', 'run2', 'REVIEW_TRANSLATION_ES', 3000)).not.toThrow();
  });

  it('rejects aggregate global oversubscription across stages', () => {
    budget();
    envelope('e1', 'SCRIPT_WRITER_SHORT', 5000);
    envelope('e2', 'REVIEW_TRANSLATION_ES', 5000);
    run('run1');
    run('run2');
    reserve('r1', 'e1', 'run1', 'SCRIPT_WRITER_SHORT', 5000);
    expect(() => reserve('r2', 'e2', 'run2', 'REVIEW_TRANSLATION_ES', 3000)).toThrow(
      /project_execution_budget_exceeded/u,
    );
  });

  it('records overrun as AMBIGUOUS and blocks further reservations', () => {
    budget('budget1', 9000);
    envelope('e1', 'SCRIPT_WRITER_SHORT', 5000);
    envelope('e2', 'REVIEW_TRANSLATION_ES', 4000);
    run('run1');
    run('run2');
    reserve('r1', 'e1', 'run1', 'SCRIPT_WRITER_SHORT', 3000);
    db.exec(
      `UPDATE editorial_execution_reservations SET status='DISPATCHED' WHERE id='r1'; UPDATE editorial_execution_reservations SET status='AMBIGUOUS',actual_microusd=4500 WHERE id='r1'`,
    );
    expect(() =>
      db.exec(`UPDATE editorial_execution_reservations SET status='RECONCILED' WHERE id='r1'`),
    ).toThrow(/reconciliation_overrun/u);
    expect(() => reserve('r2', 'e2', 'run2', 'REVIEW_TRANSLATION_ES', 1000)).toThrow(
      /ambiguous_reservation/u,
    );
  });

  it('enforces project budget versioning and terminal immutability', () => {
    budget();
    expect(() =>
      db.exec(
        `UPDATE editorial_project_execution_budgets SET status='CONSUMED' WHERE id='budget1'`,
      ),
    ).toThrow(/project_budget_version_invalid/u);
    db.exec(
      `UPDATE editorial_project_execution_budgets SET status='CONSUMED',version=2 WHERE id='budget1'`,
    );
    expect(() =>
      db.exec(
        `UPDATE editorial_project_execution_budgets SET status='ACTIVE',version=3 WHERE id='budget1'`,
      ),
    ).toThrow(/project_budget_terminal/u);
  });
});

describe('migration 0004 graph and provenance constraints', () => {
  function researchVersion(versionId: string, artifactId: string) {
    db.prepare(
      `INSERT INTO editorial_artifacts(id,workspace_id,project_id,artifact_type,status,current_version_id,created_at,updated_at,version) VALUES(?,'w1','p1','RESEARCH','active',?,'now','now',1)`,
    ).run(artifactId, versionId);
    db.prepare(
      `INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,language_code,content_text,source_type,content_hash,created_at,created_by) VALUES(?,'w1',?,1,'de','research','HUMAN_EDITED',?,'now','u1')`,
    ).run(versionId, artifactId, 'a'.repeat(64));
  }
  it('deduplicates fingerprints within an exact Research version', () => {
    researchVersion('rv1', 'ra1');
    const insert = (id: string, fingerprint: string) =>
      db
        .prepare(
          `INSERT INTO research_sources(id,workspace_id,research_version_id,source_type,title,created_at,created_by,source_fingerprint) VALUES(?,'w1','rv1','WEB','Source','now','u1',?)`,
        )
        .run(id, fingerprint);
    insert('s1', 'b'.repeat(64));
    expect(() => insert('s2', 'b'.repeat(64))).toThrow(/UNIQUE constraint/u);
    expect(() => insert('s3', 'XYZ')).toThrow(/fingerprint_invalid/u);
  });

  it('rejects an OBSERVED claim whose source belongs to another Research version', () => {
    researchVersion('rv1', 'ra1');
    db.exec(
      `INSERT INTO research_sources(id,workspace_id,research_version_id,source_type,title,created_at,created_by) VALUES('s1','w1','rv1','WEB','Source','now','u1')`,
    );
    expect(() =>
      db.exec(
        `INSERT INTO research_claims(id,workspace_id,research_version_id,source_id,claim_text,evidence_class,created_at,created_by) VALUES('claim1','w1','missing','s1','Claim','OBSERVED','now','u1')`,
      ),
    ).toThrow();
  });

  it('allows many Ideas but only one selected Idea per project', () => {
    db.exec(
      `INSERT INTO editorial_artifacts(id,workspace_id,project_id,artifact_type,status,created_at,updated_at,version) VALUES('ia1','w1','p1','IDEA_CANDIDATE','active','now','now',1),('ia2','w1','p1','IDEA_CANDIDATE','active','now','now',1); INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,language_code,content_text,source_type,content_hash,created_at,created_by) VALUES('iv1','w1','ia1',1,'de','one','HUMAN_EDITED','${'c'.repeat(64)}','now','u1'),('iv2','w1','ia2',1,'de','two','HUMAN_EDITED','${'d'.repeat(64)}','now','u1'); INSERT INTO idea_candidates(id,workspace_id,project_id,artifact_id,artifact_version_id,title,target_format,status,evidence_class,created_at,updated_at,version,created_by,updated_by) VALUES('i1','w1','p1','ia1','iv1','one','SHORT','SELECTED','UNKNOWN','now','now',1,'u1','u1')`,
    );
    expect(() =>
      db.exec(
        `INSERT INTO idea_candidates(id,workspace_id,project_id,artifact_id,artifact_version_id,title,target_format,status,evidence_class,created_at,updated_at,version,created_by,updated_by) VALUES('i2','w1','p1','ia2','iv2','two','SHORT','SELECTED','UNKNOWN','now','now',1,'u1','u1')`,
      ),
    ).toThrow(/UNIQUE constraint/u);
  });

  it('allows singleton replacement only after soft deletion', () => {
    researchVersion('rv1', 'ra1');
    expect(() => researchVersion('rv2', 'ra2')).toThrow(/UNIQUE constraint/u);
    db.exec(`UPDATE editorial_artifacts SET deleted_at='later' WHERE id='ra1'`);
    expect(() => researchVersion('rv2', 'ra2')).not.toThrow();
  });
});

describe('migration 0004 terminal audit exact-one', () => {
  it('requires one correct audit before terminalizing and makes linkage immutable', () => {
    run('run1');
    expect(() =>
      db.exec(`UPDATE intelligence_runs SET status='SUCCEEDED' WHERE id='run1'`),
    ).toThrow(/terminal_audit_invalid/u);
    db.exec(
      `INSERT INTO audit_events(id,workspace_id,actor_type,action,resource_type,resource_id,outcome,request_id,environment,metadata_json,occurred_at,ingested_at) VALUES('audit1','w1','system','intelligence.run_completed','intelligence_run','run1','success','req','test','{}','now','now')`,
    );
    db.exec(
      `UPDATE intelligence_runs SET status='SUCCEEDED',terminal_audit_event_id='audit1' WHERE id='run1'`,
    );
    expect(() =>
      db.exec(
        `INSERT INTO audit_events(id,workspace_id,actor_type,action,resource_type,resource_id,outcome,request_id,environment,metadata_json,occurred_at,ingested_at) VALUES('audit2','w1','system','intelligence.run_failed','intelligence_run','run1','failure','req2','test','{}','now','now')`,
      ),
    ).toThrow(/UNIQUE constraint/u);
    expect(() =>
      db.exec(`UPDATE intelligence_runs SET terminal_audit_event_id=NULL WHERE id='run1'`),
    ).toThrow(/immutable/u);
    expect(() => db.exec(`UPDATE intelligence_runs SET status='RUNNING' WHERE id='run1'`)).toThrow(
      /terminal/u,
    );
  });

  it('rejects wrong action/status and cross-workspace terminal audit', () => {
    run('run1');
    db.exec(
      `INSERT INTO audit_events(id,workspace_id,actor_type,action,resource_type,resource_id,outcome,request_id,environment,metadata_json,occurred_at,ingested_at) VALUES('audit1','w1','system','intelligence.run_failed','intelligence_run','run1','failure','req','test','{}','now','now')`,
    );
    expect(() =>
      db.exec(
        `UPDATE intelligence_runs SET status='SUCCEEDED',terminal_audit_event_id='audit1' WHERE id='run1'`,
      ),
    ).toThrow(/terminal_audit_invalid/u);
    expect(() =>
      db.exec(
        `INSERT INTO audit_events(id,workspace_id,actor_type,action,resource_type,resource_id,outcome,request_id,environment,metadata_json,occurred_at,ingested_at) VALUES('audit2','w2','system','intelligence.run_completed','intelligence_run','run1','success','req2','test','{}','now','now')`,
      ),
    ).toThrow(/terminal_audit_scope_invalid/u);
  });

  it('keeps foreign keys clean', () =>
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]));
});
