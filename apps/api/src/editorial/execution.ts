import {
  contentBriefSchema,
  ideaGenerationOutputSchema,
  productionScriptOutputSchema,
  researchOutputSchema,
  reviewTranslationOutputSchema,
  scriptCritiqueSchema,
  storyboardOutputSchema,
  intelligenceTaskSchema,
} from '@vision-maxson/contracts';
import {
  AIExecutionGateway,
  ProviderError,
  ProviderNotConfiguredError,
  routeModel,
  type ModelCandidate,
  type ProviderExecutionResult,
  type RoutingMode,
} from '@vision-maxson/providers';
import { OpenAIResponsesAdapter } from '@vision-maxson/providers/openai';
import { taskPolicy } from '@vision-maxson/providers/policy';
import {
  boundedProfileForProject,
  conservativeInputTokenUpperBound,
  isBoundedProfileStep,
  isProjectEligibleForBoundedProfile,
  type BoundedExecutionProfile,
} from '@vision-maxson/providers/execution-profile';
import { calculateReservation, loadBoundedEnvelope, reservationStatement } from './budget';
import { z } from 'zod';
import type { EditorialActor } from './repository';

type Task = z.infer<typeof intelligenceTaskSchema>;
type ExecutionConfig = {
  openAIEnabled: boolean;
  openAIApiKey?: string;
  openAIBaseUrl: string;
  requestId?: string;
  environment?: string;
  accessIssuer?: string;
  accessSubject?: string;
};
type Command = {
  mode: RoutingMode;
  preferredProviderKey?: string;
  preferredModelKey?: string;
  inputArtifactVersionId: string | null;
  creativeRegeneration: boolean;
};
type Row = Record<string, unknown>;
const promptKey: Record<Task, string> = {
  TOPIC_RESEARCH: 'topic_research',
  IDEA_GENERATION: 'idea_generation',
  CONTENT_BRIEF: 'content_brief',
  SCRIPT_WRITER_SHORT: 'script_writer_short',
  SCRIPT_WRITER_LONG: 'script_writer_long',
  SCRIPT_CRITIC: 'script_critic',
  REVIEW_TRANSLATION_ES: 'review_translation_es',
  STORYBOARD_PLANNER: 'storyboard_planner',
  PREFLIGHT_ANALYSIS: 'preflight_analysis',
};
const outputSchema: Record<Task, z.ZodType> = {
  TOPIC_RESEARCH: researchOutputSchema,
  IDEA_GENERATION: ideaGenerationOutputSchema,
  CONTENT_BRIEF: contentBriefSchema,
  SCRIPT_WRITER_SHORT: productionScriptOutputSchema,
  SCRIPT_WRITER_LONG: productionScriptOutputSchema,
  SCRIPT_CRITIC: scriptCritiqueSchema,
  REVIEW_TRANSLATION_ES: reviewTranslationOutputSchema,
  STORYBOARD_PLANNER: storyboardOutputSchema,
  PREFLIGHT_ANALYSIS: z.object({ checks: z.array(z.unknown()), recommendation: z.string() }),
};
const artifactType: Record<Task, string> = {
  TOPIC_RESEARCH: 'RESEARCH',
  IDEA_GENERATION: 'IDEA_CANDIDATE',
  CONTENT_BRIEF: 'CONTENT_BRIEF',
  SCRIPT_WRITER_SHORT: 'PRODUCTION_SCRIPT',
  SCRIPT_WRITER_LONG: 'PRODUCTION_SCRIPT',
  SCRIPT_CRITIC: 'SCRIPT_CRITIQUE',
  REVIEW_TRANSLATION_ES: 'REVIEW_TRANSLATION',
  STORYBOARD_PLANNER: 'STORYBOARD',
  PREFLIGHT_ANALYSIS: 'PREFLIGHT',
};
const newId = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;
const now = () => new Date().toISOString();
async function digest(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((part) => part.toString(16).padStart(2, '0'))
    .join('');
}
function parseCapabilities(value: unknown) {
  const parsed = typeof value === 'string' ? (JSON.parse(value) as Row) : (value as Row);
  return parsed;
}
function renderPrompt(template: string, context: Row) {
  const variables = [...template.matchAll(/\{\{([a-z_]+)\}\}/gu)].map((match) => match[1]);
  if (variables.some((variable) => variable !== 'context_json'))
    throw new ProviderError('PERMANENT', false, 'Prompt contains an unsupported variable.');
  return template.replaceAll('{{context_json}}', JSON.stringify(context));
}
export function reviewTranslationProviderContext(project: Row, profile: BoundedExecutionProfile) {
  const source = project.exactSource as Row | null;
  if (
    !source ||
    typeof source.versionId !== 'string' ||
    typeof source.contentText !== 'string' ||
    source.languageCode !== profile.productionLanguage
  )
    throw new ProviderError(
      'PERMANENT',
      false,
      'The exact production-language source text is required for review translation.',
    );
  return {
    task: 'REVIEW_TRANSLATION_ES' as const,
    sourceScriptVersionId: source.versionId,
    sourceLanguage: profile.productionLanguage,
    targetLanguage: profile.reviewLanguage,
    sourceScript: source.contentText,
  };
}

