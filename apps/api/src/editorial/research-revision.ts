import {
  governedImportedResearchRevisionSchema,
  normalizeResearchClaim,
  researchRevisionReceiptResultSchema,
  type GovernedImportedResearchRevisionCommand,
} from '@vision-maxson/contracts';
import { invalidationFor, type ArtifactType } from '@vision-maxson/domain';
import type { EditorialActor } from './repository';

type Context = {
  requestId: string;
  environment: string;
  accessIssuer?: string;
  accessSubject?: string;
};
type Row = Record<string, unknown>;
type ResearchRevisionResult = {
  receiptId: string;
  revisionRequestId: string;
  projectId: string;
  researchArtifactId: string;
  parentVersionId: string;
  versionId: string;
  versionNumber: number;
  contentHash: string;
  auditEventId: string;
  idempotentReplay: boolean;
};
const uid = (p: string) => `${p}_${crypto.randomUUID()}`;
const now = () => new Date().toISOString();
async function hash(value: unknown) {
  const b = new TextEncoder().encode(JSON.stringify(value));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', b))]
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');
}
export async function researchRevisionSchemaReady(db: D1Database) {
  try {
    return (
      Number(
        (
          await db
            .prepare(
              "SELECT COUNT(*) count FROM sqlite_master WHERE type='table' AND name='editorial_research_revision_imports'",
            )
            .first<{ count: number }>()
        )?.count,
      ) === 1
    );
  } catch {
    return false;
  }
}
export class GovernedResearchRevisionService {
  constructor(
    private db: D1Database,
    private actor: EditorialActor,
    private context: Context,
  ) {}
  private role() {
    const role = this.actor.roles.find((r) => r !== 'viewer');
    if (!role) throw new Error('research_revision_not_allowed');
    return role;
  }
  private async replay(
    key: string,
    commandHash: string,
    requestId: string,
    command: GovernedImportedResearchRevisionCommand,
    contentHash: string,
  ): Promise<ResearchRevisionResult | null> {
    const row = await this.db
      .prepare(
        `SELECT i.*,v.version_number AS stored_version_number,v.content_hash AS stored_content_hash,v.parent_version_id AS stored_parent_id,v.artifact_id AS stored_artifact_id,v.workspace_id AS stored_workspace_id,r.project_id AS request_project_id
       FROM editorial_research_revision_imports i
       LEFT JOIN editorial_artifact_versions v ON v.id=i.new_research_version_id
       LEFT JOIN editorial_revision_requests r ON r.id=i.revision_request_id AND r.workspace_id=i.workspace_id
       WHERE i.workspace_id=? AND i.idempotency_key=?`,
      )
      .bind(this.actor.workspaceId, key)
      .first<Row>();
    if (!row) return null;
    if (row.command_hash !== commandHash) throw new Error('research_revision_idempotency_conflict');
    let decoded: unknown;
    try {
      decoded = JSON.parse(String(row.result_json));
    } catch {
      throw new Error('research_revision_receipt_invalid');
    }
    const parsed = researchRevisionReceiptResultSchema.safeParse(decoded);
    if (!parsed.success) throw new Error('research_revision_receipt_invalid');
    const result = parsed.data;
    if (
      result.receiptId !== row.id ||
      result.revisionRequestId !== row.revision_request_id ||
      result.revisionRequestId !== requestId ||
      result.projectId !== row.project_id ||
      result.projectId !== row.request_project_id ||
      result.researchArtifactId !== row.research_artifact_id ||
      result.researchArtifactId !== command.expectedResearchArtifactId ||
      result.researchArtifactId !== row.stored_artifact_id ||
      result.parentVersionId !== row.parent_research_version_id ||
      result.parentVersionId !== command.expectedParentVersionId ||
      result.parentVersionId !== row.stored_parent_id ||
      result.versionId !== row.new_research_version_id ||
      result.versionNumber !== row.stored_version_number ||
      result.contentHash !== row.stored_content_hash ||
      result.contentHash !== contentHash ||
      result.auditEventId !== row.audit_event_id ||
      row.expected_artifact_revision !== command.expectedArtifactRevision ||
      row.stored_workspace_id !== this.actor.workspaceId
    )
      throw new Error('research_revision_receipt_invalid');
    return { ...result, idempotentReplay: true };
  }
  async create(requestId: string, key: string, input: GovernedImportedResearchRevisionCommand) {
    const role = this.role();
    if (!(await researchRevisionSchemaReady(this.db)))
      throw new Error('research_revision_schema_unavailable');
    const member = await this.db
      .prepare(
        `SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id=u.id AND ur.workspace_id=u.workspace_id JOIN roles r ON r.id=ur.role_id WHERE u.id=? AND u.workspace_id=? AND u.status='active' AND u.deleted_at IS NULL AND r.key=?`,
      )
      .bind(this.actor.id, this.actor.workspaceId, role)
      .first();
    if (!member) throw new Error('research_revision_not_allowed');
    const validated = governedImportedResearchRevisionSchema.safeParse(input);
    if (!validated.success) throw new Error('research_revision_evidence_invalid');
    const command = validated.data;
    const canonical = {
      ...command,
      claims: command.claims.map((c) => ({ ...c, claimText: normalizeResearchClaim(c.claimText) })),
    };
    const contentHash = await hash({
      languageCode: canonical.languageCode,
      summary: canonical.summary,
      sources: canonical.sources,
      claims: canonical.claims,
    });
    const commandHash = await hash({ requestId, command: canonical });
    const replay = await this.replay(key, commandHash, requestId, command, contentHash);
    if (replay) return replay;
    const request = await this.db
      .prepare(
        `SELECT r.project_id projectId,r.target_stage targetStage,r.reason_code reasonCode,x.id resolutionId
    FROM editorial_revision_requests r LEFT JOIN editorial_revision_request_resolutions x ON x.revision_request_id=r.id
    WHERE r.id=? AND r.workspace_id=?`,
      )
      .bind(requestId, this.actor.workspaceId)
      .first<Row>();
    if (!request) throw new Error('revision_request_not_found');
    if (request.resolutionId) throw new Error('revision_request_already_resolved');
    if (request.targetStage !== 'RESEARCH') throw new Error('revision_target_stage_unsupported');
    const parent = await this.db
      .prepare(
        `SELECT a.id artifactId,a.current_version_id currentVersionId,a.version artifactRevision,v.version_number versionNumber
    FROM editorial_artifacts a JOIN editorial_artifact_versions v ON v.id=a.current_version_id
    WHERE a.id=? AND a.workspace_id=? AND a.project_id=? AND a.artifact_type='RESEARCH' AND a.deleted_at IS NULL`,
      )
      .bind(command.expectedResearchArtifactId, this.actor.workspaceId, request.projectId)
      .first<Row>();
    if (!parent) throw new Error('research_artifact_not_found');
    if (parent.currentVersionId !== command.expectedParentVersionId)
      throw new Error('research_parent_not_current');
    if (Number(parent.artifactRevision) !== command.expectedArtifactRevision)
      throw new Error('research_revision_version_conflict');
    const versionId = uid('artifact_version'),
      receiptId = uid('research_revision_import'),
      auditId = uid('audit'),
      at = now();
    const sourceIds = new Map(command.sources.map((s) => [s.key, uid('research_source')]));
    const fingerprints = await Promise.all(
      command.sources.map((s) =>
        hash({
          sourceType: s.sourceType,
          sourceUrl: s.sourceUrl,
          sourceReference: s.sourceReference,
          contentHash: s.contentHash,
        }),
      ),
    );
    if (new Set(fingerprints).size !== fingerprints.length)
      throw new Error('research_revision_duplicate_source');

    const result: Omit<ResearchRevisionResult, 'idempotentReplay'> = {
      receiptId,
      revisionRequestId: requestId,
      projectId: String(request.projectId),
      researchArtifactId: command.expectedResearchArtifactId,
      parentVersionId: command.expectedParentVersionId,
      versionId,
      versionNumber: Number(parent.versionNumber) + 1,
      contentHash,
      auditEventId: auditId,
    };
    const statements: D1PreparedStatement[] = [
      this.db
        .prepare(
          `INSERT INTO audit_events(id,workspace_id,actor_type,actor_id,actor_role,access_issuer,access_subject,action,resource_type,resource_id,outcome,request_id,environment,metadata_json,occurred_at,ingested_at)
    VALUES(?,?,'user',?,?,?,?,'editorial.research_revision_imported','editorial_revision_request',?,'success',?,?,?,?,?)`,
        )
        .bind(
          auditId,
          this.actor.workspaceId,
          this.actor.id,
          role,
          this.context.accessIssuer ?? null,
          this.context.accessSubject ?? null,
          requestId,
          this.context.requestId,
          this.context.environment,
          JSON.stringify({
            workspaceId: this.actor.workspaceId,
            revisionRequestId: requestId,
            projectId: request.projectId,
            researchArtifactId: command.expectedResearchArtifactId,
            parentVersionId: command.expectedParentVersionId,
            newVersionId: versionId,
            targetStage: 'RESEARCH',
            reasonCode: request.reasonCode,
          }),
          at,
          at,
        ),
      this.db
        .prepare(
          `INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,parent_version_id,language_code,content_json,source_type,content_hash,created_at,created_by) VALUES(?,?,?,?,?,?,?,'IMPORTED',?,?,?)`,
        )
        .bind(
          versionId,
          this.actor.workspaceId,
          command.expectedResearchArtifactId,
          result.versionNumber,
          command.expectedParentVersionId,
          command.languageCode,
          JSON.stringify({ summary: command.summary }),
          contentHash,
          at,
          this.actor.id,
        ),
    ];
    command.sources.forEach((s, i) =>
      statements.push(
        this.db
          .prepare(
            `INSERT INTO research_sources(id,workspace_id,research_version_id,source_type,title,source_url,source_reference,retrieved_at,published_at,verification_status,created_at,created_by,source_key,source_fingerprint,content_hash,provenance_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .bind(
            sourceIds.get(s.key),
            this.actor.workspaceId,
            versionId,
            s.sourceType,
            s.title,
            s.sourceUrl,
            s.sourceReference,
            s.retrievedAt,
            s.publishedAt,
            s.verificationStatus,
            at,
            this.actor.id,
            s.key,
            fingerprints[i],
            s.contentHash,
            JSON.stringify({
              ingestionMode: 'GOVERNED_IMPORTED_RESEARCH_REVISION',
              revisionRequestId: requestId,
              sourceKey: s.key,
            }),
          ),
      ),
    );
    command.claims.forEach((c) =>
      statements.push(
        this.db
          .prepare(
            `INSERT INTO research_claims(id,workspace_id,research_version_id,source_id,claim_text,evidence_class,excerpt,confidence,created_at,created_by) VALUES(?,?,?,?,?,'OBSERVED',?,?,?,?)`,
          )
          .bind(
            uid('research_claim'),
            this.actor.workspaceId,
            versionId,
            sourceIds.get(c.sourceKey),
            c.claimText,
            c.excerpt,
            c.confidence,
            at,
            this.actor.id,
          ),
      ),
    );
    statements.push(
      this.db
        .prepare(
          `UPDATE editorial_artifacts SET current_version_id=?,status='active',updated_at=?,updated_by=?,version=version+1 WHERE id=? AND workspace_id=? AND current_version_id=? AND version=?`,
        )
        .bind(
          versionId,
          at,
          this.actor.id,
          command.expectedResearchArtifactId,
          this.actor.workspaceId,
          command.expectedParentVersionId,
          command.expectedArtifactRevision,
        ),
    );
    const deps = await this.db
      .prepare(
        `SELECT d.id,a.artifact_type artifactType FROM artifact_dependencies d JOIN editorial_artifact_versions v ON v.id=d.dependent_artifact_version_id JOIN editorial_artifacts a ON a.id=v.artifact_id WHERE d.workspace_id=? AND d.source_artifact_version_id=? AND d.validity_status='CURRENT'`,
      )
      .bind(this.actor.workspaceId, command.expectedParentVersionId)
      .all<{ id: string; artifactType: ArtifactType }>();
    deps.results.forEach((d) => {
      statements.push(
        this.db
          .prepare(
            'UPDATE artifact_dependencies SET validity_status=?,invalidated_at=?,invalidated_by_version_id=?,updated_at=?,version=version+1 WHERE id=? AND workspace_id=?',
          )
          .bind(invalidationFor(d.artifactType), at, versionId, at, d.id, this.actor.workspaceId),
      );
      if (d.artifactType === 'PREFLIGHT')
        statements.push(
          this.db
            .prepare(
              `UPDATE preflight_assessments SET generation_readiness='NOT_READY' WHERE artifact_version_id=(SELECT dependent_artifact_version_id FROM artifact_dependencies WHERE id=?) AND workspace_id=?`,
            )
            .bind(d.id, this.actor.workspaceId),
        );
    });
    statements.push(
      this.db
        .prepare(
          `INSERT INTO editorial_research_revision_imports(id,workspace_id,project_id,revision_request_id,research_artifact_id,parent_research_version_id,new_research_version_id,expected_artifact_revision,actor_id,actor_role,audit_event_id,idempotency_key,command_hash,result_json,environment,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          receiptId,
          this.actor.workspaceId,
          request.projectId,
          requestId,
          command.expectedResearchArtifactId,
          command.expectedParentVersionId,
          versionId,
          command.expectedArtifactRevision,
          this.actor.id,
          role,
          auditId,
          key,
          commandHash,
          JSON.stringify(result),
          this.context.environment,
          at,
        ),
    );
    try {
      await this.db.batch(statements);
    } catch (error) {
      const winner = await this.replay(key, commandHash, requestId, command, contentHash);
      if (winner) return winner;
      const sibling = await this.db
        .prepare(
          'SELECT id FROM editorial_research_revision_imports WHERE revision_request_id=? AND parent_research_version_id=?',
        )
        .bind(requestId, command.expectedParentVersionId)
        .first();
      if (sibling) throw new Error('research_revision_successor_conflict', { cause: error });
      throw error;
    }
    return { ...result, idempotentReplay: false };
  }
}
