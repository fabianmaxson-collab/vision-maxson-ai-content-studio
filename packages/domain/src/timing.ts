export type TimingResult = 'COMPATIBLE' | 'WARNING' | 'BLOCKED' | 'UNKNOWN';

export interface TimingInput {
  targetDurationSeconds: number | null;
  wordCount: number | null;
  wordsPerMinute: number | null;
  sceneDurationsSeconds: readonly number[];
  externalMinimumSeconds: number | null;
  strategyMinimumSeconds: number | null;
  strategyMaximumSeconds: number | null;
}
export interface TimingAssessment {
  result: TimingResult;
  narrationSeconds: number | null;
  storyboardSeconds: number | null;
  reasons: string[];
}

export function assessTiming(input: TimingInput): TimingAssessment {
  const narrationSeconds =
    input.wordCount === null || input.wordsPerMinute === null || input.wordsPerMinute <= 0
      ? null
      : Math.round((input.wordCount / input.wordsPerMinute) * 600) / 10;
  const storyboardSeconds = input.sceneDurationsSeconds.length
    ? Math.round(input.sceneDurationsSeconds.reduce((sum, value) => sum + value, 0) * 10) / 10
    : null;
  if (input.targetDurationSeconds === null || narrationSeconds === null)
    return {
      result: 'UNKNOWN',
      narrationSeconds,
      storyboardSeconds,
      reasons: ['timing_input_unknown'],
    };
  const reasons: string[] = [];
  if (
    input.externalMinimumSeconds !== null &&
    input.targetDurationSeconds < input.externalMinimumSeconds
  )
    reasons.push('external_minimum_not_met');
  if (
    input.strategyMinimumSeconds !== null &&
    input.targetDurationSeconds < input.strategyMinimumSeconds
  )
    reasons.push('below_internal_preference');
  if (
    input.strategyMaximumSeconds !== null &&
    input.targetDurationSeconds > input.strategyMaximumSeconds
  )
    reasons.push('above_internal_preference');
  const narrationDelta = Math.abs(narrationSeconds - input.targetDurationSeconds);
  if (narrationDelta > Math.max(5, input.targetDurationSeconds * 0.2))
    reasons.push('narration_duration_mismatch');
  if (storyboardSeconds !== null && Math.abs(storyboardSeconds - input.targetDurationSeconds) > 1)
    reasons.push('storyboard_duration_mismatch');
  const blocked = reasons.includes('external_minimum_not_met');
  return {
    result: blocked ? 'BLOCKED' : reasons.length ? 'WARNING' : 'COMPATIBLE',
    narrationSeconds,
    storyboardSeconds,
    reasons,
  };
}
