import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { governedImportedResearchRevisionSchema } from '@vision-maxson/contracts';
import type { EditorialActor } from '../src/editorial/repository';
import { EditorialRevisionService } from '../src/editorial/revision';
import { GovernedResearchRevisionService } from '../src/editorial/research-revision';
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
  values: SQLInputValue[] = [];
  constructor(
    private database: DatabaseSync,
    readonly sql: string,
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
export const actor: EditorialActor = { id: 'owner', workspaceId: 'workspace', roles: ['owner'] };
function fixture(
  evidence = true,
  includeRevisionSchema = true,
  schemaVersion = 13,
  contextFixture = false,
) {
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
      ('research-v1','workspace','research',1,'de','${contextFixture ? 'STALE_RESEARCH_V1_MARKER' : 'research'}',NULL,'HUMAN_EDITED','${'1'.repeat(64)}','t','owner'),
      ('idea-v1','workspace','idea',1,'de','${contextFixture ? 'STALE_IDEA_MARKER' : 'idea'}',NULL,'HUMAN_EDITED','${'0'.repeat(64)}','t','owner'),
      ('brief-v1','workspace','brief',1,'de',NULL,'${contextFixture ? '{"researchVersionIds":["research-v1"],"summary":"STALE_BRIEF_MARKER"}' : '{"researchVersionIds":["research-v1"]}'}','HUMAN_EDITED','${'2'.repeat(64)}','t','owner'),
      ('script-v1','workspace','script',1,'de','${contextFixture ? 'STALE_SCRIPT_MARKER' : 'script'}',NULL,'HUMAN_EDITED','${'3'.repeat(64)}','t','owner'),
      ('critique-v1','workspace','critique',1,'de','${contextFixture ? 'STALE_CRITIQUE_MARKER' : 'critique'}',NULL,'HUMAN_EDITED','${'4'.repeat(64)}','t','owner'),
      ('storyboard-v1','workspace','storyboard',1,'de','${contextFixture ? 'STALE_STORYBOARD_MARKER' : 'storyboard'}',NULL,'HUMAN_EDITED','${'5'.repeat(64)}','t','owner');
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
  if (contextFixture)
    database.exec(`
      UPDATE projects SET description='Stable documentary goal' WHERE id='project';
      UPDATE content_brands SET niche='Technology history' WHERE id='brand';
      UPDATE channel_profiles SET narrative_tone='Factual narration',editorial_strategy_json='{"audience":["Learners"],"reviewLanguage":"es"}' WHERE id='channel';
      INSERT INTO editorial_artifacts(id,workspace_id,project_id,artifact_type,current_version_id,status,created_at,updated_at,version,created_by,updated_by)
        VALUES('translation','workspace','project','REVIEW_TRANSLATION','translation-v1','approved','t','t',2,'owner','owner');
      INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,language_code,content_text,source_type,source_script_version_id,content_hash,created_at,created_by)
        VALUES('translation-v1','workspace','translation',1,'es','STALE_TRANSLATION_MARKER','HUMAN_EDITED','script-v1','${'6'.repeat(64)}','t','owner');
      INSERT INTO artifact_approvals(id,workspace_id,artifact_version_id,decision,actor_id,actor_role,decided_at)
        VALUES('approve-translation','workspace','translation-v1','APPROVED','owner','owner','t');
      INSERT INTO artifact_dependencies(id,workspace_id,source_artifact_version_id,dependent_artifact_version_id,dependency_type,validity_status,created_at,updated_at,version)
        VALUES('dep-st','workspace','script-v1','translation-v1','GENERATED_FROM','CURRENT','t','t',1);
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
async function open(schemaVersion = 13, contextFixture = false) {
  const f = fixture(true, true, schemaVersion, contextFixture);
  const r = await service(f.d1).request('storyboard-v1', 'request-key', command);
  return { ...f, requestId: String(r.id) };
}

const migration14 = '0014_governed_idea_revision_capacity.sql';
async function ready(
  include14 = true,
  historical = false,
  contextFixture = false,
  researchSummary?: string,
) {
  const f = await open(13, contextFixture);
  const importedResult = await importer(f.d1).create(f.requestId, 'import-key', {
    ...imported,
    summary:
      researchSummary ??
      (contextFixture
        ? 'AUTHORITATIVE_RESEARCH_V2_MARKER: Ariane 5 Flight 501.'
        : imported.summary),
  });
  f.database
    .exec(`INSERT INTO artifact_approvals(id,workspace_id,artifact_version_id,decision,actor_id,actor_role,decided_at) VALUES('approval-v2','workspace','${importedResult.versionId}','APPROVED','owner','owner','t');
 UPDATE editorial_artifacts SET status='approved',version=version+1 WHERE id='research';
 INSERT INTO prompt_versions(id,prompt_definition_id,version_number,template_text,input_schema_version,output_schema_version,status,content_hash,created_at) VALUES('prompt_version_idea_generation_v1','prompt_idea_generation',1,'Generate distinct editorial idea candidates grounded only in the supplied project and approved research context. Do not invent analytics, revenue, platform eligibility or sources. Context: {{context_json}}','idea-generation-input-v1','idea-generation-output-v1','active','${'a'.repeat(64)}','t');
 INSERT INTO ai_providers(id,key,display_name,status,adapter_version,created_at,updated_at) VALUES('provider_openai','openai','OpenAI','configured','v1','t','t');
 INSERT INTO ai_provider_models(id,provider_id,model_key,display_name,status,capabilities_json,effective_from,created_at,updated_at) VALUES('model_openai_gpt_5_6_terra_20260903','provider_openai','gpt-5.6-terra','Terra','available','{"qualityTier":"BALANCED","capabilities":["MULTILINGUAL_TEXT","STRUCTURED_OUTPUT"]}','2026-01-01','t','t');
 INSERT INTO ai_pricing_snapshots(id,provider_model_id,currency,input_unit_price,output_unit_price,unit_name,verification_status,effective_from,created_at) VALUES('pricing_model_openai_gpt_5_6_terra_20260903','model_openai_gpt_5_6_terra_20260903','USD',0.000002,0.000012,'token','externally_verified','2026-01-01','t');
 INSERT INTO editorial_project_execution_budgets(id,workspace_id,project_id,profile_key,profile_version,currency,monetary_ceiling_microusd,status,authorized_by,created_at,updated_at) VALUES('original-budget','workspace','project','phase3_terminal_graph_v1',1,'USD',1331520,'ACTIVE','owner','t','t');
 INSERT INTO editorial_execution_envelopes(id,workspace_id,project_id,profile_key,profile_version,provider_id,provider_model_id,currency,monetary_ceiling_microusd,maximum_calls,status,authorized_by,created_at,updated_at,project_execution_budget_id,stage_key) VALUES('original-envelope','workspace','project','phase3_terminal_graph_v1',1,'provider_openai','model_openai_gpt_5_6_terra_20260903','USD',177920,1,'${historical ? 'ACTIVE' : 'CONSUMED'}','owner','t','t','original-budget','IDEA_GENERATION');`);
  if (historical)
    f.database.exec(`
    INSERT INTO intelligence_runs(id,workspace_id,project_id,task_type,provider_id,provider_model_id,prompt_version_id,input_artifact_version_id,initiated_by,operating_mode,status,idempotency_key,created_at,updated_at) VALUES('historical-idea-run','workspace','project','IDEA_GENERATION','provider_openai','model_openai_gpt_5_6_terra_20260903','prompt_version_idea_generation_v1','research-v1','owner','ASSISTED','RUNNING','historical-idea-key','t','t');
    INSERT INTO intelligence_run_attempts(id,intelligence_run_id,attempt_number,attempt_kind,status,error_category,started_at,completed_at) VALUES('historical-idea-attempt','historical-idea-run',1,'TECHNICAL','FAILED_PERMANENT','SCHEMA_VALIDATION','t','t');
    INSERT INTO editorial_execution_reservations(id,envelope_id,workspace_id,project_id,intelligence_run_id,step_key,pricing_snapshot_id,reserved_microusd,actual_microusd,status,created_at,dispatched_at,reconciled_at,project_execution_budget_id) VALUES('historical-idea-reservation','original-envelope','workspace','project','historical-idea-run','IDEA_GENERATION','pricing_model_openai_gpt_5_6_terra_20260903',177920,1000,'RECONCILED','t','t','t','original-budget');
    INSERT INTO audit_events(id,workspace_id,actor_type,action,resource_type,resource_id,outcome,request_id,environment,metadata_json,occurred_at,ingested_at) VALUES('historical-idea-terminal','workspace','system','intelligence.run_failed','intelligence_run','historical-idea-run','failure','historical','test','{}','t','t');
    UPDATE intelligence_runs SET status='FAILED_PERMANENT',error_category='SCHEMA_VALIDATION',terminal_audit_event_id='historical-idea-terminal',version=version+1 WHERE id='historical-idea-run';
    UPDATE editorial_execution_envelopes SET status='CONSUMED',version=version+1 WHERE id='original-envelope';
  `);
  if (include14) f.database.exec(migration(migration14));
  const research = f.database
    .prepare("SELECT version FROM editorial_artifacts WHERE id='research'")
    .get()!;
  return {
    ...f,
    command: {
      expectedResearchVersionId: importedResult.versionId,
      expectedResearchArtifactRevision: Number(research.version),
      expectedResearchApprovalId: 'approval-v2',
      expectedProjectVersion: 2,
    },
  };
}

export async function briefFixture(include15 = true) {
  const f = await ready(true, true, true);
  f.database.exec(`
 INSERT INTO prompt_versions(id,prompt_definition_id,version_number,template_text,input_schema_version,output_schema_version,status,content_hash,created_at) VALUES('prompt_version_content_brief_v1','prompt_content_brief',1,'Create a Brief from {{context_json}}','content-brief-input-v1','content-brief-output-v1','active','${'b'.repeat(64)}','t');
 UPDATE idea_candidates SET status='REJECTED',version=version+1 WHERE id='idea-candidate';
 INSERT INTO editorial_artifacts(id,workspace_id,project_id,artifact_type,current_version_id,status,created_at,updated_at,version,created_by,updated_by) VALUES('new-idea','workspace','project','IDEA_CANDIDATE','new-idea-v1','approved','t','t',3,'owner','owner');
 INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,language_code,content_text,content_json,source_type,content_hash,created_at,created_by) VALUES('new-idea-v1','workspace','new-idea',1,'de',NULL,'{"title":"The event","angle":"Documented history","hook":"What happened?"}','HUMAN_EDITED','${'c'.repeat(64)}','t','owner');
 INSERT INTO artifact_approvals(id,workspace_id,artifact_version_id,decision,actor_id,actor_role,decided_at) VALUES('new-idea-approval','workspace','new-idea-v1','APPROVED','owner','owner','t');
 INSERT INTO idea_candidates(id,workspace_id,project_id,artifact_id,artifact_version_id,title,target_format,status,evidence_class,created_at,updated_at,version,created_by,updated_by) VALUES('new-candidate','workspace','project','new-idea','new-idea-v1','New Idea','SHORT','SELECTED','UNKNOWN','t','t',2,'owner','owner');
 INSERT INTO artifact_dependencies(id,workspace_id,source_artifact_version_id,dependent_artifact_version_id,dependency_type,validity_status,created_at,updated_at,version) VALUES('new-lineage','workspace','${f.command.expectedResearchVersionId}','new-idea-v1','GENERATED_FROM','CURRENT','t','t',1);
 INSERT INTO editorial_execution_envelopes(id,workspace_id,project_id,profile_key,profile_version,provider_id,provider_model_id,currency,monetary_ceiling_microusd,maximum_calls,status,authorized_by,created_at,updated_at,project_execution_budget_id,stage_key) VALUES('original-brief-envelope','workspace','project','phase3_terminal_graph_v1',1,'provider_openai','model_openai_gpt_5_6_terra_20260903','USD',201920,1,'CONSUMED','owner','t','t','original-budget','CONTENT_BRIEF');
 `);
  if (include15) f.database.exec(migration('0015_governed_content_brief_revision_capacity.sql'));
  return {
    ...f,
    command: {
      researchVersionId: f.command.expectedResearchVersionId,
      researchApprovalId: 'approval-v2',
      expectedResearchArtifactRevision: f.command.expectedResearchArtifactRevision,
      ideaCandidateId: 'new-candidate',
      expectedIdeaCandidateRevision: 2,
      ideaVersionId: 'new-idea-v1',
      ideaApprovalId: 'new-idea-approval',
      expectedIdeaArtifactRevision: 3,
      expectedProjectVersion: 2,
    },
  };
}
