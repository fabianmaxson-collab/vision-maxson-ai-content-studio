import { describe, expect, it } from 'vitest';
import {
  deriveGenerationReadiness,
  evaluateTerminalGraph,
  terminalInvalidationPlan,
  terminalStageSourceContracts,
  type TerminalArtifactVersionSnapshot,
  type TerminalDependencySnapshot,
  type TerminalGraphFailureReason,
  type TerminalGraphSnapshot,
} from './terminal-pipeline';
describe('Phase 3 exact terminal source contracts', () => {
  it('declares the approved sources and dependency semantics per terminal stage', () => {
    expect(terminalStageSourceContracts.CONTENT_BRIEF).toEqual([
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
    ]);
    expect(terminalStageSourceContracts.STORYBOARD.map((source) => source.dependencyType)).toEqual([
      'GENERATED_FROM',
      'INFORMED_BY',
    ]);
    expect(terminalStageSourceContracts.PREFLIGHT).toHaveLength(7);
    expect(
      terminalStageSourceContracts.PREFLIGHT.every(
        (source) => source.dependencyType === 'VALIDATED_BY',
      ),
    ).toBe(true);
  });
});

const ids = {
  research: 'research-v1',
  idea: 'idea-v1',
  brief: 'brief-v1',
  script: 'script-v1',
  translation: 'translation-v1',
  critique: 'critique-v1',
  storyboard: 'storyboard-v1',
  preflight: 'preflight-v1',
} as const;

function artifact(
  artifactType: TerminalArtifactVersionSnapshot['artifactType'],
  versionId: string,
  languageCode = 'de',
): TerminalArtifactVersionSnapshot {
  return {
    artifactType,
    artifactId: `${artifactType.toLowerCase()}-artifact`,
    versionId,
    currentVersionId: versionId,
    workspaceId: 'workspace-1',
    projectId: 'project-1',
    projectFormat: 'SHORT',
    productionLanguage: 'de',
    reviewLanguage: 'es',
    languageCode,
    approval: 'APPROVED',
    selected: false,
    invalidated: false,
    authoritativeProduction: false,
    reviewOnly: false,
    sourceScriptVersionId: null,
  };
}

function dependency(
  sourceVersionId: string,
  dependentVersionId: string,
  dependencyType: TerminalDependencySnapshot['dependencyType'],
): TerminalDependencySnapshot {
  return {
    sourceVersionId,
    dependentVersionId,
    dependencyType,
    validity: 'CURRENT',
    invalidatedAt: null,
    invalidatedByVersionId: null,
  };
}

function coherentGraph(): TerminalGraphSnapshot {
  const research = artifact('RESEARCH', ids.research);
  const idea = { ...artifact('IDEA_CANDIDATE', ids.idea), selected: true };
  const brief = artifact('CONTENT_BRIEF', ids.brief);
  const script = {
    ...artifact('PRODUCTION_SCRIPT', ids.script),
    authoritativeProduction: true,
  };
  const translation = {
    ...artifact('REVIEW_TRANSLATION', ids.translation, 'es'),
    reviewOnly: true,
    sourceScriptVersionId: ids.script,
  };
  const critique = artifact('SCRIPT_CRITIQUE', ids.critique);
  const storyboard = artifact('STORYBOARD', ids.storyboard);
  const preflight = {
    ...artifact('PREFLIGHT', ids.preflight, 'es'),
    artifactType: 'PREFLIGHT' as const,
    overallResult: 'PASS' as const,
    checks: [{ key: 'coherent_graph', result: 'PASS' as const, hardBlocker: true }],
    validatedVersionIds: [
      ids.research,
      ids.idea,
      ids.brief,
      ids.script,
      ids.translation,
      ids.critique,
      ids.storyboard,
    ],
  };
  const terminalVersions = preflight.validatedVersionIds;
  return {
    project: {
      workspaceId: 'workspace-1',
      projectId: 'project-1',
      status: 'PREFLIGHT_REVIEW',
      format: 'SHORT',
      productionLanguage: 'de',
      reviewLanguage: 'es',
    },
    research,
    ideas: [idea],
    brief,
    script,
    translation,
    critique,
    storyboard,
    preflight,
    dependencies: [
      dependency(ids.research, ids.idea, 'GENERATED_FROM'),
      dependency(ids.idea, ids.brief, 'GENERATED_FROM'),
      dependency(ids.research, ids.brief, 'USES_RESEARCH'),
      dependency(ids.brief, ids.script, 'GENERATED_FROM'),
      dependency(ids.script, ids.translation, 'GENERATED_FROM'),
      dependency(ids.script, ids.critique, 'EVALUATES_SOURCE'),
      dependency(ids.script, ids.storyboard, 'GENERATED_FROM'),
      dependency(ids.critique, ids.storyboard, 'INFORMED_BY'),
      ...terminalVersions.map((versionId) => dependency(versionId, ids.preflight, 'VALIDATED_BY')),
    ],
  };
}

