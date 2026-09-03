import { describe, expect, it } from 'vitest';
import {
  canDeriveProject,
  canTransitionProject,
  evaluateEligibility,
  expectedRevenue,
  hasPermission,
  resolveParameter,
  type PlatformRule,
  type StrategyRule,
} from './index';

describe('RBAC', () => {
  it('denies permissions by default', () => expect(hasPermission([], 'system:read')).toBe(false));
  it('allows owner administration', () =>
    expect(hasPermission(['owner'], 'roles:write')).toBe(true));
  it('keeps operator equivalent to Editor without administrative powers', () => {
    expect(hasPermission(['operator'], 'projects:write')).toBe(true);
    expect(hasPermission(['operator'], 'monetization:write_status')).toBe(false);
  });
  it('keeps viewer product access read-only', () => {
    expect(hasPermission(['viewer'], 'brands:read')).toBe(true);
    expect(hasPermission(['viewer'], 'brands:write')).toBe(false);
  });
});

describe('project invariants', () => {
  it('allows LONG_FORM to SHORT but never the reverse', () => {
    expect(canDeriveProject('LONG_FORM', 'SHORT')).toBe(true);
    expect(canDeriveProject('SHORT', 'LONG_FORM')).toBe(false);
  });
  it('denies unspecified lifecycle transitions', () => {
    expect(canTransitionProject('DRAFT', 'ANALYZING')).toBe(true);
    expect(canTransitionProject('DRAFT', 'PUBLISHED')).toBe(false);
  });
  it('does not silently override LOCKED', () => {
    expect(() => resolveParameter('LOCKED', 'vertical', 'horizontal')).not.toThrow();
    expect(() => resolveParameter('LOCKED', 'vertical', 'horizontal', 'horizontal')).toThrow(
      'locked_value_cannot_be_overridden',
    );
  });
  it('requires an explanation when PREFER is changed', () => {
    expect(() => resolveParameter('PREFER', 'a', 'b', 'b')).toThrow(
      'preference_deviation_reason_required',
    );
    expect(resolveParameter('PREFER', 'a', 'b', 'b', 'platform constraint').effective).toBe('b');
  });
  it('lets AUTO remain unknown', () =>
    expect(resolveParameter('AUTO', null, null).effective).toBeNull());
});

describe('monetization truthfulness', () => {
  it('models platform facts separately from internal strategy', () => {
    const external: PlatformRule = {
      id: 'external',
      platformId: 'tiktok',
      programId: 'rewards',
      verificationStatus: 'unverified',
      minimumDurationSeconds: 60,
    };
    const strategy: StrategyRule = {
      id: 'internal',
      platformId: 'tiktok',
      sourcePlatformRuleId: external.id,
      preferredMinSeconds: 65,
      preferredMaxSeconds: 90,
      safetyMarginSeconds: 5,
    };
    expect(strategy.id).not.toBe(external.id);
    expect(strategy.preferredMinSeconds).toBe(65);
    expect(external.verificationStatus).toBe('unverified');
  });
  it('separates publishable from monetization eligible', () =>
    expect(
      evaluateEligibility({ publishable: true, programRuleMatch: false, accountEligible: null }),
    ).toEqual({
      publishable: true,
      programRuleMatch: false,
      accountEligible: null,
      monetizationEligible: false,
    }));
  it('preserves unknown account eligibility', () =>
    expect(
      evaluateEligibility({ publishable: true, programRuleMatch: true, accountEligible: null })
        .monetizationEligible,
    ).toBeNull());
  it('does not estimate revenue without both inputs', () => {
    expect(expectedRevenue(null, 2)).toBeNull();
    expect(expectedRevenue(1000, null)).toBeNull();
    expect(expectedRevenue(1000, 2)).toBe(2);
  });
});
