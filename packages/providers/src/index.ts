export type ModelCapability =
  | 'STRUCTURED_OUTPUT'
  | 'MULTILINGUAL_TEXT'
  | 'RESEARCH_SYNTHESIS'
  | 'SCRIPT_GENERATION'
  | 'CRITIQUE'
  | 'TRANSLATION'
  | 'STORYBOARD_PLANNING';

export interface ProviderUsage {
  inputUnits: number | null;
  outputUnits: number | null;
  unitName: string | null;
}
export interface AIExecutionRequest<TInput = unknown> {
  runId: string;
  taskType: string;
  modelKey: string;
  promptVersionId: string;
  input: TInput;
  idempotencyKey: string;
  timeoutMs: number;
}
export interface ProviderExecutionResult<TOutput = unknown> {
  output: TOutput;
  providerRequestId: string | null;
  usage: ProviderUsage;
  safeMetadata: Record<string, string | number | boolean | null>;
}
export type ProviderErrorCategory =
  | 'TIMEOUT'
  | 'UNAVAILABLE'
  | 'RATE_LIMIT'
  | 'INVALID_RESPONSE'
  | 'SCHEMA_VALIDATION'
  | 'SAFETY_REFUSAL'
  | 'AUTHENTICATION'
  | 'PERMANENT'
  | 'CANCELLED';
export class ProviderError extends Error {
  constructor(
    readonly category: ProviderErrorCategory,
    readonly retryable: boolean,
    message: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
export interface AIProviderAdapter {
  readonly providerKey: string;
  capabilities(): Promise<readonly ModelCapability[]>;
  health(): Promise<'available' | 'degraded' | 'unavailable'>;
  execute<TInput, TOutput>(
    request: AIExecutionRequest<TInput>,
  ): Promise<ProviderExecutionResult<TOutput>>;
}
export class ProviderNotConfiguredError extends ProviderError {
  constructor() {
    super('AUTHENTICATION', false, 'No AI provider is configured.');
  }
}
