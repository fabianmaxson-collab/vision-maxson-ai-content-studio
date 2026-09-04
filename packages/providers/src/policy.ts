import type { ModelCapability, ModelQualityTier, ReasoningEffort } from './index';

export interface TaskExecutionPolicy {
  requiredCapabilities: readonly ModelCapability[];
  minimumQualityTier: ModelQualityTier;
  reasoningEffort: ReasoningEffort;
  timeoutMs: number;
  maxOutputTokens: number;
  maximumAttempts: number;
}
export interface TaskPolicyContext {
  economyEligible?: boolean;
}
export const defaultTaskPolicies: Readonly<Record<string, TaskExecutionPolicy>> = {
  TOPIC_RESEARCH: {
    requiredCapabilities: ['STRUCTURED_OUTPUT', 'RESEARCH_SYNTHESIS'],
    minimumQualityTier: 'BALANCED',
    reasoningEffort: 'medium',
    timeoutMs: 90_000,
    maxOutputTokens: 12_000,
    maximumAttempts: 2,
  },
  IDEA_GENERATION: {
    requiredCapabilities: ['STRUCTURED_OUTPUT', 'MULTILINGUAL_TEXT'],
    minimumQualityTier: 'BALANCED',
    reasoningEffort: 'medium',
    timeoutMs: 90_000,
    maxOutputTokens: 8_000,
    maximumAttempts: 2,
  },
  CONTENT_BRIEF: {
    requiredCapabilities: ['STRUCTURED_OUTPUT', 'MULTILINGUAL_TEXT'],
    minimumQualityTier: 'BALANCED',
    reasoningEffort: 'medium',
    timeoutMs: 90_000,
    maxOutputTokens: 10_000,
    maximumAttempts: 2,
  },
  SCRIPT_WRITER_SHORT: {
    requiredCapabilities: ['STRUCTURED_OUTPUT', 'SCRIPT_GENERATION', 'MULTILINGUAL_TEXT'],
    minimumQualityTier: 'BALANCED',
    reasoningEffort: 'medium',
    timeoutMs: 120_000,
    maxOutputTokens: 16_000,
    maximumAttempts: 2,
  },
  SCRIPT_WRITER_LONG: {
    requiredCapabilities: ['STRUCTURED_OUTPUT', 'SCRIPT_GENERATION', 'MULTILINGUAL_TEXT'],
    minimumQualityTier: 'BALANCED',
    reasoningEffort: 'high',
    timeoutMs: 180_000,
    maxOutputTokens: 32_000,
    maximumAttempts: 2,
  },
  SCRIPT_CRITIC: {
    requiredCapabilities: ['STRUCTURED_OUTPUT', 'CRITIQUE'],
    minimumQualityTier: 'HIGH',
    reasoningEffort: 'high',
    timeoutMs: 120_000,
    maxOutputTokens: 12_000,
    maximumAttempts: 2,
  },
  REVIEW_TRANSLATION_ES: {
    requiredCapabilities: ['STRUCTURED_OUTPUT', 'TRANSLATION', 'MULTILINGUAL_TEXT'],
    minimumQualityTier: 'BALANCED',
    reasoningEffort: 'medium',
    timeoutMs: 120_000,
    maxOutputTokens: 24_000,
    maximumAttempts: 2,
  },
  STORYBOARD_PLANNER: {
    requiredCapabilities: ['STRUCTURED_OUTPUT', 'STORYBOARD_PLANNING'],
    minimumQualityTier: 'BALANCED',
    reasoningEffort: 'medium',
    timeoutMs: 120_000,
    maxOutputTokens: 20_000,
    maximumAttempts: 2,
  },
};
export function taskPolicy(taskType: string, context: TaskPolicyContext = {}): TaskExecutionPolicy {
  const base = defaultTaskPolicies[taskType];
  if (!base) throw new Error('unsupported_intelligence_task');
  if (
    context.economyEligible &&
    ['IDEA_GENERATION', 'SCRIPT_WRITER_SHORT', 'REVIEW_TRANSLATION_ES'].includes(taskType)
  )
    return { ...base, minimumQualityTier: 'ECONOMY' };
  return { ...base };
}
