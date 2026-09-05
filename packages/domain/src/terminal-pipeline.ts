import type { ArtifactType, AssessmentResult, DependencyValidity } from './editorial';
import type { ProjectFormat } from './lifecycle';

export const terminalDependencyTypes = [
  'GENERATED_FROM',
  'USES_RESEARCH',
  'EVALUATES_SOURCE',
  'INFORMED_BY',
  'VALIDATED_BY',
] as const;
export type TerminalDependencyType = (typeof terminalDependencyTypes)[number];
export const terminalStageSourceContracts = {
  IDEA_CANDIDATE: [
    {
      artifactType: 'RESEARCH',
      dependencyType: 'GENERATED_FROM',
      currentRequired: true,
      approvalRequired: true,
    },
  ],
  CONTENT_BRIEF: [
    {
      artifactType: 'IDEA_CANDIDATE',
      dependencyType: 'GENERATED_FROM',
      currentRequired: true,
      approvalRequired: true,
      selectedRequired: true,
    },
    {
      artifactType: 'RESEARCH',
      dependencyType: 'USES_RESEARCH',
      currentRequired: true,
      approvalRequired: true,
    },
  ],
  PRODUCTION_SCRIPT: [
    {
      artifactType: 'CONTENT_BRIEF',
      dependencyType: 'GENERATED_FROM',
      currentRequired: true,
      approvalRequired: true,
    },
  ],
  REVIEW_TRANSLATION: [
    {
      artifactType: 'PRODUCTION_SCRIPT',
      dependencyType: 'GENERATED_FROM',
      currentRequired: true,
      approvalRequired: true,
      requiredWhen: 'PRODUCTION_AND_REVIEW_LANGUAGES_DIFFER',
    },
  ],
  SCRIPT_CRITIQUE: [
    {
      artifactType: 'PRODUCTION_SCRIPT',
      dependencyType: 'EVALUATES_SOURCE',
      currentRequired: true,
      approvalRequired: true,
    },
  ],
  STORYBOARD: [
    {
      artifactType: 'PRODUCTION_SCRIPT',
      dependencyType: 'GENERATED_FROM',
      currentRequired: true,
      approvalRequired: true,
    },
    {
      artifactType: 'SCRIPT_CRITIQUE',
      dependencyType: 'INFORMED_BY',
      currentRequired: true,
      approvalRequired: true,
    },
  ],
  PREFLIGHT: [
    'RESEARCH',
    'IDEA_CANDIDATE',
    'CONTENT_BRIEF',
    'PRODUCTION_SCRIPT',
    'REVIEW_TRANSLATION',
    'SCRIPT_CRITIQUE',
    'STORYBOARD',
  ].map((artifactType) => ({
    artifactType,
    dependencyType: 'VALIDATED_BY' as const,
    currentRequired: true,
    approvalRequired: true,
  })),
} as const;

export type ApprovalStatus = 'APPROVED' | 'REJECTED' | null;

export interface TerminalArtifactVersionSnapshot {
  artifactType: ArtifactType;
  artifactId: string;
  versionId: string;
  currentVersionId: string;
  workspaceId: string;
  projectId: string;
  projectFormat: ProjectFormat;
  productionLanguage: string;
  reviewLanguage: string;
  languageCode: string;
  approval: ApprovalStatus;
  selected: boolean;
  invalidated: boolean;
  authoritativeProduction: boolean;
  reviewOnly: boolean;
  sourceScriptVersionId: string | null;
}

export interface TerminalDependencySnapshot {
  sourceVersionId: string;
  dependentVersionId: string;
  dependencyType: TerminalDependencyType;
  validity: DependencyValidity;
  invalidatedAt: string | null;
  invalidatedByVersionId: string | null;
}

export interface TerminalPreflightCheckSnapshot {
  key: string;
  result: AssessmentResult;
  hardBlocker: boolean;
}