function validateSemantics(
  task: Task,
  output: unknown,
  project: Row,
  inputVersionId: string | null,
) {
  if (
    (task === 'SCRIPT_WRITER_SHORT' || task === 'SCRIPT_WRITER_LONG') &&
    (output as { languageCode: string }).languageCode !== project.primaryLanguage
  )
    throw new ProviderError(
      'SCHEMA_VALIDATION',
      false,
      'Production script language does not match the project.',
    );
  if (
    task === 'REVIEW_TRANSLATION_ES' &&
    ((output as { languageCode: string; sourceScriptVersionId: string }).languageCode !== 'es' ||
      (output as { sourceScriptVersionId: string }).sourceScriptVersionId !== inputVersionId)
  )
    throw new ProviderError('SCHEMA_VALIDATION', false, 'Spanish review provenance is invalid.');
  const ordered =
    task === 'SCRIPT_WRITER_SHORT' || task === 'SCRIPT_WRITER_LONG'
      ? (output as { segments: { order: number }[] }).segments
      : task === 'STORYBOARD_PLANNER'
        ? (output as { scenes: { order: number }[] }).scenes
        : null;
  if (ordered && ordered.some((item, index) => item.order !== index + 1))
    throw new ProviderError(
      'SCHEMA_VALIDATION',
      false,
      'Output order must be contiguous and start at one.',
    );
}
function safeError(error: unknown) {
  return error instanceof ProviderError
    ? error
    : new ProviderError('PERMANENT', false, 'AI execution failed.');
}

export class EditorialExecutionService {
  constructor(
    private readonly db: D1Database,
    private readonly actor: EditorialActor,
    private readonly config: ExecutionConfig,
  ) {}

