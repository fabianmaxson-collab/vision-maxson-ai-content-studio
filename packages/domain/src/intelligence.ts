export const intelligenceRunStatuses = [
  'QUEUED',
  'RUNNING',
  'SUCCEEDED',
  'FAILED_RETRYABLE',
  'FAILED_PERMANENT',
  'CANCELLED',
] as const;
export type IntelligenceRunStatus = (typeof intelligenceRunStatuses)[number];
export type AttemptKind = 'TECHNICAL' | 'CREATIVE_REGENERATION';

export function mayRetryTechnical(attempt: number, maximumAttempts: number): boolean {
  return attempt < maximumAttempts;
}
export function mayRegenerateCreative(regenerationNumber: number): boolean {
  return regenerationNumber < 2;
}
export function calculateKnownCost(
  inputUnits: number | null,
  outputUnits: number | null,
  inputUnitPrice: number | null,
  outputUnitPrice: number | null,
): number | null {
  return inputUnits === null ||
    outputUnits === null ||
    inputUnitPrice === null ||
    outputUnitPrice === null
    ? null
    : inputUnits * inputUnitPrice + outputUnits * outputUnitPrice;
}
