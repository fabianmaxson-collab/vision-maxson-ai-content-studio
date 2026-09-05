import { describe, expect, it } from 'vitest';
import {
  assessTiming,
  calculateKnownCost,
  canApproveEditorial,
  invalidateDependents,
  mayRegenerateCreative,
  mayRetryTechnical,
  reviewIsCurrent,
} from './index';

describe('Phase 3 editorial domain', () => {
  it('invalidates review and storyboard dependencies without deleting history', () => {
    const dependencies = [
      {
        sourceVersionId: 'script-v3',
        dependentVersionId: 'review-v2',
        validity: 'CURRENT' as const,
      },
      {
        sourceVersionId: 'script-v3',
        dependentVersionId: 'story-v1',
        validity: 'CURRENT' as const,
      },
    ];
    expect(
      invalidateDependents(dependencies, 'script-v3', {
        'review-v2': 'REVIEW_TRANSLATION',
        'story-v1': 'STORYBOARD',
      }).map((item) => item.validity),
    ).toEqual(['REGENERATION_REQUIRED', 'REAPPROVAL_REQUIRED']);
  });
  it('detects a stale Spanish review by exact source version', () => {
    expect(reviewIsCurrent('script-v3', 'script-v4')).toBe(false);
  });
  it('keeps operator approvals ordinary and viewer read-only', () => {
    expect(canApproveEditorial('operator')).toBe(true);
    expect(canApproveEditorial('viewer')).toBe(false);
  });
  it('keeps unknown timing unknown and consumes supplied rules', () => {
    expect(
      assessTiming({
        targetDurationSeconds: null,
        wordCount: 100,
        wordsPerMinute: 120,
        sceneDurationsSeconds: [],
        externalMinimumSeconds: 60,
        strategyMinimumSeconds: 65,
        strategyMaximumSeconds: 90,
      }).result,
    ).toBe('UNKNOWN');
    expect(
      assessTiming({
        targetDurationSeconds: 55,
        wordCount: 110,
        wordsPerMinute: 120,
        sceneDurationsSeconds: [55],
        externalMinimumSeconds: 60,
        strategyMinimumSeconds: 65,
        strategyMaximumSeconds: 90,
      }).result,
    ).toBe('BLOCKED');
  });
  it('separates technical retries from two creative regenerations', () => {
    expect(mayRetryTechnical(2, 4)).toBe(true);
    expect(mayRegenerateCreative(1)).toBe(true);
    expect(mayRegenerateCreative(2)).toBe(false);
  });
  it('keeps pricing unknown when any legitimate input is missing', () => {
    expect(calculateKnownCost(100, 20, null, null)).toBeNull();
  });
});
