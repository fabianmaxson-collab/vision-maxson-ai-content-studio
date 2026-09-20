import { storyboardOutputV2Schema } from '@vision-maxson/contracts';
import {
  deriveGenerationReadiness,
  evaluateTerminalGraph,
  type TerminalArtifactVersionSnapshot,
  type TerminalDependencySnapshot,
  type TerminalGraphSnapshot,
  type TerminalPreflightSnapshot,
} from '@vision-maxson/domain';
import type {
  ApprovalSnapshotGuard,
  EditorialActor,
  PreflightApprovalEvaluation,
} from './repository';
import { evaluateEditorialProductionReadiness } from './readiness';
type Row = Record<string, unknown>;
const uid = (p: string) => `${p}_${crypto.randomUUID()}`,
  at = () => new Date().toISOString();
async function hash(v: unknown) {
  const b = new TextEncoder().encode(JSON.stringify(v));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', b))]
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');
}
const typedAtomEquality = (actual: string, expected: string) =>
  `(((${actual}.type IN ('integer','real')) AND (${expected}.type IN ('integer','real')) AND ${actual}.atom=${expected}.atom)
    OR (${actual}.type=${expected}.type AND ${actual}.atom IS ${expected}.atom))`;

export function exactJsonSnapshotGuard(
  actualSql: string,
  actualValues: readonly unknown[],
  expected: unknown,
  reason: string,
): ApprovalSnapshotGuard {
  return {
    condition: `EXISTS(
      WITH actual(snapshot) AS (${actualSql}), expected(snapshot) AS (SELECT json(?))
      SELECT 1 FROM actual,expected
      WHERE (SELECT count(*) FROM json_tree(actual.snapshot))=(SELECT count(*) FROM json_tree(expected.snapshot))
        AND NOT EXISTS(
          SELECT 1 FROM json_tree(actual.snapshot) actual_node
          WHERE NOT EXISTS(
            SELECT 1 FROM json_tree(expected.snapshot) expected_node
            WHERE expected_node.fullkey=actual_node.fullkey
              AND ${typedAtomEquality('actual_node', 'expected_node')}
          )
        )
    )`,
    values: [...actualValues, JSON.stringify(expected)],
    reason,
  };
}

function typedDeepEqual(actual: unknown, expected: unknown): boolean {
  if (typeof actual === 'number' && typeof expected === 'number') return actual === expected;
  if (actual === null || expected === null || typeof actual !== typeof expected)
    return actual === expected;
  if (Array.isArray(actual) || Array.isArray(expected))
    return (
      Array.isArray(actual) &&
      Array.isArray(expected) &&
      actual.length === expected.length &&
      actual.every((value, index) => typedDeepEqual(value, expected[index]))
    );
  if (typeof actual === 'object' && typeof expected === 'object') {
    const actualRecord = actual as Record<string, unknown>,
      expectedRecord = expected as Record<string, unknown>,
      actualKeys = Object.keys(actualRecord).sort(),
      expectedKeys = Object.keys(expectedRecord).sort();
    return (
      actualKeys.length === expectedKeys.length &&
      actualKeys.every(
        (key, index) =>
          key === expectedKeys[index] && typedDeepEqual(actualRecord[key], expectedRecord[key]),
      )
    );
  }
  return actual === expected;
}
const baseTypes = [
  'RESEARCH',
  'IDEA_CANDIDATE',
  'CONTENT_BRIEF',
  'PRODUCTION_SCRIPT',
  'SCRIPT_CRITIQUE',
  'STORYBOARD',
] as const;

const deterministicSourceTypeContract = new Set([
  'AI_GENERATED',
  'HUMAN_EDITED',
  'IMPORTED',
  'DETERMINISTIC',
]);

export function sourceTypeSupportsDeterministic(tableSql: unknown) {
  if (typeof tableSql !== 'string') return false;
  const checks = [
    ...tableSql.toUpperCase().matchAll(/CHECK\s*\(\s*SOURCE_TYPE\s+IN\s*\(([^)]*)\)\s*\)/gu),
  ];
  if (checks.length !== 1) return false;
  const values = [...(checks[0]?.[1] ?? '').matchAll(/'([^']+)'/gu)].map((match) => match[1] ?? '');
  return (
    values.length === deterministicSourceTypeContract.size &&
    new Set(values).size === deterministicSourceTypeContract.size &&
    values.every((value) => deterministicSourceTypeContract.has(value))
  );
}

export async function deterministicPreflightSchemaReady(db: D1Database) {
  try {
    const row = await db
      .prepare(
        `SELECT sql FROM sqlite_master WHERE type='table' AND name='editorial_artifact_versions'`,
      )
      .first<{ sql: string | null }>();
    return sourceTypeSupportsDeterministic(row?.sql);
  } catch {
    return false;
  }
}

