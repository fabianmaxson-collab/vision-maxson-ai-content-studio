import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { intelligenceCommandSchema } from '@vision-maxson/contracts';
import { OpenAIResponsesAdapter } from '@vision-maxson/providers/openai';
import { EditorialRevisionService } from '../src/editorial/revision';
import { EditorialExecutionService } from '../src/editorial/execution';
import { evaluateEditorialProductionReadiness } from '../src/editorial/readiness';
import {
  humanFixture,
  humanService,
  actor,
  snapshot,
  corrupt,
  type HumanFixture,
} from './content-brief-human-revision-fixture';

let f: HumanFixture;
let brief: string;
let provider: ReturnType<typeof vi.spyOn>;
let expectedMockDispatches = 0;
beforeEach(async () => {
  expectedMockDispatches = 0;
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network forbidden'));
  f = await humanFixture();
  const result = await humanService(f).create(f.parentId, 'local-human', f.edit);
  brief = result.versionId;
  f.database
    .prepare(
      "INSERT INTO artifact_approvals(id,workspace_id,artifact_version_id,decision,actor_id,actor_role,decided_at) VALUES('local-approval','workspace',?,'APPROVED','owner','owner','t')",
    )
    .run(brief);
  f.database.exec(
    "UPDATE editorial_artifacts SET status='approved',version=version+1 WHERE id='brief'",
  );
  provider = vi
    .spyOn(OpenAIResponsesAdapter.prototype, 'execute')
    .mockRejectedValue(new Error('Provider forbidden'));
});
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  expect(provider).toHaveBeenCalledTimes(expectedMockDispatches);
  f?.database.close();
  vi.restoreAllMocks();
});
const readiness = (input = brief) =>
  evaluateEditorialProductionReadiness(f.d1, actor, 'project', 'BEFORE_PRODUCTION_SCRIPT', {
    inputArtifactVersionId: input,
  });
const execute = (input = brief) =>
  new EditorialExecutionService(f.d1, actor, {
    openAIEnabled: true,
    openAIApiKey: 'fixture',
    openAIBaseUrl: 'https://invalid.test',
  }).execute(
    'project',
    'SCRIPT_WRITER_SHORT',
    {
      mode: 'LOCKED',
      preferredProviderKey: 'openai',
      preferredModelKey: 'gpt-5.6-luna',
      inputArtifactVersionId: input,
      creativeRegeneration: false,
    },
    'local-script-key',
  );

