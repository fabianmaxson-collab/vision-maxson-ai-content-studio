import { describe, expect, it } from 'vitest';
import {
  createArtifactVersionSchema,
  researchClaimSchema,
  scriptCritiqueSchema,
  terminalDependencyTypeSchema,
  terminalGraphSnapshotSchema,
} from './editorial';

describe('Phase 3 editorial contracts', () => {
  it('accepts only the five terminal dependency semantics', () => {
    for (const value of [
      'GENERATED_FROM',
      'USES_RESEARCH',
      'EVALUATES_SOURCE',
      'INFORMED_BY',
      'VALIDATED_BY',
    ])
      expect(terminalDependencyTypeSchema.safeParse(value).success).toBe(true);
    expect(terminalDependencyTypeSchema.safeParse('ARBITRARY_LINK').success).toBe(false);
  });

  it('requires explicit exact-version terminal snapshot fields', () => {
    expect(
      terminalGraphSnapshotSchema.safeParse({
        project: {
          workspaceId: 'workspace-1',
          projectId: 'project-1',
          status: 'PREFLIGHT_REVIEW',
          format: 'SHORT',
          productionLanguage: 'de',
          reviewLanguage: 'es',
        },
      }).success,
    ).toBe(false);
  });
  it('requires source script for review translations', () => {
    expect(
      createArtifactVersionSchema.safeParse({
        artifactType: 'REVIEW_TRANSLATION',
        languageCode: 'es',
        contentText: 'Revisión',
        sourceType: 'IMPORTED',
      }).success,
    ).toBe(false);
  });
  it('requires provenance for observed claims', () => {
    expect(
      researchClaimSchema.safeParse({ claim: 'Observed', evidenceClass: 'OBSERVED' }).success,
    ).toBe(false);
  });
  it('rejects malformed machine critique structures', () => {
    expect(
      scriptCritiqueSchema.safeParse({ sourceScriptVersionId: 'v_1', issues: 'bad' }).success,
    ).toBe(false);
  });
});
