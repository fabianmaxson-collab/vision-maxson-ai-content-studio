import { spawnSync } from 'node:child_process';
import { createApp, type Bindings } from '../src/app';
import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  EditorialExecutionService,
  providerBoundRequestMaterial,
} from '../src/editorial/execution';
import { OpenAIResponsesAdapter } from '@vision-maxson/providers/openai';
import { governedImportedResearchRevisionSchema } from '@vision-maxson/contracts';
import type { EditorialActor } from '../src/editorial/repository';
import { EditorialRevisionService } from '../src/editorial/revision';
import { GovernedResearchRevisionService } from '../src/editorial/research-revision';
import {
  IdeaRevisionCapacityService,
  loadIdeaRevisionCapacity,
  ideaRevisionSchemaReady,
} from '../src/editorial/idea-revision-capacity';
import {
  loadGovernedTerminalEnvelope,
  loadGovernedRemediationEnvelope,
} from '../src/editorial/governed-budget';
import { GovernedChainedRemediationService } from '../src/editorial/governed-chained-remediation';
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
const actor: EditorialActor = { id: 'owner', workspaceId: 'workspace', roles: ['owner'] };
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
const count = (database: DatabaseSync, table: string) =>
  Number(database.prepare(`SELECT COUNT(*) count FROM ${table}`).get()!.count);

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
const capacity = (f: { d1: D1Database }, who = actor) =>
  new IdeaRevisionCapacityService(f.d1, who, {
    requestId: 'capacity-request',
    environment: 'test',
  });
const counts = (db: DatabaseSync) =>
  [
    'editorial_project_execution_budgets',
    'editorial_execution_envelopes',
    'audit_events',
    'editorial_idea_revision_capacities',
    'editorial_execution_reservations',
    'intelligence_runs',
    'intelligence_run_attempts',
  ].map((t) => count(db, t));
describe('Idea revision capacity atomic authorization', () => {
  it('creates exactly budget envelope audit receipt and replays without writes', async () => {
    const f = await ready();
    const before = counts(f.database);
    const provider = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('provider forbidden'));
    try {
      const r = await capacity(f).authorize(f.requestId, 'capacity-key', f.command);
      expect(counts(f.database).map((n, i) => n - before[i]!)).toEqual([1, 1, 1, 1, 0, 0, 0]);
      expect(r.monetaryCeilingMicrousd).toBe(177920);
      expect(await capacity(f).authorize(f.requestId, 'capacity-key', f.command)).toEqual({
        ...r,
        idempotentReplay: true,
      });
      await expect(
        capacity(f).authorize(f.requestId, 'capacity-key', {
          ...f.command,
          expectedProjectVersion: 3,
        }),
      ).rejects.toThrow('idempotency_conflict');
      await expect(capacity(f).authorize(f.requestId, 'other-key', f.command)).rejects.toThrow(
        'conflict',
      );
      expect(f.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      expect(provider).not.toHaveBeenCalled();
      f.database.exec(
        `UPDATE editorial_execution_envelopes SET status='CONSUMED',version=version+1 WHERE id='${r.envelopeId}'`,
      );
      expect(
        (await capacity(f).authorize(f.requestId, 'capacity-key', f.command)).idempotentReplay,
      ).toBe(true);
    } finally {
      provider.mockRestore();
      f.database.close();
    }
  });
  it.each([true, false])('serializes competing authorization, same key %s', async (same) => {
    const f = await ready();
    const before = counts(f.database);
    const rs = await Promise.allSettled([
      capacity(f).authorize(f.requestId, 'key-one', f.command),
      capacity(f).authorize(f.requestId, same ? 'key-one' : 'key-two', f.command),
    ]);
    expect(rs.filter((r) => r.status === 'fulfilled')).toHaveLength(same ? 2 : 1);
    expect(counts(f.database).map((n, i) => n - before[i]!)).toEqual([1, 1, 1, 1, 0, 0, 0]);
    f.database.close();
  });
  it.each([
    'audit_events',
    'editorial_idea_revision_capacities',
    'editorial_execution_envelopes',
    'editorial_project_execution_budgets',
  ])('rolls back injected %s failure', async (table) => {
    const f = await ready();
    const before = counts(f.database);
    f.database.exec(
      `CREATE TRIGGER fail_test BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'injected'); END;`,
    );
    await expect(capacity(f).authorize(f.requestId, 'key', f.command)).rejects.toThrow('conflict');
    expect(counts(f.database)).toEqual(before);
    f.database.close();
  });
  it.each([
    "UPDATE editorial_artifacts SET status='active',version=version+1 WHERE id='research'",
    "UPDATE projects SET version=version+1 WHERE id='project'",
    "UPDATE ai_providers SET status='inactive'",
    "UPDATE ai_provider_models SET status='inactive'",
    "UPDATE prompt_definitions SET status='inactive' WHERE key='idea_generation'",
    "UPDATE ai_pricing_snapshots SET verification_status='stale'",
    "UPDATE users SET status='disabled',version=version+1 WHERE id='owner'",
  ])('rejects changed eligibility: %s', async (sql) => {
    const f = await ready();
    const before = counts(f.database);
    f.database.exec(sql);
    await expect(capacity(f).authorize(f.requestId, 'key', f.command)).rejects.toThrow();
    expect(counts(f.database)).toEqual(before);
    f.database.close();
  });
  it('rejects wrong inputs, role and workspace without writes', async () => {
    const f = await ready();
    const before = counts(f.database);
    for (const command of [
      { ...f.command, expectedResearchVersionId: 'missing' },
      { ...f.command, expectedResearchApprovalId: 'missing' },
      { ...f.command, expectedResearchArtifactRevision: 99 },
    ])
      await expect(capacity(f).authorize(f.requestId, 'key', command)).rejects.toThrow();
    await expect(
      capacity(f, { ...actor, roles: ['viewer'] }).authorize(f.requestId, 'key', f.command),
    ).rejects.toThrow('not_allowed');
    await expect(
      capacity(f, { id: 'other-user', workspaceId: 'other', roles: ['owner'] }).authorize(
        f.requestId,
        'key',
        f.command,
      ),
    ).rejects.toThrow('not_found');
    expect(counts(f.database)).toEqual(before);
    f.database.close();
  });
  it('fails closed on schema 0013', async () => {
    const f = await ready(false);
    expect(await ideaRevisionSchemaReady(f.d1)).toBe(false);
    await expect(capacity(f).authorize(f.requestId, 'key', f.command)).rejects.toThrow(
      'schema_unavailable',
    );
    f.database.close();
  });
  it('requires explicit receipt and exact current Research binding', async () => {
    const f = await ready();
    const r = await capacity(f).authorize(f.requestId, 'key', f.command);
    await expect(
      loadGovernedTerminalEnvelope(f.d1, actor, 'project', 'IDEA_GENERATION', {
        providerKey: 'openai',
        modelKey: 'gpt-5.6-terra',
      }),
    ).rejects.toThrow();
    const loaded = await loadIdeaRevisionCapacity(
      f.d1,
      actor,
      'project',
      r.capacityId,
      f.command.expectedResearchVersionId,
    );
    expect(loaded.id).toBe(r.envelopeId);
    for (const [project, id, version] of [
      ['other', r.capacityId, f.command.expectedResearchVersionId],
      ['project', 'missing', f.command.expectedResearchVersionId],
      ['project', r.capacityId, 'research-v1'],
    ])
      await expect(
        loadIdeaRevisionCapacity(f.d1, actor, project!, id!, version!),
      ).rejects.toThrow();
    f.database.close();
  });
});

