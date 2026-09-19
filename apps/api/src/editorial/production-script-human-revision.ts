import {
  productionScriptHumanRevisionSchema,
  type ProductionScriptHumanRevisionCommand,
} from '@vision-maxson/contracts';
import { hasPermission, invalidationFor, newId, type ArtifactType } from '@vision-maxson/domain';
import type { EditorialActor } from './repository';
import { assertEditorialProductionReady, researchRemediationClaimGuard } from './readiness';

type Row = Record<string, string | number | null>;
type Context = {
  requestId: string;
  environment: string;
  accessIssuer: string;
  accessSubject: string;
};
const action = 'editorial.production_script_human_revised';
const maxSnapshotBindings = 80;
export class ProductionScriptHumanRevisionError extends Error {
  constructor(
    readonly status: 403 | 404 | 409 | 422 | 500,
    reason: string,
  ) {
    super(`production_script_human_revision_${reason}`);
  }
}
const fail = (status: 403 | 404 | 409 | 422 | 500, reason: string): never => {
  throw new ProductionScriptHumanRevisionError(status, reason);
};
async function digest(value: unknown) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))),
  );
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
const words = (text: string) => text.trim().split(/\s+/u).filter(Boolean).length;

export class ProductionScriptHumanRevisionService {
  constructor(
    private db: D1Database,
    private actor: EditorialActor,
    private context: Context,
  ) {}
  private statement(sql: string, values: unknown[] = []) {
    return this.db.prepare(sql).bind(...values);
  }
  private async rows(sql: string, values: unknown[] = []) {
    return (await this.statement(sql, values).all<Row>()).results;
  }
  // EXCEPT uses SQLite's typed value equality: INTEGER and REAL equivalents compare equal,
  // while TEXT is not coerced to a number and NULL remains distinct from non-NULL values.
  // The count check preserves duplicate cardinality and the empty-snapshot branch preserves absence.
  // Identifiers are internal SQL aliases, never client input. Each guard is its own statement.
  private guards(sql: string, values: unknown[], columns: string[], expected: Row[]) {
    if (columns.some((column) => !/^[a-z_]+$/u.test(column))) return fail(500, 'invalid_snapshot');
    const selected = columns.join(',');
    if (values.length + 1 > maxSnapshotBindings) return fail(500, 'invalid_snapshot');
    const statements = [
      this.statement(
        `SELECT CASE WHEN (SELECT count(*) FROM (${sql}))=? THEN 1 ELSE json('script_human_revision_snapshot_changed') END`,
        [...values, expected.length],
      ),
    ];
    if (expected.length === 0) return statements;

    const typedKey = (row: Row) =>
      JSON.stringify(
        columns.map((column) => {
          const value = row[column];
          if (value === null) return ['null'];
          if (typeof value === 'number') {
            if (!Number.isFinite(value)) return fail(500, 'invalid_snapshot');
            return ['number', Object.is(value, -0) ? 0 : value];
          }
          if (typeof value !== 'string') return fail(500, 'invalid_snapshot');
          return ['string', value];
        }),
      );
    const grouped = new Map<string, { row: Row; count: number }>();
    for (const row of expected) {
      const key = typedKey(row),
        group = grouped.get(key);
      if (group) group.count++;
      else grouped.set(key, { row, count: 1 });
    }
    const bindingsPerGroup = columns.length + 1;
    const groupsPerStatement = Math.floor((maxSnapshotBindings - values.length) / bindingsPerGroup);
    if (groupsPerStatement < 1) return fail(500, 'invalid_snapshot');
    const groups = [...grouped.values()];
    for (let index = 0; index < groups.length; index += groupsPerStatement) {
      const chunk = groups.slice(index, index + groupsPerStatement);
      const expectedRows = chunk
        .map(() => `(${[...columns, 'snapshot_count'].map(() => '?').join(',')})`)
        .join(',');
      statements.push(
        this.statement(
          `WITH actual AS (${sql}), expected(${selected},snapshot_count) AS (VALUES ${expectedRows}),
           actual_counts AS (SELECT ${selected},count(*) snapshot_count FROM actual GROUP BY ${selected})
           SELECT CASE WHEN NOT EXISTS(
             SELECT ${selected},snapshot_count FROM expected
             EXCEPT SELECT ${selected},snapshot_count FROM actual_counts
           ) THEN 1 ELSE json('script_human_revision_snapshot_changed') END`,
          [
            ...values,
            ...chunk.flatMap(({ row, count }) => [...columns.map((column) => row[column]), count]),
          ],
        ),
      );
    }
    return statements;
  }
  private exact(table: string, row: Row) {
    const columns = Object.keys(row);
    return this.guards(`SELECT ${columns.join(',')} FROM ${table} WHERE id=?`, [row.id], columns, [
      row,
    ]);
  }
  private insert(table: string, row: Row) {
    const columns = Object.keys(row);
    return this.statement(
      `INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`,
      Object.values(row),
    );
  }
  async create(projectId: string, input: ProductionScriptHumanRevisionCommand) {
    const parsed = productionScriptHumanRevisionSchema.safeParse(input);
    if (!parsed.success || !/^[A-Za-z0-9][A-Za-z0-9_-]{2,99}$/u.test(projectId))
      return fail(422, 'invalid_command');
    if (!this.actor.roles.includes('owner') || !hasPermission(this.actor.roles, 'editorial:write'))
      return fail(403, 'owner_required');
    const membershipSql = `SELECT u.id,u.workspace_id,u.status,r.key FROM users u JOIN user_roles ur ON ur.user_id=u.id AND ur.workspace_id=u.workspace_id JOIN roles r ON r.id=ur.role_id JOIN access_identities i ON i.user_id=u.id AND i.workspace_id=u.workspace_id WHERE u.id=? AND u.workspace_id=? AND u.status='active' AND u.deleted_at IS NULL AND r.key='owner' AND i.deleted_at IS NULL AND i.issuer=? AND i.subject=? ORDER BY i.id`;
    const membershipValues = [
      this.actor.id,
      this.actor.workspaceId,
      this.context.accessIssuer,
      this.context.accessSubject,
    ];
    const membership = await this.rows(membershipSql, membershipValues);
    if (membership.length !== 1) return fail(403, 'membership_invalid');
    const project = (
      await this.rows(
        'SELECT * FROM projects WHERE id=? AND workspace_id=? AND deleted_at IS NULL AND archived_at IS NULL',
        [projectId, this.actor.workspaceId],
      )
    )[0];
    if (!project) return fail(404, 'project_not_found');
    if (project.status !== 'ANALYZING') return fail(409, 'project_state_invalid');
    const artifactSql =
      'SELECT * FROM editorial_artifacts WHERE project_id=? AND workspace_id=? ORDER BY id';
    const scope = [projectId, this.actor.workspaceId];
    const artifacts = await this.rows(artifactSql, scope);
    const scripts = artifacts.filter(
      (a) => a.artifact_type === 'PRODUCTION_SCRIPT' && a.deleted_at === null,
    );
    const briefs = artifacts.filter(
      (a) => a.artifact_type === 'CONTENT_BRIEF' && a.deleted_at === null,
    );
    if (scripts.length !== 1 || briefs.length !== 1)
      return fail(409, 'canonical_artifacts_invalid');
    const script = scripts[0]!,
      brief = briefs[0]!,
      command = parsed.data;
    if (
      script.current_version_id !== command.baseVersionId ||
      !['active', 'approved'].includes(String(script.status))
    )
      return fail(409, 'base_not_current');
    const parent = (
      await this.rows(
        'SELECT * FROM editorial_artifact_versions WHERE id=? AND artifact_id=? AND workspace_id=?',
        [command.baseVersionId, script.id, this.actor.workspaceId],
      )
    )[0];
    const source = (
      await this.rows(
        'SELECT * FROM editorial_artifact_versions WHERE id=? AND artifact_id=? AND workspace_id=?',
        [brief.current_version_id, brief.id, this.actor.workspaceId],
      )
    )[0];
    if (
      !parent ||
      !source ||
      brief.status !== 'approved' ||
      source.source_type !== 'HUMAN_EDITED' ||
      source.language_code !== project.primary_language ||
      parent.language_code !== project.primary_language ||
      command.languageCode !== project.primary_language
    )
      return fail(409, 'source_invalid');
    let readiness;
    try {
      readiness = await assertEditorialProductionReady(
        this.db,
        this.actor,
        projectId,
        'BEFORE_PRODUCTION_SCRIPT',
        String(source.id),
      );
    } catch {
      return fail(409, 'upstream_not_ready');
    }
    // This Phase-3 operation edits a Script within the existing research-remediation graph.
    // Do not invent a parallel eligibility model or silently bypass its atomic claim guard.
    const identity = readiness.remediationIdentity;
    if (!identity || identity.briefVersionId !== source.id)
      return fail(409, 'research_revision_required');
    const approvalSql = `SELECT ap.* FROM artifact_approvals ap JOIN editorial_artifact_versions v ON v.id=ap.artifact_version_id JOIN editorial_artifacts a ON a.id=v.artifact_id WHERE a.project_id=? AND a.workspace_id=? ORDER BY ap.id`;
    const approvals = await this.rows(approvalSql, scope);
    if (
      !approvals.some(
        (ap) =>
          ap.workspace_id === this.actor.workspaceId &&
          ap.artifact_version_id === source.id &&
          ap.decision === 'APPROVED',
      )
    )
      return fail(409, 'brief_not_approved');
    const versionsSql = 'SELECT * FROM editorial_artifact_versions WHERE artifact_id=? ORDER BY id';
    const historical = await this.rows(versionsSql, [script.id]);
    if (historical.some((v) => Number(v.version_number) > Number(parent.version_number)))
      return fail(409, 'version_conflict');
    const dependencySql = `SELECT d.* FROM artifact_dependencies d JOIN editorial_artifact_versions v ON v.id=d.source_artifact_version_id JOIN editorial_artifacts a ON a.id=v.artifact_id WHERE a.project_id=? AND a.workspace_id=? ORDER BY d.id`;
    const dependencies = await this.rows(dependencySql, scope);
    const knownScriptVersions = new Set(historical.map((v) => v.id));
    const dependents = await this.rows(
      `SELECT v.id,a.id artifact_id,a.artifact_type FROM editorial_artifact_versions v JOIN editorial_artifacts a ON a.id=v.artifact_id WHERE a.project_id=? AND a.workspace_id=?`,
      scope,
    );
    const impacted = dependencies.filter(
      (d) =>
        knownScriptVersions.has(d.source_artifact_version_id) &&
        (d.validity_status === 'CURRENT' || d.invalidated_by_version_id === parent.id),
    );
    for (const dep of impacted) {
      const target = dependents.find((v) => v.id === dep.dependent_artifact_version_id);
      if (!target || dep.workspace_id !== this.actor.workspaceId)
        return fail(409, 'dependency_scope_invalid');
    }
    const content = {
      title: command.title,
      languageCode: command.languageCode,
      segments: command.segments,
    };
    const contentJson = JSON.stringify(content),
      text = command.segments.map((s) => s.text).join('\n\n'),
      hash = await digest(content);
    if (historical.some((v) => v.content_hash === hash)) return fail(409, 'content_already_exists');
    const at = new Date().toISOString(),
      versionId = newId('artifact_version'),
      auditId = newId('audit');
    const version: Row = {
      id: versionId,
      workspace_id: this.actor.workspaceId,
      artifact_id: script.id!,
      version_number: Number(parent.version_number) + 1,
      parent_version_id: parent.id!,
      language_code: command.languageCode,
      content_text: text,
      content_json: contentJson,
      source_type: 'HUMAN_EDITED',
      intelligence_run_id: null,
      content_hash: hash,
      word_count: words(text),
      source_script_version_id: null,
      created_at: at,
      created_by: this.actor.id,
    };
    const segments: Row[] = await Promise.all(
      command.segments.map(async (s) => ({
        id: newId('script_segment'),
        workspace_id: this.actor.workspaceId,
        script_version_id: versionId,
        segment_order: s.order,
        content_text: s.text,
        content_hash: await digest(s.text),
        word_count: words(s.text),
        created_at: at,
      })),
    );
    const lineage: Row = {
      id: newId('dependency'),
      workspace_id: this.actor.workspaceId,
      source_artifact_version_id: source.id,
      dependent_artifact_version_id: versionId,
      dependency_type: 'GENERATED_FROM',
      validity_status: 'CURRENT',
      invalidated_at: null,
      invalidated_by_version_id: null,
      created_at: at,
      updated_at: at,
      version: 1,
    };
    const audit: Row = {
      id: auditId,
      workspace_id: this.actor.workspaceId,
      actor_type: 'user',
      actor_id: this.actor.id,
      actor_role: 'owner',
      access_issuer: this.context.accessIssuer,
      access_subject: this.context.accessSubject,
      action,
      resource_type: 'editorial_artifact_version',
      resource_id: versionId,
      outcome: 'success',
      request_id: this.context.requestId,
      environment: this.context.environment,
      before_hash: parent.content_hash!,
      after_hash: hash,
      metadata_json: JSON.stringify({
        projectId,
        artifactId: script.id,
        oldVersionId: parent.id,
        newVersionId: versionId,
        authoritativeBriefVersionId: source.id,
        contentHash: hash,
        segmentCount: segments.length,
        sourceType: 'HUMAN_EDITED',
        revisionRequestId: identity.requestId,
      }),
      occurred_at: at,
      ingested_at: at,
    };
    const statements: D1PreparedStatement[] = [
      ...this.guards(membershipSql, membershipValues, Object.keys(membership[0]!), membership),
      ...this.exact('projects', project),
      ...this.guards(artifactSql, scope, Object.keys(script), artifacts),
      ...this.guards(versionsSql, [script.id], Object.keys(parent), historical),
      ...this.exact('editorial_artifact_versions', source),
      ...this.guards(
        approvalSql,
        scope,
        [
          'id',
          'workspace_id',
          'artifact_version_id',
          'decision',
          'actor_id',
          'actor_role',
          'comment',
          'decided_at',
        ],
        approvals,
      ),
      ...this.guards(dependencySql, scope, Object.keys(lineage), dependencies),
      researchRemediationClaimGuard(this.db, identity),
      this.insert('editorial_artifact_versions', version),
      ...segments.map((segment) => this.insert('script_segments', segment)),
      this.insert('artifact_dependencies', lineage),
      this.statement(
        "UPDATE editorial_artifacts SET current_version_id=?,status='active',version=version+1,updated_at=?,updated_by=? WHERE id=?",
        [versionId, at, this.actor.id, script.id],
      ),
    ];
    const expectedArtifacts = artifacts.map((a) =>
      a.id === script.id
        ? {
            ...a,
            current_version_id: versionId,
            status: 'active',
            version: Number(a.version) + 1,
            updated_at: at,
            updated_by: this.actor.id,
          }
        : { ...a },
    );
    const expectedDependencies = dependencies.map((d) => ({ ...d }));

    for (const dep of impacted) {
      const target = dependents.find((v) => v.id === dep.dependent_artifact_version_id)!;
      const validity = invalidationFor(target.artifact_type as ArtifactType);
      const expected = expectedDependencies.find((d) => d.id === dep.id)!;
      Object.assign(expected, {
        validity_status: validity,
        invalidated_at: at,
        invalidated_by_version_id: versionId,
        updated_at: at,
        version: Number(dep.version) + 1,
      });
      statements.push(
        this.statement(
          'UPDATE artifact_dependencies SET validity_status=?,invalidated_at=?,invalidated_by_version_id=?,updated_at=?,version=version+1 WHERE id=?',
          [validity, at, versionId, at, dep.id],
        ),
      );
      if (target.artifact_type === 'PREFLIGHT') {
        const assessments = await this.rows(
          'SELECT * FROM preflight_assessments WHERE artifact_version_id=? AND workspace_id=? ORDER BY id',
          [target.id, this.actor.workspaceId],
        );
        statements.push(
          this.statement(
            "UPDATE preflight_assessments SET generation_readiness='NOT_READY' WHERE artifact_version_id=? AND workspace_id=?",
            [target.id, this.actor.workspaceId],
          ),
          ...this.guards(
            'SELECT * FROM preflight_assessments WHERE artifact_version_id=? AND workspace_id=? ORDER BY id',
            [target.id, this.actor.workspaceId],
            assessments.length ? Object.keys(assessments[0]!) : ['id'],
            assessments.map((a) => ({ ...a, generation_readiness: 'NOT_READY' })),
          ),
        );
      }
    }
    expectedDependencies.push(lineage);
    expectedDependencies.sort((a, b) => (String(a.id) < String(b.id) ? -1 : 1));
    statements.push(this.insert('audit_events', audit));
    // Final exact guards detect skipped writes, partial materialization, or trigger interference.
    statements.push(
      researchRemediationClaimGuard(this.db, identity),
      ...this.guards(membershipSql, membershipValues, Object.keys(membership[0]!), membership),
      ...this.exact('projects', project),
      ...this.exact('editorial_artifact_versions', source),
      ...this.exact('editorial_artifact_versions', parent),
      ...this.exact('editorial_artifact_versions', version),
      ...this.exact('audit_events', audit),
      ...this.guards(
        'SELECT * FROM artifact_dependencies WHERE dependent_artifact_version_id=? ORDER BY id',
        [versionId],
        Object.keys(lineage),
        [lineage],
      ),
      ...this.guards(artifactSql, scope, Object.keys(script), expectedArtifacts),
      ...this.guards(dependencySql, scope, Object.keys(lineage), expectedDependencies),
      ...this.guards(
        approvalSql,
        scope,
        [
          'id',
          'workspace_id',
          'artifact_version_id',
          'decision',
          'actor_id',
          'actor_role',
          'comment',
          'decided_at',
        ],
        approvals,
      ),
      ...this.guards(
        'SELECT * FROM script_segments WHERE script_version_id=? ORDER BY segment_order',
        [versionId],
        Object.keys(segments[0]!),
        segments,
      ),
      ...this.guards(
        'SELECT id FROM editorial_artifact_versions WHERE artifact_id=? ORDER BY id',
        [script.id],
        ['id'],
        [...historical, version].sort((a, b) => (String(a.id) < String(b.id) ? -1 : 1)),
      ),
    );
    try {
      await this.db.batch(statements);
    } catch {
      return fail(409, 'atomic_write_unconfirmed_do_not_retry');
    }
    return {
      artifactId: script.id,
      projectId,
      parentVersionId: parent.id,
      versionId,
      versionNumber: version.version_number,
      sourceType: 'HUMAN_EDITED',
      contentHash: hash,
      segmentCount: segments.length,
      authoritativeBriefVersionId: source.id,
      auditEventId: auditId,
      approvalCount: 0,
    };
  }
}