export interface TerminalPreflightSnapshot extends TerminalArtifactVersionSnapshot {
  artifactType: 'PREFLIGHT';
  overallResult: AssessmentResult;
  checks: readonly TerminalPreflightCheckSnapshot[];
  validatedVersionIds: readonly string[];
}

export interface TerminalGraphSnapshot {
  project: {
    workspaceId: string;
    projectId: string;
    status: string;
    format: ProjectFormat;
    productionLanguage: string;
    reviewLanguage: string;
  };
  research: TerminalArtifactVersionSnapshot;
  ideas: readonly TerminalArtifactVersionSnapshot[];
  brief: TerminalArtifactVersionSnapshot;
  script: TerminalArtifactVersionSnapshot;
  translation: TerminalArtifactVersionSnapshot | null;
  critique: TerminalArtifactVersionSnapshot;
  storyboard: TerminalArtifactVersionSnapshot;
  preflight: TerminalPreflightSnapshot;
  dependencies: readonly TerminalDependencySnapshot[];
}

export const terminalGraphFailureReasons = [
  'ARTIFACT_TYPE_MISMATCH',
  'FOREIGN_WORKSPACE',
  'FOREIGN_PROJECT',
  'FORMAT_MISMATCH',
  'PRODUCTION_LANGUAGE_MISMATCH',
  'REVIEW_LANGUAGE_MISMATCH',
  'VERSION_NOT_CURRENT',
  'ARTIFACT_INVALIDATED',
  'APPROVAL_MISSING',
  'AUTHORITATIVE_IDEA_COUNT_INVALID',
  'IDEA_NOT_APPROVED',
  'DEPENDENCY_MISSING',
  'DEPENDENCY_NOT_CURRENT',
  'DEPENDENCY_INVALIDATED',
  'TRANSLATION_REQUIRED',
  'TRANSLATION_NOT_REQUIRED',
  'TRANSLATION_SOURCE_MISMATCH',
  'TRANSLATION_LANGUAGE_MISMATCH',
  'SCRIPT_NOT_AUTHORITATIVE',
  'TRANSLATION_NOT_REVIEW_ONLY',
  'PREFLIGHT_SNAPSHOT_MISMATCH',
  'PROJECT_NOT_IN_PREFLIGHT_REVIEW',
  'PREFLIGHT_NOT_PASS',
  'PREFLIGHT_NOT_APPROVED',
  'PREFLIGHT_CHECK_NOT_PASS',
  'PREFLIGHT_HARD_BLOCKER',
] as const;
export type TerminalGraphFailureReason = (typeof terminalGraphFailureReasons)[number];

export interface TerminalGraphEvaluation {
  coherent: boolean;
  failureReasons: readonly TerminalGraphFailureReason[];
}

export interface GenerationReadinessEvaluation extends TerminalGraphEvaluation {
  readiness: 'NOT_READY' | 'READY_FOR_GENERATION';
}

const expectedTypes = {
  research: 'RESEARCH',
  idea: 'IDEA_CANDIDATE',
  brief: 'CONTENT_BRIEF',
  script: 'PRODUCTION_SCRIPT',
  translation: 'REVIEW_TRANSLATION',
  critique: 'SCRIPT_CRITIQUE',
  storyboard: 'STORYBOARD',
  preflight: 'PREFLIGHT',
} as const;

function add(
  reasons: TerminalGraphFailureReason[],
  reason: TerminalGraphFailureReason,
  condition: boolean,
) {
  if (condition && !reasons.includes(reason)) reasons.push(reason);
}

function exactCurrent(artifact: TerminalArtifactVersionSnapshot) {
  return artifact.versionId === artifact.currentVersionId;
}

