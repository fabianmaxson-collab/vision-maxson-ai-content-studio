import { describe, expect, it } from 'vitest';
import { EditorialRepository } from '../src/editorial/repository';

type Artifact = {
  id: string;
  projectId: string;
  currentVersionId: string | null;
  version: number;
};
type Version = { id: string; artifactId: string; versionNumber: number };
type Dependency = {
  id: string;
  sourceVersionId: string;
  dependentArtifactType: string;
  validityStatus: string;
};

class Statement {
  private values: unknown[] = [];
  constructor(
    private readonly db: MemoryD1,
    readonly sql: string,
  ) {}
  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }
  first<T>() {
    return Promise.resolve(this.db.first(this.sql, this.values) as T | null);
  }
  all<T>() {
    return Promise.resolve({ results: this.db.all(this.sql, this.values) as T[] });
  }
  run() {
    this.db.run(this.sql, this.values);
    return Promise.resolve({ meta: { changes: 1 } });
  }
}

class MemoryD1 {
  readonly artifacts = new Map<string, Artifact>();
  readonly versions = new Map<string, Version>();
  readonly dependencies: Dependency[] = [];

  prepare(sql: string) {
    return new Statement(this, sql);
  }
  async batch(statements: Statement[]) {
    for (const statement of statements) await statement.run();
    return statements.map(() => ({ meta: { changes: 1 } }));
  }
  first(sql: string, values: unknown[]) {
    if (sql.startsWith('SELECT id FROM projects'))
      return values[0] === 'project_1' ? { id: 'project_1' } : null;
    if (sql.includes('FROM editorial_artifacts WHERE id=')) {
      const artifact = this.artifacts.get(String(values[0]));
      return artifact && artifact.projectId === values[1]
        ? {
            id: artifact.id,
            currentVersionId: artifact.currentVersionId,
            version: artifact.version,
          }
        : null;
    }
    if (sql.includes('COALESCE(MAX(version_number),0)+1')) {
      const current = [...this.versions.values()].filter(
        (version) => version.artifactId === values[0],
      );
      return { next: Math.max(0, ...current.map((version) => version.versionNumber)) + 1 };
    }
    throw new Error(`Unhandled first query: ${sql}`);
  }
  all(sql: string, values: unknown[]) {
    if (sql.includes('FROM artifact_dependencies d JOIN editorial_artifact_versions'))
      return this.dependencies
        .filter(
          (dependency) =>
            dependency.sourceVersionId === values[0] && dependency.validityStatus === 'CURRENT',
        )
        .map((dependency) => ({
          id: dependency.id,
          artifactType: dependency.dependentArtifactType,
        }));
    throw new Error(`Unhandled all query: ${sql}`);
  }
  run(sql: string, values: unknown[]) {
    if (sql.startsWith('INSERT INTO editorial_artifacts')) {
      this.artifacts.set(String(values[0]), {
        id: String(values[0]),
        projectId: String(values[2]),
        currentVersionId: null,
        version: 1,
      });
      return;
    }
    if (sql.startsWith('INSERT INTO editorial_artifact_versions')) {
      this.versions.set(String(values[0]), {
        id: String(values[0]),
        artifactId: String(values[2]),
        versionNumber: Number(values[3]),
      });
      return;
    }
    if (sql.startsWith('UPDATE editorial_artifacts SET current_version_id=')) {
      const artifact = this.artifacts.get(String(values[3]));
      if (!artifact) throw new Error('artifact missing');
      artifact.currentVersionId = String(values[0]);
      artifact.version += 1;
      return;
    }
    if (sql.startsWith('UPDATE artifact_dependencies SET validity_status=')) {
      const dependency = this.dependencies.find((candidate) => candidate.id === values[4]);
      if (!dependency) throw new Error('dependency missing');
      dependency.validityStatus = String(values[0]);
      return;
    }
    throw new Error(`Unhandled mutation: ${sql}`);
  }
}

const repository = (db: MemoryD1) =>
  new EditorialRepository(db as unknown as D1Database, {
    id: 'user_owner',
    workspaceId: 'workspace_primary',
    roles: ['owner'],
  });

const briefInput = {
  projectId: 'project_1',
  artifactType: 'CONTENT_BRIEF' as const,
  parentVersionId: null,
  languageCode: 'de',
  contentText: null,
  content: { productionLanguage: 'de', reviewLanguage: 'es', format: 'SHORT' },
  sourceType: 'HUMAN_EDITED' as const,
  sourceScriptVersionId: null,
};

describe('EditorialRepository artifact continuity', () => {
  it('creates the first CONTENT_BRIEF version and makes it current', async () => {
    const db = new MemoryD1();
    const result = await repository(db).createVersion(briefInput);

    expect(result.versionNumber).toBe(1);
    expect(db.artifacts.get(result.artifactId)?.currentVersionId).toBe(result.versionId);
    expect([...db.versions.values()]).toEqual([
      { id: result.versionId, artifactId: result.artifactId, versionNumber: 1 },
    ]);
  });

  it('accepts only the current parent and invalidates dependents', async () => {
    const db = new MemoryD1();
    const repo = repository(db);
    const first = await repo.createVersion(briefInput);
    db.dependencies.push({
      id: 'dependency_1',
      sourceVersionId: first.versionId,
      dependentArtifactType: 'PRODUCTION_SCRIPT',
      validityStatus: 'CURRENT',
    });

    const second = await repo.createVersion({
      ...briefInput,
      artifactId: first.artifactId,
      parentVersionId: first.versionId,
      expectedArtifactVersion: 2,
    });

    expect(second.versionNumber).toBe(2);
    expect(db.artifacts.get(first.artifactId)?.currentVersionId).toBe(second.versionId);
    expect(db.dependencies[0]?.validityStatus).not.toBe('CURRENT');

    await expect(
      repo.createVersion({
        ...briefInput,
        artifactId: first.artifactId,
        parentVersionId: first.versionId,
        expectedArtifactVersion: 3,
      }),
    ).rejects.toThrow('parent_version_not_current');
    await expect(
      repo.createVersion({
        ...briefInput,
        artifactId: first.artifactId,
        parentVersionId: null,
        expectedArtifactVersion: 3,
      }),
    ).rejects.toThrow('parent_version_not_current');

    expect(db.artifacts.get(first.artifactId)?.currentVersionId).toBe(second.versionId);
    expect(
      [...db.versions.values()].filter((version) => version.artifactId === first.artifactId),
    ).toHaveLength(2);
  });
});
