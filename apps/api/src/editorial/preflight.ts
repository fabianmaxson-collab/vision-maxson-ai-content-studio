import {
  deriveGenerationReadiness,
  evaluateTerminalGraph,
  type TerminalArtifactVersionSnapshot,
  type TerminalDependencySnapshot,
  type TerminalGraphSnapshot,
  type TerminalPreflightSnapshot,
} from '@vision-maxson/domain';
import type { EditorialActor } from './repository';
type Row = Record<string, unknown>;
const uid = (p: string) => `${p}_${crypto.randomUUID()}`,
  at = () => new Date().toISOString();
async function hash(v: unknown) {
  const b = new TextEncoder().encode(JSON.stringify(v));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', b))]
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');
}
const baseTypes = [
  'RESEARCH',
  'IDEA_CANDIDATE',
  'CONTENT_BRIEF',
  'PRODUCTION_SCRIPT',
  'SCRIPT_CRITIQUE',
  'STORYBOARD',
] as const;
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
  ): Promise<TerminalGraphSnapshot> {
    const p = await this.db
      .prepare(
        `SELECT workspace_id workspaceId,status,format,primary_language productionLanguage FROM projects WHERE id=? AND workspace_id=? AND deleted_at IS NULL`,
      )
      .bind(projectId, this.actor.workspaceId)
      .first<Row>();
    if (!p) throw new Error('project_not_found');
    const rs = (
      await this.db
        .prepare(
          `SELECT a.id artifactId,a.artifact_type artifactType,a.current_version_id currentVersionId,v.id versionId,v.language_code languageCode,v.source_script_version_id sourceScriptVersionId,v.content_json contentJson,
   (SELECT decision FROM artifact_approvals x WHERE x.artifact_version_id=v.id ORDER BY decided_at DESC,id DESC LIMIT 1) approval,
   CASE WHEN EXISTS(SELECT 1 FROM artifact_dependencies d WHERE d.dependent_artifact_version_id=v.id AND (d.validity_status<>'CURRENT' OR d.invalidated_at IS NOT NULL OR d.invalidated_by_version_id IS NOT NULL)) THEN 1 ELSE 0 END invalidated,
   CASE WHEN i.status='SELECTED' THEN 1 ELSE 0 END selected
   FROM editorial_artifacts a JOIN editorial_artifact_versions v ON v.id=a.current_version_id LEFT JOIN idea_candidates i ON i.artifact_version_id=v.id
   WHERE a.workspace_id=? AND a.project_id=? AND a.deleted_at IS NULL AND a.artifact_type<>'PREFLIGHT' ORDER BY a.artifact_type,a.id`,
        )
        .bind(this.actor.workspaceId, projectId)
        .all<Row>()
    ).results;
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
    const deps = (
      await this.db
        .prepare(
          `SELECT source_artifact_version_id sourceVersionId,dependent_artifact_version_id dependentVersionId,dependency_type dependencyType,validity_status validity,invalidated_at invalidatedAt,invalidated_by_version_id invalidatedByVersionId FROM artifact_dependencies WHERE workspace_id=?`,
        )
        .bind(this.actor.workspaceId)
        .all<TerminalDependencySnapshot>()
    ).results;
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
    return {
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
        ...ids.map((sourceVersionId) => ({
          sourceVersionId,
          dependentVersionId: pf.versionId,
          dependencyType: 'VALIDATED_BY' as const,
          validity: 'CURRENT' as const,
          invalidatedAt: null,
          invalidatedByVersionId: null,
        })),
      ],
    };
  }
  async calculate(projectId: string) {
    const old = await this.db
      .prepare(
        `SELECT id,current_version_id currentVersionId FROM editorial_artifacts WHERE workspace_id=? AND project_id=? AND artifact_type='PREFLIGHT' AND deleted_at IS NULL`,
      )
      .bind(this.actor.workspaceId, projectId)
      .first<{ id: string; currentVersionId: string | null }>();
    const artifactId = old?.id ?? uid('artifact'),
      versionId = uid('artifact_version'),
      g = await this.graph(projectId, { artifactId, versionId }),
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
  async readinessForApproval(versionId: string, decision: 'APPROVED' | 'REJECTED') {
    if (decision !== 'APPROVED') return 'NOT_READY' as const;
    const t = await this.db
      .prepare(
        `SELECT a.id artifactId,a.project_id projectId,a.current_version_id currentVersionId FROM editorial_artifacts a JOIN editorial_artifact_versions v ON v.artifact_id=a.id WHERE v.id=? AND v.workspace_id=? AND a.artifact_type='PREFLIGHT'`,
      )
      .bind(versionId, this.actor.workspaceId)
      .first<Row>();
    if (!t) return null;
    if (t.currentVersionId !== versionId) throw new Error('stale_version_cannot_be_approved');
    const g = await this.graph(String(t.projectId), {
        artifactId: String(t.artifactId),
        versionId,
      }),
      a = await this.db
        .prepare(
          'SELECT overall_result overallResult FROM preflight_assessments WHERE workspace_id=? AND artifact_version_id=?',
        )
        .bind(this.actor.workspaceId, versionId)
        .first<Row>(),
      cs = (
        await this.db
          .prepare(
            `SELECT check_key key,result,CASE WHEN json_extract(evidence_json,'$.hardBlocker')=1 THEN 1 ELSE 0 END hardBlocker FROM preflight_checks WHERE preflight_assessment_id=(SELECT id FROM preflight_assessments WHERE workspace_id=? AND artifact_version_id=?)`,
          )
          .bind(this.actor.workspaceId, versionId)
          .all<Row>()
      ).results;
    g.preflight = {
      ...g.preflight,
      approval: 'APPROVED',
      overallResult: String(a?.overallResult) as TerminalPreflightSnapshot['overallResult'],
      checks: cs.map((c) => ({
        key: String(c.key),
        result: String(c.result) as TerminalPreflightSnapshot['checks'][number]['result'],
        hardBlocker: Number(c.hardBlocker) === 1,
      })),
    };
    g.dependencies = (
      await this.db
        .prepare(
          `SELECT source_artifact_version_id sourceVersionId,dependent_artifact_version_id dependentVersionId,dependency_type dependencyType,validity_status validity,invalidated_at invalidatedAt,invalidated_by_version_id invalidatedByVersionId FROM artifact_dependencies WHERE workspace_id=?`,
        )
        .bind(this.actor.workspaceId)
        .all<TerminalDependencySnapshot>()
    ).results;
    return deriveGenerationReadiness(g).readiness;
  }
}
