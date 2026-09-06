import { countWords, invalidationFor, type ArtifactType, type Role } from '@vision-maxson/domain';

export interface EditorialActor {
  id: string;
  workspaceId: string;
  roles: Role[];
}
const id = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;
const now = () => new Date().toISOString();
async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((part) => part.toString(16).padStart(2, '0'))
    .join('');
}

export class EditorialRepository {
  constructor(
    private readonly db: D1Database,
    private readonly actor: EditorialActor,
  ) {}

  async list(projectId: string) {
    return (
      await this.db
        .prepare(
          `SELECT a.id,a.artifact_type AS artifactType,a.status,a.current_version_id AS currentVersionId,v.version_number AS versionNumber,v.language_code AS languageCode,v.source_type AS sourceType,v.content_text AS contentText,v.content_json AS contentJson,v.source_script_version_id AS sourceScriptVersionId,v.created_at AS createdAt,(SELECT ic.id FROM idea_candidates ic WHERE ic.artifact_version_id=v.id LIMIT 1) AS candidateId FROM editorial_artifacts a LEFT JOIN editorial_artifact_versions v ON v.id=a.current_version_id WHERE a.project_id=? AND a.workspace_id=? AND a.deleted_at IS NULL ORDER BY a.created_at,a.id`,
        )
        .bind(projectId, this.actor.workspaceId)
        .all()
    ).results;
  }

