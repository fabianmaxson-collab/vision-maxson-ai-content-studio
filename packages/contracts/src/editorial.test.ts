import { describe, expect, it } from 'vitest';
import {
  createArtifactVersionSchema,
  governedImportedResearchRevisionSchema,
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
  it('requires verified, observed and source-linked imported Research', () => {
    const valid = {
      expectedResearchArtifactId: 'artifact_research',
      expectedParentVersionId: 'artifact_version_v1',
      expectedArtifactRevision: 3,
      languageCode: 'de',
      summary: 'Verified',
      sources: [
        {
          key: 's1',
          sourceType: 'ARCHIVE',
          title: 'Record',
          sourceUrl: null,
          sourceReference: 'A1',
          publishedAt: null,
          retrievedAt: '2026-09-11T00:00:00Z',
          verificationStatus: 'owner_approved',
          contentHash: 'a'.repeat(64),
        },
      ],
      claims: [
        {
          claimText: 'Event occurred',
          sourceKey: 's1',
          evidenceClass: 'OBSERVED',
          excerpt: 'Record says so',
          confidence: 1,
        },
      ],
    };
    expect(governedImportedResearchRevisionSchema.safeParse(valid).success).toBe(true);
    for (const bad of [
      { ...valid, extra: true },
      { ...valid, sources: [] },
      { ...valid, claims: [] },
      { ...valid, sources: [{ ...valid.sources[0], sourceUrl: null, sourceReference: null }] },
      { ...valid, sources: [{ ...valid.sources[0], sourceUrl: 'http://example.test' }] },
      { ...valid, sources: [{ ...valid.sources[0], retrievedAt: 'not-a-date' }] },
      {
        ...valid,
        sources: [
          {
            ...valid.sources[0],
            publishedAt: '2026-09-12T00:00:00Z',
            retrievedAt: '2026-09-11T00:00:00Z',
          },
        ],
      },
      { ...valid, sources: [{ ...valid.sources[0], contentHash: 'A'.repeat(64) }] },
      { ...valid, sources: [{ ...valid.sources[0], key: 's1' }, { ...valid.sources[0] }] },
      { ...valid, sources: [...valid.sources, { ...valid.sources[0], key: 'unused' }] },
      { ...valid, claims: [{ ...valid.claims[0], evidenceClass: 'AI_INFERENCE' }] },
      { ...valid, claims: [{ ...valid.claims[0], evidenceClass: 'UNKNOWN' }] },
      { ...valid, claims: [{ ...valid.claims[0], sourceKey: 'none' }] },
      { ...valid, claims: [{ ...valid.claims[0], excerpt: '' }] },
      { ...valid, claims: [{ ...valid.claims[0], confidence: 1.01 }] },
      {
        ...valid,
        claims: [valid.claims[0], { ...valid.claims[0], claimText: '  EVENT OCCURRED  ' }],
      },
      { ...valid, sources: [{ ...valid.sources[0], verificationStatus: 'unverified' }] },
    ])
      expect(governedImportedResearchRevisionSchema.safeParse(bad).success).toBe(false);

    expect(
      governedImportedResearchRevisionSchema.safeParse({
        ...valid,
        sources: [valid.sources[0], { ...valid.sources[0], key: 's2', title: 'Second record' }],
        claims: [
          valid.claims[0],
          { ...valid.claims[0], claimText: 'Second fact', sourceKey: 's2' },
          { ...valid.claims[0], claimText: 'Additional fact' },
        ],
      }).success,
    ).toBe(true);
  });
  it('rejects malformed machine critique structures', () => {
    expect(
      scriptCritiqueSchema.safeParse({ sourceScriptVersionId: 'v_1', issues: 'bad' }).success,
    ).toBe(false);
  });
});

describe('imported Research normalization and optional fields', () => {
  const source = {
    key: 's1',
    sourceType: 'ARCHIVE',
    title: 'Record',
    retrievedAt: '2026-09-01T00:00:00Z',
    verificationStatus: 'owner_approved',
    contentHash: 'a'.repeat(64),
  };
  const claim = {
    claimText: 'Event occurred',
    sourceKey: 's1',
    evidenceClass: 'OBSERVED',
    excerpt: 'Evidence',
    confidence: null,
  };
  const base = {
    expectedResearchArtifactId: 'research',
    expectedParentVersionId: 'research-v1',
    expectedArtifactRevision: 3,
    languageCode: 'de',
    summary: 'Summary',
    sources: [{ ...source, sourceReference: 'Ref' }],
    claims: [claim],
  };
  it('normalizes optional absent and null values consistently', () => {
    for (const fields of [
      { sourceUrl: 'https://example.test/source' },
      { sourceReference: 'Ref' },
      { sourceUrl: 'https://example.test/source', sourceReference: 'Ref' },
      { sourceReference: 'Ref', publishedAt: null },
    ]) {
      const parsed = governedImportedResearchRevisionSchema.parse({
        ...base,
        sources: [{ ...source, ...fields }],
      });
      expect(parsed.sources[0]?.publishedAt).toBeNull();
      expect(parsed.sources[0]).toHaveProperty('sourceUrl');
      expect(parsed.sources[0]).toHaveProperty('sourceReference');
    }
    expect(governedImportedResearchRevisionSchema.parse(base)).toEqual(
      governedImportedResearchRevisionSchema.parse({
        ...base,
        sources: [{ ...source, sourceReference: 'Ref', sourceUrl: null, publishedAt: null }],
      }),
    );
    for (const fields of [
      {},
      { sourceUrl: null, sourceReference: null },
      { sourceUrl: '', sourceReference: '' },
    ])
      expect(
        governedImportedResearchRevisionSchema.safeParse({
          ...base,
          sources: [{ ...source, ...fields }],
        }).success,
      ).toBe(false);
  });
  for (const [a, b] of [
    ['Café opened', 'Cafe\u0301 opened'],
    ['Event occurred', 'Event  occurred'],
    ['Event occurred', 'EVENT\t\noccurred'],
    ['Event occurred', 'Event\u00a0\u2003occurred'],
  ])
    it('rejects equivalent claim identity ' + JSON.stringify([a, b]), () => {
      expect(
        governedImportedResearchRevisionSchema.safeParse({
          ...base,
          claims: [
            { ...claim, claimText: a },
            { ...claim, claimText: b },
          ],
        }).success,
      ).toBe(false);
    });
  it('keeps equivalent claims from distinct source keys and preserves display text', () => {
    const value = {
      ...base,
      sources: [base.sources[0], { ...base.sources[0], key: 's2' }],
      claims: [
        { ...claim, claimText: 'Café  opened' },
        { ...claim, sourceKey: 's2', claimText: 'Cafe\u0301 opened' },
      ],
    };
    const parsed = governedImportedResearchRevisionSchema.parse(value);
    expect(parsed.claims[0]?.claimText).toBe('Café  opened');
    expect(parsed.claims).toHaveLength(2);
  });
});