function requiredDependency(
  snapshot: TerminalGraphSnapshot,
  sourceVersionId: string,
  dependentVersionId: string,
  dependencyType: TerminalDependencyType,
  reasons: TerminalGraphFailureReason[],
) {
  const dependency = snapshot.dependencies.find(
    (candidate) =>
      candidate.sourceVersionId === sourceVersionId &&
      candidate.dependentVersionId === dependentVersionId &&
      candidate.dependencyType === dependencyType,
  );
  add(reasons, 'DEPENDENCY_MISSING', dependency === undefined);
  if (!dependency) return;
  add(reasons, 'DEPENDENCY_NOT_CURRENT', dependency.validity !== 'CURRENT');
  add(
    reasons,
    'DEPENDENCY_INVALIDATED',
    dependency.invalidatedAt !== null || dependency.invalidatedByVersionId !== null,
  );
}

function validateArtifact(
  artifact: TerminalArtifactVersionSnapshot,
  expectedType: ArtifactType,
  snapshot: TerminalGraphSnapshot,
  reasons: TerminalGraphFailureReason[],
  approvalRequired = true,
) {
  add(reasons, 'ARTIFACT_TYPE_MISMATCH', artifact.artifactType !== expectedType);
  add(reasons, 'FOREIGN_WORKSPACE', artifact.workspaceId !== snapshot.project.workspaceId);
  add(reasons, 'FOREIGN_PROJECT', artifact.projectId !== snapshot.project.projectId);
  add(reasons, 'FORMAT_MISMATCH', artifact.projectFormat !== snapshot.project.format);
  add(
    reasons,
    'PRODUCTION_LANGUAGE_MISMATCH',
    artifact.productionLanguage !== snapshot.project.productionLanguage,
  );
  add(
    reasons,
    'REVIEW_LANGUAGE_MISMATCH',
    artifact.reviewLanguage !== snapshot.project.reviewLanguage,
  );
  add(reasons, 'VERSION_NOT_CURRENT', !exactCurrent(artifact));
  add(reasons, 'ARTIFACT_INVALIDATED', artifact.invalidated);
  add(reasons, 'APPROVAL_MISSING', approvalRequired && artifact.approval !== 'APPROVED');
}

function expectedPreflightVersions(
  snapshot: TerminalGraphSnapshot,
  idea: TerminalArtifactVersionSnapshot,
) {
  return [
    snapshot.research.versionId,
    idea.versionId,
    snapshot.brief.versionId,
    snapshot.script.versionId,
    ...(snapshot.translation ? [snapshot.translation.versionId] : []),
    snapshot.critique.versionId,
    snapshot.storyboard.versionId,
  ].sort();
}

function sameSet(left: readonly string[], right: readonly string[]) {
  const a = [...new Set(left)].sort();
  const b = [...new Set(right)].sort();
  return (
    a.length === left.length &&
    b.length === right.length &&
    a.length === b.length &&
    a.every((value, i) => value === b[i])
  );
}

