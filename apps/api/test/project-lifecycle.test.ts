import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { ProductRepository } from '../src/product/repository';

const routes = readFileSync(new URL('../src/product/routes.ts', import.meta.url), 'utf8');
const repositorySource = readFileSync(
  new URL('../src/product/repository.ts', import.meta.url),
  'utf8',
);
const preflightSource = readFileSync(
  new URL('../src/editorial/preflight.ts', import.meta.url),
  'utf8',
);
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

function fixture() {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys=ON');
  database.exec(migrationSql('0000_phase_1_data_security_core.sql'));
  database.exec(migrationSql('0001_phase_2_product_channel_monetization.sql'));
  database.exec(`
    INSERT INTO workspaces(id,slug,name,created_at,updated_at,version) VALUES
      ('w1','w1','Workspace 1','t','t',1),
      ('w2','w2','Workspace 2','t','t',1);
    INSERT INTO users(id,workspace_id,email,status,created_at,updated_at,version) VALUES
      ('owner1','w1','owner1@test','active','t','t',1),
      ('owner2','w2','owner2@test','active','t','t',1);
    INSERT INTO content_brands(id,workspace_id,name,normalized_name,primary_language,created_at,updated_at,version) VALUES
      ('b1','w1','Brand 1','brand 1','de','t','t',1),
      ('b2','w2','Brand 2','brand 2','de','t','t',1);
    INSERT INTO channel_profiles(id,workspace_id,content_brand_id,name,normalized_name,primary_language,created_at,updated_at,version) VALUES
      ('c1','w1','b1','Channel 1','channel 1','de','t','t',1),
      ('c2','w2','b2','Channel 2','channel 2','de','t','t',1);
    INSERT INTO projects(id,workspace_id,content_brand_id,channel_profile_id,title,format,operating_mode,status,primary_language,readiness_status,created_at,updated_at,version,created_by,updated_by) VALUES
      ('p1','w1','b1','c1','Project 1','SHORT','ASSISTED','DRAFT','de','configuring','t','t',1,'owner1','owner1'),
      ('p2','w2','b2','c2','Project 2','SHORT','ASSISTED','DRAFT','de','configuring','t','t',1,'owner2','owner2');
  `);
  const db = new AtomicD1(database);
  const repository = new ProductRepository(db as unknown as D1Database, {
    id: 'owner1',
    workspaceId: 'w1',
    email: 'owner1@test',
    roles: ['owner'],
  });
  return { database, repository };
}

const context = {
  requestId: 'request-1',
  environment: 'test',
  accessIssuer: 'issuer',
  accessSubject: 'subject',
};

const project = (database: DatabaseSync, id = 'p1') =>
  database
    .prepare('SELECT status,readiness_status AS readinessStatus,version FROM projects WHERE id=?')
    .get(id);
const auditCount = (database: DatabaseSync) =>
  database.prepare('SELECT COUNT(*) AS count FROM audit_events').get() as { count: number };

describe('project lifecycle transition', () => {
  it('exposes a strict authenticated projects:write operation with no direct readiness input', () => {
    expect(routes).toContain("'/projects/:id/status-transitions'");
    expect(routes).toContain("requirePermission('projects:write')");
    expect(routes).toContain('Request body must contain exactly targetStatus and version.');
    expect(routes).not.toContain(
      "'/projects/:id/status-transitions', requirePermission('projects:read')",
    );
    expect(routes).not.toMatch(/status-transitions[\s\S]*READY_FOR_GENERATION/u);
  });

  it('atomically performs a legal transition and records one workspace-scoped audit', async () => {
    const { database, repository } = fixture();
    const result = await repository.transitionProject('p1', 'ANALYZING', 1, context);

    expect(result).toMatchObject({
      id: 'p1',
      previousStatus: 'DRAFT',
      status: 'ANALYZING',
      readinessStatus: 'configuring',
      version: 2,
    });
    expect(project(database)).toEqual({
      status: 'ANALYZING',
      readinessStatus: 'configuring',
      version: 2,
    });
    expect(auditCount(database).count).toBe(1);
    const audit = database
      .prepare(
        `SELECT workspace_id AS workspaceId,action,resource_id AS resourceId,request_id AS requestId,metadata_json AS metadataJson FROM audit_events`,
      )
      .get() as Record<string, unknown>;
    expect(audit).toMatchObject({
      workspaceId: 'w1',
      action: 'project.lifecycle_transitioned',
      resourceId: 'p1',
      requestId: 'request-1',
    });
    expect(JSON.parse(String(audit.metadataJson))).toEqual({
      fromStatus: 'DRAFT',
      toStatus: 'ANALYZING',
      fromVersion: 1,
      toVersion: 2,
    });
  });

  it.each([
    ['illegal transition', 'p1', 'PREFLIGHT_REVIEW', 1, 'project_transition_invalid'],
    ['stale version', 'p1', 'ANALYZING', 2, 'project_transition_conflict'],
    ['foreign workspace', 'p2', 'ANALYZING', 1, 'project_not_found'],
  ])('rejects %s without mutation', async (_case, id, status, version, message) => {
    const { database, repository } = fixture();
    await expect(repository.transitionProject(id, status, version, context)).rejects.toThrow(
      message,
    );
    expect(project(database, id)).toEqual({
      status: 'DRAFT',
      readinessStatus: 'configuring',
      version: 1,
    });
    expect(auditCount(database).count).toBe(0);
  });

  it('reaches PREFLIGHT_REVIEW only through the canonical state machine', async () => {
    const { database, repository } = fixture();
    const states = ['ANALYZING', 'SCRIPT_REVIEW', 'STORYBOARD_REVIEW', 'PREFLIGHT_REVIEW'];
    for (const [index, status] of states.entries()) {
      await repository.transitionProject('p1', status, index + 1, {
        ...context,
        requestId: `request-${index + 1}`,
      });
    }
    expect(project(database)).toEqual({
      status: 'PREFLIGHT_REVIEW',
      readinessStatus: 'configuring',
      version: 5,
    });
    expect(auditCount(database).count).toBe(4);
  });

  it('preserves deterministic Preflight as the sole readiness derivation path', () => {
    expect(repositorySource).toContain('canTransitionProject(project.status, nextStatus)');
    expect(repositorySource).toContain('UPDATE projects SET status=?');
    expect(repositorySource).not.toContain('UPDATE projects SET readiness_status=');
    expect(preflightSource).toContain('deriveGenerationReadiness');
    expect(preflightSource).toContain("generationReadiness: 'NOT_READY'");
  });
});