  async execute(projectId: string, task: Task, command: Command, idempotencyKey: string) {
    if (task === 'PREFLIGHT_ANALYSIS')
      throw new ProviderError(
        'PERMANENT',
        false,
        'Preflight is deterministic and cannot use a provider.',
      );
    const commandHash = await digest({ projectId, task, command });
    const existing = await this.db
      .prepare(
        `SELECT id,status,output_artifact_version_id AS outputArtifactVersionId,error_category AS errorCategory,safe_metadata_json AS safeMetadataJson FROM intelligence_runs WHERE workspace_id=? AND idempotency_key=?`,
      )
      .bind(this.actor.workspaceId, idempotencyKey)
      .first<Row>();
    if (existing) {
      const metadata =
        typeof existing.safeMetadataJson === 'string'
          ? (JSON.parse(existing.safeMetadataJson) as Row)
          : {};
      if (metadata.commandHash !== commandHash)
        throw new ProviderError(
          'PERMANENT',
          false,
          'Idempotency key is already bound to a different command.',
        );
      return { run: existing, idempotentReplay: true };
    }
    if (!(await this.terminalSchemaReady()))
      throw new ProviderError(
        'UNAVAILABLE',
        false,
        'Terminal pipeline schema capability is unavailable.',
      );
    if (!this.config.openAIEnabled || !this.config.openAIApiKey)
      throw new ProviderNotConfiguredError();
    const project = await this.projectContext(projectId, task, command.inputArtifactVersionId);
    if (task === 'SCRIPT_WRITER_SHORT' && project.format !== 'SHORT')
      throw new ProviderError(
        'PERMANENT',
        false,
        'The short-script route requires a SHORT project.',
      );
    const prompt = await this.db
      .prepare(
        `SELECT pv.id,pv.template_text AS templateText,pd.key FROM prompt_versions pv JOIN prompt_definitions pd ON pd.id=pv.prompt_definition_id WHERE pd.key=? AND pd.status='active' AND pv.status='active' ORDER BY pv.version_number DESC LIMIT 1`,
      )
      .bind(promptKey[task])
      .first<{ id: string; templateText: string; key: string }>();
    if (!prompt)
      throw new ProviderError('PERMANENT', false, 'Active prompt version is unavailable.');
    const modelRows = await this.db
      .prepare(
        `SELECT p.id AS providerId,p.key AS providerKey,m.id AS modelId,m.model_key AS modelKey,m.capabilities_json AS capabilitiesJson,m.status,ps.id AS pricingSnapshotId,ps.input_unit_price AS inputPrice,ps.output_unit_price AS outputPrice,ps.currency,ps.unit_name AS unitName,ps.verification_status AS verificationStatus,ps.effective_from AS effectiveFrom,ps.effective_to AS effectiveTo FROM ai_providers p JOIN ai_provider_models m ON m.provider_id=p.id LEFT JOIN ai_pricing_snapshots ps ON ps.provider_model_id=m.id AND ps.effective_to IS NULL WHERE p.status='configured' AND m.status='available'`,
      )
      .all<Row>();
    const candidates = modelRows.results.map((row) => {
      const cfg = parseCapabilities(row.capabilitiesJson);
      return {
        providerKey: String(row.providerKey),
        modelKey: String(row.modelKey),
        status: row.status as 'available',
        capabilities: cfg.capabilities as ModelCandidate['capabilities'],
        qualityTier: cfg.qualityTier as ModelCandidate['qualityTier'],
        costRank: Number(cfg.costRank),
      } satisfies ModelCandidate;
    });
    const boundedProfile = isBoundedProfileStep(task)
      ? boundedProfileForProject({
          format: project.format,
          operatingMode: project.operatingMode,
          primaryLanguage: project.primaryLanguage,
          reviewLanguage: project.reviewLocale,
        })
      : undefined;
    const economyEligible =
      boundedProfile !== undefined &&
      isBoundedProfileStep(task) &&
      this.isProfileProjectEligible(project, task, boundedProfile);
    const policy = taskPolicy(task, { economyEligible });
    const selected = routeModel(candidates, {
      mode: command.mode,
      requiredCapabilities: policy.requiredCapabilities,
      minimumQualityTier: policy.minimumQualityTier,
      ...(command.preferredProviderKey
        ? { preferredProviderKey: command.preferredProviderKey }
        : {}),
      ...(command.preferredModelKey ? { preferredModelKey: command.preferredModelKey } : {}),
    });
    const selectedRow = modelRows.results.find(
      (row) => row.providerKey === selected.providerKey && row.modelKey === selected.modelKey,
    )!;
    const boundedStep =
      economyEligible &&
      boundedProfile !== undefined &&
      isBoundedProfileStep(task) &&
      selected.providerKey === boundedProfile.providerKey &&
      selected.modelKey === boundedProfile.modelKey;
    if (boundedStep && command.creativeRegeneration)
      throw new ProviderError(
        'PERMANENT',
        false,
        'Creative regeneration is not allowed by the execution profile.',
      );
    const stepPolicy = boundedStep ? boundedProfile.steps[task] : policy;
    const providerInput = boundedStep
      ? task === 'REVIEW_TRANSLATION_ES'
        ? reviewTranslationProviderContext(project, boundedProfile)
        : {
            ...project,
            executionProfile: {
              key: boundedProfile.key,
              productionLanguage: boundedProfile.productionLanguage,
              reviewLanguage: boundedProfile.reviewLanguage,
              externalResearchAllowed: false,
              specializedVerificationAllowed: false,
              humanReviewRequired: true,
              reviewTranslationIsReviewOnly: true,
            },
          }
      : project;
    const providerInstructions = renderPrompt(prompt.templateText, providerInput);
    const providerOutputSchema = z.toJSONSchema(outputSchema[task]);
    // Bounded prompts already render the complete context into instructions. Sending it again as
    // input duplicates provider-bound content and consumes budget without adding information.
    const providerRequestInput = boundedStep ? {} : providerInput;
    if (
      boundedStep &&
      conservativeInputTokenUpperBound({
        instructions: providerInstructions,
        input: providerRequestInput,
        outputSchema: providerOutputSchema,
      }) > boundedProfile.steps[task].inputTokenCeiling
    )
      throw new ProviderError(
        'PERMANENT',
        false,
        'Provider-bound input exceeds the execution profile ceiling.',
      );
    const envelope = boundedStep
      ? await loadBoundedEnvelope(this.db, this.actor, projectId, selected, boundedProfile)
      : null;
    const reservedMicrousd = boundedStep
      ? calculateReservation(selectedRow, task, boundedProfile)
      : null;
    const runId = newId('intelligence_run'),
      at = now();
    const regeneration = command.creativeRegeneration ? 1 : 0;
    const insertRun = this.db
      .prepare(
        `INSERT OR IGNORE INTO intelligence_runs(id,workspace_id,project_id,task_type,provider_id,provider_model_id,prompt_version_id,input_artifact_version_id,initiated_by,operating_mode,status,idempotency_key,creative_regeneration_number,safe_metadata_json,pricing_snapshot_id,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?,?,?,'QUEUED',?,?,?, ?,?,?,1)`,
      )
      .bind(
        runId,
        this.actor.workspaceId,
        projectId,
        task,
        selectedRow.providerId,
        selectedRow.modelId,
        prompt.id,
        command.inputArtifactVersionId,
        this.actor.id,
        String(project.operatingMode),
        idempotencyKey,
        regeneration,
        JSON.stringify({ commandHash }),
        selectedRow.pricingSnapshotId ?? null,
        at,
        at,
      );
    if (boundedStep && envelope && reservedMicrousd !== null) {
      try {
        await this.db.batch([
          insertRun,
          reservationStatement(this.db, {
            envelopeId: String(envelope.id),
            workspaceId: this.actor.workspaceId,
            projectId,
            runId,
            step: task,
            pricingSnapshotId: String(selectedRow.pricingSnapshotId),
            reservedMicrousd,
            at,
          }),
        ]);
        await this.db
          .prepare(
            `UPDATE editorial_execution_envelopes SET status='CONSUMED',updated_at=?,version=version+1 WHERE id=? AND status='ACTIVE' AND (SELECT COUNT(*) FROM editorial_execution_reservations WHERE envelope_id=?) >= maximum_calls`,
          )
          .bind(now(), envelope.id, envelope.id)
          .run();
      } catch {
        const winner = await this.existingRun(idempotencyKey);
        if (winner && this.commandHash(winner) === commandHash)
          return { run: winner, idempotentReplay: true };
        throw new ProviderError(
          'UNAVAILABLE',
          false,
          'The execution step could not be reserved atomically.',
        );
      }
    } else await insertRun.run();
    const reserved = await this.db
      .prepare(
        `SELECT id,status,output_artifact_version_id AS outputArtifactVersionId,safe_metadata_json AS safeMetadataJson FROM intelligence_runs WHERE workspace_id=? AND idempotency_key=?`,
      )
      .bind(this.actor.workspaceId, idempotencyKey)
      .first<Row>();
    if (!reserved) throw new ProviderError('PERMANENT', false, 'Reserved run could not be read.');
    if (reserved.id !== runId) {
      if (this.commandHash(reserved) !== commandHash)
        throw new ProviderError(
          'PERMANENT',
          false,
          'Idempotency key is already bound to a different command.',
        );
      return { run: reserved, idempotentReplay: true };
    }
    const adapter = new OpenAIResponsesAdapter(this.config.openAIApiKey, this.config.openAIBaseUrl);
    const observer = this.observer(runId);
    const started = Date.now();
    try {
      const result = await new AIExecutionGateway(new Map([['openai', adapter]])).execute<
        Row,
        unknown
      >({
        candidate: selected,
        maximumAttempts: stepPolicy.maximumAttempts,
        observer,
        request: {
          runId,
          taskType: task,
          modelKey: selected.modelKey,
          promptVersionId: prompt.id,
          input: providerRequestInput,
          instructions: providerInstructions,
          outputSchema: providerOutputSchema,
          outputSchemaName: prompt.key,
          idempotencyKey,
          timeoutMs: stepPolicy.timeoutMs,
          maxOutputTokens: stepPolicy.maxOutputTokens,
          reasoningEffort: stepPolicy.reasoningEffort,
        },
      });
      const parsed = outputSchema[task].safeParse(result.output);
      if (!parsed.success)
        throw new ProviderError('SCHEMA_VALIDATION', false, 'Provider output failed validation.');
      const costs = this.cost(result, selectedRow);
      const metadata = {
        commandHash,
        ...result.safeMetadata,
        latencyMs: Date.now() - started,
        cachedInputUnits: result.usage.cachedInputUnits,
        reasoningOutputUnits: result.usage.reasoningOutputUnits,
      };
      validateSemantics(task, parsed.data, project, command.inputArtifactVersionId);
      const outputVersionId = await this.persist(
        projectId,
        task,
        runId,
        command.inputArtifactVersionId,
        project.primaryLanguage,
        parsed.data,
        { result, costs, metadata, boundedStep, reservedMicrousd },
      );
      return {
        run: {
          id: runId,
          status: 'SUCCEEDED',
          outputArtifactVersionId: outputVersionId,
          usage: result.usage,
          ...costs,
        },
        idempotentReplay: false,
      };
    } catch (error) {
      const mapped = safeError(error);
      const terminalAt = now();
      const auditId = newId('audit');
      const terminalStatus = mapped.retryable ? 'FAILED_RETRYABLE' : 'FAILED_PERMANENT';
      const statements: D1PreparedStatement[] = [
        this.db
          .prepare(
            `UPDATE intelligence_run_attempts SET status=?,error_category=?,safe_error_detail=?,completed_at=? WHERE intelligence_run_id=? AND status='RUNNING'`,
          )
          .bind(terminalStatus, mapped.category, mapped.message, terminalAt, runId),
      ];
      if (boundedStep)
        statements.push(
          this.db
            .prepare(
              `UPDATE editorial_execution_reservations SET status='AMBIGUOUS',reconciled_at=? WHERE intelligence_run_id=? AND status IN ('RESERVED','DISPATCHED')`,
            )
            .bind(terminalAt, runId),
        );
      statements.push(
        this.terminalAuditStatement(
          auditId,
          runId,
          'intelligence.run_failed',
          'failure',
          terminalAt,
        ),
        this.db
          .prepare(
            `UPDATE intelligence_runs SET status=?,error_category=?,safe_error_detail=?,terminal_audit_event_id=?,completed_at=?,updated_at=?,version=version+1 WHERE id=? AND workspace_id=?`,
          )
          .bind(
            terminalStatus,
            mapped.category,
            mapped.message,
            auditId,
            terminalAt,
            terminalAt,
            runId,
            this.actor.workspaceId,
          ),
      );
      await this.db.batch(statements);
      throw mapped;
    }
  }