describe('receipt and reservation database defenses', () => {
  it.each([
    'workspace_id',
    'project_id',
    'revision_request_id',
    'research_artifact_id',
    'research_version_id',
    'research_approval_id',
    'budget_id',
    'envelope_id',
    'actor_id',
    'actor_role',
    'prompt_version_id',
    'pricing_snapshot_id',
    'profile_key',
    'stage_key',
    'result_json',
  ])('rejects tampered %s atomically', async (field) => {
    const f = await ready();
    const before = counts(f.database);
    const original = f.d1.batch.bind(f.d1);
    f.d1.batch = async (statements) => {
      const last = statements.at(-1) as unknown as Statement;
      const columns = last.sql.slice(last.sql.indexOf('(') + 1, last.sql.indexOf(')')).split(',');
      last.values[columns.indexOf(field) + 1] = field === 'result_json' ? '{}' : 'wrong-value';
      return original(statements);
    };
    await expect(capacity(f).authorize(f.requestId, 'key', f.command)).rejects.toThrow();
    expect(counts(f.database)).toEqual(before);
    f.database.close();
  });
  it('rejects malformed replay and forbids receipt updates/deletes', async () => {
    const f = await ready();
    await capacity(f).authorize(f.requestId, 'key', f.command);
    expect(() =>
      f.database.exec("UPDATE editorial_idea_revision_capacities SET result_json='{}'"),
    ).toThrow();
    expect(() => f.database.exec('DELETE FROM editorial_idea_revision_capacities')).toThrow();
    const trigger = f.database
      .prepare("SELECT sql FROM sqlite_master WHERE name='idea_revision_capacity_no_update'")
      .get()!;
    f.database.exec(
      "DROP TRIGGER idea_revision_capacity_no_update; UPDATE editorial_idea_revision_capacities SET result_json='{}'",
    );
    f.database.exec(String(trigger.sql));
    await expect(capacity(f).authorize(f.requestId, 'key', f.command)).rejects.toThrow(
      'receipt_invalid',
    );
    f.database.close();
  });
  it('preserves preexisting rows, and true upgrade from 0013', async () => {
    const f = await ready(false);
    const names = [
      'editorial_artifacts',
      'editorial_artifact_versions',
      'artifact_dependencies',
      'artifact_approvals',
      'editorial_revision_requests',
      'editorial_project_execution_budgets',
      'editorial_execution_envelopes',
      'intelligence_runs',
    ];
    const snap = () => names.map((t) => f.database.prepare(`SELECT * FROM ${t} ORDER BY id`).all());
    const before = snap();
    f.database.exec(migration(migration14));
    expect(snap()).toEqual(before);
    await capacity(f).authorize(f.requestId, 'key', f.command);
    expect(snap().slice(0, 5)).toEqual(before.slice(0, 5));
    expect(
      f.database
        .prepare('SELECT status FROM editorial_revision_requests WHERE id=?')
        .get(f.requestId),
    ).toEqual({ status: 'OPEN' });
    expect(f.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    f.database.close();
  });
  it.each([
    'exact',
    'wrong-source',
    'missing-selector',
    'wrong-budget',
    'second-call',
    'stale-project',
  ])('enforces reservation binding: %s', async (scenario) => {
    const f = await ready();
    const r = await capacity(f).authorize(f.requestId, 'key', f.command);
    if (scenario === 'stale-project')
      f.database.exec("UPDATE projects SET version=version+1 WHERE id='project'");
    const reserve = (suffix: string) =>
      f.d1.batch([
        f.d1
          .prepare(
            `INSERT INTO intelligence_runs(id,workspace_id,project_id,task_type,provider_id,provider_model_id,prompt_version_id,input_artifact_version_id,initiated_by,operating_mode,status,idempotency_key,creative_regeneration_number,safe_metadata_json,pricing_snapshot_id,created_at,updated_at,version) VALUES(?,'workspace','project','IDEA_GENERATION','provider_openai','model_openai_gpt_5_6_terra_20260903','prompt_version_idea_generation_v1',?,'owner','ASSISTED','QUEUED',?,0,?,'pricing_model_openai_gpt_5_6_terra_20260903','t','t',1)`,
          )
          .bind(
            'run-' + suffix,
            scenario === 'wrong-source' ? 'research-v1' : r.researchVersionId,
            'execution-' + suffix,
            JSON.stringify(
              scenario === 'missing-selector' ? {} : { ideaRevisionCapacityId: r.capacityId },
            ),
          ),
        f.d1
          .prepare(
            `INSERT INTO editorial_execution_reservations(id,envelope_id,workspace_id,project_id,intelligence_run_id,step_key,pricing_snapshot_id,reserved_microusd,status,created_at,project_execution_budget_id) VALUES(?,?,'workspace','project',?,'IDEA_GENERATION','pricing_model_openai_gpt_5_6_terra_20260903',177920,'RESERVED','t',?)`,
          )
          .bind(
            'reservation-' + suffix,
            r.envelopeId,
            'run-' + suffix,
            scenario === 'wrong-budget' ? 'original-budget' : r.budgetId,
          ),
      ]);
    if (scenario === 'exact' || scenario === 'second-call') {
      await reserve('one');
      expect(count(f.database, 'editorial_execution_reservations')).toBe(1);
      if (scenario === 'second-call') await expect(reserve('two')).rejects.toThrow();
    } else {
      const before = counts(f.database);
      await expect(reserve('one')).rejects.toThrow();
      expect(counts(f.database)).toEqual(before);
    }
    expect(f.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    f.database.close();
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

describe('Idea revision authorization HTTP contract', () => {
  it('validates key and rejects overrides with sanitized response', async () => {
    const f = await ready();
    const url = `/api/v1/editorial-revision-requests/${f.requestId}/idea-generation-capacity`;
    for (const [body, key] of [
      [f.command, ' '.repeat(5)],
      [f.command, 'x'.repeat(201)],
      [{ ...f.command, maximumCalls: 2 }, 'valid-key'],
    ] as const) {
      const r = await revisionPost(f.d1, url, body, key);
      expect(r.status).toBe(422);
    }
    const r = await revisionPost(f.d1, url, f.command);
    expect(r.status).toBe(201);
    const result = await r.json<{ capacityId: string }>();
    expect(result.capacityId).toBeTruthy();
    f.database.close();
  });
});

describe('additional Idea capacity eligibility and scope checks', () => {
  it('requires providers:admin at the HTTP boundary', async () => {
    const f = await ready();
    const before = counts(f.database);
    f.database.exec("UPDATE user_roles SET role_id='role_viewer' WHERE user_id='owner'");
    const r = await revisionPost(
      f.d1,
      `/api/v1/editorial-revision-requests/${f.requestId}/idea-generation-capacity`,
      f.command,
    );
    expect(r.status).toBe(403);
    expect(counts(f.database)).toEqual(before);
    f.database.close();
  });
  it('rejects a missing request, key, and foreign approval', async () => {
    const f = await ready();
    const before = counts(f.database);
    await expect(capacity(f).authorize('missing-request', 'key', f.command)).rejects.toThrow(
      'not_found',
    );
    await expect(capacity(f).authorize(f.requestId, ' ', f.command)).rejects.toThrow(
      'command_invalid',
    );
    await expect(
      capacity(f).authorize(f.requestId, 'key', {
        ...f.command,
        expectedResearchApprovalId: 'approve-research',
      }),
    ).rejects.toThrow('ineligible');
    expect(counts(f.database)).toEqual(before);
    f.database.close();
  });
  it('keeps durable uniqueness after cancellation', async () => {
    const f = await ready();
    const r = await capacity(f).authorize(f.requestId, 'key', f.command);
    f.database.exec(
      `UPDATE editorial_execution_envelopes SET status='CANCELLED',version=version+1 WHERE id='${r.envelopeId}'; UPDATE editorial_project_execution_budgets SET status='CANCELLED',version=version+1 WHERE id='${r.budgetId}'`,
    );
    const before = counts(f.database);
    await expect(capacity(f).authorize(f.requestId, 'new-key', f.command)).rejects.toThrow(
      'conflict',
    );
    expect(counts(f.database)).toEqual(before);
    f.database.close();
  });
  it('rejects a successful Idea Run from the revised Research', async () => {
    const f = await ready();
    f.database
      .exec(`INSERT INTO intelligence_runs(id,workspace_id,project_id,task_type,input_artifact_version_id,initiated_by,operating_mode,status,idempotency_key,created_at,updated_at,version) VALUES('new-idea-run','workspace','project','IDEA_GENERATION','${f.command.expectedResearchVersionId}','owner','ASSISTED','QUEUED','idea-key','t','t',1);
  INSERT INTO audit_events(id,workspace_id,actor_type,action,resource_type,resource_id,outcome,request_id,environment,metadata_json,occurred_at,ingested_at) VALUES('idea-done','workspace','system','intelligence.run_completed','intelligence_run','new-idea-run','success','req','test','{}','t','t');
  UPDATE intelligence_runs SET status='SUCCEEDED',terminal_audit_event_id='idea-done',version=2 WHERE id='new-idea-run';`);
    const before = counts(f.database);
    await expect(capacity(f).authorize(f.requestId, 'key', f.command)).rejects.toThrow(
      'ineligible',
    );
    expect(counts(f.database)).toEqual(before);
    f.database.close();
  });
  it('rechecks changed approval and project at execution time', async () => {
    const f = await ready();
    const r = await capacity(f).authorize(f.requestId, 'key', f.command);
    f.database.exec(
      "UPDATE editorial_artifacts SET status='active',version=version+1 WHERE id='research'",
    );
    await expect(
      loadIdeaRevisionCapacity(f.d1, actor, 'project', r.capacityId, r.researchVersionId),
    ).rejects.toThrow('binding_invalid');
    f.database.close();
  });
});

it('prevents changing an authorized profile or model to bypass explicit execution binding', async () => {
  const f = await ready();
  const r = await capacity(f).authorize(f.requestId, 'key', f.command);
  expect(() =>
    f.database.exec(
      `UPDATE editorial_execution_envelopes SET profile_key='other',version=version+1 WHERE id='${r.envelopeId}'`,
    ),
  ).toThrow();
  expect(() =>
    f.database.exec(
      `UPDATE editorial_project_execution_budgets SET monetary_ceiling_microusd=999999,version=version+1 WHERE id='${r.budgetId}'`,
    ),
  ).toThrow();
  f.database.close();
});

it.each(['authorization', 'dispatch'])(
  'executes the actual %s batch under SQLite expression depth 100',
  async (step) => {
    const f = await ready();
    const original = f.d1.batch.bind(f.d1);
    let evidence = { status: -1, stderr: '', stdout: '' };
    f.d1.batch = (statements) => {
      if (
        step === 'dispatch' &&
        !(statements[0] as unknown as Statement).sql.startsWith(
          "UPDATE editorial_execution_reservations SET status='DISPATCHED'",
        )
      )
        return original(statements);
      evidence = depth100(f, statements);
      return original(statements);
    };
    const r = await capacity(f).authorize(f.requestId, 'key', f.command);
    if (step === 'dispatch') {
      const adapter = providerDouble();
      await executor(f).execute(
        'project',
        'IDEA_GENERATION',
        executionCommand(r),
        'depth-execution',
      );
      expect(adapter).toHaveBeenCalledTimes(1);
    }
    expect(evidence.stderr).toBe('');
    expect(evidence.status).toBe(0);
    expect(evidence.stdout).toContain('EXPRESSION_DEPTH_100_PASS');
    f.database.close();
  },
);

it('rejects mismatched audit metadata atomically', async () => {
  const f = await ready();
  const before = counts(f.database);
  const original = f.d1.batch.bind(f.d1);
  f.d1.batch = (statements) => {
    (statements[2] as unknown as Statement).values[7] = '{}';
    return original(statements);
  };
  await expect(capacity(f).authorize(f.requestId, 'key', f.command)).rejects.toThrow();
  expect(counts(f.database)).toEqual(before);
  f.database.close();
});
it.each([
  ['profileVersion', true],
  ['profileVersion', false],
  ['profileVersion', '1'],
  ['profileVersion', null],
  ['profileVersion', []],
  ['profileVersion', {}],
  ['profileVersion', 2],
  ['maximumCalls', true],
  ['maximumCalls', false],
  ['maximumCalls', '1'],
  ['maximumCalls', null],
  ['maximumCalls', []],
  ['maximumCalls', {}],
  ['maximumCalls', 2],
  ['monetaryCeilingMicrousd', true],
] as const)(
  'rejects capacity audit numeric type/value mismatch %s=%j atomically',
  async (field, value) => {
    const f = await ready();
    const before = counts(f.database);
    const original = f.d1.batch.bind(f.d1);
    f.d1.batch = (statements) => {
      const audit = statements[2] as unknown as Statement;
      const rawMetadata = audit.values[7];
      if (typeof rawMetadata !== 'string') throw new Error('expected audit metadata');
      const metadata = JSON.parse(rawMetadata) as Record<string, unknown>;
      metadata[field] = value;
      audit.values[7] = JSON.stringify(metadata);
      return original(statements);
    };
    await expect(capacity(f).authorize(f.requestId, 'key', f.command)).rejects.toThrow();
    expect(counts(f.database)).toEqual(before);
    f.database.close();
  },
);
it('rejects a resolved request at authorization and execution', async () => {
  const f = await ready();
  const r = await capacity(f).authorize(f.requestId, 'key', f.command);
  // Test-only resolution fixture: the request itself remains OPEN and append-only.
  const triggers = f.database
    .prepare(
      "SELECT name,sql FROM sqlite_master WHERE type='trigger' AND tbl_name='editorial_revision_request_resolutions'",
    )
    .all();
  for (const t of triggers) f.database.exec(`DROP TRIGGER "${String(t.name)}"`);
  f.database.exec(
    `INSERT INTO editorial_revision_request_resolutions(id,workspace_id,project_id,revision_request_id,status,resolution_artifact_version_id,resolved_by,idempotency_key,command_hash,audit_event_id,resolved_at) VALUES('test-resolution','workspace','project','${f.requestId}','RESOLVED','storyboard-v1','owner','resolution-key','${'a'.repeat(64)}','${r.auditEventId}','t')`,
  );
  for (const t of triggers) f.database.exec(String(t.sql));
  await expect(
    loadIdeaRevisionCapacity(f.d1, actor, 'project', r.capacityId, r.researchVersionId),
  ).rejects.toThrow();
  await expect(capacity(f).authorize(f.requestId, 'other', f.command)).rejects.toThrow();
  f.database.close();
});
it('rolls back when project eligibility changes after prechecks', async () => {
  const f = await ready();
  const before = counts(f.database);
  const original = f.d1.batch.bind(f.d1);
  f.d1.batch = (statements) => {
    f.database.exec("UPDATE projects SET version=version+1 WHERE id='project'");
    return original(statements);
  };
  await expect(capacity(f).authorize(f.requestId, 'key', f.command)).rejects.toThrow();
  expect(counts(f.database)).toEqual(before);
  f.database.close();
});

const fakeIdeaOutput = {
  items: [
    {
      title: 'Testidee',
      angle: 'Test',
      hook: 'Test',
      rationale: 'Test',
      audience: ['Test'],
      targetFormat: 'SHORT',
      risks: [],
      confidence: 0.5,
    },
  ],
};
const fakeIdeaResult = {
  output: fakeIdeaOutput,
  providerRequestId: 'local-fake-request',
  usage: {
    inputUnits: 10,
    outputUnits: 20,
    cachedInputUnits: 0,
    reasoningOutputUnits: 0,
    unitName: 'token',
  },
  safeMetadata: {},
};
function executor(f: { d1: D1Database }, who = actor, environment = 'test') {
  return new EditorialExecutionService(f.d1, who, {
    openAIEnabled: true,
    openAIApiKey: 'test-placeholder',
    openAIBaseUrl: 'https://invalid.test',
    requestId: 'execution-test',
    environment,
  });
}
function executionCommand(r: { capacityId: string; researchVersionId: string }) {
  return {
    mode: 'LOCKED' as const,
    preferredProviderKey: 'openai',
    preferredModelKey: 'gpt-5.6-terra',
    inputArtifactVersionId: r.researchVersionId,
    creativeRegeneration: false,
    ideaRevisionCapacityId: r.capacityId,
  };
}
function providerDouble() {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network forbidden in local tests'));
  return vi.spyOn(OpenAIResponsesAdapter.prototype, 'execute').mockResolvedValue(fakeIdeaResult);
}
afterEach(() => {
  vi.restoreAllMocks();
});
function resolveRequestFixture(f: Awaited<ReturnType<typeof ready>>, auditId: string) {
  // A completed resolution is append-only. Materialize this concurrent state only
  // in the isolated fixture; restore every guard before the execution resumes.
  const triggers = f.database
    .prepare(
      "SELECT name,sql FROM sqlite_master WHERE type='trigger' AND tbl_name='editorial_revision_request_resolutions'",
    )
    .all();
  for (const t of triggers) f.database.exec(`DROP TRIGGER "${String(t.name)}"`);
  f.database
    .prepare(
      `INSERT INTO editorial_revision_request_resolutions(id,workspace_id,project_id,revision_request_id,status,resolution_artifact_version_id,resolved_by,idempotency_key,command_hash,audit_event_id,resolved_at) VALUES('resolution','workspace','project',?,'RESOLVED','storyboard-v1','owner','closed-key',?,?,'t')`,
    )
    .run(f.requestId, 'a'.repeat(64), auditId);
  for (const t of triggers) f.database.exec(String(t.sql));
}

describe('complete Idea revision execution and dispatch authorization', () => {
  it('keeps a successful one-micro overrun ambiguous without enlarging its reservation', async () => {
    const f = await ready();
    f.database.exec(
      `UPDATE ai_provider_models SET capabilities_json=json_set(capabilities_json,'$.cachedInputUnitPriceUsd',0.000001)`,
    );
    const r = await capacity(f).authorize(f.requestId, 'capacity', f.command);
    const adapter = providerDouble().mockResolvedValue({
      ...fakeIdeaResult,
      usage: { ...fakeIdeaResult.usage, inputUnits: 5, cachedInputUnits: 1, outputUnits: 14826 },
    });
    const result = await executor(f).execute(
      'project',
      'IDEA_GENERATION',
      executionCommand(r),
      'one-micro-overrun',
    );
    expect(
      f.database
        .prepare(
          'SELECT status,reserved_microusd,actual_microusd FROM editorial_execution_reservations WHERE intelligence_run_id=?',
        )
        .get(String(result.run.id)),
    ).toEqual({ status: 'AMBIGUOUS', reserved_microusd: 177920, actual_microusd: 177921 });
    expect(adapter).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(f.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    f.database.close();
  });
  it.each([
    [0, 14826, 177912, 'RECONCILED'],
    [0, 14827, 177924, 'AMBIGUOUS'],
    [-1, 0, null, 'AMBIGUOUS'],
    [Number.MAX_SAFE_INTEGER, 0, null, 'AMBIGUOUS'],
  ])(
    'keeps reconciliation bounded for usage %s/%s',
    async (inputUnits, outputUnits, actual, status) => {
      const f = await ready();
      const r = await capacity(f).authorize(f.requestId, 'capacity', f.command);
      const adapter = providerDouble().mockResolvedValue({
        ...fakeIdeaResult,
        usage: { ...fakeIdeaResult.usage, inputUnits, outputUnits },
      });
      const execution = executor(f).execute(
        'project',
        'IDEA_GENERATION',
        executionCommand(r),
        'boundary-accounting',
      );
      if (inputUnits < 0) {
        // Existing D1 usage constraints reject impossible provider usage. No
        // negative charge or successful reconciliation may escape the batch.
        await expect(execution).rejects.toThrow('CHECK constraint failed');
        expect(
          f.database
            .prepare(
              'SELECT actual_microusd,status FROM editorial_execution_reservations WHERE envelope_id=?',
            )
            .get(r.envelopeId),
        ).toEqual({ actual_microusd: null, status: 'DISPATCHED' });
        expect(adapter).toHaveBeenCalledTimes(1);
        expect(globalThis.fetch).not.toHaveBeenCalled();
        expect(f.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
        f.database.close();
        return;
      }
      const result = await execution;
      expect(
        f.database
          .prepare(
            'SELECT status,actual_microusd FROM editorial_execution_reservations WHERE intelligence_run_id=?',
          )
          .get(String(result.run.id)),
      ).toEqual({ status, actual_microusd: actual });
      expect(adapter).toHaveBeenCalledTimes(1);
      expect(globalThis.fetch).not.toHaveBeenCalled();
      expect(f.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      f.database.close();
    },
  );
  it.each([
    [630, 1244, 16188, 'RECONCILED'],
    [0, 14827, 177924, 'AMBIGUOUS'],
    [Number.MAX_SAFE_INTEGER, 0, null, 'AMBIGUOUS'],
  ])(
    'preserves failure exposure for usage %s/%s',
    async (inputUnits, outputUnits, actual, status) => {
      const f = await ready();
      const r = await capacity(f).authorize(f.requestId, 'capacity', f.command);
      const adapter = providerDouble().mockResolvedValue({
        ...fakeIdeaResult,
        output: { items: [] },
        usage: { ...fakeIdeaResult.usage, inputUnits, outputUnits },
      });
      await expect(
        executor(f).execute(
          'project',
          'IDEA_GENERATION',
          executionCommand(r),
          'failed-output-accounting',
        ),
      ).rejects.toThrow();
      const run = f.database
        .prepare("SELECT * FROM intelligence_runs WHERE idempotency_key='failed-output-accounting'")
        .get()!;
      expect(run).toMatchObject({
        status: 'FAILED_PERMANENT',
        actual_cost: actual === null ? null : Number(actual) / 1_000_000,
      });
      expect(JSON.parse(String(run.safe_metadata_json))).toMatchObject({
        actualMicrousd: actual,
        accountingPolicy: 'exact_decimal_total_ceil_microusd_v1',
      });
      expect(
        f.database
          .prepare(
            'SELECT status,reserved_microusd,actual_microusd FROM editorial_execution_reservations WHERE envelope_id=?',
          )
          .get(r.envelopeId),
      ).toEqual({ status, reserved_microusd: 177920, actual_microusd: actual });
      // Same exposure expression used by the persisted D1 budget/envelope guards.
      for (const [column, id] of [
        ['project_execution_budget_id', r.budgetId],
        ['envelope_id', r.envelopeId],
      ]) {
        expect(
          f.database
            .prepare(
              `SELECT SUM(CASE status WHEN 'RECONCILED' THEN actual_microusd WHEN 'CANCELLED' THEN 0 WHEN 'AMBIGUOUS' THEN MAX(reserved_microusd,COALESCE(actual_microusd,reserved_microusd)) ELSE reserved_microusd END) total FROM editorial_execution_reservations WHERE ${column}=?`,
            )
            .get(id!),
        ).toEqual({ total: actual ?? 177920 });
      }
      expect(
        f.database
          .prepare('SELECT COUNT(*) n FROM audit_events WHERE id=?')
          .get(String(run.terminal_audit_event_id)),
      ).toEqual({ n: 1 });
      expect(
        f.database
          .prepare('SELECT COUNT(*) n FROM editorial_idea_revision_capacity_recoveries')
          .get(),
      ).toEqual({ n: 0 });
      expect(
        f.database
          .prepare('SELECT COUNT(*) n FROM intelligence_run_attempts WHERE intelligence_run_id=?')
          .get(String(run.id)),
      ).toEqual({ n: 1 });
      await expect(
        executor(f).execute(
          'project',
          'IDEA_GENERATION',
          executionCommand(r),
          'unauthorized-second-execution',
        ),
      ).rejects.toThrow();
      expect(adapter).toHaveBeenCalledTimes(1);
      expect(globalThis.fetch).not.toHaveBeenCalled();
      expect(f.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      f.database.close();
    },
  );

  it('reconciles the canonical 630/1244 usage identically in Run, reservation and budget', async () => {
    const f = await ready();
    const r = await capacity(f).authorize(f.requestId, 'capacity', f.command);
    const adapter = providerDouble().mockResolvedValue({
      ...fakeIdeaResult,
      usage: { ...fakeIdeaResult.usage, inputUnits: 630, outputUnits: 1244 },
    });
    const result = await executor(f).execute(
      'project',
      'IDEA_GENERATION',
      executionCommand(r),
      'canonical-accounting',
    );
    expect(result.run).toMatchObject({
      status: 'SUCCEEDED',
      actualCost: 0.016188,
      currency: 'USD',
    });
    const run = f.database
      .prepare('SELECT actual_cost,safe_metadata_json FROM intelligence_runs WHERE id=?')
      .get(String(result.run.id))!;
    expect(run.actual_cost).toBe(0.016188);
    expect(JSON.parse(String(run.safe_metadata_json))).toMatchObject({
      actualMicrousd: 16188,
      accountingPolicy: 'exact_decimal_total_ceil_microusd_v1',
    });
    expect(
      f.database
        .prepare(
          'SELECT status,actual_microusd FROM editorial_execution_reservations WHERE intelligence_run_id=?',
        )
        .get(String(result.run.id)),
    ).toEqual({ status: 'RECONCILED', actual_microusd: 16188 });
    expect(
      f.database
        .prepare(
          'SELECT SUM(actual_microusd) total FROM editorial_execution_reservations WHERE project_execution_budget_id=?',
        )
        .get(r.budgetId),
    ).toEqual({ total: 16188 });
    expect(
      f.database
        .prepare(
          'SELECT SUM(actual_microusd) total FROM editorial_execution_reservations WHERE envelope_id=?',
        )
        .get(r.envelopeId),
    ).toEqual({ total: 16188 });
    expect(adapter).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(f.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    f.database.close();
  });

  it('persists one successful result, requires human selection/approval and replays once consumed', async () => {
    const f = await ready();
    const r = await capacity(f).authorize(f.requestId, 'capacity', f.command);
    const adapter = providerDouble();
    const ex = executor(f);
    const command = executionCommand(r);
    const before = counts(f.database);
    const first = await ex.execute('project', 'IDEA_GENERATION', command, 'execution');
    expect(first.run.status).toBe('SUCCEEDED');
    expect(adapter).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(adapter.mock.calls[0]![0]).toMatchObject({
      modelKey: 'gpt-5.6-terra',
      promptVersionId: 'prompt_version_idea_generation_v1',
      maxOutputTokens: 8000,
      timeoutMs: 90000,
      reasoningEffort: 'medium',
    });
    expect(counts(f.database).map((n, i) => n - before[i]!)).toEqual([0, 0, 1, 0, 1, 1, 1]);
    expect(
      f.database
        .prepare(
          'SELECT status,reserved_microusd,actual_microusd FROM editorial_execution_reservations WHERE envelope_id=?',
        )
        .get(r.envelopeId),
    ).toEqual({ status: 'RECONCILED', reserved_microusd: 177920, actual_microusd: 260 });
    expect(
      f.database
        .prepare('SELECT status FROM editorial_execution_envelopes WHERE id=?')
        .get(r.envelopeId),
    ).toEqual({ status: 'CONSUMED' });
    const ideas = f.database
      .prepare(
        'SELECT artifact_version_id,status FROM idea_candidates WHERE artifact_version_id IN (SELECT id FROM editorial_artifact_versions WHERE intelligence_run_id=?)',
      )
      .all(String(first.run.id));
    expect(ideas).toHaveLength(1);
    expect(ideas[0]!.status).toBe('CANDIDATE');
    expect(
      f.database
        .prepare('SELECT count(*) n FROM artifact_approvals WHERE artifact_version_id=?')
        .get(ideas[0]!.artifact_version_id!),
    ).toEqual({ n: 0 });
    expect(
      f.database
        .prepare(
          'SELECT source_artifact_version_id,dependency_type,validity_status FROM artifact_dependencies WHERE dependent_artifact_version_id=?',
        )
        .all(ideas[0]!.artifact_version_id!),
    ).toEqual([
      {
        source_artifact_version_id: r.researchVersionId,
        dependency_type: 'GENERATED_FROM',
        validity_status: 'CURRENT',
      },
    ]);
    expect(
      f.database.prepare('SELECT count(*) n FROM editorial_revision_request_resolutions').get(),
    ).toEqual({ n: 0 });
    const after = counts(f.database);
    expect(
      (await ex.execute('project', 'IDEA_GENERATION', command, 'execution')).idempotentReplay,
    ).toBe(true);
    await expect(ex.execute('project', 'IDEA_GENERATION', command, 'second-key')).rejects.toThrow(
      'binding_invalid',
    );
    expect(counts(f.database)).toEqual(after);
    expect(adapter).toHaveBeenCalledTimes(1);
    expect(f.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    f.database.close();
  });
  it.each([
    'unapproved',
    'superseded',
    'approval-rejected',
    'request-closed',
    'project-version',
    'project-status',
    'budget-cancelled',
    'schema-degraded',
    'schema-race',
  ])('never dispatches after post-reservation eligibility loss: %s', async (kind) => {
    const f = await ready();
    const r = await capacity(f).authorize(f.requestId, 'capacity', f.command);
    const adapter = providerDouble();
    const original = f.d1.batch.bind(f.d1);
    let injected = false;
    const beforeIdeas = count(f.database, 'idea_candidates');
    f.d1.batch = async <T>(statements: D1PreparedStatement[]) => {
      const sql = (statements[0] as unknown as Statement).sql;
      if (
        kind === 'schema-race' &&
        sql.startsWith("UPDATE editorial_execution_reservations SET status='DISPATCHED'")
      ) {
        f.database.exec('DROP TRIGGER idea_revision_capacity_dispatch_guard');
        injected = true;
      }
      const result = await original<T>(statements);
      if (
        !injected &&
        (statements as unknown as Statement[]).some((s) =>
          s.sql.includes('INSERT INTO editorial_execution_reservations'),
        )
      ) {
        if (kind === 'schema-race') return result;
        injected = true;
        if (kind === 'unapproved')
          f.database.exec(
            "UPDATE editorial_artifacts SET status='active',version=version+1 WHERE id='research'",
          );
        if (kind === 'superseded')
          f.database.exec(
            "UPDATE editorial_artifacts SET current_version_id='research-v1',version=version+1 WHERE id='research'",
          );
        if (kind === 'approval-rejected') {
          f.database
            .prepare(
              "INSERT INTO artifact_approvals(id,workspace_id,artifact_version_id,decision,actor_id,actor_role,decided_at) VALUES('rejection','workspace',?,'REJECTED','owner','owner','t')",
            )
            .run(r.researchVersionId);
          f.database.exec(
            "UPDATE editorial_artifacts SET status='rejected',version=version+1 WHERE id='research'",
          );
        }
        if (kind === 'request-closed') resolveRequestFixture(f, r.auditEventId);
        if (kind === 'project-version')
          f.database.exec("UPDATE projects SET version=version+1 WHERE id='project'");
        if (kind === 'project-status')
          f.database.exec(
            "UPDATE projects SET status='DRAFT',version=version+1 WHERE id='project'",
          );
        if (kind === 'budget-cancelled')
          f.database
            .prepare(
              "UPDATE editorial_project_execution_budgets SET status='CANCELLED',version=version+1 WHERE id=?",
            )
            .run(r.budgetId);
        if (kind === 'schema-degraded')
          f.database.exec('DROP TRIGGER idea_revision_capacity_dispatch_guard');
      }
      return result;
    };
    await expect(
      executor(f).execute('project', 'IDEA_GENERATION', executionCommand(r), 'race-key'),
    ).rejects.toThrow(/idea_revision_(dispatch_ineligible|schema_unavailable)/);
    expect(injected).toBe(true);
    expect(adapter).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(
      f.database
        .prepare(
          'SELECT status,actual_cost,input_units,output_units FROM intelligence_runs WHERE idempotency_key=?',
        )
        .get('race-key'),
    ).toEqual({ status: 'FAILED_PERMANENT', actual_cost: 0, input_units: 0, output_units: 0 });
    expect(
      f.database
        .prepare(
          'SELECT status,actual_microusd,dispatched_at FROM editorial_execution_reservations WHERE envelope_id=?',
        )
        .get(r.envelopeId),
    ).toEqual({ status: 'CANCELLED', actual_microusd: 0, dispatched_at: null });
    expect(count(f.database, 'intelligence_run_attempts')).toBe(0);
    expect(count(f.database, 'idea_candidates')).toBe(beforeIdeas);
    expect(
      f.database
        .prepare("SELECT count(*) n FROM audit_events WHERE action='intelligence.run_failed'")
        .get(),
    ).toEqual({ n: 1 });
    expect(f.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    f.database.close();
  });
  it.each([
    'ordinary',
    'wrong-research',
    'wrong-project',
    'wrong-workspace',
    'wrong-request',
    'mixed-selector',
  ])('rejects %s before adapter or reservation', async (kind) => {
    const f = await ready();
    const r = await capacity(f).authorize(f.requestId, 'capacity', f.command);
    const adapter = providerDouble();
    const command: ReturnType<typeof executionCommand> & {
      remediationId?: string;
      ideaRevisionCapacityId?: string;
    } = executionCommand(r);
    if (kind === 'ordinary')
      delete (command as { ideaRevisionCapacityId?: string }).ideaRevisionCapacityId;
    if (kind === 'wrong-research') command.inputArtifactVersionId = 'research-v1';
    if (kind === 'mixed-selector') command.remediationId = 'other';
    if (kind === 'wrong-request') resolveRequestFixture(f, r.auditEventId);
    const before = counts(f.database);
    await expect(
      executor(
        f,
        kind === 'wrong-workspace'
          ? { id: 'other-user', workspaceId: 'other', roles: ['owner'] }
          : actor,
      ).execute(
        kind === 'wrong-project' ? 'other-project' : 'project',
        'IDEA_GENERATION',
        command,
        'invalid-key',
      ),
    ).rejects.toThrow();
    expect(counts(f.database)).toEqual(before);
    expect(adapter).not.toHaveBeenCalled();
    expect(
      f.database
        .prepare('SELECT status FROM editorial_execution_envelopes WHERE id=?')
        .get(r.envelopeId),
    ).toEqual({ status: 'ACTIVE' });
    f.database.close();
  });
  it('rolls back all dispatch initialization when the attempt insert fails', async () => {
    const f = await ready();
    const r = await capacity(f).authorize(f.requestId, 'capacity', f.command);
    const adapter = providerDouble();
    f.database.exec(
      "CREATE TRIGGER fail_attempt BEFORE INSERT ON intelligence_run_attempts BEGIN SELECT RAISE(ABORT,'injected'); END;",
    );
    await expect(
      executor(f).execute('project', 'IDEA_GENERATION', executionCommand(r), 'init-failure'),
    ).rejects.toThrow('dispatch_not_committed');
    expect(adapter).not.toHaveBeenCalled();
    expect(count(f.database, 'intelligence_run_attempts')).toBe(0);
    expect(
      f.database
        .prepare(
          'SELECT status,dispatched_at,actual_microusd FROM editorial_execution_reservations WHERE envelope_id=?',
        )
        .get(r.envelopeId),
    ).toEqual({ status: 'CANCELLED', dispatched_at: null, actual_microusd: 0 });
    expect(f.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    f.database.close();
  });
});

describe('controlled Idea execution HTTP errors', () => {
  it.each(['schema13', 'wrong-research', 'closed', 'stale'])(
    'maps %s without 503 or internal SQL',
    async (kind) => {
      const f = await ready(kind !== 'schema13');
      const adapter = providerDouble();
      const r =
        kind === 'schema13'
          ? { capacityId: 'capacity', researchVersionId: f.command.expectedResearchVersionId }
          : await capacity(f).authorize(f.requestId, 'capacity', f.command);
      const command = executionCommand(r);
      if (kind === 'wrong-research') command.inputArtifactVersionId = 'research-v1';
      if (kind === 'closed' && 'auditEventId' in r)
        resolveRequestFixture(f, String(r.auditEventId));
      if (kind === 'stale')
        f.database.exec("UPDATE projects SET version=version+1 WHERE id='project'");
      const response = await revisionPost(f.d1, '/api/v1/projects/project/ideas/generate', command);
      expect(response.status).toBe(kind === 'schema13' ? 422 : 409);
      const body = await response.text();
      expect(body).toContain(
        kind === 'schema13'
          ? 'idea_revision_schema_unavailable'
          : 'idea_revision_execution_binding_invalid',
      );
      expect(body).not.toMatch(/SQLITE|SELECT |TRIGGER|stack|editorial_idea_revision_capacities/);
      expect(adapter).not.toHaveBeenCalled();
      f.database.close();
    },
  );
});

const historicalDiagnostic = JSON.stringify({
  validationDiagnostic: {
    validationLayer: 'application_schema',
    schemaVersion: 'storyboard-output-v2',
    totalIssueCount: 1,
    capturedIssueCount: 1,
    truncated: false,
    issues: [
      {
        code: 'custom',
        path: [],
        pathTruncated: false,
        category: 'duplicate_continuity_key',
        message: 'Value does not satisfy the active output contract.',
      },
    ],
  },
});

async function historicalStoryboard(f: Awaited<ReturnType<typeof ready>>, chained = true) {
  f.database.exec(`
    INSERT INTO editorial_project_execution_budgets(id,workspace_id,project_id,profile_key,profile_version,currency,monetary_ceiling_microusd,status,authorized_by,created_at,updated_at,version) VALUES
      ('root-budget','workspace','project','phase3_storyboard_remediation_v1',1,'USD',321920,'ACTIVE','owner','t','t',1);
    INSERT INTO editorial_execution_envelopes(id,workspace_id,project_id,profile_key,profile_version,provider_id,provider_model_id,currency,monetary_ceiling_microusd,maximum_calls,status,authorized_by,created_at,updated_at,version,project_execution_budget_id,stage_key) VALUES
      ('historical-storyboard-envelope','workspace','project','phase3_terminal_graph_v1',1,'provider_openai','model_openai_gpt_5_6_terra_20260903','USD',321920,1,'ACTIVE','owner','t','t',2,'original-budget','STORYBOARD_PLANNER'),
      ('root-envelope','workspace','project','phase3_storyboard_remediation_v1',1,'provider_openai','model_openai_gpt_5_6_terra_20260903','USD',321920,1,'ACTIVE','owner','t','t',1,'root-budget','STORYBOARD_PLANNER');
    INSERT INTO intelligence_runs(id,workspace_id,project_id,task_type,provider_id,provider_model_id,initiated_by,operating_mode,status,idempotency_key,error_category,safe_error_detail,created_at,updated_at) VALUES
      ('root-run','workspace','project','STORYBOARD_PLANNER','provider_openai','model_openai_gpt_5_6_terra_20260903','owner','ASSISTED','RUNNING','root-run-key',NULL,NULL,'t','t');
    INSERT INTO intelligence_run_attempts(id,intelligence_run_id,attempt_number,attempt_kind,status,error_category,safe_error_detail,started_at,completed_at) VALUES('root-attempt','root-run',1,'TECHNICAL','FAILED_PERMANENT','SCHEMA_VALIDATION','schema_validation_failed','t','t');
    INSERT INTO editorial_execution_reservations(id,envelope_id,workspace_id,project_id,intelligence_run_id,step_key,pricing_snapshot_id,reserved_microusd,actual_microusd,status,created_at,dispatched_at,reconciled_at,project_execution_budget_id) VALUES('root-reservation','historical-storyboard-envelope','workspace','project','root-run','STORYBOARD_PLANNER','pricing_model_openai_gpt_5_6_terra_20260903',321920,NULL,'AMBIGUOUS','t','t',NULL,'original-budget');
    UPDATE editorial_execution_envelopes SET status='CONSUMED',version=2 WHERE id='historical-storyboard-envelope';
    INSERT INTO audit_events(id,workspace_id,actor_type,action,resource_type,resource_id,outcome,request_id,environment,metadata_json,occurred_at,ingested_at) VALUES
      ('root-terminal','workspace','system','intelligence.run_failed','intelligence_run','root-run','failure','r','test','{}','t','t'),
      ('root-auth','workspace','user','editorial.remediation_capacity_authorized','editorial_execution_remediation','root-remediation','success','r','test','{}','t','t');
    UPDATE intelligence_runs SET status='FAILED_PERMANENT',error_category='SCHEMA_VALIDATION',safe_error_detail='schema_validation_failed',terminal_audit_event_id='root-terminal' WHERE id='root-run';
    INSERT INTO editorial_execution_remediations(id,workspace_id,project_id,original_project_execution_budget_id,expected_original_budget_version,historical_reservation_id,historical_run_id,historical_envelope_id,remediation_project_execution_budget_id,remediation_envelope_id,profile_key,profile_version,stage_key,provider_id,provider_model_id,additional_exposure_microusd,maximum_calls,maximum_attempts,sdk_max_retries,fallback_enabled,creative_regeneration_enabled,external_research_enabled,human_approval_required,reason_category,idempotency_key,command_hash,audit_event_id,authorized_by,created_at)
      VALUES('root-remediation','workspace','project','original-budget',1,'root-reservation','root-run','historical-storyboard-envelope','root-budget','root-envelope','phase3_storyboard_remediation_v1',1,'STORYBOARD_PLANNER','provider_openai','model_openai_gpt_5_6_terra_20260903',321920,1,1,0,0,0,0,1,'PROVIDER_OUTPUT_SCHEMA_VALIDATION_AMBIGUOUS','root-key','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','root-auth','owner','t');
`);
  if (!chained)
    return {
      remediationId: 'root-remediation',
      budgetId: 'root-budget',
      envelopeId: 'root-envelope',
    };
  f.database.exec(`
    INSERT INTO intelligence_runs(id,workspace_id,project_id,task_type,provider_id,provider_model_id,initiated_by,operating_mode,status,idempotency_key,error_category,safe_error_detail,safe_metadata_json,created_at,updated_at) VALUES('child-run','workspace','project','STORYBOARD_PLANNER','provider_openai','model_openai_gpt_5_6_terra_20260903','owner','ASSISTED','RUNNING','child-run-key',NULL,NULL,'${historicalDiagnostic}','t','t');
    INSERT INTO audit_events(id,workspace_id,actor_type,action,resource_type,resource_id,outcome,request_id,environment,metadata_json,occurred_at,ingested_at) VALUES('child-terminal','workspace','system','intelligence.run_failed','intelligence_run','child-run','failure','r2','test','{}','t','t');
    INSERT INTO intelligence_run_attempts(id,intelligence_run_id,attempt_number,attempt_kind,status,error_category,safe_error_detail,safe_metadata_json,started_at,completed_at) VALUES('child-attempt','child-run',1,'TECHNICAL','FAILED_PERMANENT','SCHEMA_VALIDATION','Provider output failed validation.','${historicalDiagnostic}','t','t');
    UPDATE intelligence_runs SET status='FAILED_PERMANENT',error_category='SCHEMA_VALIDATION',safe_error_detail='Provider output failed validation.',terminal_audit_event_id='child-terminal' WHERE id='child-run';
    INSERT INTO editorial_execution_reservations(id,envelope_id,workspace_id,project_id,intelligence_run_id,step_key,pricing_snapshot_id,reserved_microusd,actual_microusd,status,created_at,dispatched_at,reconciled_at,project_execution_budget_id) VALUES('child-reservation','root-envelope','workspace','project','child-run','STORYBOARD_PLANNER','pricing_model_openai_gpt_5_6_terra_20260903',321920,88480,'RECONCILED','t','t','t','root-budget');
    UPDATE editorial_execution_envelopes SET status='CONSUMED',version=2 WHERE id='root-envelope';
`);

  return new GovernedChainedRemediationService(f.d1, actor, {
    requestId: 'historical-chain',
    environment: 'test',
    accessIssuer: 'issuer',
    accessSubject: 'subject',
  }).authorize('project', 'chain-history', {
    workspaceId: 'workspace',
    parentRemediationId: 'root-remediation',
    historicalRunId: 'child-run',
    remediationStage: 'STORYBOARD_PLANNER',
    providerKey: 'openai',
    modelKey: 'gpt-5.6-terra',
    remediationCeilingMicrousd: 321920,
    maximumCalls: 1,
    remediationProfileKey: 'phase3_storyboard_chained_remediation_v2',
    remediationProfileVersion: 2,
    reasonCategory: 'SCHEMA_VALIDATION_DUPLICATE_CONTINUITY_KEY',
  });
}

describe('populated schema 0013 upgrade and historical dispatch isolation', () => {
  it('preserves every historical row across exactly migration 0014, including both Storyboard remediations', async () => {
    const f = await ready(false, true);
    const chain = await historicalStoryboard(f);
    await populateHistoricalChainedExecution(f, chain);
    const tables = f.database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()
      .map((t) => String(t.name));
    const snapshot = () =>
      tables.map((t) => ({ table: t, rows: f.database.prepare(`SELECT * FROM "${t}"`).all() }));
    const before = snapshot();
    expect(count(f.database, 'editorial_execution_remediations')).toBe(1);
    expect(count(f.database, 'editorial_chained_execution_remediations')).toBe(1);
    expect(count(f.database, 'editorial_execution_reservations')).toBe(4);
    expect(count(f.database, 'intelligence_run_attempts')).toBe(4);
    expect(count(f.database, 'editorial_revision_requests')).toBe(1);
    expect(count(f.database, 'artifact_approvals')).toBeGreaterThan(0);
    expect(count(f.database, 'artifact_dependencies')).toBeGreaterThan(0);
    expect(await ideaRevisionSchemaReady(f.d1)).toBe(false);
    f.database.exec(migration(migration14));
    expect(snapshot()).toEqual(before);
    expect(count(f.database, 'editorial_idea_revision_capacity_recoveries')).toBe(0);
    expect(await ideaRevisionSchemaReady(f.d1)).toBe(true);
    expect(f.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    await expect(
      loadGovernedRemediationEnvelope(
        f.d1,
        actor,
        'project',
        'STORYBOARD_PLANNER',
        { providerKey: 'openai', modelKey: 'gpt-5.6-terra' },
        chain.remediationId,
      ),
    ).rejects.toThrow('binding is invalid');
    await expect(
      loadGovernedRemediationEnvelope(
        f.d1,
        actor,
        'project',
        'STORYBOARD_PLANNER',
        { providerKey: 'openai', modelKey: 'gpt-5.6-terra' },
        'root-remediation',
      ),
    ).rejects.toThrow('binding is invalid');
    const r = await capacity(f).authorize(f.requestId, 'new-idea-capacity', f.command);
    // Existing rows remain byte/value identical even when the new feature is used.
    for (const table of before) {
      const after = f.database.prepare(`SELECT * FROM "${table.table}"`).all();
      for (const row of table.rows) expect(after).toContainEqual(row);
    }
    expect(r.monetaryCeilingMicrousd).toBe(177920);
    f.database.close();
  });
  it.each([false, true])(
    'keeps actual Storyboard reservation/observer dispatch behavior, chained=%s',
    async (chained) => {
      const f = await ready(false, true);
      const r = await historicalStoryboard(f, chained);
      f.database.exec(migration(migration14));
      const envelope = await loadGovernedRemediationEnvelope(
        f.d1,
        actor,
        'project',
        'STORYBOARD_PLANNER',
        { providerKey: 'openai', modelKey: 'gpt-5.6-terra' },
        r.remediationId,
      );
      expect(envelope.id).toBe(r.envelopeId);
      f.database.exec(
        "INSERT INTO intelligence_runs(id,workspace_id,project_id,task_type,provider_id,provider_model_id,input_artifact_version_id,initiated_by,operating_mode,status,idempotency_key,created_at,updated_at) VALUES('storyboard-execution','workspace','project','STORYBOARD_PLANNER','provider_openai','model_openai_gpt_5_6_terra_20260903','script-v1','owner','ASSISTED','QUEUED','storyboard-execution','t','t')",
      );
      f.database
        .prepare(
          "INSERT INTO editorial_execution_reservations(id,envelope_id,workspace_id,project_id,intelligence_run_id,step_key,pricing_snapshot_id,reserved_microusd,status,created_at,project_execution_budget_id) VALUES('storyboard-reservation',?,'workspace','project','storyboard-execution','STORYBOARD_PLANNER','pricing_model_openai_gpt_5_6_terra_20260903',321920,'RESERVED','t',?)",
        )
        .run(r.envelopeId, r.budgetId);
      f.database
        .prepare(
          "UPDATE editorial_execution_envelopes SET status='CONSUMED',version=version+1 WHERE id=?",
        )
        .run(r.envelopeId);
      // Exercise the unchanged production observer, not a reimplementation of it.
      const observer = (
        executor(f) as unknown as { observer(id: string): { started(n: number): Promise<void> } }
      ).observer('storyboard-execution');
      await observer.started(1);
      expect(
        f.database
          .prepare("SELECT status FROM intelligence_runs WHERE id='storyboard-execution'")
          .get(),
      ).toEqual({ status: 'RUNNING' });
      expect(
        f.database
          .prepare(
            "SELECT status FROM editorial_execution_reservations WHERE id='storyboard-reservation'",
          )
          .get(),
      ).toEqual({ status: 'DISPATCHED' });
      expect(
        f.database
          .prepare(
            "SELECT count(*) n FROM intelligence_run_attempts WHERE intelligence_run_id='storyboard-execution'",
          )
          .get(),
      ).toEqual({ n: 1 });
      await expect(
        loadGovernedRemediationEnvelope(
          f.d1,
          actor,
          'project',
          'STORYBOARD_PLANNER',
          { providerKey: 'openai', modelKey: 'gpt-5.6-terra' },
          r.remediationId,
        ),
      ).rejects.toThrow();
      expect(f.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      f.database.close();
    },
  );
});

type LocalFailure = Awaited<ReturnType<typeof failedRecoveryFixture>>;
async function failedRecoveryFixture(
  kind: 'project-version' | 'provider' = 'project-version',
  environment = 'test',
) {
  const f = await ready();
  const admin = new IdeaRevisionCapacityService(f.d1, actor, {
    requestId: 'local-recovery',
    environment,
  });
  const c = await admin.authorize(f.requestId, 'original-capacity', f.command);
  const adapter = providerDouble();
  const original = f.d1.batch.bind(f.d1);
  let injected = false;
  f.d1.batch = async <T>(statements: D1PreparedStatement[]) => {
    const result = await original<T>(statements);
    if (
      !injected &&
      (statements as unknown as Statement[]).some((x) =>
        x.sql.includes('INSERT INTO editorial_execution_reservations'),
      )
    ) {
      injected = true;
      f.database.exec(
        kind === 'project-version'
          ? "UPDATE projects SET version=3 WHERE id='project'"
          : "UPDATE ai_providers SET status='inactive' WHERE id='provider_openai'",
      );
    }
    return result;
  };
  await expect(
    executor(f, actor, environment).execute(
      'project',
      'IDEA_GENERATION',
      executionCommand(c),
      'original-failed-execution',
    ),
  ).rejects.toThrow('dispatch_ineligible');
  f.d1.batch = original;
  expect(adapter).not.toHaveBeenCalled();
  if (kind === 'provider')
    f.database.exec("UPDATE ai_providers SET status='configured' WHERE id='provider_openai'");
  const run = f.database
    .prepare("SELECT * FROM intelligence_runs WHERE idempotency_key='original-failed-execution'")
    .get()!;
  const reservation = f.database
    .prepare('SELECT * FROM editorial_execution_reservations WHERE envelope_id=?')
    .get(c.envelopeId)!;
  expect(run.status).toBe('FAILED_PERMANENT');
  expect(reservation.status).toBe('CANCELLED');
  return {
    ...f,
    c,
    admin,
    adapter,
    run,
    reservation,
    environment,
    recoveryCommand: {
      expectedFailedRunId: String(run.id),
      expectedFailedReservationId: String(reservation.id),
      expectedProjectVersion: kind === 'project-version' ? 3 : 2,
    },
  };
}
function allLocalRows(db: DatabaseSync) {
  return db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map((t) => ({
      table: t.name,
      rows: db.prepare('SELECT * FROM "' + String(t.name) + '"').all(),
    }));
}
function originalRecoveryHistory(f: LocalFailure) {
  return [
    ['editorial_idea_revision_capacities', f.c.capacityId],
    ['editorial_project_execution_budgets', f.c.budgetId],
    ['editorial_execution_envelopes', f.c.envelopeId],
    ['editorial_execution_reservations', f.reservation.id],
    ['intelligence_runs', f.run.id],
    ['audit_events', f.run.terminal_audit_event_id],
  ].map(([t, id]) => f.database.prepare('SELECT * FROM ' + String(t) + ' WHERE id=?').get(id!));
}
const recoveryCountTables = [
  'editorial_project_execution_budgets',
  'editorial_execution_envelopes',
  'audit_events',
  'editorial_idea_revision_capacities',
  'editorial_idea_revision_capacity_recoveries',
  'editorial_execution_reservations',
  'intelligence_runs',
  'intelligence_run_attempts',
  'editorial_artifact_versions',
  'artifact_dependencies',
  'artifact_approvals',
];
const recoveryCounts = (db: DatabaseSync) => recoveryCountTables.map((t) => count(db, t));

describe('one bounded recovery after a durable zero-provider failure', () => {
  it.each(['project-version', 'provider'] as const)(
    'recovers %s and executes exactly once without changing original history',
    async (kind) => {
      const f = await failedRecoveryFixture(kind);
      const history = originalRecoveryHistory(f),
        before = recoveryCounts(f.database);
      const r = await f.admin.recover(f.c.capacityId, 'recovery-key', f.recoveryCommand);
      expect(recoveryCounts(f.database).map((n, i) => n - before[i]!)).toEqual([
        0, 1, 1, 0, 1, 0, 0, 0, 0, 0, 0,
      ]);
      expect(originalRecoveryHistory(f)).toEqual(history);
      expect(r.budgetId).toBe(f.c.budgetId);
      expect(r.originalProjectVersion).toBe(2);
      expect(r.recoveryProjectVersion).toBe(f.recoveryCommand.expectedProjectVersion);
      expect(f.adapter).not.toHaveBeenCalled();
      const oldReplay = await executor(f).execute(
        'project',
        'IDEA_GENERATION',
        executionCommand(f.c),
        'original-failed-execution',
      );
      expect(oldReplay.idempotentReplay).toBe(true);
      expect(oldReplay.run.status).toBe('FAILED_PERMANENT');
      const success = await executor(f).execute(
        'project',
        'IDEA_GENERATION',
        executionCommand(f.c),
        'replacement-execution',
      );
      expect(success.run.status).toBe('SUCCEEDED');
      expect(f.adapter).toHaveBeenCalledTimes(1);
      const reservation = f.database
        .prepare(
          'SELECT status,reserved_microusd,actual_microusd FROM editorial_execution_reservations WHERE envelope_id=?',
        )
        .get(r.replacementEnvelopeId);
      expect(reservation).toEqual({
        status: 'RECONCILED',
        reserved_microusd: 177920,
        actual_microusd: 260,
      });
      expect(
        f.database
          .prepare('SELECT status FROM editorial_execution_envelopes WHERE id=?')
          .get(r.replacementEnvelopeId),
      ).toEqual({ status: 'CONSUMED' });
      const idea = f.database
        .prepare(
          'SELECT artifact_version_id,status FROM idea_candidates WHERE artifact_version_id IN (SELECT id FROM editorial_artifact_versions WHERE intelligence_run_id=?)',
        )
        .get(String(success.run.id))!;
      expect(idea.status).toBe('CANDIDATE');
      expect(
        f.database
          .prepare('SELECT count(*) n FROM artifact_approvals WHERE artifact_version_id=?')
          .get(idea.artifact_version_id!),
      ).toEqual({ n: 0 });
      expect(
        f.database
          .prepare(
            'SELECT source_artifact_version_id,dependency_type,validity_status FROM artifact_dependencies WHERE dependent_artifact_version_id=?',
          )
          .all(idea.artifact_version_id!),
      ).toEqual([
        {
          source_artifact_version_id: f.c.researchVersionId,
          dependency_type: 'GENERATED_FROM',
          validity_status: 'CURRENT',
        },
      ]);
      expect(originalRecoveryHistory(f)).toEqual(history);
      const after = allLocalRows(f.database);
      expect(await f.admin.recover(f.c.capacityId, 'recovery-key', f.recoveryCommand)).toEqual({
        ...r,
        idempotentReplay: true,
      });
      await expect(
        f.admin.recover(f.c.capacityId, 'another-recovery', f.recoveryCommand),
      ).rejects.toThrow('recovery_exhausted');
      expect(
        (
          await executor(f).execute(
            'project',
            'IDEA_GENERATION',
            executionCommand(f.c),
            'replacement-execution',
          )
        ).idempotentReplay,
      ).toBe(true);
      await expect(
        executor(f).execute('project', 'IDEA_GENERATION', executionCommand(f.c), 'third-execution'),
      ).rejects.toThrow('binding_invalid');
      expect(allLocalRows(f.database)).toEqual(after);
      expect(f.adapter).toHaveBeenCalledTimes(1);
      expect(f.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      expect(globalThis.fetch).not.toHaveBeenCalled();
      f.database.close();
    },
  );
  it('rejects a changed recovery command under the same trimmed idempotency key', async () => {
    const f = await failedRecoveryFixture();
    const first = await f.admin.recover(f.c.capacityId, ' key ', f.recoveryCommand);
    expect(await f.admin.recover(f.c.capacityId, 'key', f.recoveryCommand)).toEqual({
      ...first,
      idempotentReplay: true,
    });
    const before = allLocalRows(f.database);
    await expect(
      f.admin.recover(f.c.capacityId, 'key', { ...f.recoveryCommand, expectedProjectVersion: 4 }),
    ).rejects.toThrow('idempotency_conflict');
    expect(allLocalRows(f.database)).toEqual(before);
    f.database.close();
  });
  it.each([false, true])('serializes recovery competitors; same key %s', async (same) => {
    const f = await failedRecoveryFixture(),
      before = recoveryCounts(f.database);
    const results = await Promise.allSettled([
      f.admin.recover(f.c.capacityId, 'recovery-one', f.recoveryCommand),
      f.admin.recover(f.c.capacityId, same ? 'recovery-one' : 'recovery-two', f.recoveryCommand),
    ]);
    expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(same ? 2 : 1);
    expect(recoveryCounts(f.database).map((n, i) => n - before[i]!)).toEqual([
      0, 1, 1, 0, 1, 0, 0, 0, 0, 0, 0,
    ]);
    expect(f.adapter).not.toHaveBeenCalled();
    f.database.close();
  });
  it.each([
    'editorial_execution_envelopes',
    'audit_events',
    'editorial_idea_revision_capacity_recoveries',
  ])('rolls back every recovery write when %s fails', async (table) => {
    const f = await failedRecoveryFixture();
    f.database.exec(
      'CREATE TRIGGER local_injected_failure BEFORE INSERT ON ' +
        table +
        " BEGIN SELECT RAISE(ABORT,'injected'); END;",
    );
    const before = allLocalRows(f.database);
    await expect(f.admin.recover(f.c.capacityId, 'recovery', f.recoveryCommand)).rejects.toThrow(
      'recovery_conflict',
    );
    expect(allLocalRows(f.database)).toEqual(before);
    expect(f.adapter).not.toHaveBeenCalled();
    f.database.close();
  });
  it('revalidates the project atomically when eligibility changes after precheck', async () => {
    const f = await failedRecoveryFixture(),
      before = recoveryCounts(f.database);
    const original = f.d1.batch.bind(f.d1);
    f.d1.batch = (statements) => {
      f.database.exec("UPDATE projects SET version=4 WHERE id='project'");
      return original(statements);
    };
    await expect(f.admin.recover(f.c.capacityId, 'recovery', f.recoveryCommand)).rejects.toThrow(
      'recovery_conflict',
    );
    expect(recoveryCounts(f.database)).toEqual(before);
    expect(f.adapter).not.toHaveBeenCalled();
    f.database.close();
  });
  it('fails atomically if recovery schema is degraded between precheck and batch', async () => {
    const f = await failedRecoveryFixture(),
      before = recoveryCounts(f.database);
    const original = f.d1.batch.bind(f.d1);
    f.d1.batch = (statements) => {
      f.database.exec('DROP TRIGGER idea_revision_recovery_current_guard');
      return original(statements);
    };
    await expect(f.admin.recover(f.c.capacityId, 'recovery', f.recoveryCommand)).rejects.toThrow(
      'recovery_conflict',
    );
    expect(recoveryCounts(f.database)).toEqual(before);
    expect(f.adapter).not.toHaveBeenCalled();
    f.database.close();
  });
  it('never permits a second recovery after a replacement pre-dispatch failure', async () => {
    const f = await failedRecoveryFixture();
    const r = await f.admin.recover(f.c.capacityId, 'recovery', f.recoveryCommand);
    const history = originalRecoveryHistory(f),
      original = f.d1.batch.bind(f.d1);
    let injected = false;
    f.d1.batch = async <T>(statements: D1PreparedStatement[]) => {
      const result = await original<T>(statements);
      if (
        !injected &&
        (statements as unknown as Statement[]).some((s) =>
          s.sql.includes('INSERT INTO editorial_execution_reservations'),
        )
      ) {
        injected = true;
        f.database.exec("UPDATE projects SET version=4 WHERE id='project'");
      }
      return result;
    };
    await expect(
      executor(f).execute('project', 'IDEA_GENERATION', executionCommand(f.c), 'replacement-fails'),
    ).rejects.toThrow('dispatch_ineligible');
    f.d1.batch = original;
    expect(f.adapter).not.toHaveBeenCalled();
    const run = f.database
      .prepare("SELECT id,status FROM intelligence_runs WHERE idempotency_key='replacement-fails'")
      .get()!;
    const reservation = f.database
      .prepare(
        'SELECT id,status,actual_microusd,dispatched_at FROM editorial_execution_reservations WHERE envelope_id=?',
      )
      .get(r.replacementEnvelopeId)!;
    expect(run.status).toBe('FAILED_PERMANENT');
    expect(reservation).toMatchObject({
      status: 'CANCELLED',
      actual_microusd: 0,
      dispatched_at: null,
    });
    const before = allLocalRows(f.database);
    await expect(
      f.admin.recover(f.c.capacityId, 'second-recovery', {
        expectedFailedRunId: String(run.id),
        expectedFailedReservationId: String(reservation.id),
        expectedProjectVersion: 4,
      }),
    ).rejects.toThrow('recovery_exhausted');
    expect(allLocalRows(f.database)).toEqual(before);
    expect(originalRecoveryHistory(f)).toEqual(history);
    expect(count(f.database, 'intelligence_run_attempts')).toBe(0);
    expect(f.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    f.database.close();
  });
});

describe('recovery rejects unsafe or semantically invalid failure evidence', () => {
  it.each([
    'superseded',
    'closed-request',
    'approval-invalid',
    'provider-inactive',
    'model-inactive',
    'prompt-inactive',
    'pricing-ineligible',
    'budget-inactive',
    'attempt',
    'provider-request',
    'provider-response',
    'dispatch',
    'positive-reservation-cost',
    'positive-run-cost',
    'output-pointer',
    'output-version',
    'missing-proof',
    'wrong-failure',
    'success-already-exists',
  ] as const)('blocks %s without partial writes', async (kind) => {
    const f = await failedRecoveryFixture(),
      db = f.database;
    if (kind === 'superseded')
      db.exec(
        "UPDATE editorial_artifacts SET current_version_id='research-v1',version=version+1 WHERE id='research'",
      );
    if (kind === 'closed-request') resolveRequestFixture(f, f.c.auditEventId);
    if (kind === 'approval-invalid')
      db.prepare(
        "INSERT INTO artifact_approvals(id,workspace_id,artifact_version_id,decision,actor_id,actor_role,decided_at) VALUES('invalidating-approval','workspace',?,'REJECTED','owner','owner','t')",
      ).run(f.c.researchVersionId);
    if (kind === 'provider-inactive') db.exec("UPDATE ai_providers SET status='inactive'");
    if (kind === 'model-inactive') db.exec("UPDATE ai_provider_models SET status='inactive'");
    if (kind === 'prompt-inactive')
      db.exec("UPDATE prompt_definitions SET status='inactive' WHERE id='prompt_idea_generation'");
    if (kind === 'pricing-ineligible')
      db.exec("UPDATE ai_pricing_snapshots SET verification_status='stale'");
    if (kind === 'budget-inactive')
      db.prepare(
        "UPDATE editorial_project_execution_budgets SET status='CANCELLED',version=version+1 WHERE id=?",
      ).run(f.c.budgetId);
    if (kind === 'attempt' || kind === 'provider-request')
      db.prepare(
        "INSERT INTO intelligence_run_attempts(id,intelligence_run_id,attempt_number,attempt_kind,status,provider_request_id,started_at) VALUES('contradictory-attempt',?,1,'TECHNICAL','RUNNING',?,'t')",
      ).run(f.run.id!, kind === 'provider-request' ? 'provider-request' : null);
    if (kind === 'provider-response')
      db.prepare(
        "UPDATE intelligence_runs SET safe_metadata_json=json_set(safe_metadata_json,'$.providerResponseId','response') WHERE id=?",
      ).run(f.run.id!);
    if (kind === 'dispatch')
      db.prepare("UPDATE editorial_execution_reservations SET dispatched_at='t' WHERE id=?").run(
        f.reservation.id!,
      );
    if (kind === 'positive-reservation-cost')
      db.prepare('UPDATE editorial_execution_reservations SET actual_microusd=1 WHERE id=?').run(
        f.reservation.id!,
      );
    if (kind === 'positive-run-cost')
      db.prepare('UPDATE intelligence_runs SET actual_cost=0.000001 WHERE id=?').run(f.run.id!);
    if (kind === 'output-pointer')
      db.prepare(
        "UPDATE intelligence_runs SET output_artifact_version_id='idea-v1' WHERE id=?",
      ).run(f.run.id!);
    if (kind === 'output-version') {
      db.exec(
        "INSERT INTO editorial_artifacts(id,workspace_id,project_id,artifact_type,current_version_id,status,created_at,updated_at,version) VALUES('contradictory-output','workspace','project','IDEA_CANDIDATE','contradictory-version','active','t','t',1)",
      );
      db.prepare(
        "INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,language_code,content_text,source_type,intelligence_run_id,content_hash,created_at,created_by) VALUES('contradictory-version','workspace','contradictory-output',1,'de','output','AI_GENERATED',?,?,'t','owner')",
      ).run(f.run.id!, 'd'.repeat(64));
    }
    if (kind === 'missing-proof')
      db.prepare(
        "UPDATE intelligence_runs SET safe_metadata_json=json_remove(safe_metadata_json,'$.preDispatchFailure') WHERE id=?",
      ).run(f.run.id!);
    if (kind === 'wrong-failure')
      db.prepare("UPDATE intelligence_runs SET safe_error_detail='another_failure' WHERE id=?").run(
        f.run.id!,
      );
    if (kind === 'success-already-exists') {
      db.prepare(
        "INSERT INTO intelligence_runs(id,workspace_id,project_id,task_type,input_artifact_version_id,initiated_by,operating_mode,status,idempotency_key,created_at,updated_at) VALUES('already-generated','workspace','project','IDEA_GENERATION',?,'owner','ASSISTED','QUEUED','already-generated','t','t')",
      ).run(f.c.researchVersionId);
      db.exec(
        "INSERT INTO audit_events(id,workspace_id,actor_type,action,resource_type,resource_id,outcome,request_id,environment,metadata_json,occurred_at,ingested_at) VALUES('already-generated-audit','workspace','system','intelligence.run_completed','intelligence_run','already-generated','success','t','test','{}','t','t'); UPDATE intelligence_runs SET status='SUCCEEDED',terminal_audit_event_id='already-generated-audit' WHERE id='already-generated'",
      );
    }
    const before = allLocalRows(db);
    await expect(f.admin.recover(f.c.capacityId, 'recovery', f.recoveryCommand)).rejects.toThrow(
      'not_recoverable',
    );
    expect(allLocalRows(db)).toEqual(before);
    expect(f.adapter).not.toHaveBeenCalled();
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    db.close();
  });
  it('rejects recovery after actual fake-provider dispatch and success', async () => {
    const f = await ready(),
      c = await capacity(f).authorize(f.requestId, 'capacity', f.command),
      adapter = providerDouble();
    const result = await executor(f).execute(
      'project',
      'IDEA_GENERATION',
      executionCommand(c),
      'successful-execution',
    );
    const reservation = f.database
      .prepare('SELECT id FROM editorial_execution_reservations WHERE envelope_id=?')
      .get(c.envelopeId)!;
    const before = allLocalRows(f.database);
    await expect(
      capacity(f).recover(c.capacityId, 'recovery', {
        expectedFailedRunId: String(result.run.id),
        expectedFailedReservationId: String(reservation.id),
        expectedProjectVersion: 2,
      }),
    ).rejects.toThrow('not_recoverable');
    expect(allLocalRows(f.database)).toEqual(before);
    expect(adapter).toHaveBeenCalledTimes(1);
    f.database.close();
  });
  it.each(['expectedFailedRunId', 'expectedFailedReservationId'] as const)(
    'rejects mismatched %s',
    async (key) => {
      const f = await failedRecoveryFixture(),
        before = allLocalRows(f.database);
      await expect(
        f.admin.recover(f.c.capacityId, 'recovery', {
          ...f.recoveryCommand,
          [key]: 'wrong-identity',
        }),
      ).rejects.toThrow('not_recoverable');
      expect(allLocalRows(f.database)).toEqual(before);
      f.database.close();
    },
  );
  it('rejects an unrelated existing replacement envelope without adopting it', async () => {
    const f = await failedRecoveryFixture(),
      e = f.database
        .prepare('SELECT * FROM editorial_execution_envelopes WHERE id=?')
        .get(f.c.envelopeId)!;
    const copy = { ...e, id: 'unlinked-envelope', status: 'ACTIVE', version: 1 },
      keys = Object.keys(copy);
    f.database
      .prepare(
        'INSERT INTO editorial_execution_envelopes(' +
          keys.join(',') +
          ') VALUES(' +
          keys.map(() => '?').join(',') +
          ')',
      )
      .run(...Object.values(copy));
    const before = allLocalRows(f.database);
    await expect(f.admin.recover(f.c.capacityId, 'recovery', f.recoveryCommand)).rejects.toThrow(
      'recovery_conflict',
    );
    expect(allLocalRows(f.database)).toEqual(before);
    f.database.close();
  });
  it.each([
    'workspace_id',
    'project_id',
    'research_version_id',
    'research_approval_id',
    'budget_id',
    'original_envelope_id',
    'failed_run_id',
    'failed_reservation_id',
    'provider_model_id',
    'recovery_project_version',
  ] as const)('rolls back a forged recovery %s at the DB boundary', async (column) => {
    const f = await failedRecoveryFixture(),
      before = allLocalRows(f.database),
      original = f.d1.batch.bind(f.d1);
    f.d1.batch = (statements) => {
      const receipt = (statements as unknown as Statement[]).find((s) =>
        s.sql.startsWith('INSERT INTO editorial_idea_revision_capacity_recoveries'),
      )!;
      const names = receipt.sql
        .slice(receipt.sql.indexOf('(') + 1, receipt.sql.indexOf(')'))
        .split(',');
      receipt.values[names.indexOf(column) + 1] =
        column === 'recovery_project_version' ? 999 : 'forged-value';
      return original(statements);
    };
    await expect(f.admin.recover(f.c.capacityId, 'recovery', f.recoveryCommand)).rejects.toThrow(
      'recovery_conflict',
    );
    expect(allLocalRows(f.database)).toEqual(before);
    f.database.close();
  });
  it('rejects mismatched recovery audit metadata atomically', async () => {
    const f = await failedRecoveryFixture(),
      before = allLocalRows(f.database),
      original = f.d1.batch.bind(f.d1);
    f.d1.batch = (statements) => {
      const audit = (statements as unknown as Statement[]).find((s) =>
        s.sql.startsWith('INSERT INTO audit_events'),
      )!;
      const raw = audit.values[7];
      if (typeof raw !== 'string') throw new Error('Expected audit JSON text');
      const value = JSON.parse(raw) as Record<string, unknown>;
      value.failedRunId = 'other-run';
      audit.values[7] = JSON.stringify(value);
      return original(statements);
    };
    await expect(f.admin.recover(f.c.capacityId, 'recovery', f.recoveryCommand)).rejects.toThrow(
      'recovery_conflict',
    );
    expect(allLocalRows(f.database)).toEqual(before);
    f.database.close();
  });
});
describe('recovery receipt and historical immutability', () => {
  it('freezes original rows while preserving normal replacement lifecycle', async () => {
    const f = await failedRecoveryFixture(),
      r = await f.admin.recover(f.c.capacityId, 'recovery', f.recoveryCommand);
    for (const [table, id] of [
      ['editorial_idea_revision_capacities', f.c.capacityId],
      ['editorial_idea_revision_capacity_recoveries', r.recoveryId],
      ['editorial_project_execution_budgets', f.c.budgetId],
      ['editorial_execution_envelopes', f.c.envelopeId],
      ['editorial_execution_reservations', String(f.reservation.id)],
      ['intelligence_runs', String(f.run.id)],
    ]) {
      const before = allLocalRows(f.database);
      expect(() =>
        f.database.prepare('UPDATE ' + table + ' SET id=id WHERE id=?').run(id!),
      ).toThrow();
      expect(() => f.database.prepare('DELETE FROM ' + table + ' WHERE id=?').run(id!)).toThrow();
      expect(allLocalRows(f.database)).toEqual(before);
    }
    expect(() =>
      f.database
        .prepare(
          "UPDATE editorial_execution_envelopes SET provider_model_id='wrong-model' WHERE id=?",
        )
        .run(r.replacementEnvelopeId),
    ).toThrow();
    await expect(
      loadGovernedTerminalEnvelope(f.d1, actor, 'project', 'IDEA_GENERATION', {
        providerKey: 'openai',
        modelKey: 'gpt-5.6-terra',
      }),
    ).rejects.toThrow();
    expect(f.adapter).not.toHaveBeenCalled();
    f.database.close();
  });
  it.each(['extra', 'wrong-type', 'wrong-binding'] as const)(
    'strictly rejects persisted recovery result %s',
    async (kind) => {
      const f = await failedRecoveryFixture(),
        r = await f.admin.recover(f.c.capacityId, 'recovery', f.recoveryCommand);
      const trigger = f.database
        .prepare("SELECT sql FROM sqlite_master WHERE name='idea_revision_recovery_no_update'")
        .get()!;
      f.database.exec('DROP TRIGGER idea_revision_recovery_no_update');
      const row = f.database
        .prepare('SELECT result_json FROM editorial_idea_revision_capacity_recoveries WHERE id=?')
        .get(r.recoveryId)!;
      const value = JSON.parse(String(row.result_json)) as Record<string, unknown>;
      if (kind === 'extra') value.extra = true;
      if (kind === 'wrong-type') value.recoveryProjectVersion = '3';
      if (kind === 'wrong-binding') value.failedRunId = 'wrong-run';
      f.database
        .prepare('UPDATE editorial_idea_revision_capacity_recoveries SET result_json=? WHERE id=?')
        .run(JSON.stringify(value), r.recoveryId);
      f.database.exec(String(trigger.sql));
      const before = allLocalRows(f.database);
      await expect(f.admin.recover(f.c.capacityId, 'recovery', f.recoveryCommand)).rejects.toThrow(
        'receipt_invalid',
      );
      await expect(
        loadIdeaRevisionCapacity(f.d1, actor, 'project', f.c.capacityId, f.c.researchVersionId),
      ).rejects.toThrow('receipt_invalid');
      expect(allLocalRows(f.database)).toEqual(before);
      f.database.close();
    },
  );
});
describe('recovery HTTP boundary', () => {
  it('requires providers:admin and rejects malformed/stale/scoped requests without writes', async () => {
    const f = await failedRecoveryFixture('project-version', 'staging');
    const url = '/api/v1/editorial-idea-revision-capacities/' + f.c.capacityId + '/recover';
    const before = allLocalRows(f.database);
    for (const [body, key, status] of [
      [{ ...f.recoveryCommand, maximumCalls: 2 }, 'key', 422],
      [f.recoveryCommand, ' ', 422],
      [f.recoveryCommand, 'x'.repeat(201), 422],
      [{ ...f.recoveryCommand, expectedProjectVersion: 2 }, 'key', 409],
    ] as const) {
      const response = await revisionPost(f.d1, url, body, key);
      expect(response.status).toBe(status);
      expect(await response.text()).not.toMatch(/SQLITE|constraint|trigger/i);
    }
    const missing = await revisionPost(
      f.d1,
      '/api/v1/editorial-idea-revision-capacities/missing-capacity/recover',
      f.recoveryCommand,
    );
    expect(missing.status).toBe(404);
    expect(allLocalRows(f.database)).toEqual(before);
    f.database.exec("UPDATE user_roles SET role_id='role_viewer' WHERE user_id='owner'");
    expect((await revisionPost(f.d1, url, f.recoveryCommand)).status).toBe(403);
    f.database.close();
  });
  it('returns 201 then exact 200 replay with one audit and no provider', async () => {
    const f = await failedRecoveryFixture('project-version', 'staging');
    const url = '/api/v1/editorial-idea-revision-capacities/' + f.c.capacityId + '/recover';
    const response = await revisionPost(f.d1, url, f.recoveryCommand, ' recovery ');
    expect(response.status).toBe(201);
    const body = await response.json<Record<string, unknown>>();
    const replay = await revisionPost(f.d1, url, f.recoveryCommand, 'recovery');
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({ ...body, idempotentReplay: true });
    expect(count(f.database, 'editorial_idea_revision_capacity_recoveries')).toBe(1);
    expect(
      f.database
        .prepare(
          "SELECT count(*) n FROM audit_events WHERE action='editorial.idea_revision_capacity_recovered'",
        )
        .get(),
    ).toEqual({ n: 1 });
    expect(f.adapter).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
    f.database.close();
  });
  it('fails closed on missing recovery schema at HTTP boundary', async () => {
    const f = await failedRecoveryFixture('project-version', 'staging');
    f.database.exec('DROP TRIGGER idea_revision_recovery_failure_guard');
    const before = allLocalRows(f.database);
    const response = await revisionPost(
      f.d1,
      '/api/v1/editorial-idea-revision-capacities/' + f.c.capacityId + '/recover',
      f.recoveryCommand,
    );
    expect(response.status).toBe(422);
    expect((await response.json<{ detail: string }>()).detail).toBe(
      'idea_revision_schema_unavailable',
    );
    expect(allLocalRows(f.database)).toEqual(before);
    f.database.close();
  });
});

function depth100(f: { database: DatabaseSync }, statements: D1PreparedStatement[]) {
  const ddl = f.database
    .prepare(
      "SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'",
    )
    .all();
  const tables = ddl
    .filter((d) => d.type === 'table')
    .map((d) => ({
      name: d.name,
      rows: f.database.prepare(`SELECT * FROM "${String(d.name)}"`).all(),
    }));
  const batch = (statements as unknown as Statement[]).map((s) => ({
    sql: s.sql,
    values: s.values,
  }));
  const py = spawnSync(
    'python',
    [
      '-c',
      `
import json,sqlite3,sys
p=json.load(sys.stdin);d=sqlite3.connect(':memory:')
for x in p['ddl']:
 if x['type']=='table':d.execute(x['sql'])
for t in p['tables']:
 for r in t['rows']:
  cols={x[1] for x in d.execute('PRAGMA table_info('+t['name']+')')}
  r={k:v for k,v in r.items() if k in cols}
  d.execute('INSERT INTO "'+t['name']+'"('+','.join('"'+k+'"' for k in r)+') VALUES('+','.join('?' for _ in r)+')',list(r.values()))
for x in p['ddl']:
 if x['type']!='table':d.execute(x['sql'])
d.commit();d.execute('PRAGMA foreign_keys=ON');d.setlimit(sqlite3.SQLITE_LIMIT_EXPR_DEPTH,100)
d.execute('BEGIN')
for x in p['batch']:d.execute(x['sql'],x['values'])
d.commit();assert not d.execute('PRAGMA foreign_key_check').fetchall()
print('EXPRESSION_DEPTH_100_PASS')
`,
    ],
    { input: JSON.stringify({ ddl, tables, batch }), encoding: 'utf8' },
  );
  return { status: py.status ?? -1, stderr: py.stderr, stdout: py.stdout };
}

it.each(['recovery', 'replacement-dispatch'] as const)(
  'enforces expression depth 100 for %s',
  async (kind) => {
    const f = await failedRecoveryFixture();
    let evidence: { status: number; stderr: string; stdout: string } | undefined;
    if (kind === 'replacement-dispatch')
      await f.admin.recover(f.c.capacityId, 'recovery', f.recoveryCommand);
    const original = f.d1.batch.bind(f.d1);
    f.d1.batch = (statements) => {
      const sql = (statements[0] as unknown as Statement).sql;
      if (
        (kind === 'recovery' && sql.startsWith('INSERT INTO editorial_execution_envelopes')) ||
        (kind === 'replacement-dispatch' &&
          sql.startsWith("UPDATE editorial_execution_reservations SET status='DISPATCHED'"))
      )
        evidence = depth100(f, statements);
      return original(statements);
    };
    if (kind === 'recovery') await f.admin.recover(f.c.capacityId, 'recovery', f.recoveryCommand);
    else
      await executor(f).execute(
        'project',
        'IDEA_GENERATION',
        executionCommand(f.c),
        'depth-replacement',
      );
    expect(evidence).toBeDefined();
    expect(evidence!.stderr).toBe('');
    expect(evidence!.status).toBe(0);
    expect(evidence!.stdout).toContain('EXPRESSION_DEPTH_100_PASS');
    f.database.close();
  },
);
async function populateHistoricalChainedExecution(
  f: Awaited<ReturnType<typeof ready>>,
  r: { envelopeId: string; budgetId: string },
) {
  f.database.exec(
    "INSERT INTO intelligence_runs(id,workspace_id,project_id,task_type,provider_id,provider_model_id,input_artifact_version_id,initiated_by,operating_mode,status,idempotency_key,created_at,updated_at) VALUES('historical-gen2','workspace','project','STORYBOARD_PLANNER','provider_openai','model_openai_gpt_5_6_terra_20260903','script-v1','owner','ASSISTED','QUEUED','historical-gen2','t','t')",
  );
  f.database
    .prepare(
      "INSERT INTO editorial_execution_reservations(id,envelope_id,workspace_id,project_id,intelligence_run_id,step_key,pricing_snapshot_id,reserved_microusd,status,created_at,project_execution_budget_id) VALUES('historical-gen2-reservation',?,'workspace','project','historical-gen2','STORYBOARD_PLANNER','pricing_model_openai_gpt_5_6_terra_20260903',321920,'RESERVED','t',?)",
    )
    .run(r.envelopeId, r.budgetId);
  f.database
    .prepare(
      "UPDATE editorial_execution_envelopes SET status='CONSUMED',version=version+1 WHERE id=?",
    )
    .run(r.envelopeId);
  await (executor(f) as unknown as { observer(id: string): { started(n: number): Promise<void> } })
    .observer('historical-gen2')
    .started(1);
  f.database.exec(
    "INSERT INTO audit_events(id,workspace_id,actor_type,action,resource_type,resource_id,outcome,request_id,environment,metadata_json,occurred_at,ingested_at) VALUES('historical-gen2-terminal','workspace','system','intelligence.run_failed','intelligence_run','historical-gen2','failure','local-gen2','test','{}','t','t'); UPDATE intelligence_run_attempts SET status='FAILED_PERMANENT',error_category='SCHEMA_VALIDATION',completed_at='t2' WHERE intelligence_run_id='historical-gen2'; UPDATE editorial_execution_reservations SET status='RECONCILED',actual_microusd=88480,reconciled_at='t2' WHERE id='historical-gen2-reservation'; UPDATE intelligence_runs SET status='FAILED_PERMANENT',error_category='SCHEMA_VALIDATION',actual_cost=0.08848,terminal_audit_event_id='historical-gen2-terminal',completed_at='t2',version=version+1 WHERE id='historical-gen2'",
  );
}
async function distinctRequestB(f: Awaited<ReturnType<typeof ready>>) {
  f.database.exec(
    "INSERT INTO projects(id,workspace_id,content_brand_id,channel_profile_id,title,status,format,operating_mode,primary_language,created_at,updated_at,version) VALUES('project-B','workspace','brand','channel','Project B','ANALYZING','SHORT','ASSISTED','de','t','t',2); INSERT INTO editorial_artifacts(id,workspace_id,project_id,artifact_type,current_version_id,status,created_at,updated_at,version,created_by,updated_by) VALUES('research-B','workspace','project-B','RESEARCH','research-B-v1','approved','t','t',2,'owner','owner'),('storyboard-B','workspace','project-B','STORYBOARD','storyboard-B-v1','active','t','t',2,'owner','owner')",
  );
  f.database
    .prepare(
      "INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,language_code,content_text,source_type,content_hash,created_at,created_by) VALUES('research-B-v1','workspace','research-B',1,'de','Research B','HUMAN_EDITED',?,'t','owner'),('storyboard-B-v1','workspace','storyboard-B',1,'de','Storyboard B','HUMAN_EDITED',?,'t','owner')",
    )
    .run('b'.repeat(64), 'c'.repeat(64));
  f.database.exec(
    "INSERT INTO artifact_approvals(id,workspace_id,artifact_version_id,decision,actor_id,actor_role,decided_at) VALUES('approval-B-v1','workspace','research-B-v1','APPROVED','owner','owner','t')",
  );
  const request = await service(f.d1).request('storyboard-B-v1', 'request-B', command);
  const research = await importer(f.d1).create(String(request.id), 'import-B', {
    ...imported,
    expectedResearchArtifactId: 'research-B',
    expectedParentVersionId: 'research-B-v1',
  });
  const approval = await revisionPost(
    f.d1,
    '/api/v1/editorial-artifact-versions/' + research.versionId + '/approve',
    { decision: 'APPROVED', comment: null },
  );
  expect(approval.status).toBe(201);
  return { requestId: String(request.id), researchVersionId: research.versionId };
}
it('rejects capacity and recovery A in distinct existing request B context', async () => {
  const f = await failedRecoveryFixture();
  const r = await f.admin.recover(f.c.capacityId, 'recovery', f.recoveryCommand);
  const b = await distinctRequestB(f);
  expect(b.requestId).not.toBe(f.requestId);
  const before = allLocalRows(f.database);
  await expect(
    capacity(f).authorize(b.requestId, 'wrong-request', {
      ...f.command,
      expectedProjectVersion: 2,
    }),
  ).rejects.toThrow('ineligible');
  await expect(
    executor(f).execute(
      'project-B',
      'IDEA_GENERATION',
      { ...executionCommand(f.c), inputArtifactVersionId: b.researchVersionId },
      'wrong-context',
    ),
  ).rejects.toThrow('binding_invalid');
  const loaded = await loadIdeaRevisionCapacity(
    f.d1,
    actor,
    'project',
    f.c.capacityId,
    f.c.researchVersionId,
  );
  expect(loaded.id).toBe(r.replacementEnvelopeId);
  expect(allLocalRows(f.database)).toEqual(before);
  expect(f.adapter).not.toHaveBeenCalled();
  expect(f.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  f.database.close();
});

describe('replacement execution binding and dispatch races', () => {
  it('rejects a reservation for an unlinked second envelope under the same budget', async () => {
    const f = await failedRecoveryFixture();
    const envelope = {
      ...f.database
        .prepare('SELECT * FROM editorial_execution_envelopes WHERE id=?')
        .get(f.c.envelopeId)!,
      id: 'unlinked-envelope',
      status: 'ACTIVE',
      version: 1,
    };
    const run = {
      ...f.run,
      id: 'unlinked-run',
      status: 'QUEUED',
      idempotency_key: 'unlinked-execution',
      terminal_audit_event_id: null,
      completed_at: null,
      error_category: null,
      safe_error_detail: null,
      safe_metadata_json: JSON.stringify({ ideaRevisionCapacityId: f.c.capacityId }),
    };
    for (const [table, row] of [
      ['editorial_execution_envelopes', envelope],
      ['intelligence_runs', run],
    ] as const) {
      const columns = Object.keys(row);
      f.database
        .prepare(
          'INSERT INTO ' +
            table +
            '(' +
            columns.join(',') +
            ') VALUES(' +
            columns.map(() => '?').join(',') +
            ')',
        )
        .run(...Object.values(row));
    }
    const before = allLocalRows(f.database);
    expect(() =>
      f.database
        .prepare(
          "INSERT INTO editorial_execution_reservations(id,envelope_id,workspace_id,project_id,intelligence_run_id,step_key,pricing_snapshot_id,reserved_microusd,status,created_at,project_execution_budget_id) VALUES('unlinked-reservation','unlinked-envelope','workspace','project','unlinked-run','IDEA_GENERATION','pricing_model_openai_gpt_5_6_terra_20260903',177920,'RESERVED','t',?)",
        )
        .run(f.c.budgetId),
    ).toThrow('idea_revision_capacity_invalid');
    expect(allLocalRows(f.database)).toEqual(before);
    expect(f.adapter).not.toHaveBeenCalled();
    f.database.close();
  });
  it('rejects forged replacement recovery metadata inside the real reservation batch', async () => {
    const f = await failedRecoveryFixture();
    await f.admin.recover(f.c.capacityId, 'recovery', f.recoveryCommand);
    const before = allLocalRows(f.database),
      original = f.d1.batch.bind(f.d1);
    f.d1.batch = (statements) => {
      const run = (statements as unknown as Statement[]).find((s) =>
        s.sql.includes('INSERT OR IGNORE INTO intelligence_runs'),
      );
      if (run) {
        const index = run.values.findIndex(
          (v) => typeof v === 'string' && v.includes('"ideaRevisionRecoveryId"'),
        );
        expect(index).toBeGreaterThanOrEqual(0);
        const raw = run.values[index];
        if (typeof raw !== 'string') throw new Error('Expected Run metadata JSON text');
        const metadata = JSON.parse(raw) as Record<string, unknown>;
        metadata.ideaRevisionRecoveryId = 'unlinked-recovery';
        run.values[index] = JSON.stringify(metadata);
      }
      return original(statements);
    };
    await expect(
      executor(f).execute('project', 'IDEA_GENERATION', executionCommand(f.c), 'forged-recovery'),
    ).rejects.toThrow();
    expect(allLocalRows(f.database)).toEqual(before);
    expect(f.adapter).not.toHaveBeenCalled();
    f.database.close();
  });
  it('allows exactly one fake provider execution for concurrent replacement execution keys', async () => {
    const f = await failedRecoveryFixture();
    await f.admin.recover(f.c.capacityId, 'recovery', f.recoveryCommand);
    const before = {
      runs: count(f.database, 'intelligence_runs'),
      reservations: count(f.database, 'editorial_execution_reservations'),
      attempts: count(f.database, 'intelligence_run_attempts'),
    };
    const results = await Promise.allSettled(
      ['replacement-A', 'replacement-B'].map((key) =>
        executor(f).execute('project', 'IDEA_GENERATION', executionCommand(f.c), key),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(f.adapter).toHaveBeenCalledTimes(1);
    expect(count(f.database, 'intelligence_runs')).toBe(before.runs + 1);
    expect(
      f.database
        .prepare(
          "SELECT status,count(*) n FROM intelligence_runs WHERE idempotency_key IN ('replacement-A','replacement-B') GROUP BY status ORDER BY status",
        )
        .all(),
    ).toEqual([{ status: 'SUCCEEDED', n: 1 }]);
    expect(count(f.database, 'editorial_execution_reservations')).toBe(before.reservations + 1);
    expect(count(f.database, 'intelligence_run_attempts')).toBe(before.attempts + 1);
    expect(count(f.database, 'editorial_idea_revision_capacity_recoveries')).toBe(1);
    expect(f.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    f.database.close();
  });
  it.each([
    'research-superseded',
    'request-closed',
    'approval-invalid',
    'provider-inactive',
  ] as const)(
    'rechecks %s after replacement reservation and before provider dispatch',
    async (kind) => {
      const f = await failedRecoveryFixture(),
        r = await f.admin.recover(f.c.capacityId, 'recovery', f.recoveryCommand);
      const original = f.d1.batch.bind(f.d1),
        history = originalRecoveryHistory(f);
      let injected = false;
      f.d1.batch = async <T>(statements: D1PreparedStatement[]) => {
        const result = await original<T>(statements);
        if (
          !injected &&
          (statements as unknown as Statement[]).some((s) =>
            s.sql.includes('INSERT INTO editorial_execution_reservations'),
          )
        ) {
          injected = true;
          if (kind === 'research-superseded')
            f.database.exec(
              "UPDATE editorial_artifacts SET current_version_id='research-v1',version=version+1 WHERE id='research'",
            );
          if (kind === 'request-closed') resolveRequestFixture(f, f.c.auditEventId);
          if (kind === 'approval-invalid')
            f.database
              .prepare(
                "INSERT INTO artifact_approvals(id,workspace_id,artifact_version_id,decision,actor_id,actor_role,decided_at) VALUES('invalidating-approval','workspace',?,'REJECTED','owner','owner','t')",
              )
              .run(f.c.researchVersionId);
          if (kind === 'provider-inactive')
            f.database.exec("UPDATE ai_providers SET status='inactive' WHERE id='provider_openai'");
        }
        return result;
      };
      await expect(
        executor(f).execute(
          'project',
          'IDEA_GENERATION',
          executionCommand(f.c),
          'replacement-race',
        ),
      ).rejects.toThrow('dispatch_ineligible');
      f.d1.batch = original;
      expect(f.adapter).not.toHaveBeenCalled();
      expect(
        f.database
          .prepare(
            'SELECT status,actual_microusd,dispatched_at FROM editorial_execution_reservations WHERE envelope_id=?',
          )
          .get(r.replacementEnvelopeId),
      ).toEqual({ status: 'CANCELLED', actual_microusd: 0, dispatched_at: null });
      expect(count(f.database, 'intelligence_run_attempts')).toBe(0);
      expect(originalRecoveryHistory(f)).toEqual(history);
      const before = allLocalRows(f.database);
      await expect(
        f.admin.recover(f.c.capacityId, 'second-recovery', f.recoveryCommand),
      ).rejects.toThrow('recovery_exhausted');
      expect(allLocalRows(f.database)).toEqual(before);
      f.database.close();
    },
  );
  it.each(['inactive-actor', 'different-workspace', 'different-environment'] as const)(
    'rejects recovery or replay for %s',
    async (kind) => {
      const f = await failedRecoveryFixture();
      await f.admin.recover(f.c.capacityId, 'recovery', f.recoveryCommand);
      if (kind === 'inactive-actor')
        f.database.exec("UPDATE users SET status='disabled' WHERE id='owner'");
      const a =
        kind === 'different-workspace'
          ? { id: 'other-user', workspaceId: 'other', roles: [...actor.roles] }
          : actor;
      const admin = new IdeaRevisionCapacityService(f.d1, a, {
        requestId: 'local-replay',
        environment: kind === 'different-environment' ? 'staging' : 'test',
      });
      const before = allLocalRows(f.database);
      await expect(admin.recover(f.c.capacityId, 'recovery', f.recoveryCommand)).rejects.toThrow();
      expect(allLocalRows(f.database)).toEqual(before);
      expect(f.adapter).not.toHaveBeenCalled();
      f.database.close();
    },
  );
  it('executes recovery and loader read queries under expression depth 100', async () => {
    const f = await failedRecoveryFixture(),
      prepared: Statement[] = [],
      original = f.d1.prepare.bind(f.d1);
    f.d1.prepare = (sql) => {
      const s = original(sql);
      if (/^\s*(SELECT|PRAGMA)/iu.test(sql)) prepared.push(s as unknown as Statement);
      return s;
    };
    await f.admin.recover(f.c.capacityId, 'recovery', f.recoveryCommand);
    await loadIdeaRevisionCapacity(f.d1, actor, 'project', f.c.capacityId, f.c.researchVersionId);
    const evidence = depth100(f, prepared as unknown as D1PreparedStatement[]);
    expect(evidence.stderr).toBe('');
    expect(evidence.status).toBe(0);
    expect(evidence.stdout).toContain('EXPRESSION_DEPTH_100_PASS');
    f.database.close();
  });
});

async function secondResearchApproval(f: Awaited<ReturnType<typeof ready>>) {
  f.database.exec(`
    INSERT INTO user_roles(workspace_id,user_id,role_id,created_at,created_by) VALUES('workspace','viewer','role_admin','t','owner');
    INSERT INTO access_identities(id,workspace_id,user_id,issuer,subject,email,last_seen_at,created_at,updated_at,version)
      VALUES('identity-second','workspace','viewer','https://team.cloudflareaccess.com','second-subject','viewer@example.test','t','t','t',1);
  `);
  const response = await createApp(() =>
    Promise.resolve({
      ...accessIdentity,
      subject: 'second-subject',
      email: 'viewer@example.test',
    }),
  ).request(
    '/api/v1/editorial-artifact-versions/' + f.command.expectedResearchVersionId + '/approve',
    {
      method: 'POST',
      headers: {
        Origin: 'https://staging.vision.directormaxson.com',
        'Content-Type': 'application/json',
        'Cf-Access-Jwt-Assertion': 'verified-by-local-test',
      },
      body: JSON.stringify({ decision: 'APPROVED', comment: null }),
    },
    revisionBindings(f.d1),
  );
  expect(response.status).toBe(201);
  return (await response.json<{ approvalId: string }>()).approvalId;
}

describe('9DI authorization linearization and sole approval', () => {
  it.each([
    'scope-removed',
    'reservation-degraded',
    'dispatch-degraded',
    'recovery-degraded',
    'project-version',
    'research-noncurrent',
    'approval-invalid',
    'request-closed',
    'additional-approval',
    'actor-inactive',
    'policy-inactive',
  ])('rolls back the entire authorization after precheck: %s', async (kind) => {
    const f = await ready();
    const adapter = providerDouble();
    const original = f.d1.batch.bind(f.d1);
    let injected = false;
    let before: number[] = [];
    f.d1.batch = async <T>(statements: D1PreparedStatement[]) => {
      if (
        !injected &&
        (statements[0] as unknown as Statement).sql.startsWith(
          'INSERT INTO editorial_project_execution_budgets',
        )
      ) {
        injected = true;
        const guard = {
          'scope-removed': 'idea_revision_capacity_scope_guard',
          'reservation-degraded': 'idea_revision_capacity_reservation_guard',
          'dispatch-degraded': 'idea_revision_capacity_dispatch_guard',
          'recovery-degraded': 'idea_revision_recovery_scope_guard',
        }[kind];
        if (guard) {
          const ddl = String(
            f.database.prepare('SELECT sql FROM sqlite_master WHERE name=?').get(guard)!.sql,
          );
          f.database.exec('DROP TRIGGER ' + guard);
          if (kind !== 'scope-removed') {
            f.database.exec(ddl.replace(/WHEN[\s\S]*?BEGIN/u, 'WHEN 0 BEGIN'));
          }
          f.database.exec("UPDATE projects SET version=3 WHERE id='project'");
        }
        if (kind === 'project-version')
          f.database.exec("UPDATE projects SET version=3 WHERE id='project'");
        if (kind === 'research-noncurrent')
          f.database.exec(
            "UPDATE editorial_artifacts SET current_version_id='research-v1',version=version+1 WHERE id='research'",
          );
        if (kind === 'approval-invalid')
          f.database
            .prepare(
              "INSERT INTO artifact_approvals(id,workspace_id,artifact_version_id,decision,actor_id,actor_role,decided_at) VALUES('new-rejection','workspace',?,'REJECTED','owner','owner','t')",
            )
            .run(f.command.expectedResearchVersionId);
        if (kind === 'request-closed')
          resolveRequestFixture(
            f,
            String(f.database.prepare('SELECT id FROM audit_events LIMIT 1').get()!.id),
          );
        if (kind === 'additional-approval') await secondResearchApproval(f);
        if (kind === 'actor-inactive')
          f.database.exec("UPDATE users SET status='disabled' WHERE id='owner'");
        if (kind === 'policy-inactive')
          f.database.exec(
            "UPDATE ai_provider_models SET status='inactive' WHERE model_key='gpt-5.6-terra'",
          );
        before = counts(f.database);
      }
      return original<T>(statements);
    };
    const response = await revisionPost(
      f.d1,
      '/api/v1/editorial-revision-requests/' + f.requestId + '/idea-generation-capacity',
      f.command,
    );
    expect(injected).toBe(true);
    expect([409, 422]).toContain(response.status);
    expect(await response.text()).not.toMatch(/SQLITE|SELECT |TRIGGER|stack|wrong-value/);
    expect(counts(f.database)).toEqual(before);
    expect(count(f.database, 'editorial_idea_revision_capacities')).toBe(0);
    expect(adapter).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(f.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    f.database.close();
  });
  it('rejects either exact approval when a second actor has approved through the real route', async () => {
    const f = await ready();
    const adapter = providerDouble();
    const second = await secondResearchApproval(f);
    const before = counts(f.database);
    const revision = Number(
      f.database.prepare("SELECT version FROM editorial_artifacts WHERE id='research'").get()!
        .version,
    );
    for (const id of [f.command.expectedResearchApprovalId, second]) {
      await expect(
        capacity(f).authorize(f.requestId, 'approval-' + id, {
          ...f.command,
          expectedResearchArtifactRevision: revision,
          expectedResearchApprovalId: id,
        }),
      ).rejects.toMatchObject({ status: 409, message: 'idea_revision_ineligible' });
      expect(counts(f.database)).toEqual(before);
    }
    expect(
      f.database
        .prepare('SELECT count(*) n FROM artifact_approvals WHERE artifact_version_id=?')
        .get(f.command.expectedResearchVersionId),
    ).toEqual({ n: 2 });
    expect(count(f.database, 'editorial_idea_revision_capacities')).toBe(0);
    expect(adapter).not.toHaveBeenCalled();
    f.database.close();
  });
  it('also rejects recovery after a second real approval', async () => {
    const f = await failedRecoveryFixture();
    await secondResearchApproval(f);
    const before = counts(f.database);
    await expect(
      f.admin.recover(f.c.capacityId, 'two-approvals-recovery', f.recoveryCommand),
    ).rejects.toThrow('not_recoverable');
    expect(counts(f.database)).toEqual(before);
    expect(f.adapter).not.toHaveBeenCalled();
    f.database.close();
  });
  it('rejects a second approval inserted after reservation and before dispatch', async () => {
    const f = await ready();
    const c = await capacity(f).authorize(f.requestId, 'capacity', f.command);
    const adapter = providerDouble();
    const batch = f.d1.batch.bind(f.d1);
    let injected = false;
    f.d1.batch = async <T>(statements: D1PreparedStatement[]) => {
      const result = await batch<T>(statements);
      if (
        !injected &&
        (statements as unknown as Statement[]).some((s) =>
          s.sql.includes('INSERT INTO editorial_execution_reservations'),
        )
      ) {
        injected = true;
        await secondResearchApproval(f);
      }
      return result;
    };
    await expect(
      executor(f).execute(
        'project',
        'IDEA_GENERATION',
        executionCommand(c),
        'second-approval-dispatch',
      ),
    ).rejects.toMatchObject({
      dispatchOutcome: 'NOT_COMMITTED',
      rejection: 'ELIGIBILITY_REJECTED',
    });
    expect(adapter).not.toHaveBeenCalled();
    expect(count(f.database, 'intelligence_run_attempts')).toBe(0);
    f.database.close();
  });
});

describe('9DI dispatch batch confirmation reconciliation', () => {
  it.each([
    'eligibility',
    'committed-lost-ack',
    'not-committed-transport',
    'unreadable-state',
  ] as const)('never redispatches or invokes provider after %s', async (kind) => {
    const f = await ready();
    const admin = capacity(f);
    const c = await admin.authorize(f.requestId, 'capacity', f.command);
    const adapter = providerDouble();
    const batch = f.d1.batch.bind(f.d1);
    const prepare = f.d1.prepare.bind(f.d1);
    let dispatchBatches = 0;
    f.d1.batch = async <T>(statements: D1PreparedStatement[]) => {
      if (
        (statements[0] as unknown as Statement).sql.startsWith(
          "UPDATE editorial_execution_reservations SET status='DISPATCHED'",
        )
      ) {
        dispatchBatches++;
        if (kind === 'eligibility') {
          f.database.exec("UPDATE projects SET version=3 WHERE id='project'");
          return batch<T>(statements);
        }
        if (kind === 'committed-lost-ack') await batch<T>(statements);
        if (kind === 'unreadable-state') {
          f.d1.prepare = (sql: string) => {
            if (sql.includes('SELECT r.status reservation_status'))
              throw new Error('injected local read unavailable');
            return prepare(sql);
          };
        }
        throw new Error('injected lost D1 confirmation, never expose this');
      }
      return batch<T>(statements);
    };
    const outcome =
      kind === 'committed-lost-ack'
        ? 'COMMITTED_NO_PROVIDER_CALL'
        : kind === 'unreadable-state'
          ? 'AMBIGUOUS'
          : 'NOT_COMMITTED';
    await expect(
      executor(f).execute('project', 'IDEA_GENERATION', executionCommand(c), 'reconcile-key'),
    ).rejects.toMatchObject({
      dispatchOutcome: outcome,
      rejection: kind === 'eligibility' ? 'ELIGIBILITY_REJECTED' : null,
      status: kind === 'eligibility' ? 409 : 500,
    });
    expect(dispatchBatches).toBe(1);
    expect(adapter).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
    const run = f.database
      .prepare("SELECT * FROM intelligence_runs WHERE idempotency_key='reconcile-key'")
      .get()!;
    const res = f.database
      .prepare('SELECT * FROM editorial_execution_reservations WHERE intelligence_run_id=?')
      .get(String(run.id))!;
    const attempts = f.database
      .prepare('SELECT * FROM intelligence_run_attempts WHERE intelligence_run_id=?')
      .all(String(run.id));
    const metadata = JSON.parse(String(run.safe_metadata_json)) as Record<string, unknown>;
    expect(run.status).toBe('FAILED_PERMANENT');
    expect(run.output_artifact_version_id).toBeNull();
    expect(run.safe_error_detail).not.toMatch(/injected|SQLITE|SELECT|TRIGGER/);
    expect(attempts).toHaveLength(kind === 'committed-lost-ack' ? 1 : 0);
    for (const attempt of attempts) {
      expect(attempt.provider_request_id).toBeNull();
      expect(attempt.attempt_number).toBe(1);
    }
    const safeZero = kind === 'eligibility' || kind === 'not-committed-transport';
    expect(res.status).toBe(
      safeZero ? 'CANCELLED' : kind === 'unreadable-state' ? 'RESERVED' : 'AMBIGUOUS',
    );
    expect(res.actual_microusd).toBe(safeZero ? 0 : null);
    expect(run.actual_cost).toBe(safeZero ? 0 : null);
    expect(run.input_units).toBe(safeZero ? 0 : null);
    expect(run.output_units).toBe(safeZero ? 0 : null);
    if (kind === 'committed-lost-ack') {
      expect(res.dispatched_at).toBeTruthy();
      expect(run.started_at).toBe(res.dispatched_at);
      expect(attempts[0]!.started_at).toBe(res.dispatched_at);
    } else {
      expect(res.dispatched_at).toBeNull();
      expect(run.started_at).toBeNull();
    }
    if (kind === 'eligibility') expect(metadata.preDispatchFailure).toBe('ELIGIBILITY_REJECTED');
    else {
      expect(metadata.preDispatchFailure).toBeUndefined();
      expect(metadata.dispatchAuthorizationOutcome).toBe(outcome);
      expect(metadata.providerAdapterInvoked).toBe(false);
      const before = counts(f.database);
      await expect(
        admin.recover(c.capacityId, 'must-not-recover', {
          expectedProjectVersion: 2,
          expectedFailedRunId: String(run.id),
          expectedFailedReservationId: String(res.id),
        }),
      ).rejects.toThrow('not_recoverable');
      expect(counts(f.database)).toEqual(before);
    }
    // Read-only idempotent replay never resumes dispatch or invokes the adapter.
    const replay = await executor(f).execute(
      'project',
      'IDEA_GENERATION',
      executionCommand(c),
      'reconcile-key',
    );
    expect(replay.idempotentReplay).toBe(true);
    expect(dispatchBatches).toBe(1);
    expect(adapter).not.toHaveBeenCalled();
    expect(
      f.database
        .prepare(
          "SELECT count(*) n FROM audit_events WHERE action='intelligence.run_failed' AND resource_id=?",
        )
        .get(String(run.id)),
    ).toEqual({ n: 1 });
    expect(f.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    f.database.close();
  });
});

it('9DI rolls back zero-cost terminal proof if dispatch commits after the reconciliation read', async () => {
  const f = await ready();
  const admin = capacity(f);
  const c = await admin.authorize(f.requestId, 'capacity', f.command);
  const adapter = providerDouble();
  const batch = f.d1.batch.bind(f.d1);
  let pending: D1PreparedStatement[] | null = null;
  let injected = false;
  let dispatchAttempts = 0;
  f.d1.batch = async <T>(statements: D1PreparedStatement[]) => {
    const first = (statements[0] as unknown as Statement).sql;
    if (first.startsWith("UPDATE editorial_execution_reservations SET status='DISPATCHED'")) {
      dispatchAttempts++;
      pending = statements;
      throw new Error('local transport lost while server batch was pending');
    }
    if (pending && !injected && first.startsWith('UPDATE intelligence_run_attempts SET status=')) {
      injected = true;
      // Finish the already submitted server batch once; not a second client dispatch.
      await batch(pending);
    }
    return batch<T>(statements);
  };
  await expect(
    executor(f).execute('project', 'IDEA_GENERATION', executionCommand(c), 'late-commit'),
  ).rejects.toMatchObject({
    status: 500,
    dispatchOutcome: 'AMBIGUOUS',
    rejection: null,
  });
  expect(dispatchAttempts).toBe(1);
  expect(injected).toBe(true);
  expect(adapter).not.toHaveBeenCalled();
  const run = f.database
    .prepare("SELECT * FROM intelligence_runs WHERE idempotency_key='late-commit'")
    .get()!;
  const res = f.database
    .prepare('SELECT * FROM editorial_execution_reservations WHERE intelligence_run_id=?')
    .get(String(run.id))!;
  expect(run.status).toBe('RUNNING');
  expect(run.actual_cost).toBeNull();
  expect(
    (JSON.parse(String(run.safe_metadata_json)) as Record<string, unknown>).preDispatchFailure,
  ).toBeUndefined();
  expect(res.status).toBe('DISPATCHED');
  expect(res.actual_microusd).toBeNull();
  expect(res.dispatched_at).toBeTruthy();
  expect(
    f.database
      .prepare(
        'SELECT status,provider_request_id FROM intelligence_run_attempts WHERE intelligence_run_id=?',
      )
      .all(String(run.id)),
  ).toEqual([{ status: 'RUNNING', provider_request_id: null }]);
  expect(
    f.database
      .prepare(
        "SELECT count(*) n FROM audit_events WHERE action='intelligence.run_failed' AND resource_id=?",
      )
      .get(String(run.id)),
  ).toEqual({ n: 0 });
  await expect(
    admin.recover(c.capacityId, 'blocked-late-commit', {
      expectedProjectVersion: 2,
      expectedFailedRunId: String(run.id),
      expectedFailedReservationId: String(res.id),
    }),
  ).rejects.toThrow('not_recoverable');
  expect(f.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  f.database.close();
});

it.each(['committed', 'unreadable'] as const)(
  '9DI returns a sanitized HTTP 500 after %s confirmation loss',
  async (kind) => {
    const f = await ready();
    const c = await capacity(f).authorize(f.requestId, 'capacity', f.command);
    const adapter = providerDouble();
    const batch = f.d1.batch.bind(f.d1);
    const prepare = f.d1.prepare.bind(f.d1);
    let submitted = 0;
    f.d1.batch = async <T>(statements: D1PreparedStatement[]) => {
      if (
        (statements[0] as unknown as Statement).sql.startsWith(
          "UPDATE editorial_execution_reservations SET status='DISPATCHED'",
        )
      ) {
        submitted++;
        if (kind === 'committed') await batch<T>(statements);
        else
          f.d1.prepare = (sql: string) => {
            if (sql.includes('SELECT r.status reservation_status'))
              throw new Error('secret raw SQL details');
            return prepare(sql);
          };
        throw new Error('secret raw SQL details');
      }
      return batch<T>(statements);
    };
    const response = await createApp(() => Promise.resolve(accessIdentity)).request(
      '/api/v1/projects/project/ideas/generate',
      {
        method: 'POST',
        headers: {
          Origin: 'https://staging.vision.directormaxson.com',
          'Content-Type': 'application/json',
          'Cf-Access-Jwt-Assertion': 'local-test',
          'Idempotency-Key': 'http-lost',
        },
        body: JSON.stringify(executionCommand(c)),
      },
      {
        ...revisionBindings(f.d1),
        OPENAI_PROVIDER_ENABLED: 'true',
        OPENAI_API_KEY: 'local-test-placeholder',
      },
    );
    expect(response.status).toBe(500);
    const body = await response.text();
    expect(body).toContain(
      kind === 'committed'
        ? 'idea_revision_dispatch_committed_confirmation_lost'
        : 'idea_revision_dispatch_ambiguous',
    );
    expect(body).not.toMatch(/secret|SQL|SELECT|TRIGGER|stack|eligibility|ineligible/);
    expect(submitted).toBe(1);
    expect(adapter).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
    f.database.close();
  },
);

describe('9DR-R1 Research-authoritative Idea revision context', () => {
  it('dispatches once with only exact Research v2, preserves history and writes only v2 lineage', async () => {
    const f = await ready(true, false, true);
    const r = await capacity(f).authorize(f.requestId, 'context-capacity', f.command);
    const adapter = providerDouble();
    const before = counts(f.database);
    const history = [
      'projects',
      'editorial_artifacts',
      'editorial_artifact_versions',
      'artifact_dependencies',
      'artifact_approvals',
      'idea_candidates',
      'editorial_revision_requests',
    ].map((table) => ({
      table,
      rows: f.database.prepare(`SELECT * FROM ${table} ORDER BY id`).all(),
    }));
    expect(
      f.database
        .prepare("SELECT validity_status FROM artifact_dependencies WHERE id='dep-rb'")
        .get(),
    ).toEqual({ validity_status: 'STALE' });
    const prepared = vi.spyOn(f.d1, 'prepare');
    try {
      const result = await executor(f).execute(
        'project',
        'IDEA_GENERATION',
        executionCommand(r),
        'context-execution',
      );
      expect(result.run.status).toBe('SUCCEEDED');
      expect(adapter).toHaveBeenCalledTimes(1);
      expect(globalThis.fetch).not.toHaveBeenCalled();
      const request = adapter.mock.calls[0]![0];
      expect(request.input).toEqual({});
      expect(request.instructions).toContain(
        'AUTHORITATIVE_RESEARCH_V2_MARKER: Ariane 5 Flight 501.',
      );
      for (const marker of [
        'STALE_RESEARCH_V1_MARKER',
        'STALE_IDEA_MARKER',
        'STALE_BRIEF_MARKER',
        'STALE_SCRIPT_MARKER',
        'STALE_TRANSLATION_MARKER',
        'STALE_CRITIQUE_MARKER',
        'STALE_STORYBOARD_MARKER',
        'research-v1',
      ])
        expect(request.instructions).not.toContain(marker);
      const context = JSON.parse(
        request.instructions.slice(request.instructions.indexOf('Context: ') + 9),
      ) as Record<string, unknown>;
      expect(context).toMatchObject({
        id: 'project',
        title: 'Project',
        description: 'Stable documentary goal',
        format: 'SHORT',
        operatingMode: 'ASSISTED',
        primaryLanguage: 'de',
        brandName: 'Brand',
        niche: 'Technology history',
        channelName: 'Channel',
        narrativeTone: 'Factual narration',
        editorialStrategyJson: '{"audience":["Learners"],"reviewLanguage":"es"}',
        reviewLocale: 'es',
        exactSource: null,
        storyboardSourceSegments: [],
        lineage: [{ sourceVersionId: r.researchVersionId, dependencyType: 'GENERATED_FROM' }],
        approvedArtifacts: [
          {
            artifactType: 'RESEARCH',
            versionId: r.researchVersionId,
            languageCode: 'de',
            contentJson: '{"summary":"AUTHORITATIVE_RESEARCH_V2_MARKER: Ariane 5 Flight 501."}',
          },
        ],
      });
      expect(context.approvedArtifacts).toHaveLength(1);
      expect(prepared.mock.calls.some(([sql]) => sql.includes('ORDER BY a.artifact_type'))).toBe(
        false,
      );
      expect(request).toMatchObject({
        modelKey: 'gpt-5.6-terra',
        promptVersionId: 'prompt_version_idea_generation_v1',
        maxOutputTokens: 8000,
        timeoutMs: 90000,
        reasoningEffort: 'medium',
      });
      expect(counts(f.database).map((n, i) => n - before[i]!)).toEqual([0, 0, 1, 0, 1, 1, 1]);
      const reservation = f.database
        .prepare(
          'SELECT envelope_id,project_execution_budget_id,status,reserved_microusd,actual_microusd,dispatched_at FROM editorial_execution_reservations WHERE intelligence_run_id=?',
        )
        .get(String(result.run.id));
      expect(reservation).toMatchObject({
        envelope_id: r.envelopeId,
        project_execution_budget_id: r.budgetId,
        status: 'RECONCILED',
        reserved_microusd: 177920,
        actual_microusd: 260,
      });
      expect(reservation?.dispatched_at).toBeTypeOf('string');
      expect(
        f.database
          .prepare('SELECT status FROM editorial_execution_envelopes WHERE id=?')
          .get(r.envelopeId),
      ).toEqual({ status: 'CONSUMED' });
      expect(
        f.database
          .prepare(
            'SELECT source_artifact_version_id,dependency_type,validity_status FROM artifact_dependencies WHERE dependent_artifact_version_id=?',
          )
          .all(String(result.run.outputArtifactVersionId)),
      ).toEqual([
        {
          source_artifact_version_id: r.researchVersionId,
          dependency_type: 'GENERATED_FROM',
          validity_status: 'CURRENT',
        },
      ]);
      expect(
        f.database
          .prepare('SELECT status FROM idea_candidates WHERE artifact_version_id=?')
          .get(String(result.run.outputArtifactVersionId)),
      ).toEqual({ status: 'CANDIDATE' });
      expect(
        f.database
          .prepare('SELECT count(*) n FROM artifact_approvals WHERE artifact_version_id=?')
          .get(String(result.run.outputArtifactVersionId)),
      ).toEqual({ n: 0 });
      expect(count(f.database, 'editorial_revision_request_resolutions')).toBe(0);
      for (const { table, rows } of history)
        for (const row of rows)
          expect(f.database.prepare(`SELECT * FROM ${table} WHERE id=?`).get(row.id!)).toEqual(row);
      expect(f.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      f.database.close();
    }
  });

  it('leaves ordinary Idea context unchanged without the revision-capacity selector', async () => {
    const f = await ready(true, false, true);
    const adapter = providerDouble();
    try {
      const ex = executor(f) as unknown as {
        projectContext(
          projectId: string,
          task: string,
          inputVersionId: string,
        ): Promise<Record<string, unknown>>;
      };
      const context = await ex.projectContext(
        'project',
        'IDEA_GENERATION',
        f.command.expectedResearchVersionId,
      );
      const serialized = JSON.stringify(context);
      expect(serialized).toContain('AUTHORITATIVE_RESEARCH_V2_MARKER');
      expect(serialized).toContain('STALE_BRIEF_MARKER');
      expect(serialized).toContain('STALE_IDEA_MARKER');
      expect(context.approvedArtifacts).toHaveLength(6);
      expect(adapter).not.toHaveBeenCalled();
      expect(globalThis.fetch).not.toHaveBeenCalled();
    } finally {
      f.database.close();
    }
  });

  it.each([
    'unapproved',
    'superseded',
    'approval-mismatch',
    'multiple-approvals',
    'wrong-input',
    'source-absent',
    'source-empty',
    'source-malformed',
    'source-race',
    'unrendered-context',
  ])('fails before reservation and provider for unsafe authoritative context: %s', async (kind) => {
    const f = await ready(true, false, true);
    const r = await capacity(f).authorize(f.requestId, 'unsafe-capacity', f.command);
    const adapter = providerDouble();
    const command = executionCommand(r);
    if (kind === 'unapproved')
      f.database.exec(
        "UPDATE editorial_artifacts SET status='active',version=version+1 WHERE id='research'",
      );
    if (kind === 'superseded')
      f.database.exec(
        "UPDATE editorial_artifacts SET current_version_id='research-v1',version=version+1 WHERE id='research'",
      );
    if (kind === 'approval-mismatch')
      f.database
        .prepare(
          "INSERT INTO artifact_approvals(id,workspace_id,artifact_version_id,decision,actor_id,actor_role,decided_at) VALUES('reject-v2','workspace',?,'REJECTED','owner','owner','t')",
        )
        .run(r.researchVersionId);
    if (kind === 'multiple-approvals') await secondResearchApproval(f);
    if (kind === 'wrong-input') command.inputArtifactVersionId = 'research-v1';

    const prepare = f.d1.prepare.bind(f.d1);
    let faultInjected = false;
    f.d1.prepare = (sql) => {
      const sourceRead = sql.startsWith('SELECT v.id versionId,a.id artifactId,a.artifact_type');
      const promptRead = sql.startsWith('SELECT pv.id,pv.template_text');
      if (sourceRead && kind === 'source-race') {
        faultInjected = true;
        f.database.exec(
          "UPDATE editorial_artifacts SET current_version_id='research-v1',version=version+1 WHERE id='research'",
        );
      }
      const statement = prepare(sql);
      // Model an unavailable/corrupt read without altering immutable source rows.
      if (
        (sourceRead && ['source-absent', 'source-empty', 'source-malformed'].includes(kind)) ||
        (promptRead && kind === 'unrendered-context')
      ) {
        const first = statement.first.bind(statement);
        statement.first = async <T>() => {
          faultInjected = true;
          const row = await first<Record<string, unknown>>();
          if (kind === 'source-absent') return null;
          if (kind === 'unrendered-context')
            return { ...row, templateText: 'No authoritative context rendered.' } as T;
          return {
            ...row,
            contentText: null,
            contentJson: kind === 'source-empty' ? '{}' : '{invalid',
          } as T;
        };
      }
      return statement;
    };
    const before = counts(f.database);
    const ideasBefore = count(f.database, 'idea_candidates');
    try {
      await expect(
        executor(f).execute('project', 'IDEA_GENERATION', command, 'unsafe-context'),
      ).rejects.toThrow(
        /idea_revision_(execution_binding_invalid|context_unavailable)|Exact approved current RESEARCH input/,
      );
      if (kind.startsWith('source-') || kind === 'unrendered-context')
        expect(faultInjected).toBe(true);
      expect(adapter).not.toHaveBeenCalled();
      expect(globalThis.fetch).not.toHaveBeenCalled();
      expect(counts(f.database)).toEqual(before);
      expect(count(f.database, 'idea_candidates')).toBe(ideasBefore);
      expect(
        f.database
          .prepare('SELECT count(*) n FROM intelligence_runs WHERE idempotency_key=?')
          .get('unsafe-context'),
      ).toEqual({ n: 0 });
      expect(
        f.database
          .prepare('SELECT count(*) n FROM editorial_execution_reservations WHERE envelope_id=?')
          .get(r.envelopeId),
      ).toEqual({ n: 0 });
      expect(
        f.database
          .prepare('SELECT status FROM editorial_execution_envelopes WHERE id=?')
          .get(r.envelopeId),
      ).toEqual({ status: 'ACTIVE' });
      expect(f.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      f.database.close();
    }
  });
});

describe('9DR-R2A literal-safe Research rendering', () => {
  const difficultSource = [
    'Backslashes: C:\\research\\source\\file.txt',
    'Double quotes: "approved source"',
    'Newlines:\nfirst line\nsecond line',
    'Unicode: español, investigación, für Größe, Straße, 😀🚀',
    'JSON-looking: {"summary":"$&","path":"C:\\notes"}',
    'Literal source placeholder: {{context_json}}',
    'Combined: $$ $& $' + String.fromCharCode(96) + " $' $1 $2 $<name>",
  ].join('\n');
  const sources = ['$&', '$$', '$' + String.fromCharCode(96), "$'", '$1', '$2', '$<name>'].map(
    (token) => 'literal ' + token + ' diagnostic token.',
  );

  it.each([...sources, difficultSource])(
    'preserves approved Research literally through the actual capacity selector: %s',
    async (sourceText) => {
      const f = await ready(true, false, true, sourceText);
      const r = await capacity(f).authorize(f.requestId, 'literal-capacity', f.command);
      const adapter = providerDouble();
      const sourceRow = () =>
        f.database
          .prepare('SELECT * FROM editorial_artifact_versions WHERE id=?')
          .get(r.researchVersionId);
      const persisted = sourceRow();
      expect(JSON.parse(String(persisted?.content_json))).toEqual({ summary: sourceText });
      try {
        const result = await executor(f).execute(
          'project',
          'IDEA_GENERATION',
          executionCommand(r),
          'literal-execution',
        );
        expect(result.run.status).toBe('SUCCEEDED');
        expect(adapter).toHaveBeenCalledTimes(1);
        expect(globalThis.fetch).not.toHaveBeenCalled();
        const request = adapter.mock.calls[0]![0];
        const rendered = JSON.parse(
          request.instructions.slice(request.instructions.indexOf('Context: ') + 9),
        ) as {
          approvedArtifacts: { versionId: string; contentJson: string }[];
        };
        expect(rendered.approvedArtifacts).toHaveLength(1);
        expect(rendered.approvedArtifacts[0]!.versionId).toBe(r.researchVersionId);
        expect(rendered.approvedArtifacts[0]!.contentJson).toBe(persisted?.content_json);
        expect(JSON.parse(rendered.approvedArtifacts[0]!.contentJson)).toEqual({
          summary: sourceText,
        });
        for (const marker of [
          'STALE_RESEARCH_V1_MARKER',
          'STALE_IDEA_MARKER',
          'STALE_BRIEF_MARKER',
          'STALE_SCRIPT_MARKER',
          'STALE_TRANSLATION_MARKER',
          'STALE_CRITIQUE_MARKER',
          'STALE_STORYBOARD_MARKER',
        ])
          expect(request.instructions).not.toContain(marker);
        expect(request.input).toEqual({});
        expect(request.promptVersionId).toBe('prompt_version_idea_generation_v1');
        expect(sourceRow()).toEqual(persisted);
        expect(
          f.database
            .prepare(
              'SELECT source_artifact_version_id,dependency_type,validity_status FROM artifact_dependencies WHERE dependent_artifact_version_id=?',
            )
            .all(String(result.run.outputArtifactVersionId)),
        ).toEqual([
          {
            source_artifact_version_id: r.researchVersionId,
            dependency_type: 'GENERATED_FROM',
            validity_status: 'CURRENT',
          },
        ]);
        expect(
          f.database
            .prepare('SELECT status FROM idea_candidates WHERE artifact_version_id=?')
            .get(String(result.run.outputArtifactVersionId)),
        ).toEqual({ status: 'CANDIDATE' });
        expect(
          f.database
            .prepare('SELECT count(*) n FROM artifact_approvals WHERE artifact_version_id=?')
            .get(String(result.run.outputArtifactVersionId)),
        ).toEqual({ n: 0 });
        expect(count(f.database, 'editorial_revision_request_resolutions')).toBe(0);
        expect(f.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      } finally {
        f.database.close();
      }
    },
  );

  it('renders every placeholder literally without recursively rendering source placeholders', () => {
    const context = { source: difficultSource, markers: sources };
    const template = 'FIRST\n{{context_json}}\nSECOND\n{{context_json}}\nEND';
    const material = providerBoundRequestMaterial(template, context, {}, { type: 'object' });
    const expected = JSON.stringify(context);
    expect(material.instructions).toBe('FIRST\n' + expected + '\nSECOND\n' + expected + '\nEND');
    const first = material.instructions.slice(
      'FIRST\n'.length,
      material.instructions.indexOf('\nSECOND\n'),
    );
    const second = material.instructions.slice(
      material.instructions.indexOf('\nSECOND\n') + '\nSECOND\n'.length,
      -'\nEND'.length,
    );
    expect(JSON.parse(first)).toEqual(context);
    expect(JSON.parse(second)).toEqual(context);
  });

  it('keeps unsupported template variables fail-closed', () => {
    expect(() =>
      providerBoundRequestMaterial(
        '{{context_json}} {{unsupported_payload}}',
        { source: difficultSource },
        {},
        { type: 'object' },
      ),
    ).toThrow('Prompt contains an unsupported variable.');
  });
});
