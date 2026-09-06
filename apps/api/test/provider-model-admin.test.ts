import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { ProviderModelAdminService } from '../src/providers/model-admin';

const migrationSql = (name: string) =>
  readFileSync(new URL(`../../../packages/db/migrations/${name}`, import.meta.url), 'utf8');

class SqliteStatement {
  private values: unknown[] = [];
  constructor(
    private readonly database: DatabaseSync,
    private readonly sql: string,
  ) {}
  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }
  first<T>() {
    return Promise.resolve(
      (this.database.prepare(this.sql).get(...(this.values as [])) as T) ?? null,
    );
  }
  all<T>() {
    return Promise.resolve({
      results: this.database.prepare(this.sql).all(...(this.values as [])) as T[],
    });
  }
  run() {
    const result = this.database.prepare(this.sql).run(...(this.values as []));
    return Promise.resolve({ meta: { changes: Number(result.changes) } });
  }
}

class AtomicD1 {
  constructor(readonly database: DatabaseSync) {}
  prepare(sql: string) {
    return new SqliteStatement(this.database, sql);
  }
  async batch(statements: SqliteStatement[]) {
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

function fixture(providerStatus = 'configured') {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys=ON');
  for (const migration of [
    '0000_phase_1_data_security_core.sql',
    '0001_phase_2_product_channel_monetization.sql',
    '0002_phase_3_editorial_intelligence.sql',
  ]) {
    database.exec(migrationSql(migration));
  }
  database.exec(`
    INSERT INTO workspaces(id,slug,name,created_at,updated_at,version)
      VALUES('workspace','workspace','Workspace','t','t',1);
    INSERT INTO users(id,workspace_id,email,status,created_at,updated_at,version)
      VALUES('owner','workspace','owner@test','active','t','t',1);
    INSERT INTO ai_providers(id,key,display_name,status,adapter_version,created_at,updated_at,version)
      VALUES('provider_openai','openai','OpenAI','${providerStatus}','responses-v1','t','t',1);
    INSERT INTO ai_provider_models(id,provider_id,model_key,display_name,status,capabilities_json,effective_from,created_at,updated_at,version) VALUES
      ('model_terra','provider_openai','gpt-5.6-terra','Terra','inactive','{"qualityTier":"BALANCED","contextWindow":200000}','t','t','t',1),
      ('model_sol','provider_openai','gpt-5.6-sol','Sol','inactive','{"qualityTier":"HIGH","contextWindow":200000}','t','t','t',1);
    INSERT INTO ai_pricing_snapshots(id,provider_model_id,currency,input_unit_price,output_unit_price,unit_name,verification_status,effective_from,created_at,created_by) VALUES
      ('price_terra','model_terra','USD',0.0000002,0.000001,'token','externally_verified','t','t','owner'),
      ('price_sol','model_sol','USD',0.0000004,0.000002,'token','externally_verified','t','t','owner');
  `);
  const db = new AtomicD1(database);
  const service = new ProviderModelAdminService(
    db as unknown as D1Database,
    { id: 'owner', workspaceId: 'workspace', roles: ['owner'] },
    {
      requestId: 'request-1',
      environment: 'test',
      accessIssuer: 'issuer',
      accessSubject: 'subject',
    },
  );
  return { database, service };
}

const model = (database: DatabaseSync, id: string) =>
  database
    .prepare(
      `SELECT status,capabilities_json AS capabilitiesJson,provider_id AS providerId,model_key AS modelKey,version FROM ai_provider_models WHERE id=?`,
    )
    .get(id) as Record<string, unknown>;
const pricing = (database: DatabaseSync, modelId: string) =>
  database
    .prepare(
      `SELECT id,currency,input_unit_price AS inputUnitPrice,output_unit_price AS outputUnitPrice,verification_status AS verificationStatus FROM ai_pricing_snapshots WHERE provider_model_id=?`,
    )
    .get(modelId);
const audits = (database: DatabaseSync) =>
  database
    .prepare(
      `SELECT id,workspace_id AS workspaceId,action,resource_id AS resourceId,metadata_json AS metadataJson FROM audit_events ORDER BY id`,
    )
    .all() as Array<Record<string, unknown>>;

const activate = (service: ProviderModelAdminService, modelId: string) =>
  service.transition('provider_openai', modelId, {
    expectedStatus: 'inactive',
    targetStatus: 'available',
    version: 1,
  });

describe('provider model availability administration', () => {
  it.each([
    ['model_terra', 'gpt-5.6-terra', 'BALANCED', 'price_terra'],
    ['model_sol', 'gpt-5.6-sol', 'HIGH', 'price_sol'],
  ])(
    'activates %s without changing identity, quality, capabilities or pricing',
    async (modelId, modelKey, qualityTier, pricingId) => {
      const { database, service } = fixture();
      const beforePricing = pricing(database, modelId);
      const result = await activate(service, modelId);

      expect(result).toMatchObject({
        providerId: 'provider_openai',
        providerKey: 'openai',
        modelId,
        modelKey,
        previousStatus: 'inactive',
        status: 'available',
        version: 2,
        idempotent: false,
      });
      const persisted = model(database, modelId);
      expect(persisted).toMatchObject({
        status: 'available',
        providerId: 'provider_openai',
        modelKey,
        version: 2,
      });
      expect(JSON.parse(String(persisted.capabilitiesJson))).toMatchObject({ qualityTier });
      expect(pricing(database, modelId)).toEqual(beforePricing);
      expect(pricing(database, modelId)).toMatchObject({ id: pricingId });

      const rows = audits(database);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        workspaceId: 'workspace',
        action: 'provider_model.status_transitioned',
        resourceId: modelId,
      });
      expect(JSON.parse(String(rows[0]?.metadataJson))).toMatchObject({
        providerId: 'provider_openai',
        providerKey: 'openai',
        modelId,
        modelKey,
        previousStatus: 'inactive',
        newStatus: 'available',
        fromVersion: 1,
        toVersion: 2,
      });
    },
  );

  it('returns an idempotent replay without a second update or audit', async () => {
    const { database, service } = fixture();
    const first = await activate(service, 'model_terra');
    const replay = await activate(service, 'model_terra');
    expect(first.idempotent).toBe(false);
    expect(replay).toMatchObject({
      status: 'available',
      version: 2,
      auditEventId: first.auditEventId,
      idempotent: true,
    });
    expect(model(database, 'model_terra').version).toBe(2);
    expect(audits(database)).toHaveLength(1);
  });

  it.each([
    ['unknown provider', 'provider_missing', 'model_terra', 'provider_model_not_found'],
    ['unknown model', 'provider_openai', 'model_missing', 'provider_model_not_found'],
    ['stale version', 'provider_openai', 'model_terra', 'provider_model_transition_conflict'],
  ])('rejects %s without mutation or audit', async (caseName, providerId, modelId, error) => {
    void caseName;
    const { database, service } = fixture();
    await expect(
      service.transition(providerId, modelId, {
        expectedStatus: 'inactive',
        targetStatus: 'available',
        version: error === 'provider_model_transition_conflict' ? 2 : 1,
      }),
    ).rejects.toThrow(error);
    expect(model(database, 'model_terra')).toMatchObject({ status: 'inactive', version: 1 });
    expect(audits(database)).toHaveLength(0);
  });

  it('rejects an invalid availability target and an unconfigured provider', async () => {
    const valid = fixture();
    await expect(
      valid.service.transition('provider_openai', 'model_terra', {
        expectedStatus: 'inactive',
        targetStatus: 'degraded',
        version: 1,
      } as never),
    ).rejects.toThrow('provider_model_transition_invalid');
    expect(audits(valid.database)).toHaveLength(0);

    const unconfigured = fixture('inactive');
    await expect(activate(unconfigured.service, 'model_terra')).rejects.toThrow(
      'provider_not_configured',
    );
    expect(model(unconfigured.database, 'model_terra')).toMatchObject({
      status: 'inactive',
      version: 1,
    });
    expect(audits(unconfigured.database)).toHaveLength(0);
  });

  it('rolls back the audit when the guarded model update fails', async () => {
    const { database, service } = fixture();
    database.exec(`CREATE TRIGGER reject_model_update BEFORE UPDATE ON ai_provider_models
      BEGIN SELECT RAISE(ABORT,'blocked update'); END;`);
    await expect(activate(service, 'model_terra')).rejects.toThrow('blocked update');
    expect(model(database, 'model_terra')).toMatchObject({ status: 'inactive', version: 1 });
    expect(audits(database)).toHaveLength(0);
  });
});