  async createVersion(input: {
    projectId: string;
    artifactId?: string;
    artifactType: ArtifactType;
    parentVersionId: string | null;
    languageCode: string;
    contentText: string | null;
    content: Record<string, unknown> | null;
    sourceType: 'HUMAN_EDITED' | 'IMPORTED';
    sourceScriptVersionId: string | null;
    expectedArtifactVersion?: number;
  }) {
    const project = await this.db
      .prepare(`SELECT id FROM projects WHERE id=? AND workspace_id=? AND deleted_at IS NULL`)
      .bind(input.projectId, this.actor.workspaceId)
      .first();
    if (!project) throw new Error('project_not_found');
    const artifactId = input.artifactId ?? id('artifact');
    const existing = input.artifactId
      ? await this.db
          .prepare(
            `SELECT id,current_version_id AS currentVersionId,version FROM editorial_artifacts WHERE id=? AND project_id=? AND workspace_id=? AND deleted_at IS NULL`,
          )
          .bind(input.artifactId, input.projectId, this.actor.workspaceId)
          .first<{ id: string; currentVersionId: string | null; version: number }>()
      : null;
    if (input.artifactId && !existing) throw new Error('artifact_not_found');
    if (
      existing &&
      input.expectedArtifactVersion !== undefined &&
      existing.version !== input.expectedArtifactVersion
    )
      throw new Error('version_conflict');
    if (existing && existing.currentVersionId !== (input.parentVersionId ?? null))
      throw new Error('parent_version_not_current');
    const versionNumber = existing
      ? ((
          await this.db
            .prepare(
              `SELECT COALESCE(MAX(version_number),0)+1 AS next FROM editorial_artifact_versions WHERE artifact_id=?`,
            )
            .bind(artifactId)
            .first<{ next: number }>()
        )?.next ?? 1)
      : 1;
    const versionId = id('artifact_version');
    const contentJson = input.content === null ? null : JSON.stringify(input.content);
    const hash = await sha256(
      JSON.stringify({
        languageCode: input.languageCode,
        contentText: input.contentText,
        content: input.content,
        sourceScriptVersionId: input.sourceScriptVersionId,
      }),
    );
    const at = now();
    const statements: D1PreparedStatement[] = [];
    if (!existing)
      statements.push(
        this.db
          .prepare(
            `INSERT INTO editorial_artifacts(id,workspace_id,project_id,artifact_type,status,created_at,updated_at,version,created_by,updated_by) VALUES(?,?,?,?,'draft',?,?,1,?,?)`,
          )
          .bind(
            artifactId,
            this.actor.workspaceId,
            input.projectId,
            input.artifactType,
            at,
            at,
            this.actor.id,
            this.actor.id,
          ),
      );
    statements.push(
      this.db
        .prepare(
          `INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,parent_version_id,language_code,content_text,content_json,source_type,content_hash,word_count,source_script_version_id,created_at,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          versionId,
          this.actor.workspaceId,
          artifactId,
          versionNumber,
          input.parentVersionId,
          input.languageCode,
          input.contentText,
          contentJson,
          input.sourceType,
          hash,
          input.contentText === null ? null : countWords(input.contentText),
          input.sourceScriptVersionId,
          at,
          this.actor.id,
        ),
    );
    statements.push(
      this.db
        .prepare(
          `UPDATE editorial_artifacts SET current_version_id=?,status='active',updated_at=?,updated_by=?,version=version+1 WHERE id=? AND workspace_id=?`,
        )
        .bind(versionId, at, this.actor.id, artifactId, this.actor.workspaceId),
    );
    if (existing?.currentVersionId) {
      const dependents = await this.db
        .prepare(
          `SELECT d.id,a.artifact_type AS artifactType FROM artifact_dependencies d JOIN editorial_artifact_versions v ON v.id=d.dependent_artifact_version_id JOIN editorial_artifacts a ON a.id=v.artifact_id WHERE d.source_artifact_version_id=? AND d.workspace_id=? AND d.validity_status='CURRENT'`,
        )
        .bind(existing.currentVersionId, this.actor.workspaceId)
        .all<{ id: string; artifactType: ArtifactType }>();
      for (const dependent of dependents.results) {
        statements.push(
          this.db
            .prepare(
              `UPDATE artifact_dependencies SET validity_status=?,invalidated_at=?,invalidated_by_version_id=?,updated_at=?,version=version+1 WHERE id=? AND workspace_id=?`,
            )
            .bind(
              invalidationFor(dependent.artifactType),
              at,
              versionId,
              at,
              dependent.id,
              this.actor.workspaceId,
            ),
        );
        if (dependent.artifactType === 'PREFLIGHT')
          statements.push(
            this.db
              .prepare(
                `UPDATE preflight_assessments SET generation_readiness='NOT_READY' WHERE artifact_version_id=(SELECT dependent_artifact_version_id FROM artifact_dependencies WHERE id=?) AND workspace_id=?`,
              )
              .bind(dependent.id, this.actor.workspaceId),
          );
      }
    }
    await this.db.batch(statements);
    return { artifactId, versionId, versionNumber, contentHash: hash };
  }

  async approve(
    versionId: string,
    decision: 'APPROVED' | 'REJECTED',
    comment: string | null,
    preflightReadiness: 'READY_FOR_GENERATION' | 'NOT_READY' | null = null,
  ) {
    const version = await this.db
      .prepare(
        `SELECT v.id,v.artifact_id AS artifactId,a.current_version_id AS currentVersionId FROM editorial_artifact_versions v JOIN editorial_artifacts a ON a.id=v.artifact_id WHERE v.id=? AND v.workspace_id=?`,
      )
      .bind(versionId, this.actor.workspaceId)
      .first<{ id: string; artifactId: string; currentVersionId: string | null }>();
    if (!version) throw new Error('artifact_version_not_found');
    if (version.currentVersionId !== versionId) throw new Error('stale_version_cannot_be_approved');
    const role = this.actor.roles.find((value) => value !== 'viewer');
    if (!role) throw new Error('approval_not_allowed');
    const approvalId = id('approval'),
      at = now();
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO artifact_approvals(id,workspace_id,artifact_version_id,decision,actor_id,actor_role,comment,decided_at) VALUES(?,?,?,?,?,?,?,?)`,
        )
        .bind(
          approvalId,
          this.actor.workspaceId,
          versionId,
          decision,
          this.actor.id,
          role,
          comment,
          at,
        ),
      this.db
        .prepare(
          `UPDATE editorial_artifacts SET status=?,updated_at=?,updated_by=?,version=version+1 WHERE id=? AND workspace_id=?`,
        )
        .bind(
          decision === 'APPROVED' ? 'approved' : 'rejected',
          at,
          this.actor.id,
          version.artifactId,
          this.actor.workspaceId,
        ),
      this.db
        .prepare(
          `UPDATE preflight_assessments SET generation_readiness=? WHERE artifact_version_id=? AND workspace_id=?`,
        )
        .bind(preflightReadiness ?? 'NOT_READY', versionId, this.actor.workspaceId),
    ]);
    return { approvalId, versionId, decision };
  }

  async projectCostSummary(projectId: string) {
    const row = await this.db
      .prepare(
        `SELECT COUNT(*) AS runCount,SUM(actual_cost) AS knownSubtotal,SUM(CASE WHEN actual_cost IS NULL THEN 1 ELSE 0 END) AS unknownCount,MIN(currency) AS minCurrency,MAX(currency) AS maxCurrency FROM intelligence_runs WHERE project_id=? AND workspace_id=? AND status='SUCCEEDED'`,
      )
      .bind(projectId, this.actor.workspaceId)
      .first<{
        runCount: number;
        knownSubtotal: number | null;
        unknownCount: number;
        minCurrency: string | null;
        maxCurrency: string | null;
      }>();
    const complete = Boolean(
      row &&
      row.runCount > 0 &&
      row.unknownCount === 0 &&
      row.minCurrency === row.maxCurrency &&
      row.minCurrency,
    );
    return {
      runCount: row?.runCount ?? 0,
      knownSubtotal: row?.knownSubtotal ?? null,
      unknownCount: row?.unknownCount ?? 0,
      currency: complete ? row!.minCurrency : null,
      projectEnvelopeWith15Percent:
        complete && row && row.knownSubtotal !== null ? row.knownSubtotal * 1.15 : null,
      complete,
    };
  }
  async providerCatalog() {
    const providers = await this.db
      .prepare(
        `SELECT id,key,display_name AS displayName,status FROM ai_providers WHERE status!='disabled' ORDER BY display_name`,
      )
      .all();
    return {
      configured: providers.results.some((item) => item.status === 'configured'),
      items: providers.results,
    };
  }
}
