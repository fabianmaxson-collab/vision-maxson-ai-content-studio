import { describe, expect, it } from 'vitest';
import {
  createArtifactVersionSchema,
  researchClaimSchema,
  scriptCritiqueSchema,
} from './editorial';

describe('Phase 3 editorial contracts', () => {
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