export function evaluateTerminalGraph(snapshot: TerminalGraphSnapshot): TerminalGraphEvaluation {
  const reasons: TerminalGraphFailureReason[] = [];
  validateArtifact(snapshot.research, expectedTypes.research, snapshot, reasons);
  validateArtifact(snapshot.brief, expectedTypes.brief, snapshot, reasons);
  validateArtifact(snapshot.script, expectedTypes.script, snapshot, reasons);
  validateArtifact(snapshot.critique, expectedTypes.critique, snapshot, reasons);
  validateArtifact(snapshot.storyboard, expectedTypes.storyboard, snapshot, reasons);
  validateArtifact(snapshot.preflight, expectedTypes.preflight, snapshot, reasons, false);

  const selectedIdeas = snapshot.ideas.filter((idea) => idea.selected);
  add(reasons, 'AUTHORITATIVE_IDEA_COUNT_INVALID', selectedIdeas.length !== 1);
  for (const idea of selectedIdeas) validateArtifact(idea, expectedTypes.idea, snapshot, reasons);
  const idea = selectedIdeas[0];

  add(
    reasons,
    'SCRIPT_NOT_AUTHORITATIVE',
    !snapshot.script.authoritativeProduction ||
      snapshot.script.languageCode !== snapshot.project.productionLanguage,
  );

  const translationRequired =
    snapshot.project.productionLanguage !== snapshot.project.reviewLanguage;
  add(reasons, 'TRANSLATION_REQUIRED', translationRequired && snapshot.translation === null);
  add(reasons, 'TRANSLATION_NOT_REQUIRED', !translationRequired && snapshot.translation !== null);

  if (snapshot.translation) {
    validateArtifact(snapshot.translation, expectedTypes.translation, snapshot, reasons);
    add(
      reasons,
      'TRANSLATION_SOURCE_MISMATCH',
      snapshot.translation.sourceScriptVersionId !== snapshot.script.versionId,
    );
    add(
      reasons,
      'TRANSLATION_LANGUAGE_MISMATCH',
      snapshot.translation.languageCode !== snapshot.project.reviewLanguage,
    );
    add(reasons, 'TRANSLATION_NOT_REVIEW_ONLY', !snapshot.translation.reviewOnly);
  }

  if (idea) {
    add(reasons, 'IDEA_NOT_APPROVED', idea.approval !== 'APPROVED');
    requiredDependency(
      snapshot,
      snapshot.research.versionId,
      idea.versionId,
      'GENERATED_FROM',
      reasons,
    );
    requiredDependency(
      snapshot,
      idea.versionId,
      snapshot.brief.versionId,
      'GENERATED_FROM',
      reasons,
    );
    requiredDependency(
      snapshot,
      snapshot.research.versionId,
      snapshot.brief.versionId,
      'USES_RESEARCH',
      reasons,
    );
    add(
      reasons,
      'PREFLIGHT_SNAPSHOT_MISMATCH',
      !sameSet(snapshot.preflight.validatedVersionIds, expectedPreflightVersions(snapshot, idea)),
    );
  } else {
    add(reasons, 'PREFLIGHT_SNAPSHOT_MISMATCH', true);
  }

  requiredDependency(
    snapshot,
    snapshot.brief.versionId,
    snapshot.script.versionId,
    'GENERATED_FROM',
    reasons,
  );
  if (snapshot.translation)
    requiredDependency(
      snapshot,
      snapshot.script.versionId,
      snapshot.translation.versionId,
      'GENERATED_FROM',
      reasons,
    );
  requiredDependency(
    snapshot,
    snapshot.script.versionId,
    snapshot.critique.versionId,
    'EVALUATES_SOURCE',
    reasons,
  );
  requiredDependency(
    snapshot,
    snapshot.script.versionId,
    snapshot.storyboard.versionId,
    'GENERATED_FROM',
    reasons,
  );
  requiredDependency(
    snapshot,
    snapshot.critique.versionId,
    snapshot.storyboard.versionId,
    'INFORMED_BY',
    reasons,
  );

  if (idea) {
    for (const versionId of expectedPreflightVersions(snapshot, idea))
      requiredDependency(
        snapshot,
        versionId,
        snapshot.preflight.versionId,
        'VALIDATED_BY',
        reasons,
      );
  }

  return { coherent: reasons.length === 0, failureReasons: reasons };
}

export function deriveGenerationReadiness(
  snapshot: TerminalGraphSnapshot,
): GenerationReadinessEvaluation {
  const graph = evaluateTerminalGraph(snapshot);
  const reasons = [...graph.failureReasons];
  add(reasons, 'PROJECT_NOT_IN_PREFLIGHT_REVIEW', snapshot.project.status !== 'PREFLIGHT_REVIEW');
  add(reasons, 'PREFLIGHT_NOT_PASS', snapshot.preflight.overallResult !== 'PASS');
  add(reasons, 'PREFLIGHT_NOT_APPROVED', snapshot.preflight.approval !== 'APPROVED');
  add(
    reasons,
    'PREFLIGHT_CHECK_NOT_PASS',
    snapshot.preflight.checks.some((check) => check.result !== 'PASS'),
  );
  add(
    reasons,
    'PREFLIGHT_HARD_BLOCKER',
    snapshot.preflight.checks.some((check) => check.hardBlocker && check.result !== 'PASS'),
  );
  return {
    coherent: graph.coherent,
    failureReasons: reasons,
    readiness: reasons.length === 0 ? 'READY_FOR_GENERATION' : 'NOT_READY',
  };
}

