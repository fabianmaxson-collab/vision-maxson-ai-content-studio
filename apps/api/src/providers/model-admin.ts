import {
  providerModelAvailabilityStatusSchema,
  type ProviderModelAvailabilityStatus,
  type ProviderModelStatusTransition,
} from '@vision-maxson/contracts';
import { newId, type Role } from '@vision-maxson/domain';

interface AdminActor {
  id: string;
  workspaceId: string;
  roles: Role[];
}

interface AuditContext {
  requestId: string;
  environment: string;
  accessIssuer: string;
  accessSubject: string;
}

interface ProviderModelRow {
  providerId: string;
  providerKey: string;
  providerStatus: string;
  modelId: string;
  modelKey: string;
  modelStatus: string;
  version: number;
}

interface ReplayAuditRow {
  id: string;
  metadataJson: string;
}

const transitionAllowed = (
  from: ProviderModelAvailabilityStatus,
  to: ProviderModelAvailabilityStatus,
) => (from === 'inactive' && to === 'available') || (from === 'available' && to === 'inactive');

export class ProviderModelAdminService {
  constructor(
    private readonly db: D1Database,
    private readonly actor: AdminActor,
    private readonly auditContext: AuditContext,
  ) {}

  private async findReplay(
    model: ProviderModelRow,
    input: ProviderModelStatusTransition,
  ): Promise<string | null> {
    if (model.modelStatus !== input.targetStatus || model.version !== input.version + 1) {
      return null;
    }
    const audits = await this.db
      .prepare(
        `SELECT id,metadata_json AS metadataJson FROM audit_events WHERE workspace_id=? AND action='provider_model.status_transitioned' AND resource_type='ai_provider_model' AND resource_id=? AND outcome='success' ORDER BY occurred_at DESC,id DESC`,
      )
      .bind(this.actor.workspaceId, model.modelId)
      .all<ReplayAuditRow>();
    for (const audit of audits.results) {
      try {
        const metadata = JSON.parse(audit.metadataJson) as Record<string, unknown>;
        if (
          metadata.providerId === model.providerId &&
          metadata.providerKey === model.providerKey &&
          metadata.modelId === model.modelId &&
          metadata.modelKey === model.modelKey &&
          metadata.previousStatus === input.expectedStatus &&
          metadata.newStatus === input.targetStatus &&
          metadata.fromVersion === input.version &&
          metadata.toVersion === input.version + 1
        ) {
          return audit.id;
        }
      } catch {
        // Malformed historical metadata cannot prove an idempotent replay.
      }
    }
    return null;
  }

  async transition(providerId: string, modelId: string, input: ProviderModelStatusTransition) {
    if (
      !providerModelAvailabilityStatusSchema.safeParse(input.expectedStatus).success ||
      !providerModelAvailabilityStatusSchema.safeParse(input.targetStatus).success ||
      !transitionAllowed(input.expectedStatus, input.targetStatus)
    ) {
      throw new Error('provider_model_transition_invalid');
    }
    const model = await this.db
      .prepare(
        `SELECT p.id AS providerId,p.key AS providerKey,p.status AS providerStatus,m.id AS modelId,m.model_key AS modelKey,m.status AS modelStatus,m.version FROM ai_provider_models m JOIN ai_providers p ON p.id=m.provider_id WHERE p.id=? AND m.id=? AND m.provider_id=p.id`,
      )
      .bind(providerId, modelId)
      .first<ProviderModelRow>();
    if (!model) throw new Error('provider_model_not_found');
    if (model.providerStatus !== 'configured') throw new Error('provider_not_configured');

    const replayAuditId = await this.findReplay(model, input);
    if (replayAuditId) {
      return {
        providerId: model.providerId,
        providerKey: model.providerKey,
        modelId: model.modelId,
        modelKey: model.modelKey,
        previousStatus: input.expectedStatus,
        status: input.targetStatus,
        version: input.version + 1,
        auditEventId: replayAuditId,
        idempotent: true,
      };
    }
    if (model.modelStatus !== input.expectedStatus || model.version !== input.version) {
      throw new Error('provider_model_transition_conflict');
    }

    const auditEventId = newId('audit');
    const at = new Date().toISOString();
    const metadata = JSON.stringify({
      providerId: model.providerId,
      providerKey: model.providerKey,
      modelId: model.modelId,
      modelKey: model.modelKey,
      previousStatus: input.expectedStatus,
      newStatus: input.targetStatus,
      fromVersion: input.version,
      toVersion: input.version + 1,
    });
    const results = await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO audit_events(id,workspace_id,actor_type,actor_id,actor_role,access_issuer,access_subject,action,resource_type,resource_id,outcome,request_id,environment,metadata_json,occurred_at,ingested_at) SELECT ?,?,'user',?,?,?,?,'provider_model.status_transitioned','ai_provider_model',m.id,'success',?,?,?,?,? FROM ai_provider_models m JOIN ai_providers p ON p.id=m.provider_id WHERE p.id=? AND p.status='configured' AND m.id=? AND m.provider_id=p.id AND m.status=? AND m.version=?`,
        )
        .bind(
          auditEventId,
          this.actor.workspaceId,
          this.actor.id,
          this.actor.roles[0] ?? null,
          this.auditContext.accessIssuer,
          this.auditContext.accessSubject,
          this.auditContext.requestId,
          this.auditContext.environment,
          metadata,
          at,
          at,
          model.providerId,
          model.modelId,
          input.expectedStatus,
          input.version,
        ),
      this.db
        .prepare(
          `UPDATE ai_provider_models SET status=?,updated_at=?,version=version+1 WHERE id=? AND provider_id=? AND status=? AND version=? AND EXISTS(SELECT 1 FROM ai_providers p WHERE p.id=ai_provider_models.provider_id AND p.status='configured')`,
        )
        .bind(
          input.targetStatus,
          at,
          model.modelId,
          model.providerId,
          input.expectedStatus,
          input.version,
        ),
    ]);
    if (results[0]?.meta.changes !== 1 || results[1]?.meta.changes !== 1) {
      const current = await this.db
        .prepare(
          `SELECT p.id AS providerId,p.key AS providerKey,p.status AS providerStatus,m.id AS modelId,m.model_key AS modelKey,m.status AS modelStatus,m.version FROM ai_provider_models m JOIN ai_providers p ON p.id=m.provider_id WHERE p.id=? AND m.id=? AND m.provider_id=p.id`,
        )
        .bind(providerId, modelId)
        .first<ProviderModelRow>();
      if (current) {
        const concurrentReplay = await this.findReplay(current, input);
        if (concurrentReplay) {
          return {
            providerId: current.providerId,
            providerKey: current.providerKey,
            modelId: current.modelId,
            modelKey: current.modelKey,
            previousStatus: input.expectedStatus,
            status: input.targetStatus,
            version: input.version + 1,
            auditEventId: concurrentReplay,
            idempotent: true,
          };
        }
      }
      throw new Error('provider_model_transition_conflict');
    }
    return {
      providerId: model.providerId,
      providerKey: model.providerKey,
      modelId: model.modelId,
      modelKey: model.modelKey,
      previousStatus: input.expectedStatus,
      status: input.targetStatus,
      version: input.version + 1,
      auditEventId,
      idempotent: false,
    };
  }
}
