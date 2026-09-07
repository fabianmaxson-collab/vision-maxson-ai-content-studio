import { describe, expect, it } from 'vitest';
import { productionScriptOutputSchema } from '@vision-maxson/contracts';
import {
  conservativeInputTokenUpperBound,
  phase3ShortDeReviewEsProfile,
} from '@vision-maxson/providers/execution-profile';
import { z } from 'zod';
import {
  providerBoundRequestMaterial,
  scriptWriterShortProviderContext,
} from '../src/editorial/execution';
import fixture from './fixtures/canonical-script-context.json';

const canonicalProject = fixture.project;
const outputSchema = z.toJSONSchema(productionScriptOutputSchema);
const profileContext = {
  key: phase3ShortDeReviewEsProfile.key,
  productionLanguage: phase3ShortDeReviewEsProfile.productionLanguage,
  reviewLanguage: phase3ShortDeReviewEsProfile.reviewLanguage,
  externalResearchAllowed: false,
  specializedVerificationAllowed: false,
  humanReviewRequired: true,
  reviewTranslationIsReviewOnly: true,
};

describe('SCRIPT_WRITER_SHORT exact-Brief provider context', () => {
  it('reproduces the historical canonical context rejection', () => {
    const broad = { ...canonicalProject, executionProfile: profileContext };
    const material = providerBoundRequestMaterial(fixture.promptTemplate, broad, {}, outputSchema);
    expect(material.conservativeInputUnits).toBe(9736);
    expect(material.conservativeInputUnits - 8192).toBe(1544);
  });

  it('uses only the exact complete Brief and shared runtime sizing', () => {
    const briefVersionId = 'artifact_version_853b2f46-1d0f-4071-9566-bff028021f15';
    const context = scriptWriterShortProviderContext(
      canonicalProject,
      phase3ShortDeReviewEsProfile,
      briefVersionId,
    );
    const material = providerBoundRequestMaterial(
      fixture.promptTemplate,
      context,
      {},
      outputSchema,
    );

    expect(context).toMatchObject({
      task: 'SCRIPT_WRITER_SHORT',
      projectId: 'project_2135b883-8499-48e9-a4a7-bb04b970d72a',
      productionLanguage: 'de',
      inputBriefVersionId: briefVersionId,
      approvedBrief: { format: 'SHORT', productionLanguage: 'de', reviewLanguage: 'es' },
      executionProfile: profileContext,
    });
    expect(material.input).toEqual({});
    expect(material.outputSchema).toEqual(outputSchema);
    expect(material.conservativeInputUnits).toBe(6111);
    expect(8192 - material.conservativeInputUnits).toBe(2081);

    const exactBrief = canonicalProject.approvedArtifacts.find(
      (artifact) => artifact.artifactType === 'CONTENT_BRIEF',
    );
    expect(context.approvedBrief).toEqual(JSON.parse(exactBrief!.contentJson));
    expect(Object.keys(context)).toEqual([
      'task',
      'projectId',
      'productionLanguage',
      'inputBriefVersionId',
      'approvedBrief',
      'executionProfile',
    ]);
    expect(context).not.toHaveProperty('approvedArtifacts');
    const serialized = JSON.stringify(context);
    expect(serialized.match(/Recherche vor Erzählung/gu)).toHaveLength(1);
    expect(serialized).not.toContain('"rationale":');
    expect(serialized).not.toContain('"claims":');
    expect(serialized).not.toContain('IDEA_CANDIDATE');
    expect(serialized).not.toContain('RESEARCH');
    expect(serialized).not.toContain('brandName');
    expect(serialized).not.toContain('channelName');
    expect(serialized).not.toContain('exactSource');
    expect(serialized).not.toContain('lineage');
  });

  it('fails closed unless the exact Brief and bounded languages match', () => {
    const exact = 'artifact_version_853b2f46-1d0f-4071-9566-bff028021f15';
    expect(() =>
      scriptWriterShortProviderContext(canonicalProject, phase3ShortDeReviewEsProfile, 'other'),
    ).toThrow('exact current approved bounded Content Brief');
    expect(() =>
      scriptWriterShortProviderContext(
        { ...canonicalProject, format: 'LONG_FORM' },
        phase3ShortDeReviewEsProfile,
        exact,
      ),
    ).toThrow('exact current approved bounded Content Brief');
    expect(() =>
      scriptWriterShortProviderContext(
        {
          ...canonicalProject,
          approvedArtifacts: canonicalProject.approvedArtifacts.map((artifact) =>
            artifact.artifactType === 'CONTENT_BRIEF'
              ? {
                  ...artifact,
                  contentJson: JSON.stringify({
                    ...JSON.parse(artifact.contentJson),
                    productionLanguage: 'en',
                  }),
                }
              : artifact,
          ),
        },
        phase3ShortDeReviewEsProfile,
        exact,
      ),
    ).toThrow('incompatible with the execution profile');
  });

  it.each([8191, 8192, 8193])(
    'measures the exact %i-unit boundary through runtime material',
    (target) => {
      const material = providerBoundRequestMaterial(
        'x'.repeat(target - 1030) + '{{context_json}}',
        {},
        {},
        {},
      );
      expect(material.conservativeInputUnits).toBe(target);
      expect(material.conservativeInputUnits > 8192).toBe(target === 8193);
    },
  );

  it('keeps the primitive estimator result identical to runtime material', () => {
    const context = scriptWriterShortProviderContext(
      canonicalProject,
      phase3ShortDeReviewEsProfile,
      'artifact_version_853b2f46-1d0f-4071-9566-bff028021f15',
    );
    const material = providerBoundRequestMaterial(
      fixture.promptTemplate,
      context,
      {},
      outputSchema,
    );
    expect(material.conservativeInputUnits).toBe(
      conservativeInputTokenUpperBound({
        instructions: material.instructions,
        input: material.input,
        outputSchema: material.outputSchema,
      }),
    );
  });
});