export class DeterministicPreflightService {
  constructor(
    private db: D1Database,
    private actor: EditorialActor,
    private requestId: string,
    private environment: string,
  ) {}
  private async graph(
    projectId: string,
    pf: { artifactId: string; versionId: string },
    includeVirtualPreflightDependencies = true,
  ): Promise<{ snapshot: TerminalGraphSnapshot; stableGuards: ApprovalSnapshotGuard[] }> {
    const stableGuards: ApprovalSnapshotGuard[] = [];
    const p = await this.db
      .prepare(
        `SELECT id projectId,workspace_id workspaceId,status,format,primary_language productionLanguage,version FROM projects WHERE id=? AND workspace_id=? AND deleted_at IS NULL`,
      )
      .bind(projectId, this.actor.workspaceId)
      .first<Row>();
    if (!p) throw new Error('project_not_found');
    stableGuards.push({
      condition: `EXISTS(SELECT 1 FROM projects WHERE id=? AND workspace_id=? AND status=? AND format=? AND primary_language=? AND version=? AND deleted_at IS NULL)`,
      values: [
        projectId,
        this.actor.workspaceId,
        p.status,
        p.format,
        p.productionLanguage,
        p.version,
      ],
      reason: 'preflight_project_snapshot_changed',
    });
    const rs = (
      await this.db
        .prepare(
          `SELECT a.id artifactId,a.artifact_type artifactType,a.current_version_id currentVersionId,a.status artifactStatus,a.version artifactRevision,v.id versionId,v.language_code languageCode,v.source_script_version_id sourceScriptVersionId,v.content_json contentJson,
   (SELECT id FROM artifact_approvals x WHERE x.artifact_version_id=v.id ORDER BY decided_at DESC,id DESC LIMIT 1) approvalId,
   (SELECT decision FROM artifact_approvals x WHERE x.artifact_version_id=v.id ORDER BY decided_at DESC,id DESC LIMIT 1) approval,
   (SELECT decided_at FROM artifact_approvals x WHERE x.artifact_version_id=v.id ORDER BY decided_at DESC,id DESC LIMIT 1) approvalDecidedAt,
   (SELECT count(*) FROM artifact_approvals x WHERE x.artifact_version_id=v.id) approvalCount,
   i.id candidateId,i.status candidateStatus,i.version candidateVersion,
   (SELECT count(*) FROM idea_candidates c WHERE c.artifact_version_id=v.id) candidateCount,
   (SELECT count(*) FROM artifact_dependencies d WHERE d.dependent_artifact_version_id=v.id AND (d.validity_status<>'CURRENT' OR d.invalidated_at IS NOT NULL OR d.invalidated_by_version_id IS NOT NULL)) invalidDependencyCount,
   CASE WHEN EXISTS(SELECT 1 FROM artifact_dependencies d WHERE d.dependent_artifact_version_id=v.id AND (d.validity_status<>'CURRENT' OR d.invalidated_at IS NOT NULL OR d.invalidated_by_version_id IS NOT NULL)) THEN 1 ELSE 0 END invalidated,
   CASE WHEN i.status='SELECTED' THEN 1 ELSE 0 END selected
   FROM editorial_artifacts a JOIN editorial_artifact_versions v ON v.id=a.current_version_id LEFT JOIN idea_candidates i ON i.artifact_version_id=v.id
   WHERE a.workspace_id=? AND a.project_id=? AND a.deleted_at IS NULL AND a.artifact_type<>'PREFLIGHT' ORDER BY a.artifact_type,a.id`,
        )
        .bind(this.actor.workspaceId, projectId)
        .all<Row>()
    ).results;
    if (rs.length > 20) throw new Error('preflight_snapshot_too_large');
    const artifactSnapshot = rs.map((row) => ({
      artifactId: String(row.artifactId),
      artifactType: String(row.artifactType),
      currentVersionId: String(row.currentVersionId),
      artifactStatus: String(row.artifactStatus),
      artifactRevision: Number(row.artifactRevision),
      version: {
        id: String(row.versionId),
        languageCode: String(row.languageCode),
        sourceScriptVersionId:
          typeof row.sourceScriptVersionId === 'string' ? row.sourceScriptVersionId : null,
      },
      approval: {
        count: Number(row.approvalCount),
        id: typeof row.approvalId === 'string' ? row.approvalId : null,
        decision: typeof row.approval === 'string' ? row.approval : null,
        decidedAt: typeof row.approvalDecidedAt === 'string' ? row.approvalDecidedAt : null,
      },
      candidate: {
        count: Number(row.candidateCount),
        id: typeof row.candidateId === 'string' ? row.candidateId : null,
        status: typeof row.candidateStatus === 'string' ? row.candidateStatus : null,
        version: row.candidateVersion == null ? null : Number(row.candidateVersion),
      },
      invalidDependencyCount: Number(row.invalidDependencyCount),
    }));
    stableGuards.push(
      exactJsonSnapshotGuard(
        `SELECT coalesce(json_group_array(json(row_json)),json('[]')) FROM (
          SELECT json_object(
            'artifactId',a.id,
            'artifactType',a.artifact_type,
            'currentVersionId',a.current_version_id,
            'artifactStatus',a.status,
            'artifactRevision',a.version,
            'version',json_object(
              'id',v.id,
              'languageCode',v.language_code,
              'sourceScriptVersionId',v.source_script_version_id
            ),
            'approval',json_object(
              'count',(SELECT count(*) FROM artifact_approvals x WHERE x.artifact_version_id=v.id),
              'id',(SELECT id FROM artifact_approvals x WHERE x.artifact_version_id=v.id ORDER BY decided_at DESC,id DESC LIMIT 1),
              'decision',(SELECT decision FROM artifact_approvals x WHERE x.artifact_version_id=v.id ORDER BY decided_at DESC,id DESC LIMIT 1),
              'decidedAt',(SELECT decided_at FROM artifact_approvals x WHERE x.artifact_version_id=v.id ORDER BY decided_at DESC,id DESC LIMIT 1)
            ),
            'candidate',json_object(
              'count',(SELECT count(*) FROM idea_candidates c WHERE c.artifact_version_id=v.id),
              'id',i.id,
              'status',i.status,
              'version',i.version
            ),
            'invalidDependencyCount',(SELECT count(*) FROM artifact_dependencies d WHERE d.dependent_artifact_version_id=v.id AND (d.validity_status<>'CURRENT' OR d.invalidated_at IS NOT NULL OR d.invalidated_by_version_id IS NOT NULL))
          ) row_json
          FROM editorial_artifacts a
          JOIN editorial_artifact_versions v ON v.id=a.current_version_id
          LEFT JOIN idea_candidates i ON i.artifact_version_id=v.id
          WHERE a.workspace_id=? AND a.project_id=? AND a.deleted_at IS NULL AND a.artifact_type<>'PREFLIGHT'
          ORDER BY a.artifact_type,a.id
        )`,
        [this.actor.workspaceId, projectId],
        artifactSnapshot,
        'preflight_artifact_snapshot_changed',
      ),
    );
    const pick = (t: string) => rs.filter((r) => r.artifactType === t),
      brief = pick('CONTENT_BRIEF')[0];
    let review = String(p.productionLanguage);
    if (brief && typeof brief.contentJson === 'string') {
      try {
        const j = JSON.parse(brief.contentJson) as Row;
        if (typeof j.reviewLanguage === 'string') review = j.reviewLanguage;
      } catch {
        throw new Error('content_brief_json_invalid');
      }
    }
    const missing: string[] = baseTypes.filter((t) =>
      t === 'IDEA_CANDIDATE' ? pick(t).length === 0 : pick(t).length !== 1,
    );
    if (review !== p.productionLanguage && pick('REVIEW_TRANSLATION').length !== 1)
      missing.push('REVIEW_TRANSLATION');
    if (review === p.productionLanguage && pick('REVIEW_TRANSLATION').length)
      throw new Error('terminal_graph_translation_not_required');
    if (missing.length)
      throw new Error(`terminal_graph_incomplete:${[...new Set(missing)].join(',')}`);
    const snap = (r: Row): TerminalArtifactVersionSnapshot => ({
      artifactType: r.artifactType as TerminalArtifactVersionSnapshot['artifactType'],
      artifactId: String(r.artifactId),
      versionId: String(r.versionId),
      currentVersionId: String(r.currentVersionId),
      workspaceId: String(p.workspaceId),
      projectId,
      projectFormat: p.format as TerminalArtifactVersionSnapshot['projectFormat'],
      productionLanguage: String(p.productionLanguage),
      reviewLanguage: review,
      languageCode: String(r.languageCode),
      approval: (r.approval ?? null) as TerminalArtifactVersionSnapshot['approval'],
      selected: Number(r.selected) === 1,
      invalidated: Number(r.invalidated) === 1,
      authoritativeProduction:
        r.artifactType === 'PRODUCTION_SCRIPT' && r.languageCode === p.productionLanguage,
      reviewOnly: r.artifactType === 'REVIEW_TRANSLATION',
      sourceScriptVersionId:
        typeof r.sourceScriptVersionId === 'string' ? r.sourceScriptVersionId : null,
    });
    const ideas = pick('IDEA_CANDIDATE').map(snap),
      chosen = ideas.filter((x) => x.selected);
    if (chosen.length !== 1) throw new Error('terminal_graph_selected_idea_invalid');
    const storyboardRow = pick('STORYBOARD')[0]!;
    const storyboardContract = await this.db
      .prepare(
        `SELECT r.id runId,r.prompt_version_id promptVersionId,pv.output_schema_version outputSchemaVersion FROM editorial_artifact_versions v JOIN intelligence_runs r ON r.id=v.intelligence_run_id JOIN prompt_versions pv ON pv.id=r.prompt_version_id WHERE v.id=? AND v.workspace_id=?`,
      )
      .bind(storyboardRow.versionId, this.actor.workspaceId)
      .first<Row>();
    stableGuards.push({
      condition: `(SELECT r.id FROM editorial_artifact_versions v JOIN intelligence_runs r ON r.id=v.intelligence_run_id JOIN prompt_versions pv ON pv.id=r.prompt_version_id WHERE v.id=? AND v.workspace_id=?) IS ?
        AND (SELECT r.prompt_version_id FROM editorial_artifact_versions v JOIN intelligence_runs r ON r.id=v.intelligence_run_id JOIN prompt_versions pv ON pv.id=r.prompt_version_id WHERE v.id=? AND v.workspace_id=?) IS ?
        AND (SELECT pv.output_schema_version FROM editorial_artifact_versions v JOIN intelligence_runs r ON r.id=v.intelligence_run_id JOIN prompt_versions pv ON pv.id=r.prompt_version_id WHERE v.id=? AND v.workspace_id=?) IS ?`,
      values: [
        storyboardRow.versionId,
        this.actor.workspaceId,
        storyboardContract?.runId ?? null,
        storyboardRow.versionId,
        this.actor.workspaceId,
        storyboardContract?.promptVersionId ?? null,
        storyboardRow.versionId,
        this.actor.workspaceId,
        storyboardContract?.outputSchemaVersion ?? null,
      ],
      reason: 'preflight_storyboard_contract_changed',
    });
    if (storyboardContract?.outputSchemaVersion === 'storyboard-output-v2') {
      let rawContent: unknown;
      try {
        rawContent = JSON.parse(String(storyboardRow.contentJson)) as unknown;
      } catch {
        throw new Error('storyboard_v2_content_invalid');
      }
      const parsedResult = storyboardOutputV2Schema.safeParse(rawContent);
      if (!parsedResult.success) throw new Error('storyboard_v2_content_invalid');
      const parsed = parsedResult.data;
      const normalized = (
        await this.db
          .prepare(
            `SELECT * FROM storyboard_scenes WHERE workspace_id=? AND storyboard_version_id=? ORDER BY scene_order`,
          )
          .bind(this.actor.workspaceId, storyboardRow.versionId)
          .all<Row>()
      ).results;
      if (normalized.length !== parsed.scenes.length)
        throw new Error('storyboard_v2_scene_count_mismatch');
      const scriptVersionId = String(pick('PRODUCTION_SCRIPT')[0]!.versionId),
        linkRows = (
          await this.db
            .prepare(
              `SELECT sss.storyboard_scene_id sceneId,sss.script_segment_id segmentId,sss.segment_order segmentOrder FROM scene_script_segments sss JOIN storyboard_scenes scene ON scene.id=sss.storyboard_scene_id AND scene.workspace_id=sss.workspace_id JOIN script_segments ss ON ss.id=sss.script_segment_id WHERE sss.workspace_id=? AND scene.storyboard_version_id=? AND ss.script_version_id=? ORDER BY scene.scene_order,sss.segment_order,sss.script_segment_id`,
            )
            .bind(this.actor.workspaceId, storyboardRow.versionId, scriptVersionId)
            .all<Row>()
        ).results,
        sceneSnapshot: Array<Record<string, unknown>> = [];
      for (const [index, scene] of parsed.scenes.entries()) {
        const row = normalized[index]!;
        const sceneLinks = linkRows.filter((link) => link.sceneId === row.id),
          linkIds = sceneLinks.map((link) => String(link.segmentId));
        if (
          linkIds.length !== scene.scriptSegmentIds.length ||
          linkIds.some((linkId, linkIndex) => linkId !== scene.scriptSegmentIds[linkIndex])
        )
          throw new Error('storyboard_v2_segment_linkage_invalid');
        const expected = {
          scalar: {
            targetDurationSeconds: scene.targetDurationSeconds,
            visualDescription: scene.visualDescription,
            location: scene.location,
            action: scene.action,
            cameraFraming: scene.cameraFraming,
            cameraMovement: scene.cameraMovement,
            mood: scene.mood,
            continuityKey: scene.continuityKey,
            continuityNotes: scene.continuityNotes,
            transitionNotes: scene.transitionNotes,
            aspectRatio: scene.aspectRatio,
            recommendedMediaType: scene.recommendedMediaType,
            generationInstructions: scene.generationInstructions,
            contractVersion: 'storyboard-output-v2',
          },
          structured: {
            safeAreaGuidance: scene.safeAreaGuidance,
            onScreenText: scene.onScreenText,
            captions: scene.captions,
            factualClaims: scene.factualClaims,
            assetRequirements: scene.assetRequirements,
            mediaReferences: scene.mediaReferences,
            characterVersionIds: scene.characterVersionIds,
            audioGuidance: scene.audioGuidance,
            continuityReferenceKeys: scene.continuityReferenceKeys,
          },
        };
        const actual = {
          scalar: {
            targetDurationSeconds:
              row.target_duration_seconds == null ? null : Number(row.target_duration_seconds),
            visualDescription: String(row.visual_description),
            location: String(row.location),
            action: String(row.action),
            cameraFraming: String(row.camera_framing),
            cameraMovement: row.camera_movement ?? null,
            mood: String(row.mood),
            continuityKey: row.continuity_key ?? null,
            continuityNotes: String(row.continuity_notes),
            transitionNotes: String(row.transition_notes),
            aspectRatio: row.aspect_ratio ?? null,
            recommendedMediaType: row.recommended_media_type ?? null,
            generationInstructions: String(row.generation_instructions),
            contractVersion: row.contract_version ?? null,
          },
          structured: {
            safeAreaGuidance: JSON.parse(String(row.safe_area_guidance_json)) as unknown,
            onScreenText: JSON.parse(String(row.on_screen_text_json)) as unknown,
            captions: JSON.parse(String(row.captions_json)) as unknown,
            factualClaims: JSON.parse(String(row.factual_claims_json)) as unknown,
            assetRequirements: JSON.parse(String(row.asset_requirements_json)) as unknown,
            mediaReferences: JSON.parse(String(row.media_references_json)) as unknown,
            characterVersionIds: JSON.parse(String(row.character_version_refs_json)) as unknown,
            audioGuidance: JSON.parse(String(row.audio_guidance_json)) as unknown,
            continuityReferenceKeys: JSON.parse(
              String(row.continuity_reference_keys_json),
            ) as unknown,
          },
        };
        if (!typedDeepEqual(actual, expected))
          throw new Error('storyboard_v2_normalization_mismatch');
        sceneSnapshot.push({
          id: String(row.id),
          sceneOrder: Number(row.scene_order),
          ...expected,
        });
      }
      stableGuards.push(
        exactJsonSnapshotGuard(
          `SELECT coalesce(json_group_array(json(row_json)),json('[]')) FROM (
            SELECT json_object(
              'id',scene.id,
              'sceneOrder',scene.scene_order,
              'scalar',json_object(
                'targetDurationSeconds',scene.target_duration_seconds,
                'visualDescription',scene.visual_description,
                'location',scene.location,
                'action',scene.action,
                'cameraFraming',scene.camera_framing,
                'cameraMovement',scene.camera_movement,
                'mood',scene.mood,
                'continuityKey',scene.continuity_key,
                'continuityNotes',scene.continuity_notes,
                'transitionNotes',scene.transition_notes,
                'aspectRatio',scene.aspect_ratio,
                'recommendedMediaType',scene.recommended_media_type,
                'generationInstructions',scene.generation_instructions,
                'contractVersion',scene.contract_version
              ),
              'structured',json_object(
                'safeAreaGuidance',json(scene.safe_area_guidance_json),
                'onScreenText',json(scene.on_screen_text_json),
                'captions',json(scene.captions_json),
                'factualClaims',json(scene.factual_claims_json),
                'assetRequirements',json(scene.asset_requirements_json),
                'mediaReferences',json(scene.media_references_json),
                'characterVersionIds',json(scene.character_version_refs_json),
                'audioGuidance',json(scene.audio_guidance_json),
                'continuityReferenceKeys',json(scene.continuity_reference_keys_json)
              )
            ) row_json
            FROM storyboard_scenes scene
            WHERE scene.workspace_id=? AND scene.storyboard_version_id=?
            ORDER BY scene.scene_order
          )`,
          [this.actor.workspaceId, storyboardRow.versionId],
          sceneSnapshot,
          'preflight_storyboard_scene_snapshot_changed',
        ),
        exactJsonSnapshotGuard(
          `SELECT coalesce(json_group_array(json(row_json)),json('[]')) FROM (
            SELECT json_object(
              'sceneId',sss.storyboard_scene_id,
              'segmentId',sss.script_segment_id,
              'segmentOrder',sss.segment_order
            ) row_json
            FROM scene_script_segments sss
            JOIN storyboard_scenes scene ON scene.id=sss.storyboard_scene_id AND scene.workspace_id=sss.workspace_id
            JOIN script_segments ss ON ss.id=sss.script_segment_id
            WHERE sss.workspace_id=? AND scene.storyboard_version_id=? AND ss.script_version_id=?
            ORDER BY scene.scene_order,sss.segment_order,sss.script_segment_id
          )`,
          [this.actor.workspaceId, storyboardRow.versionId, scriptVersionId],
          linkRows.map((link) => ({
            sceneId: String(link.sceneId),
            segmentId: String(link.segmentId),
            segmentOrder: Number(link.segmentOrder),
          })),
          'preflight_storyboard_link_snapshot_changed',
        ),
      );
    } else if (
      storyboardContract?.outputSchemaVersion &&
      storyboardContract.outputSchemaVersion !== 'storyboard-output-v1'
    )
      throw new Error('storyboard_schema_version_unsupported');

    const ids = [
      String(pick('RESEARCH')[0]!.versionId),
      chosen[0]!.versionId,
      String(brief!.versionId),
      String(pick('PRODUCTION_SCRIPT')[0]!.versionId),
      ...(review === p.productionLanguage
        ? []
        : [String(pick('REVIEW_TRANSLATION')[0]!.versionId)]),
      String(pick('SCRIPT_CRITIQUE')[0]!.versionId),
      String(pick('STORYBOARD')[0]!.versionId),
    ];
    const dependencyVersionIds = [...ids, pf.versionId],
      dependencyPlaceholders = dependencyVersionIds.map(() => '?').join(','),
      dependencyRows = (
        await this.db
          .prepare(
            `SELECT id,source_artifact_version_id sourceVersionId,dependent_artifact_version_id dependentVersionId,dependency_type dependencyType,validity_status validity,invalidated_at invalidatedAt,invalidated_by_version_id invalidatedByVersionId,version FROM artifact_dependencies WHERE workspace_id=? AND dependent_artifact_version_id IN (${dependencyPlaceholders}) ORDER BY id`,
          )
          .bind(this.actor.workspaceId, ...dependencyVersionIds)
          .all<Row>()
      ).results;
    if (dependencyRows.length > 100) throw new Error('preflight_snapshot_too_large');
    stableGuards.push(
      exactJsonSnapshotGuard(
        `SELECT coalesce(json_group_array(json(row_json)),json('[]')) FROM (
          SELECT json_object(
            'id',id,
            'sourceVersionId',source_artifact_version_id,
            'dependentVersionId',dependent_artifact_version_id,
            'dependencyType',dependency_type,
            'validity',validity_status,
            'invalidatedAt',invalidated_at,
            'invalidatedByVersionId',invalidated_by_version_id,
            'version',version
          ) row_json
          FROM artifact_dependencies
          WHERE workspace_id=? AND dependent_artifact_version_id IN (${dependencyPlaceholders})
          ORDER BY id
        )`,
        [this.actor.workspaceId, ...dependencyVersionIds],
        dependencyRows.map((dependency) => ({
          id: String(dependency.id),
          sourceVersionId: String(dependency.sourceVersionId),
          dependentVersionId: String(dependency.dependentVersionId),
          dependencyType: String(dependency.dependencyType),
          validity: String(dependency.validity),
          invalidatedAt:
            typeof dependency.invalidatedAt === 'string' ? dependency.invalidatedAt : null,
          invalidatedByVersionId:
            typeof dependency.invalidatedByVersionId === 'string'
              ? dependency.invalidatedByVersionId
              : null,
          version: Number(dependency.version),
        })),
        'preflight_dependency_snapshot_changed',
      ),
    );
    const deps = dependencyRows.map((dependency): TerminalDependencySnapshot => ({
      sourceVersionId: String(dependency.sourceVersionId),
      dependentVersionId: String(dependency.dependentVersionId),
      dependencyType: dependency.dependencyType as TerminalDependencySnapshot['dependencyType'],
      validity: dependency.validity as TerminalDependencySnapshot['validity'],
      invalidatedAt: typeof dependency.invalidatedAt === 'string' ? dependency.invalidatedAt : null,
      invalidatedByVersionId:
        typeof dependency.invalidatedByVersionId === 'string'
          ? dependency.invalidatedByVersionId
          : null,
    }));
    const preflight: TerminalPreflightSnapshot = {
      artifactType: 'PREFLIGHT',
      artifactId: pf.artifactId,
      versionId: pf.versionId,
      currentVersionId: pf.versionId,
      workspaceId: String(p.workspaceId),
      projectId,
      projectFormat: p.format as TerminalPreflightSnapshot['projectFormat'],
      productionLanguage: String(p.productionLanguage),
      reviewLanguage: review,
      languageCode: review,
      approval: null,
      selected: false,
      invalidated: false,
      authoritativeProduction: false,
      reviewOnly: false,
      sourceScriptVersionId: null,
      overallResult: 'PASS',
      checks: [{ key: 'terminal_graph_coherent', result: 'PASS', hardBlocker: true }],
      validatedVersionIds: ids,
    };
    const snapshot: TerminalGraphSnapshot = {
      project: {
        workspaceId: String(p.workspaceId),
        projectId,
        status: String(p.status),
        format: p.format as TerminalGraphSnapshot['project']['format'],
        productionLanguage: String(p.productionLanguage),
        reviewLanguage: review,
      },
      research: snap(pick('RESEARCH')[0]!),
      ideas,
      brief: snap(brief!),
      script: snap(pick('PRODUCTION_SCRIPT')[0]!),
      translation: review === p.productionLanguage ? null : snap(pick('REVIEW_TRANSLATION')[0]!),
      critique: snap(pick('SCRIPT_CRITIQUE')[0]!),
      storyboard: snap(pick('STORYBOARD')[0]!),
      preflight,
      dependencies: [
        ...deps,
        ...(includeVirtualPreflightDependencies
          ? ids.map((sourceVersionId) => ({
              sourceVersionId,
              dependentVersionId: pf.versionId,
              dependencyType: 'VALIDATED_BY' as const,
              validity: 'CURRENT' as const,
              invalidatedAt: null,
              invalidatedByVersionId: null,
            }))
          : []),
      ],
    };
    return { snapshot, stableGuards };
  }
  async calculate(projectId: string) {
    if (!(await deterministicPreflightSchemaReady(this.db)))
      throw new Error('deterministic_preflight_schema_unavailable');
    const editorialReadiness = await evaluateEditorialProductionReadiness(
      this.db,
      this.actor,
      projectId,
      'BEFORE_PREFLIGHT',
    );
    if (!editorialReadiness.ready)
      throw new Error(`editorial_production_not_ready:${editorialReadiness.blockers.join(',')}`);
    const old = await this.db
      .prepare(
        `SELECT id,current_version_id currentVersionId FROM editorial_artifacts WHERE workspace_id=? AND project_id=? AND artifact_type='PREFLIGHT' AND deleted_at IS NULL`,
      )
      .bind(this.actor.workspaceId, projectId)
      .first<{ id: string; currentVersionId: string | null }>();
    const artifactId = old?.id ?? uid('artifact'),
      versionId = uid('artifact_version'),
      g = (await this.graph(projectId, { artifactId, versionId })).snapshot,
      ev = evaluateTerminalGraph(g);
    if (!ev.coherent) throw new Error(`terminal_graph_incoherent:${ev.failureReasons.join(',')}`);
    const body = {
        ruleSetVersion: 'phase3-terminal-v1',
        validatedVersionIds: [...g.preflight.validatedVersionIds].sort(),
        checks: g.preflight.checks,
        overallResult: 'PASS',
      },
      contentHash = await hash(body);
    const replay = await this.db
      .prepare(
        `SELECT a.id artifactId,v.id versionId,p.id assessmentId,p.overall_result overallResult,p.generation_readiness generationReadiness FROM editorial_artifacts a JOIN editorial_artifact_versions v ON v.id=a.current_version_id JOIN preflight_assessments p ON p.artifact_version_id=v.id WHERE a.workspace_id=? AND a.project_id=? AND a.artifact_type='PREFLIGHT' AND v.content_hash=?`,
      )
      .bind(this.actor.workspaceId, projectId, contentHash)
      .first<Row>();
    if (replay) return { ...replay, idempotentReplay: true };
    const time = at(),
      assessmentId = uid('preflight'),
      n = old
        ? Number(
            (
              await this.db
                .prepare(
                  'SELECT COALESCE(MAX(version_number),0)+1 n FROM editorial_artifact_versions WHERE artifact_id=?',
                )
                .bind(artifactId)
                .first<{ n: number }>()
            )?.n,
          )
        : 1,
      s: D1PreparedStatement[] = [];
    if (!old)
      s.push(
        this.db
          .prepare(
            `INSERT INTO editorial_artifacts(id,workspace_id,project_id,artifact_type,status,created_at,updated_at,version,created_by,updated_by) VALUES(?,?,?,'PREFLIGHT','active',?,?,1,?,?)`,
          )
          .bind(
            artifactId,
            this.actor.workspaceId,
            projectId,
            time,
            time,
            this.actor.id,
            this.actor.id,
          ),
      );
    s.push(
      this.db
        .prepare(
          `INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,parent_version_id,language_code,content_json,source_type,content_hash,created_at,created_by) VALUES(?,?,?,?,?,?,?,'DETERMINISTIC',?,?,?)`,
        )
        .bind(
          versionId,
          this.actor.workspaceId,
          artifactId,
          n,
          old?.currentVersionId ?? null,
          g.project.reviewLanguage,
          JSON.stringify(body),
          contentHash,
          time,
          this.actor.id,
        ),
      this.db
        .prepare(
          `INSERT INTO preflight_assessments(id,workspace_id,project_id,artifact_id,artifact_version_id,overall_result,generation_readiness,rule_set_version,assessed_at,assessed_by) VALUES(?,?,?,?,?,'PASS','NOT_READY','phase3-terminal-v1',?,?)`,
        )
        .bind(
          assessmentId,
          this.actor.workspaceId,
          projectId,
          artifactId,
          versionId,
          time,
          this.actor.id,
        ),
      this.db
        .prepare(
          `INSERT INTO preflight_checks(id,preflight_assessment_id,check_key,result,explanation,evidence_json,rule_version,override_allowed,created_at) VALUES(?,?,?,'PASS','Canonical terminal graph is coherent.',?,'phase3-terminal-v1',0,?)`,
        )
        .bind(
          uid('check'),
          assessmentId,
          'terminal_graph_coherent',
          JSON.stringify({ hardBlocker: true, validatedVersionIds: body.validatedVersionIds }),
          time,
        ),
    );
    for (const source of body.validatedVersionIds)
      s.push(
        this.db
          .prepare(
            `INSERT INTO artifact_dependencies(id,workspace_id,source_artifact_version_id,dependent_artifact_version_id,dependency_type,validity_status,created_at,updated_at,version) VALUES(?,?,?,?,?,'CURRENT',?,?,1)`,
          )
          .bind(
            uid('dependency'),
            this.actor.workspaceId,
            source,
            versionId,
            'VALIDATED_BY',
            time,
            time,
          ),
      );
    s.push(
      this.db
        .prepare(
          `UPDATE editorial_artifacts SET current_version_id=?,status='active',updated_at=?,updated_by=?,version=version+1 WHERE id=? AND workspace_id=?`,
        )
        .bind(versionId, time, this.actor.id, artifactId, this.actor.workspaceId),
      this.db
        .prepare(
          `INSERT INTO audit_events(id,workspace_id,actor_type,actor_id,actor_role,action,resource_type,resource_id,outcome,request_id,environment,metadata_json,occurred_at,ingested_at) VALUES(?,?,'user',?,?,?,'editorial_artifact_version',?,'success',?,?,?,?,?)`,
        )
        .bind(
          uid('audit'),
          this.actor.workspaceId,
          this.actor.id,
          this.actor.roles[0] ?? null,
          'editorial.preflight_calculated',
          versionId,
          this.requestId,
          this.environment,
          JSON.stringify({ contentHash }),
          time,
          time,
        ),
    );
    try {
      await this.db.batch(s);
    } catch (error) {
      const winner = await this.db
        .prepare(
          `SELECT a.id artifactId,v.id versionId,p.id assessmentId,p.overall_result overallResult,p.generation_readiness generationReadiness FROM editorial_artifacts a JOIN editorial_artifact_versions v ON v.id=a.current_version_id JOIN preflight_assessments p ON p.artifact_version_id=v.id WHERE a.workspace_id=? AND a.project_id=? AND a.artifact_type='PREFLIGHT' AND v.content_hash=?`,
        )
        .bind(this.actor.workspaceId, projectId, contentHash)
        .first<Row>();
      if (winner) return { ...winner, idempotentReplay: true };
      throw error;
    }
    return {
      artifactId,
      versionId,
      assessmentId,
      overallResult: 'PASS',
      generationReadiness: 'NOT_READY',
      idempotentReplay: false,
    };
  }
  async readinessForApproval(
    versionId: string,
    decision: 'APPROVED' | 'REJECTED',
  ): Promise<PreflightApprovalEvaluation | null> {
    if (decision !== 'APPROVED')
      return { readiness: 'NOT_READY', beforeGuards: [], stableGuards: [] };
    const t = await this.db
      .prepare(
        `SELECT a.id artifactId,a.project_id projectId,a.current_version_id currentVersionId FROM editorial_artifacts a JOIN editorial_artifact_versions v ON v.artifact_id=a.id WHERE v.id=? AND v.workspace_id=? AND a.artifact_type='PREFLIGHT'`,
      )
      .bind(versionId, this.actor.workspaceId)
      .first<Row>();
    if (!t) return null;
    if (t.currentVersionId !== versionId) throw new Error('stale_version_cannot_be_approved');
    const captured = await this.graph(
        String(t.projectId),
        { artifactId: String(t.artifactId), versionId },
        false,
      ),
      g = captured.snapshot,
      assessment = await this.db
        .prepare(
          `SELECT id,workspace_id workspaceId,project_id projectId,artifact_id artifactId,artifact_version_id artifactVersionId,overall_result overallResult,generation_readiness generationReadiness,rule_set_version ruleSetVersion,assessed_at assessedAt,assessed_by assessedBy FROM preflight_assessments WHERE workspace_id=? AND artifact_version_id=?`,
        )
        .bind(this.actor.workspaceId, versionId)
        .first<Row>(),
      checks = (
        await this.db
          .prepare(
            `SELECT id,check_key key,result,CASE WHEN json_extract(evidence_json,'$.hardBlocker')=1 THEN 1 ELSE 0 END hardBlocker FROM preflight_checks WHERE preflight_assessment_id=? ORDER BY id`,
          )
          .bind(assessment?.id ?? '')
          .all<Row>()
      ).results;
    if (!assessment) throw new Error('preflight_assessment_missing');
    if (checks.length > 100) throw new Error('preflight_snapshot_too_large');
    const stableGuards: ApprovalSnapshotGuard[] = [
      ...captured.stableGuards,
      {
        condition: `EXISTS(SELECT 1 FROM preflight_assessments WHERE id=? AND workspace_id=? AND project_id=? AND artifact_id=? AND artifact_version_id=? AND overall_result=? AND rule_set_version=? AND assessed_at=? AND assessed_by=?)`,
        values: [
          assessment.id,
          assessment.workspaceId,
          assessment.projectId,
          assessment.artifactId,
          assessment.artifactVersionId,
          assessment.overallResult,
          assessment.ruleSetVersion,
          assessment.assessedAt,
          assessment.assessedBy,
        ],
        reason: 'preflight_assessment_snapshot_changed',
      },
      exactJsonSnapshotGuard(
        `SELECT coalesce(json_group_array(json(row_json)),json('[]')) FROM (
          SELECT json_object(
            'id',id,
            'key',check_key,
            'result',result,
            'hardBlocker',CASE WHEN json_extract(evidence_json,'$.hardBlocker')=1 THEN 1 ELSE 0 END
          ) row_json
          FROM preflight_checks
          WHERE preflight_assessment_id=?
          ORDER BY id
        )`,
        [assessment.id],
        checks.map((check) => ({
          id: String(check.id),
          key: String(check.key),
          result: String(check.result),
          hardBlocker: Number(check.hardBlocker),
        })),
        'preflight_check_snapshot_changed',
      ),
    ];
    g.preflight = {
      ...g.preflight,
      approval: 'APPROVED',
      overallResult: String(assessment.overallResult) as TerminalPreflightSnapshot['overallResult'],
      checks: checks.map((check) => ({
        key: String(check.key),
        result: String(check.result) as TerminalPreflightSnapshot['checks'][number]['result'],
        hardBlocker: Number(check.hardBlocker) === 1,
      })),
    };
    return {
      readiness: deriveGenerationReadiness(g).readiness,
      beforeGuards: [
        {
          condition: `EXISTS(SELECT 1 FROM preflight_assessments WHERE id=? AND workspace_id=? AND artifact_version_id=? AND generation_readiness=?)`,
          values: [
            assessment.id,
            this.actor.workspaceId,
            versionId,
            assessment.generationReadiness,
          ],
          reason: 'preflight_readiness_snapshot_changed',
        },
      ],
      stableGuards,
    };
  }
}