export interface TerminalInvalidationEffect {
  artifactType: ArtifactType;
  validity: Exclude<DependencyValidity, 'CURRENT'>;
}

const downstream: Readonly<Record<ArtifactType, readonly TerminalInvalidationEffect[]>> = {
  RESEARCH: [
    { artifactType: 'IDEA_CANDIDATE', validity: 'STALE' },
    { artifactType: 'CONTENT_BRIEF', validity: 'STALE' },
    { artifactType: 'PRODUCTION_SCRIPT', validity: 'STALE' },
    { artifactType: 'REVIEW_TRANSLATION', validity: 'REGENERATION_REQUIRED' },
    { artifactType: 'SCRIPT_CRITIQUE', validity: 'REGENERATION_REQUIRED' },
    { artifactType: 'STORYBOARD', validity: 'REAPPROVAL_REQUIRED' },
    { artifactType: 'PREFLIGHT', validity: 'REAPPROVAL_REQUIRED' },
  ],
  IDEA_CANDIDATE: [
    { artifactType: 'CONTENT_BRIEF', validity: 'STALE' },
    { artifactType: 'PRODUCTION_SCRIPT', validity: 'STALE' },
    { artifactType: 'REVIEW_TRANSLATION', validity: 'REGENERATION_REQUIRED' },
    { artifactType: 'SCRIPT_CRITIQUE', validity: 'REGENERATION_REQUIRED' },
    { artifactType: 'STORYBOARD', validity: 'REAPPROVAL_REQUIRED' },
    { artifactType: 'PREFLIGHT', validity: 'REAPPROVAL_REQUIRED' },
  ],
  CONTENT_BRIEF: [
    { artifactType: 'PRODUCTION_SCRIPT', validity: 'STALE' },
    { artifactType: 'REVIEW_TRANSLATION', validity: 'REGENERATION_REQUIRED' },
    { artifactType: 'SCRIPT_CRITIQUE', validity: 'REGENERATION_REQUIRED' },
    { artifactType: 'STORYBOARD', validity: 'REAPPROVAL_REQUIRED' },
    { artifactType: 'PREFLIGHT', validity: 'REAPPROVAL_REQUIRED' },
  ],
  PRODUCTION_SCRIPT: [
    { artifactType: 'REVIEW_TRANSLATION', validity: 'REGENERATION_REQUIRED' },
    { artifactType: 'SCRIPT_CRITIQUE', validity: 'REGENERATION_REQUIRED' },
    { artifactType: 'STORYBOARD', validity: 'REAPPROVAL_REQUIRED' },
    { artifactType: 'PREFLIGHT', validity: 'REAPPROVAL_REQUIRED' },
  ],
  REVIEW_TRANSLATION: [{ artifactType: 'PREFLIGHT', validity: 'REAPPROVAL_REQUIRED' }],
  SCRIPT_CRITIQUE: [
    { artifactType: 'STORYBOARD', validity: 'REAPPROVAL_REQUIRED' },
    { artifactType: 'PREFLIGHT', validity: 'REAPPROVAL_REQUIRED' },
  ],
  STORYBOARD: [{ artifactType: 'PREFLIGHT', validity: 'REAPPROVAL_REQUIRED' }],
  PREFLIGHT: [],
};

export function terminalInvalidationPlan(replacedType: ArtifactType) {
  return {
    effects: downstream[replacedType].map((effect) => ({ ...effect })),
    revokeReadiness: true,
    preserveHistoricalVersions: true,
  } as const;
}
