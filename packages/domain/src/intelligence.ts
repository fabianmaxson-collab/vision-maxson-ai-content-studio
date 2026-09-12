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
  const micro = calculateUsageMicrousd(inputUnits, outputUnits, inputUnitPrice, outputUnitPrice);
  return micro === null ? null : micro / 1_000_000;
}

/**
 * Rates are decimal USD per token (the persisted numeric rate's shortest decimal).
 * Sum exact decimal charges with bigint, then ceil ONCE to integer micro-USD.
 * Cached tokens are a subset of input; reasoning tokens are already in output.
 * Missing/invalid/unsafe accounting stays unknown, never zero or an unsafe number.
 */
export function calculateUsageMicrousd(
  inputUnits: number | null,
  outputUnits: number | null,
  inputUnitPrice: number | null,
  outputUnitPrice: number | null,
  cachedInputUnits = 0,
  cachedInputUnitPrice: number | null = null,
  reasoningOutputUnits = 0,
): number | null {
  if (
    inputUnits === null ||
    outputUnits === null ||
    inputUnitPrice === null ||
    outputUnitPrice === null ||
    ![inputUnits, outputUnits, cachedInputUnits, reasoningOutputUnits].every(
      (value) => Number.isSafeInteger(value) && value >= 0,
    ) ||
    cachedInputUnits > inputUnits ||
    reasoningOutputUnits > outputUnits ||
    ![inputUnitPrice, outputUnitPrice, cachedInputUnitPrice ?? inputUnitPrice].every(
      (value) => Number.isFinite(value) && value >= 0,
    )
  )
    return null;

  const decimal = (value: number) => {
    const [mantissa = '0', exponent = '0'] = value.toString().toLowerCase().split('e');
    const [whole = '0', fraction = ''] = mantissa.split('.');
    const scale = fraction.length - Number(exponent);
    const coefficient = BigInt(whole + fraction);
    return scale < 0
      ? { coefficient: coefficient * 10n ** BigInt(-scale), scale: 0 }
      : { coefficient, scale };
  };
  const charges = [
    { units: inputUnits - cachedInputUnits, rate: decimal(inputUnitPrice) },
    { units: cachedInputUnits, rate: decimal(cachedInputUnitPrice ?? inputUnitPrice) },
    { units: outputUnits, rate: decimal(outputUnitPrice) },
  ];
  const scale = Math.max(...charges.map(({ rate }) => rate.scale));
  const denominator = 10n ** BigInt(scale);
  const numerator =
    charges.reduce(
      (sum, { units, rate }) =>
        sum + BigInt(units) * rate.coefficient * 10n ** BigInt(scale - rate.scale),
      0n,
    ) * 1_000_000n;
  const rounded = (numerator + denominator - 1n) / denominator;
  return rounded > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(rounded);
}