// Local-only catalog/envelope fixtures; no administrative endpoint or network is used.
function seedScriptEconomics(withEnvelope = false) {
  f.database.exec(`
      INSERT INTO prompt_versions(id,prompt_definition_id,version_number,template_text,input_schema_version,output_schema_version,status,content_hash,created_at) VALUES('local-script-prompt','prompt_script_writer_short',1,'{{context_json}}','script-input-v1','script-output-v1','active','${'a'.repeat(64)}','t');
      INSERT INTO ai_provider_models(id,provider_id,model_key,display_name,status,capabilities_json,effective_from,created_at,updated_at) VALUES('local-luna','provider_openai','gpt-5.6-luna','Luna','available','{"qualityTier":"ECONOMY","capabilities":["MULTILINGUAL_TEXT","STRUCTURED_OUTPUT","SCRIPT_GENERATION"]}','2026-01-01','t','t');
      INSERT INTO ai_pricing_snapshots(id,provider_model_id,currency,input_unit_price,output_unit_price,unit_name,verification_status,effective_from,created_at) VALUES('local-luna-price','local-luna','USD',0.0000003,0.0000024,'token','externally_verified','2026-01-01','t');
    `);
  if (withEnvelope)
    f.database.exec(
      "INSERT INTO editorial_execution_envelopes(id,workspace_id,project_id,profile_key,profile_version,provider_id,provider_model_id,currency,monetary_ceiling_microusd,maximum_calls,status,authorized_by,created_at,updated_at) VALUES('local-script-envelope','workspace','project','phase3_short_de_review_es_v1',1,'provider_openai','local-luna','USD',7000,2,'ACTIVE','owner','t','t')",
    );
}
const drifts = [
  'Research rejection',
  'Brief rejection',
  'Idea switch',
  'Research pointer',
  'Brief pointer',
  'Idea rejection',
  'stale edge',
  'missing edge',
  'second request',
] as const;
type Drift = (typeof drifts)[number];
function drift(kind: Drift) {
  if (kind.endsWith('rejection')) {
    const artifact =
      kind === 'Research rejection'
        ? 'research'
        : kind === 'Brief rejection'
          ? 'brief'
          : 'new-idea';
    const v = f.database
      .prepare('SELECT current_version_id id FROM editorial_artifacts WHERE id=?')
      .get(artifact)!;
    f.database
      .prepare(
        "INSERT INTO artifact_approvals(id,workspace_id,artifact_version_id,decision,actor_id,actor_role,decided_at) VALUES('concurrent-rejection','workspace',?,'REJECTED','owner','owner','t')",
      )
      .run(String(v.id));
    f.database
      .prepare("UPDATE editorial_artifacts SET status='rejected',version=version+1 WHERE id=?")
      .run(artifact);
  } else if (kind === 'Idea switch') {
    f.database.exec(
      "UPDATE idea_candidates SET status='CANDIDATE',version=version+1 WHERE id='new-candidate';UPDATE idea_candidates SET status='SELECTED',version=version+1 WHERE id='idea-candidate'",
    );
  } else if (kind === 'Research pointer') {
    f.database.exec(
      "UPDATE editorial_artifacts SET current_version_id='research-v1',version=version+1 WHERE id='research'",
    );
  } else if (kind === 'Brief pointer') {
    f.database
      .prepare(
        "UPDATE editorial_artifacts SET current_version_id=?,version=version+1 WHERE id='brief'",
      )
      .run(f.parentId);
  } else if (kind === 'stale edge') {
    f.database.exec(
      "UPDATE artifact_dependencies SET validity_status='STALE',version=version+1 WHERE id='new-lineage'",
    );
  } else if (kind === 'missing edge') {
    f.database.exec("DELETE FROM artifact_dependencies WHERE id='new-lineage'");
  } else {
    const row = f.database
      .prepare('SELECT * FROM editorial_revision_requests WHERE id=?')
      .get(f.requestId)!;
    const audit = f.database
      .prepare('SELECT * FROM audit_events WHERE id=?')
      .get(String(row.audit_event_id))!;
    delete audit.terminal_intelligence_run_id;
    const copy = (table: string, value: typeof row) =>
      f.database
        .prepare(
          `INSERT INTO ${table}(${Object.keys(value).join(',')}) VALUES(${Object.keys(value)
            .map(() => '?')
            .join(',')})`,
        )
        .run(...Object.values(value));
    copy('audit_events', { ...audit, id: 'concurrent-audit' });
    const triggers = f.database
      .prepare(
        "SELECT name,sql FROM sqlite_master WHERE type='trigger' AND tbl_name='editorial_revision_requests'",
      )
      .all() as { name: string; sql: string }[];
    for (const t of triggers) f.database.exec(`DROP TRIGGER ${t.name}`);
    copy('editorial_revision_requests', {
      ...row,
      id: 'concurrent-request',
      idempotency_key: 'concurrent-request',
      audit_event_id: 'concurrent-audit',
    });
    for (const t of triggers) f.database.exec(t.sql);
  }
}

