export const artifactTypes = [
  'RESEARCH',
  'IDEA_CANDIDATE',
  'CONTENT_BRIEF',
  'PRODUCTION_SCRIPT',
  'REVIEW_TRANSLATION',
  'SCRIPT_CRITIQUE',
  'STORYBOARD',
  'PREFLIGHT',
] as const;
export type ArtifactType = (typeof artifactTypes)[number];
export type ArtifactSourceType = 'AI_GENERATED' | 'HUMAN_EDITED' | 'IMPORTED';
export type DependencyValidity =
  'CURRENT' | 'STALE' | 'INVALIDATED' | 'REGENERATION_REQUIRED' | 'REAPPROVAL_REQUIRED';
export type AssessmentResult = 'PASS' | 'WARNING' | 'BLOCKED' | 'UNKNOWN';

export interface VersionDependency {
  sourceVersionId: string;
  dependentVersionId: string;
  validity: DependencyValidity;
}

export function invalidationFor(type: ArtifactType): DependencyValidity {
  if (type === 'REVIEW_TRANSLATION' || type === 'SCRIPT_CRITIQUE') return 'REGENERATION_REQUIRED';
  if (type === 'STORYBOARD' || type === 'PREFLIGHT') return 'REAPPROVAL_REQUIRED';
  return 'STALE';
}

export function invalidateDependents(
  dependencies: readonly VersionDependency[],
  replacedVersionId: string,
  dependentTypes: Readonly<Record<string, ArtifactType>>,
): VersionDependency[] {
  return dependencies.map((dependency) =>
    dependency.sourceVersionId === replacedVersionId
      ? {
          ...dependency,
          validity: invalidationFor(dependentTypes[dependency.dependentVersionId] ?? 'RESEARCH'),
        }
      : dependency,
  );
}

export function reviewIsCurrent(
  sourceScriptVersionId: string,
  currentScriptVersionId: string,
): boolean {
  return sourceScriptVersionId === currentScriptVersionId;
}

export function countWords(text: string): number {
  return text.trim() ? text.trim().split(/\s+/u).length : 0;
}

export function canApproveEditorial(role: 'owner' | 'admin' | 'operator' | 'viewer'): boolean {
  return role !== 'viewer';
}
