export type DataProvenance = 'observed' | 'estimated' | 'approved_default' | 'unknown';
export interface EligibilityInput {
  publishable: boolean;
  programRuleMatch: boolean | null;
  accountEligible: boolean | null;
}
export interface EligibilityResult extends EligibilityInput {
  monetizationEligible: boolean | null;
}
export function evaluateEligibility(input: EligibilityInput): EligibilityResult {
  const monetizationEligible =
    !input.publishable || input.programRuleMatch === false || input.accountEligible === false
      ? false
      : input.programRuleMatch === true && input.accountEligible === true
        ? true
        : null;
  return { ...input, monetizationEligible };
}
export function expectedRevenue(
  views: number | null,
  ratePerThousand: number | null,
): number | null {
  return views === null || ratePerThousand === null ? null : (views / 1000) * ratePerThousand;
}
export interface PlatformRule {
  id: string;
  platformId: string;
  programId: string;
  verificationStatus:
    'unverified' | 'owner_approved' | 'externally_verified' | 'stale' | 'superseded';
  minimumDurationSeconds: number | null;
}
export interface StrategyRule {
  id: string;
  platformId: string;
  sourcePlatformRuleId: string | null;
  preferredMinSeconds: number | null;
  preferredMaxSeconds: number | null;
  safetyMarginSeconds: number | null;
}
