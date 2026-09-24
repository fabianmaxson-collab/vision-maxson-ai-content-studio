import { describe, expect, it } from 'vitest';
import {
  createStoryboardResearchClaimSnapshot,
  validateStoryboardFactualClaims,
  type StoryboardResearchClaim,
} from '../src/editorial/storyboard-research-claims';

const claim = (id: string): StoryboardResearchClaim => ({
  id,
  claimText: 'Evidenced event',
  evidenceClass: 'OBSERVED',
  excerpt: 'Documented excerpt',
  confidence: 0.9,
  sourceId: 'source-v2',
  sourceType: 'ARCHIVE',
  sourceTitle: 'Archive',
  sourceUrl: null,
  sourceReference: 'archive-reference',
  sourceVerificationStatus: 'owner_approved',
});
const output = (ids: string[], status = 'SUPPORTED_BY_APPROVED_RESEARCH') => ({
  scenes: [{ factualClaims: [{ status, researchClaimIds: ids }] }],
});

describe('exact Storyboard Research claim provenance', () => {
  it('serializes the exact version and material claim registry deterministically', async () => {
    const a = await createStoryboardResearchClaimSnapshot(
      'workspace',
      'project-a',
      'research-v2',
      'a'.repeat(64),
      [claim('claim-b'), claim('claim-a')],
    );
    const b = await createStoryboardResearchClaimSnapshot(
      'workspace',
      'project-a',
      'research-v2',
      'a'.repeat(64),
      [claim('claim-a'), claim('claim-b')],
    );
    expect(a.canonicalJson).toBe(b.canonicalJson);
    expect(a.hash).toBe(b.hash);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.count).toBe(2);
    const changed = await createStoryboardResearchClaimSnapshot(
      'workspace',
      'project-a',
      'research-v2',
      'a'.repeat(64),
      [{ ...claim('claim-a'), claimText: 'Altered' }, claim('claim-b')],
    );
    expect(changed.hash).not.toBe(a.hash);
  });

  it('accepts one and multiple exact eligible IDs; rejects one invalid among several', async () => {
    const snapshot = await createStoryboardResearchClaimSnapshot(
      'workspace',
      'project-a',
      'research-v2',
      'a'.repeat(64),
      [claim('claim-a'), claim('claim-b')],
    );
    expect(validateStoryboardFactualClaims(output(['claim-a']), snapshot)).toEqual(['claim-a']);
    expect(validateStoryboardFactualClaims(output(['claim-b', 'claim-a']), snapshot)).toEqual([
      'claim-a',
      'claim-b',
    ]);
    expect(() =>
      validateStoryboardFactualClaims(output(['claim-a', 'claim-b', 'fake']), snapshot),
    ).toThrow('exact approved Research claims');
    expect(() => validateStoryboardFactualClaims(output(['claim-a', 'claim-a']), snapshot)).toThrow(
      'exact approved Research claims',
    );
  });

  it.each([
    ['fabricated', 'research_claim_does_not_exist'],
    ['stale Research v1', 'claim-from-research-v1'],
    ['cross-project Research', 'claim-from-project-b'],
  ])('rejects %s claim IDs outside the exact approved Research v2 snapshot', async (_case, id) => {
    const snapshot = await createStoryboardResearchClaimSnapshot(
      'workspace',
      'project-a',
      'research-v2',
      'a'.repeat(64),
      [claim('claim-a')],
    );
    expect(() => validateStoryboardFactualClaims(output([id]), snapshot)).toThrow(
      'exact approved Research claims',
    );
  });

  it('fails closed for an empty registry and preserves OPEN/UNCERTAIN semantics', async () => {
    const empty = await createStoryboardResearchClaimSnapshot(
      'workspace',
      'project-a',
      'research-v2',
      'a'.repeat(64),
      [],
    );
    expect(() => validateStoryboardFactualClaims(output(['fabricated']), empty)).toThrow(
      'exact approved Research claims',
    );
    expect(validateStoryboardFactualClaims(output([], 'OPEN'), empty)).toEqual([]);
    expect(validateStoryboardFactualClaims(output([], 'UNCERTAIN'), empty)).toEqual([]);
    expect(() => validateStoryboardFactualClaims(output(['claim-a'], 'OPEN'), empty)).toThrow(
      'cannot cite approved Research',
    );
  });

  it('does not treat unverified, stale or AI-inferred rows as approved factual support', async () => {
    const snapshot = await createStoryboardResearchClaimSnapshot(
      'workspace',
      'project-a',
      'research-v2',
      'a'.repeat(64),
      [
        { ...claim('unverified'), sourceVerificationStatus: 'unverified' },
        { ...claim('stale'), sourceVerificationStatus: 'stale' },
        { ...claim('inferred'), evidenceClass: 'AI_INFERENCE', sourceId: null },
      ],
    );
    for (const id of ['unverified', 'stale', 'inferred'])
      expect(() => validateStoryboardFactualClaims(output([id]), snapshot)).toThrow(
        'exact approved Research claims',
      );
  });
});
