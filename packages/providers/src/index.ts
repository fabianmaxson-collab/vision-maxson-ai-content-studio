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
  cachedInputUnits: number | null;
  reasoningOutputUnits: number | null;
  unitName: string | null;
}
export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export interface AIExecutionRequest<TInput = unknown> {
  runId: string;
  taskType: string;
  modelKey: string;
  promptVersionId: string;
  input: TInput;
  instructions: string;
  outputSchema: Record<string, unknown>;
  outputSchemaName: string;
  idempotencyKey: string;
  timeoutMs: number;
  maxOutputTokens: number;
  reasoningEffort: ReasoningEffort;
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
export type RoutingMode = 'AUTO' | 'PREFER' | 'LOCKED';
export type ModelQualityTier = 'HIGH' | 'BALANCED' | 'ECONOMY';
export interface ModelCandidate {
  providerKey: string;
  modelKey: string;
  status: 'available' | 'degraded' | 'disabled';
  capabilities: readonly ModelCapability[];
  qualityTier: ModelQualityTier;
  costRank: number;
}
export interface RoutingRequest {
  mode: RoutingMode;
  requiredCapabilities: readonly ModelCapability[];
  minimumQualityTier: ModelQualityTier;
  preferredProviderKey?: string;
  preferredModelKey?: string;
}
const tierRank: Record<ModelQualityTier, number> = { ECONOMY: 1, BALANCED: 2, HIGH: 3 };
const eligible = (candidate: ModelCandidate, request: RoutingRequest) =>
  candidate.status === 'available' &&
  tierRank[candidate.qualityTier] >= tierRank[request.minimumQualityTier] &&
  request.requiredCapabilities.every((capability) => candidate.capabilities.includes(capability));
export function routeModel(candidates: readonly ModelCandidate[], request: RoutingRequest) {
  const available = candidates.filter((candidate) => eligible(candidate, request));
  const preferred = available.find(
    (candidate) =>
      (!request.preferredProviderKey || candidate.providerKey === request.preferredProviderKey) &&
      (!request.preferredModelKey || candidate.modelKey === request.preferredModelKey),
  );
  if (request.mode === 'LOCKED') {
    if (!request.preferredProviderKey || !request.preferredModelKey || !preferred)
      throw new ProviderError('UNAVAILABLE', false, 'Locked provider/model is unavailable.');
    return preferred;
  }
  if (request.mode === 'PREFER' && preferred) return preferred;
  const selected = [...available].sort(
    (a, b) => tierRank[b.qualityTier] - tierRank[a.qualityTier] || a.costRank - b.costRank,
  )[0];
  if (!selected) throw new ProviderError('UNAVAILABLE', true, 'No eligible model is available.');
  return selected;
}
export interface ExecutionAttemptObserver {
  started(attempt: number): Promise<void>;
  succeeded(attempt: number, result: ProviderExecutionResult): Promise<void>;
  failed(attempt: number, error: ProviderError): Promise<void>;
}
export class AIExecutionGateway {
  constructor(private readonly adapters: ReadonlyMap<string, AIProviderAdapter>) {}
  async execute<TInput, TOutput>(args: {
    request: AIExecutionRequest<TInput>;
    candidate: ModelCandidate;
    maximumAttempts: number;
    observer: ExecutionAttemptObserver;
  }): Promise<ProviderExecutionResult<TOutput>> {
    const adapter = this.adapters.get(args.candidate.providerKey);
    if (!adapter) throw new ProviderNotConfiguredError();
    let lastError: ProviderError | undefined;
    for (let attempt = 1; attempt <= args.maximumAttempts; attempt += 1) {
      await args.observer.started(attempt);
      try {
        const result = await adapter.execute<TInput, TOutput>(args.request);
        await args.observer.succeeded(attempt, result);
        return result;
      } catch (error) {
        const mapped =
          error instanceof ProviderError
            ? error
            : new ProviderError('PERMANENT', false, 'Provider execution failed.');
        await args.observer.failed(attempt, mapped);
        lastError = mapped;
        if (!mapped.retryable || attempt === args.maximumAttempts) break;
      }
    }
    throw lastError ?? new ProviderError('PERMANENT', false, 'Provider execution failed.');
  }
}