function withoutTranslation(): TerminalGraphSnapshot {
  const graph = coherentGraph();
  const artifacts = [
    graph.research,
    ...graph.ideas,
    graph.brief,
    graph.script,
    graph.critique,
    graph.storyboard,
    graph.preflight,
  ];
  for (const item of artifacts) {
    item.productionLanguage = 'es';
    item.reviewLanguage = 'es';
    item.languageCode = 'es';
  }
  graph.project.productionLanguage = 'es';
  graph.project.reviewLanguage = 'es';
  graph.translation = null;
  graph.dependencies = graph.dependencies.filter(
    (item) =>
      item.sourceVersionId !== ids.translation && item.dependentVersionId !== ids.translation,
  );
  graph.preflight.validatedVersionIds = graph.preflight.validatedVersionIds.filter(
    (versionId) => versionId !== ids.translation,
  );
  return graph;
}

function expectFailure(
  mutate: (graph: TerminalGraphSnapshot) => void,
  reason: TerminalGraphFailureReason,
) {
  const graph = coherentGraph();
  mutate(graph);
  const result = deriveGenerationReadiness(graph);
  expect(result.readiness).toBe('NOT_READY');
  expect(result.failureReasons).toContain(reason);
}

describe('Phase 3 coherent terminal graph', () => {
  it('derives READY for the exact approved/current SHORT de to es chain', () => {
    const graph = coherentGraph();
    expect(evaluateTerminalGraph(graph)).toEqual({ coherent: true, failureReasons: [] });
    expect(deriveGenerationReadiness(graph)).toEqual({
      coherent: true,
      failureReasons: [],
      readiness: 'READY_FOR_GENERATION',
    });
  });

  it('derives READY for SHORT es to es without a review translation', () => {
    expect(deriveGenerationReadiness(withoutTranslation()).readiness).toBe('READY_FOR_GENERATION');
  });

  it('supports a coherent LONG_FORM graph at the pure-domain level', () => {
    const graph = coherentGraph();
    graph.project.format = 'LONG_FORM';
    for (const item of [
      graph.research,
      ...graph.ideas,
      graph.brief,
      graph.script,
      graph.translation!,
      graph.critique,
      graph.storyboard,
      graph.preflight,
    ])
      item.projectFormat = 'LONG_FORM';
    expect(deriveGenerationReadiness(graph).readiness).toBe('READY_FOR_GENERATION');
  });

  it('requires the exact current Research version', () =>
    expectFailure((graph) => {
      graph.research.currentVersionId = 'research-v2';
    }, 'VERSION_NOT_CURRENT'));

  it('rejects invalidated Research', () =>
    expectFailure((graph) => {
      graph.research.invalidated = true;
    }, 'ARTIFACT_INVALIDATED'));

  it('requires exactly one selected Idea', () =>
    expectFailure((graph) => {
      graph.ideas = [...graph.ideas, { ...artifact('IDEA_CANDIDATE', 'idea-v2'), selected: true }];
    }, 'AUTHORITATIVE_IDEA_COUNT_INVALID'));

  it('requires the selected Idea approval', () =>
    expectFailure((graph) => {
      graph.ideas[0]!.approval = null;
    }, 'IDEA_NOT_APPROVED'));

  it('requires Idea to depend on the exact Research', () =>
    expectFailure((graph) => {
      graph.dependencies = graph.dependencies.filter(
        (item) =>
          !(
            item.sourceVersionId === ids.research &&
            item.dependentVersionId === ids.idea &&
            item.dependencyType === 'GENERATED_FROM'
          ),
      );
      graph.dependencies = [
        ...graph.dependencies,
        dependency('research-v0', ids.idea, 'GENERATED_FROM'),
      ];
    }, 'DEPENDENCY_MISSING'));

  it('requires Brief to derive from the exact Idea', () =>
    expectFailure((graph) => {
      graph.dependencies = graph.dependencies.filter(
        (item) =>
          !(
            item.sourceVersionId === ids.idea &&
            item.dependentVersionId === ids.brief &&
            item.dependencyType === 'GENERATED_FROM'
          ),
      );
    }, 'DEPENDENCY_MISSING'));

  it('requires Brief to use the exact Research', () =>
    expectFailure((graph) => {
      graph.dependencies = graph.dependencies.filter(
        (item) => item.dependencyType !== 'USES_RESEARCH',
      );
    }, 'DEPENDENCY_MISSING'));

  it('rejects a stale Brief', () =>
    expectFailure((graph) => {
      graph.brief.currentVersionId = 'brief-v2';
    }, 'VERSION_NOT_CURRENT'));

  it('requires Script to derive from the exact Brief', () =>
    expectFailure((graph) => {
      graph.dependencies = graph.dependencies.filter(
        (item) => !(item.sourceVersionId === ids.brief && item.dependentVersionId === ids.script),
      );
    }, 'DEPENDENCY_MISSING'));

  it('rejects SHORT/LONG_FORM mismatch', () =>
    expectFailure((graph) => {
      graph.brief.projectFormat = 'LONG_FORM';
    }, 'FORMAT_MISMATCH'));

  it('rejects a stale Script', () =>
    expectFailure((graph) => {
      graph.script.currentVersionId = 'script-v2';
    }, 'VERSION_NOT_CURRENT'));

  it('requires Translation when production and review languages differ', () =>
    expectFailure((graph) => {
      graph.translation = null;
    }, 'TRANSLATION_REQUIRED'));

  it('omits Translation when production and review languages match', () =>
    expectFailure((graph) => {
      const sameLanguage = withoutTranslation();
      Object.assign(graph, sameLanguage);
      graph.translation = artifact('REVIEW_TRANSLATION', ids.translation, 'es');
    }, 'TRANSLATION_NOT_REQUIRED'));

  it('requires Translation to reference the exact Script', () =>
    expectFailure((graph) => {
      graph.translation!.sourceScriptVersionId = 'script-v0';
    }, 'TRANSLATION_SOURCE_MISMATCH'));

  it('requires Translation in the review language', () =>
    expectFailure((graph) => {
      graph.translation!.languageCode = 'de';
    }, 'TRANSLATION_LANGUAGE_MISMATCH'));

  it('rejects stale Translation', () =>
    expectFailure((graph) => {
      graph.translation!.invalidated = true;
    }, 'ARTIFACT_INVALIDATED'));

  it('requires Critique to evaluate the exact Script', () =>
    expectFailure((graph) => {
      graph.dependencies = graph.dependencies.filter(
        (item) => item.dependencyType !== 'EVALUATES_SOURCE',
      );
      graph.dependencies = [
        ...graph.dependencies,
        dependency('script-v0', ids.critique, 'EVALUATES_SOURCE'),
      ];
    }, 'DEPENDENCY_MISSING'));

  it('rejects stale Critique', () =>
    expectFailure((graph) => {
      graph.critique.currentVersionId = 'critique-v2';
    }, 'VERSION_NOT_CURRENT'));

  it('requires Storyboard to derive from the exact Script', () =>
    expectFailure((graph) => {
      graph.dependencies = graph.dependencies.filter(
        (item) =>
          !(item.dependentVersionId === ids.storyboard && item.dependencyType === 'GENERATED_FROM'),
      );
    }, 'DEPENDENCY_MISSING'));

  it('requires Storyboard to be informed by the exact Critique', () =>
    expectFailure((graph) => {
      graph.dependencies = graph.dependencies.filter(
        (item) => item.dependencyType !== 'INFORMED_BY',
      );
    }, 'DEPENDENCY_MISSING'));

  it('rejects stale Storyboard', () =>
    expectFailure((graph) => {
      graph.storyboard.invalidated = true;
    }, 'ARTIFACT_INVALIDATED'));

  it('rejects a required dependency that is not CURRENT', () =>
    expectFailure((graph) => {
      graph.dependencies[0]!.validity = 'STALE';
    }, 'DEPENDENCY_NOT_CURRENT'));

  it('rejects a dependency with invalidation metadata', () =>
    expectFailure((graph) => {
      graph.dependencies[0]!.invalidatedAt = '2026-09-06T00:00:00.000Z';
    }, 'DEPENDENCY_INVALIDATED'));

  it('rejects a foreign workspace artifact', () =>
    expectFailure((graph) => {
      graph.script.workspaceId = 'workspace-foreign';
    }, 'FOREIGN_WORKSPACE'));

  it('rejects a foreign project artifact', () =>
    expectFailure((graph) => {
      graph.storyboard.projectId = 'project-foreign';
    }, 'FOREIGN_PROJECT'));

  it('requires Preflight to validate the exact terminal versions', () =>
    expectFailure((graph) => {
      graph.preflight.validatedVersionIds = [
        ...graph.preflight.validatedVersionIds.filter((id) => id !== ids.script),
        'script-v0',
      ];
    }, 'PREFLIGHT_SNAPSHOT_MISMATCH'));

  it.each(['WARNING', 'BLOCKED', 'UNKNOWN'] as const)(
    'keeps readiness NOT_READY for Preflight %s',
    (result) =>
      expectFailure((graph) => {
        graph.preflight.overallResult = result;
      }, 'PREFLIGHT_NOT_PASS'),
  );

  it('requires approval of the exact Preflight version', () =>
    expectFailure((graph) => {
      graph.preflight.approval = null;
    }, 'PREFLIGHT_NOT_APPROVED'));

  it('rejects stale Preflight despite a historical approval', () =>
    expectFailure((graph) => {
      graph.preflight.currentVersionId = 'preflight-v2';
      graph.preflight.approval = 'APPROVED';
    }, 'VERSION_NOT_CURRENT'));

  it('rejects any non-PASS check and unresolved hard blocker', () => {
    const graph = coherentGraph();
    graph.preflight.checks = [{ key: 'budget', result: 'UNKNOWN', hardBlocker: true }];
    const result = deriveGenerationReadiness(graph);
    expect(result.failureReasons).toEqual(
      expect.arrayContaining(['PREFLIGHT_CHECK_NOT_PASS', 'PREFLIGHT_HARD_BLOCKER']),
    );
  });

  it('requires the canonical PREFLIGHT_REVIEW project state', () =>
    expectFailure((graph) => {
      graph.project.status = 'GENERATING';
    }, 'PROJECT_NOT_IN_PREFLIGHT_REVIEW'));

  it('requires the German Script to remain authoritative and Translation review-only', () => {
    const graph = coherentGraph();
    graph.script.authoritativeProduction = false;
    graph.translation!.reviewOnly = false;
    expect(deriveGenerationReadiness(graph).failureReasons).toEqual(
      expect.arrayContaining(['SCRIPT_NOT_AUTHORITATIVE', 'TRANSLATION_NOT_REVIEW_ONLY']),
    );
  });
});