  async getRun(runId: string) {
    return this.db
      .prepare(
        `SELECT id,project_id AS projectId,task_type AS taskType,status,output_artifact_version_id AS outputArtifactVersionId,input_units AS inputUnits,output_units AS outputUnits,actual_cost AS actualCost,currency,error_category AS errorCategory,safe_error_detail AS safeErrorDetail,created_at AS createdAt,updated_at AS updatedAt FROM intelligence_runs WHERE id=? AND workspace_id=?`,
      )
      .bind(runId, this.actor.workspaceId)
      .first<Row>();
  }

  async cancel(runId: string) {
    const at = now();
    const result = await this.db
      .prepare(
        `UPDATE intelligence_runs SET status='CANCELLED',completed_at=?,updated_at=?,version=version+1 WHERE id=? AND workspace_id=? AND status IN ('QUEUED','RUNNING')`,
      )
      .bind(at, at, runId, this.actor.workspaceId)
      .run();
    if (!result.meta.changes)
      throw new ProviderError('CANCELLED', false, 'Run cannot be cancelled.');
    await this.db
      .prepare(
        `UPDATE intelligence_run_attempts SET status='CANCELLED',completed_at=? WHERE intelligence_run_id=? AND status='RUNNING'`,
      )
      .bind(at, runId)
      .run();
    return { id: runId, status: 'CANCELLED' };
  }
  private async projectContext(projectId: string, task: Task, inputVersionId: string | null) {
    const project = await this.db
      .prepare(
        `SELECT p.id,p.title,p.description,p.format,p.operating_mode AS operatingMode,p.primary_language AS primaryLanguage,b.name AS brandName,b.niche,c.name AS channelName,c.narrative_tone AS narrativeTone,c.editorial_strategy_json AS editorialStrategyJson FROM projects p JOIN content_brands b ON b.id=p.content_brand_id JOIN channel_profiles c ON c.id=p.channel_profile_id WHERE p.id=? AND p.workspace_id=? AND p.deleted_at IS NULL`,
      )
      .bind(projectId, this.actor.workspaceId)
      .first<Row>();
    if (!project) throw new ProviderError('PERMANENT', false, 'Project not found.');
    const projectProfile = boundedProfileForProject({
      format: project.format,
      operatingMode: project.operatingMode,
      primaryLanguage: project.primaryLanguage,
      reviewLanguage: 'es',
    });
    const artifacts = await this.db
      .prepare(
        `SELECT a.artifact_type AS artifactType,v.id AS versionId,v.language_code AS languageCode,v.content_text AS contentText,v.content_json AS contentJson FROM editorial_artifacts a JOIN editorial_artifact_versions v ON v.id=a.current_version_id WHERE a.project_id=? AND a.workspace_id=? AND a.deleted_at IS NULL AND a.status='approved' ORDER BY a.artifact_type`,
      )
      .bind(projectId, this.actor.workspaceId)
      .all<Row>();
    let exactSource: Row | null = null;
    if (task === 'REVIEW_TRANSLATION_ES') {
      if (!inputVersionId)
        throw new ProviderError('PERMANENT', false, 'An exact source script version is required.');
      if (!projectProfile)
        throw new ProviderError(
          'PERMANENT',
          false,
          'The project is outside the approved bounded language profiles.',
        );
      exactSource = await this.db
        .prepare(
          `SELECT v.id AS versionId,v.language_code AS languageCode,v.content_text AS contentText,v.content_json AS contentJson,a.artifact_type AS artifactType FROM editorial_artifact_versions v JOIN editorial_artifacts a ON a.id=v.artifact_id AND a.current_version_id=v.id WHERE v.id=? AND v.workspace_id=? AND a.workspace_id=? AND a.project_id=? AND a.artifact_type='PRODUCTION_SCRIPT' AND v.language_code=? AND a.status='approved' AND a.deleted_at IS NULL`,
        )
        .bind(
          inputVersionId,
          this.actor.workspaceId,
          this.actor.workspaceId,
          projectId,
          projectProfile.productionLanguage,
        )
        .first<Row>();
      if (!exactSource)
        throw new ProviderError(
          'PERMANENT',
          false,
          'The exact current approved production script is required.',
        );
    }
    return {
      ...project,
      reviewLocale: 'es',
      exactSource,
      approvedArtifacts: artifacts.results.map((item) => ({
        ...item,
        contentText: typeof item.contentText === 'string' ? item.contentText : null,
        contentJson: typeof item.contentJson === 'string' ? item.contentJson : null,
      })),
    } as unknown as Row & {
      operatingMode: string;
      primaryLanguage: string;
      reviewLocale: string;
      approvedArtifacts: Row[];
    };
  }
  private commandHash(row: Row) {
    if (typeof row.safeMetadataJson !== 'string') return null;
    try {
      return (JSON.parse(row.safeMetadataJson) as Row).commandHash;
    } catch {
      return null;
    }
  }
  private existingRun(idempotencyKey: string) {
    return this.db
      .prepare(
        `SELECT id,status,output_artifact_version_id AS outputArtifactVersionId,safe_metadata_json AS safeMetadataJson FROM intelligence_runs WHERE workspace_id=? AND idempotency_key=?`,
      )
      .bind(this.actor.workspaceId, idempotencyKey)
      .first<Row>();
  }
  private isProfileProjectEligible(project: Row, task: Task, profile: BoundedExecutionProfile) {
    if (!isBoundedProfileStep(task)) return false;
    const brief = (project.approvedArtifacts as Row[]).find(
      (item) => item.artifactType === 'CONTENT_BRIEF',
    );
    let briefProductionLanguage: unknown;
    let briefReviewLanguage: unknown;
    if (brief && typeof brief.contentJson === 'string')
      try {
        const content = JSON.parse(brief.contentJson) as Row;
        if (content.format === 'SHORT') {
          briefProductionLanguage = content.productionLanguage;
          briefReviewLanguage = content.reviewLanguage;
        }
      } catch {
        // Invalid persisted JSON is ineligible and fails closed below.
      }
    return isProjectEligibleForBoundedProfile(
      profile,
      {
        format: project.format,
        operatingMode: project.operatingMode,
        primaryLanguage: project.primaryLanguage,
        reviewLanguage: project.reviewLocale,
        briefProductionLanguage,
        briefReviewLanguage,
        hasApprovedBrief: brief !== undefined,
        hasExactSource: project.exactSource !== null,
      },
      task,
    );
  }
  private observer(runId: string) {
    return {
      started: async (attempt: number) => {
        const at = now();
        await this.db.batch([
          this.db
            .prepare(
              `UPDATE editorial_execution_reservations SET status='DISPATCHED',dispatched_at=? WHERE intelligence_run_id=? AND status='RESERVED'`,
            )
            .bind(at, runId),
          this.db
            .prepare(
              `UPDATE intelligence_runs SET status='RUNNING',started_at=COALESCE(started_at,?),updated_at=?,version=version+1 WHERE id=?`,
            )
            .bind(at, at, runId),
          this.db
            .prepare(
              `INSERT INTO intelligence_run_attempts(id,intelligence_run_id,attempt_number,attempt_kind,status,safe_metadata_json,started_at) VALUES(?,?,?,'TECHNICAL','RUNNING','{}',?)`,
            )
            .bind(newId('attempt'), runId, attempt, at),
        ]);
      },
      succeeded: (attempt: number, result: ProviderExecutionResult) => {
        void attempt;
        void result;
        return Promise.resolve();
      },
      failed: (attempt: number, error: ProviderError) => {
        void attempt;
        void error;
        return Promise.resolve();
      },
    };
  }
  private async terminalSchemaReady() {
    try {
      const row = await this.db
        .prepare(
          `SELECT COUNT(*) AS count FROM pragma_table_info('intelligence_runs') WHERE name='terminal_audit_event_id'`,
        )
        .first<{ count: number }>();
      return Number(row?.count) === 1;
    } catch {
      return false;
    }
  }
  private terminalAuditStatement(
    auditId: string,
    runId: string,
    action: 'intelligence.run_completed' | 'intelligence.run_failed',
    outcome: 'success' | 'failure',
    at: string,
  ) {
    return this.db
      .prepare(
        `INSERT INTO audit_events(id,workspace_id,actor_type,actor_id,actor_role,access_issuer,access_subject,action,resource_type,resource_id,outcome,request_id,environment,metadata_json,occurred_at,ingested_at) VALUES(?,?,'user',?,?,?,?,?,'intelligence_run',?,?,?,?, '{}',?,?)`,
      )
      .bind(
        auditId,
        this.actor.workspaceId,
        this.actor.id,
        this.actor.roles[0] ?? null,
        this.config.accessIssuer ?? null,
        this.config.accessSubject ?? null,
        action,
        runId,
        outcome,
        this.config.requestId ?? runId,
        this.config.environment ?? 'runtime',
        at,
        at,
      );
  }
  private cost(result: ProviderExecutionResult, row: Row) {
    const input = result.usage.inputUnits,
      output = result.usage.outputUnits,
      cached = result.usage.cachedInputUnits ?? 0;
    const inputPrice = typeof row.inputPrice === 'number' ? row.inputPrice : null,
      outputPrice = typeof row.outputPrice === 'number' ? row.outputPrice : null;
    const cfg = parseCapabilities(row.capabilitiesJson);
    const cachedPrice =
      typeof cfg.cachedInputUnitPriceUsd === 'number' ? cfg.cachedInputUnitPriceUsd : null;
    return {
      actualCost:
        input === null || output === null || inputPrice === null || outputPrice === null
          ? null
          : (input - cached) * inputPrice +
            (cachedPrice === null ? cached * inputPrice : cached * cachedPrice) +
            output * outputPrice,
      currency: typeof row.currency === 'string' ? row.currency : null,
    };
  }
  private async persist(
    projectId: string,
    task: Task,
    runId: string,
    inputVersionId: string | null,
    language: string,
    output: unknown,
    completion: {
      result: ProviderExecutionResult;
      costs: { actualCost: number | null; currency: string | null };
      metadata: Row;
      boundedStep: boolean;
      reservedMicrousd: number | null;
    },
  ) {
    const at = now();
    const statements: D1PreparedStatement[] = [];
    const createArtifact = async (
      type: string,
      value: unknown,
      contentText: string | null,
      outputLanguage: string,
      sourceScriptVersionId: string | null,
    ) => {
      const existing =
        type === 'IDEA_CANDIDATE'
          ? null
          : await this.db
              .prepare(
                `SELECT a.id AS artifactId,a.current_version_id AS currentVersionId,v.version_number AS versionNumber FROM editorial_artifacts a LEFT JOIN editorial_artifact_versions v ON v.id=a.current_version_id WHERE a.workspace_id=? AND a.project_id=? AND a.artifact_type=? AND a.deleted_at IS NULL LIMIT 1`,
              )
              .bind(this.actor.workspaceId, projectId, type)
              .first<{
                artifactId: string;
                currentVersionId: string | null;
                versionNumber: number | null;
              }>();
      const artifactId = existing?.artifactId ?? newId('artifact');
      const versionId = newId('artifact_version');
      const versionNumber = Number(existing?.versionNumber ?? 0) + 1;
      const parentVersionId = existing?.currentVersionId ?? null;
      const content = JSON.stringify(value);
      const contentHash = await digest(value);
      if (!existing)
        statements.push(
          this.db
            .prepare(
              `INSERT INTO editorial_artifacts(id,workspace_id,project_id,artifact_type,status,current_version_id,created_at,updated_at,version,created_by,updated_by) VALUES(?,?,?,?,'active',NULL,?,?,1,?,?)`,
            )
            .bind(
              artifactId,
              this.actor.workspaceId,
              projectId,
              type,
              at,
              at,
              this.actor.id,
              this.actor.id,
            ),
        );
      statements.push(
        this.db
          .prepare(
            `INSERT INTO editorial_artifact_versions(id,workspace_id,artifact_id,version_number,parent_version_id,language_code,content_text,content_json,source_type,intelligence_run_id,content_hash,word_count,source_script_version_id,created_at,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .bind(
            versionId,
            this.actor.workspaceId,
            artifactId,
            versionNumber,
            parentVersionId,
            outputLanguage,
            contentText,
            content,
            'AI_GENERATED',
            runId,
            contentHash,
            contentText ? contentText.trim().split(/\s+/u).filter(Boolean).length : null,
            sourceScriptVersionId,
            at,
            this.actor.id,
          ),
        this.db
          .prepare(
            `UPDATE editorial_artifacts SET current_version_id=?,status='active',updated_at=?,updated_by=?,version=version+1 WHERE id=? AND workspace_id=?`,
          )
          .bind(versionId, at, this.actor.id, artifactId, this.actor.workspaceId),
      );
      if (inputVersionId)
        statements.push(
          this.db
            .prepare(
              `INSERT INTO artifact_dependencies(id,workspace_id,source_artifact_version_id,dependent_artifact_version_id,dependency_type,validity_status,created_at,updated_at,version) VALUES(?,?,?,?,'GENERATED_FROM','CURRENT',?,?,1)`,
            )
            .bind(newId('dependency'), this.actor.workspaceId, inputVersionId, versionId, at, at),
        );
      return { artifactId, versionId };
    };
    let outputVersionId: string;
    if (task === 'IDEA_GENERATION') {
      const items = (
        output as {
          items: Array<{
            title: string;
            angle: string;
            hook: string;
            rationale: string;
            audience: string[];
            targetFormat: string;
            risks: string[];
            confidence: number | null;
          }>;
        }
      ).items;
      let first: string | undefined;
      for (const [index, item] of items.entries()) {
        const created = await createArtifact('IDEA_CANDIDATE', item, null, language, null);
        first ??= created.versionId;
        statements.push(
          this.db
            .prepare(
              `INSERT INTO idea_candidates(id,workspace_id,project_id,artifact_id,artifact_version_id,title,angle,hook,rationale,audience_json,target_format,target_platforms_json,complexity,monetization_compatibility,risks_json,status,recommendation_rank,confidence,evidence_class,created_at,updated_at,version,created_by,updated_by) VALUES(?,?,?,?,?,?,?,?,?,? ,?,'[]','UNKNOWN','UNKNOWN',?,'CANDIDATE',?,?,'HEURISTIC',?,?,1,?,?)`,
            )
            .bind(
              newId('idea'),
              this.actor.workspaceId,
              projectId,
              created.artifactId,
              created.versionId,
              item.title,
              item.angle,
              item.hook,
              item.rationale,
              JSON.stringify(item.audience),
              item.targetFormat,
              JSON.stringify(item.risks),
              index + 1,
              item.confidence,
              at,
              at,
              this.actor.id,
              this.actor.id,
            ),
        );
      }
      outputVersionId = first!;
    } else {
      const contentText =
        task === 'SCRIPT_WRITER_SHORT' || task === 'SCRIPT_WRITER_LONG'
          ? (output as { segments: { text: string }[] }).segments
              .map((segment) => segment.text)
              .join('\n\n')
          : task === 'REVIEW_TRANSLATION_ES'
            ? (output as { faithfulTranslation: string }).faithfulTranslation
            : null;
      const sourceScriptVersionId =
        task === 'REVIEW_TRANSLATION_ES'
          ? (output as { sourceScriptVersionId: string }).sourceScriptVersionId
          : null;
      const created = await createArtifact(
        artifactType[task],
        output,
        contentText,
        task === 'REVIEW_TRANSLATION_ES' ? 'es' : language,
        sourceScriptVersionId,
      );
      outputVersionId = created.versionId;
      if (task === 'TOPIC_RESEARCH')
        for (const claim of (
          output as {
            claims: { claim: string; evidenceClass: string; confidence: number | null }[];
          }
        ).claims)
          statements.push(
            this.db
              .prepare(
                `INSERT INTO research_claims(id,workspace_id,research_version_id,source_id,claim_text,evidence_class,confidence,created_at,created_by) VALUES(?,?,?,NULL,?,?,?,?,?)`,
              )
              .bind(
                newId('claim'),
                this.actor.workspaceId,
                outputVersionId,
                claim.claim,
                claim.evidenceClass,
                claim.confidence,
                at,
                this.actor.id,
              ),
          );
      if (task === 'SCRIPT_WRITER_SHORT' || task === 'SCRIPT_WRITER_LONG')
        for (const segment of (output as { segments: { order: number; text: string }[] }).segments)
          statements.push(
            this.db
              .prepare(
                `INSERT INTO script_segments(id,workspace_id,script_version_id,segment_order,content_text,content_hash,word_count,created_at) VALUES(?,?,?,?,?,?,?,?)`,
              )
              .bind(
                newId('segment'),
                this.actor.workspaceId,
                outputVersionId,
                segment.order,
                segment.text,
                await digest(segment.text),
                segment.text.trim().split(/\s+/u).filter(Boolean).length,
                at,
              ),
          );
      if (task === 'STORYBOARD_PLANNER')
        for (const scene of (output as { scenes: Row[] }).scenes)
          statements.push(
            this.db
              .prepare(
                `INSERT INTO storyboard_scenes(id,workspace_id,storyboard_version_id,scene_order,target_duration_seconds,visual_description,location,action,camera_framing,mood,continuity_notes,generation_instructions,recommended_media_type,asset_requirements_json,transition_notes,character_version_refs_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
              )
              .bind(
                newId('scene'),
                this.actor.workspaceId,
                outputVersionId,
                scene.order,
                scene.targetDurationSeconds,
                scene.visualDescription,
                scene.location,
                scene.action,
                scene.cameraFraming,
                scene.mood,
                scene.continuityNotes,
                scene.generationInstructions,
                scene.recommendedMediaType,
                JSON.stringify(scene.assetRequirements),
                scene.transitionNotes,
                JSON.stringify(scene.characterVersionIds),
                at,
              ),
          );
      if (task === 'PREFLIGHT_ANALYSIS') {
        const assessmentId = newId('preflight');
        const value = output as {
          recommendation: string;
          checks: Array<{
            key: string;
            result: string;
            explanation: string;
            evidence: Row;
            ruleVersion: string | null;
          }>;
        };
        statements.push(
          this.db
            .prepare(
              `INSERT INTO preflight_assessments(id,workspace_id,project_id,artifact_id,artifact_version_id,overall_result,generation_readiness,rule_set_version,assessed_at,assessed_by) SELECT ?,?,?,artifact_id,?,?, 'NOT_READY','phase3-v1',?,? FROM editorial_artifact_versions WHERE id=?`,
            )
            .bind(
              assessmentId,
              this.actor.workspaceId,
              projectId,
              outputVersionId,
              value.recommendation,
              at,
              this.actor.id,
              outputVersionId,
            ),
        );
        for (const check of value.checks)
          statements.push(
            this.db
              .prepare(
                `INSERT INTO preflight_checks(id,preflight_assessment_id,check_key,result,explanation,evidence_json,rule_version,override_allowed,created_at) VALUES(?,?,?,?,?,?,?,0,?)`,
              )
              .bind(
                newId('check'),
                assessmentId,
                check.key,
                check.result,
                check.explanation,
                JSON.stringify(check.evidence),
                check.ruleVersion,
                at,
              ),
          );
      }
    }
    const auditId = newId('audit');
    statements.push(
      this.db
        .prepare(
          `UPDATE intelligence_run_attempts SET status='SUCCEEDED',provider_request_id=?,safe_metadata_json=?,completed_at=? WHERE intelligence_run_id=? AND status='RUNNING'`,
        )
        .bind(
          completion.result.providerRequestId,
          JSON.stringify(completion.result.safeMetadata),
          at,
          runId,
        ),
    );
    if (completion.boundedStep) {
      const actualMicrousd =
        completion.costs.actualCost === null
          ? null
          : Math.ceil(completion.costs.actualCost * 1_000_000);
      const reconciled =
        actualMicrousd !== null &&
        completion.reservedMicrousd !== null &&
        actualMicrousd <= completion.reservedMicrousd;
      statements.push(
        this.db
          .prepare(
            `UPDATE editorial_execution_reservations SET status=?,actual_microusd=?,reconciled_at=? WHERE intelligence_run_id=? AND status='DISPATCHED'`,
          )
          .bind(reconciled ? 'RECONCILED' : 'AMBIGUOUS', actualMicrousd, at, runId),
      );
    }
    statements.push(
      this.terminalAuditStatement(auditId, runId, 'intelligence.run_completed', 'success', at),
      this.db
        .prepare(
          `UPDATE intelligence_runs SET output_artifact_version_id=?,status='SUCCEEDED',input_units=?,output_units=?,actual_cost=?,currency=?,safe_metadata_json=?,terminal_audit_event_id=?,completed_at=?,updated_at=?,version=version+1 WHERE id=? AND workspace_id=?`,
        )
        .bind(
          outputVersionId,
          completion.result.usage.inputUnits,
          completion.result.usage.outputUnits,
          completion.costs.actualCost,
          completion.costs.currency,
          JSON.stringify(completion.metadata),
          auditId,
          at,
          at,
          runId,
          this.actor.workspaceId,
        ),
    );
    await this.db.batch(statements);
    return outputVersionId;
  }
}