describe('Server-derived Research remediation readiness on migrated SQLite', () => {
  it('advances exact approved human Brief but economic authorization still prevents execution without writes', async () => {
    seedScriptEconomics();
    const before = snapshot(f);
    expect(await readiness()).toMatchObject({ ready: true, blockers: [] });
    await expect(execute()).rejects.toThrow('An authorized execution envelope is required.');
    expect(snapshot(f)).toEqual(before);
    expect(f.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(
      f.database
        .prepare('SELECT status FROM editorial_revision_requests WHERE id=?')
        .get(f.requestId),
    ).toEqual({ status: 'OPEN' });
    expect(
      f.database.prepare('SELECT COUNT(*) n FROM editorial_revision_request_resolutions').get(),
    ).toEqual({ n: 0 });
  });
  it.each(['BEFORE_STORYBOARD', 'BEFORE_PREFLIGHT', 'BEFORE_REVISION_RESOLUTION'] as const)(
    'keeps %s strict',
    async (checkpoint) => {
      const before = snapshot(f);
      expect(
        (await evaluateEditorialProductionReadiness(f.d1, actor, 'project', checkpoint)).blockers,
      ).toContain('OPEN_REVISION_REQUEST');
      expect(snapshot(f)).toEqual(before);
    },
  );
  it.each(['ignoreRevisionRequest', 'ignoreRevisionRequestId', 'force', 'bypassReadiness'])(
    'rejects client bypass %s',
    (key) => {
      expect(
        intelligenceCommandSchema.safeParse({
          mode: 'LOCKED',
          inputArtifactVersionId: brief,
          creativeRegeneration: false,
          [key]: f.requestId,
        }).success,
      ).toBe(false);
    },
  );
  it('rejects historical input before provider configuration and persistence', async () => {
    const before = snapshot(f);
    expect((await readiness(f.parentId)).blockers).toContain('OPEN_REVISION_REQUEST');
    await expect(execute(f.parentId)).rejects.toThrow('editorial_production_not_ready');
    expect(snapshot(f)).toEqual(before);
  });
  it.each([
    [
      'unapproved Research',
      'editorial_artifacts',
      "UPDATE editorial_artifacts SET status='active' WHERE id='research'",
    ],
    [
      'baseline Research current',
      'editorial_artifacts',
      "UPDATE editorial_artifacts SET current_version_id='research-v1' WHERE id='research'",
    ],
    [
      'Idea not selected',
      'idea_candidates',
      "UPDATE idea_candidates SET status='CANDIDATE' WHERE id='new-candidate'",
    ],
    [
      'two selected Ideas',
      'idea_candidates',
      "UPDATE idea_candidates SET status='SELECTED' WHERE id='idea-candidate'",
    ],
    [
      'Idea unapproved',
      'editorial_artifacts',
      "UPDATE editorial_artifacts SET status='active' WHERE id='new-idea'",
    ],
    [
      'Idea not current',
      'editorial_artifacts',
      "UPDATE editorial_artifacts SET current_version_id=NULL WHERE id='new-idea'",
    ],
    [
      'Brief unapproved',
      'editorial_artifacts',
      "UPDATE editorial_artifacts SET status='active' WHERE id='brief'",
    ],
    [
      'Brief not current',
      'editorial_artifacts',
      "UPDATE editorial_artifacts SET current_version_id='brief-v1' WHERE id='brief'",
    ],
    [
      'missing Research Idea edge',
      'artifact_dependencies',
      "DELETE FROM artifact_dependencies WHERE id='new-lineage'",
    ],
    [
      'stale Research Idea edge',
      'artifact_dependencies',
      "UPDATE artifact_dependencies SET validity_status='STALE' WHERE id='new-lineage'",
    ],
    [
      'missing Idea Brief edge',
      'artifact_dependencies',
      "DELETE FROM artifact_dependencies WHERE dependent_artifact_version_id=(SELECT current_version_id FROM editorial_artifacts WHERE id='brief') AND dependency_type='GENERATED_FROM'",
    ],
    [
      'stale Idea Brief edge',
      'artifact_dependencies',
      "UPDATE artifact_dependencies SET validity_status='STALE' WHERE dependent_artifact_version_id=(SELECT current_version_id FROM editorial_artifacts WHERE id='brief') AND dependency_type='GENERATED_FROM'",
    ],
    [
      'Research ID mismatch',
      'editorial_artifact_versions',
      'UPDATE editorial_artifact_versions SET content_json=\'{"researchVersionIds":["research-v1"]}\' WHERE id=(SELECT current_version_id FROM editorial_artifacts WHERE id=\'brief\')',
    ],
    [
      'ambiguous Research IDs',
      'editorial_artifact_versions',
      "UPDATE editorial_artifact_versions SET content_json=json_set(content_json,'$.researchVersionIds[1]','research-v1') WHERE id=(SELECT current_version_id FROM editorial_artifacts WHERE id='brief')",
    ],
    [
      'unverified evidence',
      'research_sources',
      "UPDATE research_sources SET verification_status='unverified'",
    ],
    [
      'wrong baseline',
      'editorial_revision_requests',
      "UPDATE editorial_revision_requests SET target_baseline_version_id=(SELECT current_version_id FROM editorial_artifacts WHERE id='research')",
    ],
  ])('fails closed for %s with zero execution writes', async (_name, table, sql) => {
    if (_name === 'two selected Ideas')
      f.database.exec('DROP INDEX idea_candidates_selected_project_uq');
    corrupt(f, table, sql);
    const before = snapshot(f);
    expect((await readiness()).blockers).toContain('OPEN_REVISION_REQUEST');
    await expect(execute()).rejects.toThrow('editorial_production_not_ready');
    expect(snapshot(f)).toEqual(before);
  });
  it.each(['same baseline', 'different baseline', 'resolved original'])(
    'an additional unresolved request blocks (%s)',
    async (kind) => {
      const row = f.database
        .prepare('SELECT * FROM editorial_revision_requests WHERE id=?')
        .get(f.requestId)!;
      const audit = f.database
        .prepare('SELECT * FROM audit_events WHERE id=?')
        .get(String(row.audit_event_id))!;
      const copy = (table: string, value: typeof row) =>
        f.database
          .prepare(
            `INSERT INTO ${table}(${Object.keys(value).join(',')}) VALUES(${Object.keys(value)
              .map(() => '?')
              .join(',')})`,
          )
          .run(...Object.values(value));
      delete audit.terminal_intelligence_run_id;
      copy('audit_events', { ...audit, id: 'extra-audit' });
      corrupt(f, 'editorial_revision_requests', '');
      const triggers = f.database
        .prepare(
          "SELECT name,sql FROM sqlite_master WHERE type='trigger' AND tbl_name='editorial_revision_requests'",
        )
        .all() as { name: string; sql: string }[];
      for (const t of triggers) f.database.exec(`DROP TRIGGER ${t.name}`);
      copy('editorial_revision_requests', {
        ...row,
        id: 'extra-request',
        idempotency_key: 'extra-key',
        audit_event_id: 'extra-audit',
        target_baseline_version_id:
          kind === 'same baseline'
            ? String(row.target_baseline_version_id)
            : f.command.researchVersionId,
      });
      for (const t of triggers) f.database.exec(t.sql);
      if (kind === 'resolved original') {
        corrupt(
          f,
          'editorial_revision_request_resolutions',
          `INSERT INTO editorial_revision_request_resolutions(id,workspace_id,project_id,revision_request_id,status,resolution_artifact_version_id,resolved_by,idempotency_key,command_hash,audit_event_id,resolved_at) VALUES('local-resolution','workspace','project','${f.requestId}','RESOLVED','storyboard-v1','owner','local-resolved-key','${'a'.repeat(64)}','extra-audit','t')`,
        );
      }
      const before = snapshot(f);
      expect((await readiness()).blockers).toContain('OPEN_REVISION_REQUEST');
      await expect(execute()).rejects.toThrow('editorial_production_not_ready');
      expect(snapshot(f)).toEqual(before);
    },
  );
  it.each(['workspace', 'project'])(
    'does not borrow a corrective chain from another %s',
    async (scope) => {
      f.database.exec('PRAGMA foreign_keys=OFF');
      corrupt(
        f,
        'editorial_artifacts',
        scope === 'workspace'
          ? "UPDATE editorial_artifacts SET workspace_id='other-workspace' WHERE id='research'"
          : "UPDATE editorial_artifacts SET project_id='other-project' WHERE id='research'",
      );
      const before = snapshot(f);
      expect((await readiness()).blockers).toContain('OPEN_REVISION_REQUEST');
      await expect(execute()).rejects.toThrow('editorial_production_not_ready');
      expect(snapshot(f)).toEqual(before);
    },
  );
  it('does not resolve early using the original Storyboard', async () => {
    const before = snapshot(f);
    await expect(
      new EditorialRevisionService(f.d1, actor, {
        requestId: 'local-resolution',
        environment: 'test',
      }).resolve(f.requestId, 'local-resolution', { resolutionArtifactVersionId: 'storyboard-v1' }),
    ).rejects.toThrow();
    expect(snapshot(f)).toEqual(before);
  });
  it.each(['wrong-workspace', 'wrong-project'])('rejects inaccessible %s', async (scope) => {
    const before = snapshot(f);
    await expect(
      evaluateEditorialProductionReadiness(
        f.d1,
        scope === 'wrong-workspace' ? { ...actor, workspaceId: 'other-workspace' } : actor,
        scope === 'wrong-project' ? 'missing-project' : 'project',
        'BEFORE_PRODUCTION_SCRIPT',
      ),
    ).rejects.toThrow('project_not_found');
    expect(snapshot(f)).toEqual(before);
  });
  it('rejects ambiguous current Research artifacts', async () => {
    // Deliberate corruption in isolated SQLite, beyond the production uniqueness guard.
    f.database.exec('DROP INDEX editorial_artifacts_singleton_active_uq');
    f.database.exec(
      "INSERT INTO editorial_artifacts(id,workspace_id,project_id,artifact_type,status,created_at,updated_at,version,created_by,updated_by) VALUES('extra-research','workspace','project','RESEARCH','active','t','t',1,'owner','owner')",
    );
    const before = snapshot(f);
    expect((await readiness()).blockers).toContain('OPEN_REVISION_REQUEST');
    await expect(execute()).rejects.toThrow('editorial_production_not_ready');
    expect(snapshot(f)).toEqual(before);
  });
  it('rejects a second historical Research edge even alongside the exact link', async () => {
    f.database
      .prepare(
        "INSERT INTO artifact_dependencies(id,workspace_id,source_artifact_version_id,dependent_artifact_version_id,dependency_type,validity_status,created_at,updated_at,version) VALUES('extra-old-edge','workspace','research-v1',?,'USES_RESEARCH','CURRENT','t','t',1)",
      )
      .run(brief);
    const before = snapshot(f);
    expect((await readiness()).blockers).toContain('OPEN_REVISION_REQUEST');
    await expect(execute()).rejects.toThrow('editorial_production_not_ready');
    expect(snapshot(f)).toEqual(before);
  });
});

describe('Research remediation coherent proof and durable execution authorization', () => {
  it.each(drifts)(
    'rejects %s immediately before the authoritative readiness read',
    async (kind) => {
      let interleaved = false;
      let afterDrift: ReturnType<typeof snapshot> | undefined;
      const db = {
        prepare(sql: string) {
          const statement = f.d1.prepare(sql);
          if (sql.includes('JOIN editorial_artifact_versions baseline')) {
            const original = statement.first.bind(statement);
            statement.first = async <T>() => {
              drift(kind);
              interleaved = true;
              afterDrift = snapshot(f);
              return original<T>();
            };
          }
          return statement;
        },
      } as D1Database;
      const result = await evaluateEditorialProductionReadiness(
        db,
        actor,
        'project',
        'BEFORE_PRODUCTION_SCRIPT',
        { inputArtifactVersionId: brief },
      );
      expect(interleaved).toBe(true);
      expect(result.blockers).toContain('OPEN_REVISION_REQUEST');
      expect(result.remediationIdentity).toBeUndefined();
      expect(snapshot(f)).toEqual(afterDrift);
    },
  );
  it.each(drifts)(
    'rolls back the entire execution claim after %s before batch commit',
    async (kind) => {
      seedScriptEconomics(true);
      let afterDrift: ReturnType<typeof snapshot> | undefined;
      f.faults.beforeBatch = () => {
        delete f.faults.beforeBatch;
        expect(f.faults.statements[0]).toContain('research_remediation_claim_changed');
        drift(kind);
        afterDrift = snapshot(f);
      };
      await expect(execute()).rejects.toThrow(
        'The execution step could not be reserved atomically.',
      );
      expect(afterDrift).toBeDefined();
      expect(snapshot(f)).toEqual(afterDrift);
      expect(f.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    },
  );
  it.each([1, 2])('rolls back the valid guard and claim if statement %s fails', async (index) => {
    seedScriptEconomics(true);
    const before = snapshot(f);
    f.faults.failIndex = index;
    await expect(execute()).rejects.toThrow('The execution step could not be reserved atomically.');
    expect(snapshot(f)).toEqual(before);
  });
  it('defines commit of guard + Run + reservation as authorization, without retroactive cancellation', async () => {
    seedScriptEconomics(true);
    // The adapter throws after authorization/dispatch; preserve unknown-cost ambiguity.
    expectedMockDispatches = 1;
    const original = f.d1.batch.bind(f.d1);
    let authorized = false;
    f.d1.batch = async <T>(statements: D1PreparedStatement[]) => {
      const result = await original<T>(statements);
      if (!authorized && f.faults.statements[0]?.includes('research_remediation_claim_changed')) {
        expect(
          f.database
            .prepare(
              "SELECT status FROM intelligence_runs WHERE idempotency_key='local-script-key'",
            )
            .get(),
        ).toEqual({ status: 'QUEUED' });
        expect(
          f.database
            .prepare(
              "SELECT status FROM editorial_execution_reservations WHERE envelope_id='local-script-envelope'",
            )
            .get(),
        ).toEqual({ status: 'RESERVED' });
        authorized = true;
        drift('Research rejection');
      }
      return result;
    };
    await expect(execute()).rejects.toThrow();
    expect(authorized).toBe(true);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(
      f.database
        .prepare("SELECT status FROM intelligence_runs WHERE idempotency_key='local-script-key'")
        .get(),
    ).toEqual({ status: 'FAILED_PERMANENT' });
    expect(
      f.database
        .prepare(
          "SELECT status FROM editorial_execution_reservations WHERE envelope_id='local-script-envelope'",
        )
        .get(),
    ).toEqual({ status: 'AMBIGUOUS' });
    expect(f.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
});

describe('Revision remediation requires bounded economic authorization', () => {
  const executeModel = (modelKey: string) =>
    new EditorialExecutionService(f.d1, actor, {
      openAIEnabled: true,
      openAIApiKey: 'fixture',
      openAIBaseUrl: 'https://invalid.test',
    }).execute(
      'project',
      'SCRIPT_WRITER_SHORT',
      {
        mode: 'LOCKED',
        preferredProviderKey: 'openai',
        preferredModelKey: modelKey,
        inputArtifactVersionId: brief,
        creativeRegeneration: false,
      },
      'economic-script-key',
    );
  const seedModels = () => {
    seedScriptEconomics();
    f.database.exec(`
      UPDATE ai_provider_models SET capabilities_json=json_set(capabilities_json,'$.capabilities',json('["STRUCTURED_OUTPUT","SCRIPT_GENERATION","MULTILINGUAL_TEXT"]')) WHERE model_key='gpt-5.6-terra';
      INSERT INTO ai_provider_models(id,provider_id,model_key,display_name,status,capabilities_json,effective_from,created_at,updated_at) VALUES('local-sol','provider_openai','gpt-5.6-sol','Sol','available','{"qualityTier":"HIGH","capabilities":["STRUCTURED_OUTPUT","SCRIPT_GENERATION","MULTILINGUAL_TEXT"]}','2026-01-01','t','t');
      INSERT INTO ai_pricing_snapshots(id,provider_model_id,currency,input_unit_price,output_unit_price,unit_name,verification_status,effective_from,created_at) VALUES('local-sol-price','local-sol','USD',0.000001,0.00001,'token','externally_verified','2026-01-01','t');
    `);
  };
  it('rejects every available non-profile Script model, including the Terra bypass', async () => {
    seedModels();
    const models = f.database
      .prepare(
        "SELECT model_key FROM ai_provider_models WHERE status='available' AND model_key<>'gpt-5.6-luna' AND EXISTS(SELECT 1 FROM json_each(capabilities_json,'$.capabilities') WHERE value='SCRIPT_GENERATION')",
      )
      .all();
    expect(models.length).toBeGreaterThanOrEqual(2);
    for (const model of models) {
      const before = snapshot(f);
      await expect(executeModel(String(model.model_key))).rejects.toThrow(
        'Revision-remediation Script execution requires the governed bounded profile',
      );
      expect(snapshot(f)).toEqual(before);
      expect(provider).not.toHaveBeenCalled();
    }
  });
  it('preserves ordinary Terra Script execution without an OPEN revision', async () => {
    seedModels();
    // A resolved historical request does not grant/use the OPEN-remediation exception.
    corrupt(
      f,
      'editorial_revision_request_resolutions',
      `INSERT INTO editorial_revision_request_resolutions(id,workspace_id,project_id,revision_request_id,status,resolution_artifact_version_id,resolved_by,idempotency_key,command_hash,audit_event_id,resolved_at) SELECT 'ordinary-resolution',workspace_id,project_id,id,'RESOLVED',reviewed_artifact_version_id,actor_id,'ordinary-resolution','${'a'.repeat(64)}',audit_event_id,'t' FROM editorial_revision_requests WHERE id='${f.requestId}'`,
    );
    expect((await readiness()).remediationIdentity).toBeUndefined();
    expectedMockDispatches = 1;
    await expect(executeModel('gpt-5.6-terra')).rejects.toThrow('Provider execution failed.');
    expect(provider).toHaveBeenCalledTimes(1);
  });
  it.each([
    'remediation',
    'boundedRequired',
    'revisionMode',
    'forceBounded',
    'ignoreEconomics',
    'executionClass',
    'reasoningEffort',
  ])('does not accept client economic/profile override %s', (key) => {
    expect(
      intelligenceCommandSchema.safeParse({
        mode: 'LOCKED',
        inputArtifactVersionId: brief,
        creativeRegeneration: false,
        [key]: 'override',
      }).success,
    ).toBe(false);
  });
  it('rejects a project configuration outside the German bounded profile', async () => {
    seedModels();
    f.database.exec("UPDATE projects SET operating_mode='MANUAL' WHERE id='project'");
    const before = snapshot(f);
    await expect(executeModel('gpt-5.6-terra')).rejects.toThrow(
      'Revision-remediation Script execution requires the governed bounded profile',
    );
    expect(snapshot(f)).toEqual(before);
  });
  it('keeps Luna without envelope fail closed', async () => {
    seedScriptEconomics();
    const before = snapshot(f);
    await expect(execute()).rejects.toThrow('An authorized execution envelope is required.');
    expect(snapshot(f)).toEqual(before);
  });
  it.each([
    ['consumed', "status='CONSUMED'"],
    ['inactive', "status='CANCELLED'"],
    ['expired', "status='EXPIRED'"],
    ['wrong project', "project_id='protected-tim'"],
    ['wrong profile', "profile_key='phase3_short_en_review_es_v1'"],
    ['wrong profile version', 'profile_version=2'],
    ['exhausted monetary capacity', 'monetary_ceiling_microusd=1'],
  ])('rejects %s envelope with no execution persistence', async (_, assignment) => {
    seedScriptEconomics(true);
    corrupt(
      f,
      'editorial_execution_envelopes',
      `UPDATE editorial_execution_envelopes SET ${assignment} WHERE id='local-script-envelope'`,
    );
    const before = snapshot(f);
    await expect(execute()).rejects.toThrow();
    expect(snapshot(f)).toEqual(before);
    expect(f.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
  it('does not borrow another workspace envelope', async () => {
    seedScriptEconomics(true);
    // Deliberately inconsistent local fixture tests workspace lookup independently of DB guards.
    f.database.exec('PRAGMA foreign_keys=OFF');
    corrupt(
      f,
      'editorial_execution_envelopes',
      "UPDATE editorial_execution_envelopes SET workspace_id='other' WHERE id='local-script-envelope'",
    );
    const before = snapshot(f);
    await expect(execute()).rejects.toThrow('An authorized execution envelope is required.');
    expect(snapshot(f)).toEqual(before);
  });
  it('dispatches bounded Luna only after Run and reservation commit with profile reasoning', async () => {
    seedScriptEconomics(true);
    // Catalog hints must not override the immutable bounded execution policy.
    f.database.exec(
      "UPDATE ai_provider_models SET capabilities_json=json_set(capabilities_json,'$.reasoningEffort','high') WHERE id='local-luna'",
    );
    expectedMockDispatches = 1;
    vi.spyOn(OpenAIResponsesAdapter.prototype, 'execute').mockImplementation((request) => {
      expect(request.reasoningEffort).toBe('none');
      expect(request.maxOutputTokens).toBe(768);
      const run = f.database
        .prepare("SELECT id FROM intelligence_runs WHERE idempotency_key='local-script-key'")
        .get()!;
      expect(
        f.database
          .prepare(
            'SELECT intelligence_run_id FROM editorial_execution_reservations WHERE envelope_id=?',
          )
          .get('local-script-envelope'),
      ).toEqual({ intelligence_run_id: run.id });
      return Promise.reject(new Error('Local mocked dispatch'));
    });
    await expect(execute()).rejects.toThrow();
    expect(provider).toHaveBeenCalledTimes(1);
    expect(f.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
});

it('rejects an ACTIVE envelope whose two calls are already reserved', async () => {
  seedScriptEconomics(true);
  const template = f.database.prepare('SELECT * FROM intelligence_runs LIMIT 1').get()!;
  for (const [index, step] of ['SCRIPT_WRITER_SHORT', 'REVIEW_TRANSLATION_ES'].entries()) {
    const run = {
      ...template,
      id: `exhausted-run-${index}`,
      task_type: step,
      status: 'QUEUED',
      idempotency_key: `exhausted-key-${index}`,
      output_artifact_version_id: null,
    };
    f.database
      .prepare(
        `INSERT INTO intelligence_runs(${Object.keys(run).join(',')}) VALUES(${Object.keys(run)
          .map(() => '?')
          .join(',')})`,
      )
      .run(...Object.values(run));
    f.database
      .prepare(
        "INSERT INTO editorial_execution_reservations(id,envelope_id,workspace_id,project_id,intelligence_run_id,step_key,pricing_snapshot_id,reserved_microusd,status,created_at) VALUES(?,'local-script-envelope','workspace','project',?,?,'local-luna-price',1,'RESERVED','t')",
      )
      .run(`exhausted-reservation-${index}`, run.id, step);
  }
  const before = snapshot(f);
  await expect(execute()).rejects.toThrow('The execution step could not be reserved atomically.');
  expect(snapshot(f)).toEqual(before);
  expect(f.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
});