describe('Phase 3 terminal invalidation and readiness revocation', () => {
  it.each([
    ['RESEARCH', ['IDEA_CANDIDATE', 'CONTENT_BRIEF', 'PRODUCTION_SCRIPT', 'PREFLIGHT']],
    ['IDEA_CANDIDATE', ['CONTENT_BRIEF', 'PRODUCTION_SCRIPT', 'PREFLIGHT']],
    ['CONTENT_BRIEF', ['PRODUCTION_SCRIPT', 'PREFLIGHT']],
    ['PRODUCTION_SCRIPT', ['REVIEW_TRANSLATION', 'SCRIPT_CRITIQUE', 'STORYBOARD', 'PREFLIGHT']],
    ['SCRIPT_CRITIQUE', ['STORYBOARD', 'PREFLIGHT']],
    ['STORYBOARD', ['PREFLIGHT']],
    ['PREFLIGHT', []],
  ] as const)('plans downstream invalidation after replacing %s', (type, expected) => {
    const plan = terminalInvalidationPlan(type);
    expect(plan.revokeReadiness).toBe(true);
    expect(plan.preserveHistoricalVersions).toBe(true);
    expect(plan.effects.map((effect) => effect.artifactType)).toEqual(
      expect.arrayContaining([...expected]),
    );
  });

  it('revokes readiness after an upstream version changes', () => {
    const graph = coherentGraph();
    expect(deriveGenerationReadiness(graph).readiness).toBe('READY_FOR_GENERATION');
    graph.research.currentVersionId = 'research-v2';
    expect(deriveGenerationReadiness(graph).readiness).toBe('NOT_READY');
    expect(terminalInvalidationPlan('RESEARCH').revokeReadiness).toBe(true);
  });
});
