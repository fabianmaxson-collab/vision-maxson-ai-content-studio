export type ParameterMode = 'AUTO' | 'PREFER' | 'LOCKED';
export interface ParameterDecision<T> {
  mode: ParameterMode;
  requested: T | null;
  recommended: T | null;
  effective: T | null;
  deviationReason?: string;
}
export function resolveParameter<T>(
  mode: ParameterMode,
  requested: T | null,
  recommended: T | null,
  proposed?: T | null,
  reason?: string,
): ParameterDecision<T> {
  if (mode === 'LOCKED') {
    if (requested === null) throw new Error('locked_value_required');
    if (proposed !== undefined && proposed !== requested)
      throw new Error('locked_value_cannot_be_overridden');
    return { mode, requested, recommended, effective: requested };
  }
  if (mode === 'PREFER') {
    const effective = proposed ?? requested ?? recommended;
    if (requested !== null && effective !== requested && !reason)
      throw new Error('preference_deviation_reason_required');
    return {
      mode,
      requested,
      recommended,
      effective,
      ...(reason ? { deviationReason: reason } : {}),
    };
  }
  return { mode, requested: null, recommended, effective: proposed ?? recommended };
}
