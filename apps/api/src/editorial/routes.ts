import {
  approvalSchema,
  createArtifactVersionSchema,
  intelligenceCommandSchema,
  type intelligenceTaskSchema,
} from '@vision-maxson/contracts';
import { hasPermission, newId, type Permission } from '@vision-maxson/domain';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import type { Bindings } from '../app';
import { ProviderError } from '@vision-maxson/providers';
import {
  phase3ShortDeReviewEsProfile,
  phase3ShortEnReviewEsProfile,
  type BoundedExecutionProfile,
} from '@vision-maxson/providers/execution-profile';
import { EditorialExecutionService } from './execution';
import { authorizePhase3Envelope } from './budget';
import { EditorialRepository, type EditorialActor } from './repository';
import type { z } from 'zod';

type Vars = {
  requestId: string;
  identity: { issuer: string; subject: string; email: string };
  user: EditorialActor;
};
type Env = { Bindings: Bindings; Variables: Vars };
const problem = (
  c: Context<Env>,
  status: 403 | 404 | 409 | 422 | 503,
  title: string,
  detail: string,
) =>
  c.json(
    {
      type: `https://vision.directormaxson.com/problems/${title.toLowerCase().replaceAll(' ', '-')}`,
      title,
      status,
      detail,
      requestId: c.get('requestId'),
    },
    status,
  );
const requirePermission =
  (permission: Permission): MiddlewareHandler<Env> =>
  async (c, next) =>
    hasPermission(c.get('user').roles, permission)
      ? next()
      : problem(c, 403, 'Forbidden', 'The current user does not have this permission.');
async function audit(
  c: Context<Env>,
  action: string,
  resourceType: string,
  resourceId: string,
  metadata: Record<string, unknown> = {},
) {
  const user = c.get('user'),
    identity = c.get('identity'),
    at = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO audit_events(id,workspace_id,actor_type,actor_id,actor_role,access_issuer,access_subject,action,resource_type,resource_id,outcome,request_id,environment,metadata_json,occurred_at,ingested_at) VALUES(?,?,'user',?,?,?,?,?,?,?,'success',?,?,?,?,?)`,
  )
    .bind(
      newId('audit'),
      user.workspaceId,
      user.id,
      user.roles[0] ?? null,
      identity.issuer,
      identity.subject,
      action,
      resourceType,
      resourceId,
      c.get('requestId'),
      c.env.ENVIRONMENT,
      JSON.stringify(metadata),
      at,
      at,
    )
    .run();
}
export const editorialRoutes = new Hono<Env>();

editorialRoutes.get('/ai/catalog', requirePermission('intelligence:read'), async (c) =>
  c.json(await new EditorialRepository(c.env.DB, c.get('user')).providerCatalog()),
);
editorialRoutes.get(
  '/projects/:projectId/intelligence',
  requirePermission('editorial:read'),
  async (c) => {
    const repository = new EditorialRepository(c.env.DB, c.get('user'));
    const [artifacts, providers, cost] = await Promise.all([
      repository.list(c.req.param('projectId')),
      repository.providerCatalog(),
      repository.projectCostSummary(c.req.param('projectId')),
    ]);
    return c.json({ artifacts, aiProviderConfigured: providers.configured, projectCost: cost });
  },
);
editorialRoutes.get(
  '/projects/:projectId/editorial-artifacts',
  requirePermission('editorial:read'),
  async (c) =>
    c.json({
      items: await new EditorialRepository(c.env.DB, c.get('user')).list(c.req.param('projectId')),
    }),
);
editorialRoutes.post(
  '/projects/:projectId/editorial-artifacts',
  requirePermission('editorial:write'),
  async (c) => {
    const parsed = createArtifactVersionSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return problem(c, 422, 'Validation Failed', 'The editorial artifact is invalid.');
    try {
      const input = {
        projectId: c.req.param('projectId'),
        artifactType: parsed.data.artifactType,
        parentVersionId: parsed.data.parentVersionId,
        languageCode: parsed.data.languageCode,
        contentText: parsed.data.contentText,
        content: parsed.data.content,
        sourceType: parsed.data.sourceType,
        sourceScriptVersionId: parsed.data.sourceScriptVersionId,
        ...(parsed.data.artifactId ? { artifactId: parsed.data.artifactId } : {}),
        ...(parsed.data.expectedArtifactVersion
          ? { expectedArtifactVersion: parsed.data.expectedArtifactVersion }
          : {}),
      };
      const result = await new EditorialRepository(c.env.DB, c.get('user')).createVersion(input);
      await audit(
        c,
        parsed.data.artifactType === 'PRODUCTION_SCRIPT' && parsed.data.parentVersionId
          ? 'script.edited'
          : `${parsed.data.artifactType.toLowerCase()}.created`,
        'editorial_artifact',
        result.artifactId,
      );
      return c.json(result, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'editorial_write_failed';
      return problem(
        c,
        message.includes('conflict') || message.includes('current') ? 409 : 422,
        message.includes('conflict') ? 'Conflict' : 'Validation Failed',
        message,
      );
    }
  },
);
editorialRoutes.post(
  '/editorial-artifact-versions/:versionId/approve',
  requirePermission('editorial:approve'),
  async (c) => {
    const parsed = approvalSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return problem(c, 422, 'Validation Failed', 'Invalid approval.');
    try {
      const result = await new EditorialRepository(c.env.DB, c.get('user')).approve(
        c.req.param('versionId'),
        parsed.data.decision,
        parsed.data.comment,
      );
      await audit(c, 'artifact.approval_recorded', 'editorial_artifact_version', result.versionId);
      return c.json(result, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'approval_failed';
      return problem(c, message.includes('stale') ? 409 : 422, 'Validation Failed', message);
    }
  },
);
const envelopeProfiles: readonly BoundedExecutionProfile[] = [
  phase3ShortEnReviewEsProfile,
  phase3ShortDeReviewEsProfile,
];
for (const profile of envelopeProfiles)
  editorialRoutes.post(
    `/admin/projects/:projectId/editorial-execution-envelopes/${profile.key}`,
    requirePermission('providers:admin'),
    async (c) => {
      const body: unknown = await c.req.json().catch(() => ({}));
      if (typeof body !== 'object' || body === null || Object.keys(body).length !== 0)
        return problem(
          c,
          422,
          'Validation Failed',
          'This authorization endpoint accepts no budget overrides.',
        );
      try {
        const result = await authorizePhase3Envelope(
          c.env.DB,
          c.get('user'),
          c.req.param('projectId'),
          profile,
        );
        if (!result.idempotent)
          await audit(
            c,
            'editorial.execution_envelope_authorized',
            'editorial_execution_envelope',
            String(result.envelope.id),
            {
              profileKey: profile.key,
              projectId: c.req.param('projectId'),
              providerKey: profile.providerKey,
              modelKey: profile.modelKey,
              maximumCalls: profile.maximumDispatches,
              monetaryCeilingMicrousd: profile.monetaryCeilingMicrousd,
              currency: 'USD',
            },
          );
        return c.json(result, result.idempotent ? 200 : 201);
      } catch (error) {
        return problem(
          c,
          422,
          'Validation Failed',
          error instanceof Error ? error.message : 'execution_envelope_authorization_failed',
        );
      }
    },
  );

type IntelligenceTask = z.infer<typeof intelligenceTaskSchema>;
const taskRoutes: ReadonlyArray<readonly [string, IntelligenceTask]> = [
  ['/projects/:projectId/research/generate', 'TOPIC_RESEARCH'],
  ['/projects/:projectId/ideas/generate', 'IDEA_GENERATION'],
  ['/projects/:projectId/content-brief/generate', 'CONTENT_BRIEF'],
  ['/projects/:projectId/scripts/generate', 'SCRIPT_WRITER_SHORT'],
  ['/projects/:projectId/scripts/:versionId/translate-review', 'REVIEW_TRANSLATION_ES'],
  ['/projects/:projectId/scripts/:versionId/critique', 'SCRIPT_CRITIC'],
  ['/projects/:projectId/storyboards/generate', 'STORYBOARD_PLANNER'],
];
const executionService = (c: Context<Env>) =>
  new EditorialExecutionService(c.env.DB, c.get('user'), {
    openAIEnabled: c.env.OPENAI_PROVIDER_ENABLED === 'true',
    ...(c.env.OPENAI_API_KEY ? { openAIApiKey: c.env.OPENAI_API_KEY } : {}),
    openAIBaseUrl: c.env.OPENAI_API_BASE_URL ?? 'https://api.openai.com/v1',
    requestId: c.get('requestId'),
    environment: c.env.ENVIRONMENT,
    accessIssuer: c.get('identity').issuer,
    accessSubject: c.get('identity').subject,
  });
for (const [route, task] of taskRoutes)
  editorialRoutes.post(route, requirePermission('intelligence:execute'), async (c) => {
    const parsed = intelligenceCommandSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success)
      return problem(c, 422, 'Validation Failed', 'El comando de IA no es válido.');
    const idempotencyKey = c.req.header('Idempotency-Key');
    if (!idempotencyKey || idempotencyKey.length > 200)
      return problem(c, 422, 'Validation Failed', 'Se requiere una clave Idempotency-Key válida.');
    const inputArtifactVersionId = c.req.param('versionId') || parsed.data.inputArtifactVersionId;
    try {
      const result = await executionService(c).execute(
        c.req.param('projectId')!,
        task,
        {
          mode: parsed.data.mode,
          inputArtifactVersionId,
          creativeRegeneration: parsed.data.creativeRegeneration,
          ...(parsed.data.preferredProviderKey
            ? { preferredProviderKey: parsed.data.preferredProviderKey }
            : {}),
          ...(parsed.data.preferredModelKey
            ? { preferredModelKey: parsed.data.preferredModelKey }
            : {}),
        },
        idempotencyKey,
      );
      return c.json(result, result.idempotentReplay ? 200 : 201);
    } catch (error) {
      if (error instanceof ProviderError)
        return problem(
          c,
          error.category === 'AUTHENTICATION' ? 503 : error.retryable ? 503 : 422,
          error.category === 'AUTHENTICATION'
            ? 'AI Provider Not Configured'
            : 'AI Execution Failed',
          error.message,
        );
      return problem(c, 503, 'AI Execution Failed', 'La ejecución no pudo completarse.');
    }
  });
editorialRoutes.get(
  '/intelligence-runs/:runId',
  requirePermission('intelligence:read'),
  async (c) => {
    const run = await executionService(c).getRun(c.req.param('runId'));
    return run ? c.json({ run }) : problem(c, 404, 'Not Found', 'No se encontró la ejecución.');
  },
);
editorialRoutes.post(
  '/intelligence-runs/:runId/cancel',
  requirePermission('intelligence:execute'),
  async (c) => {
    try {
      const result = await executionService(c).cancel(c.req.param('runId'));
      await audit(c, 'intelligence.run_cancelled', 'intelligence_run', result.id);
      return c.json({ run: result });
    } catch (error) {
      return problem(
        c,
        409,
        'Conflict',
        error instanceof Error ? error.message : 'La ejecución no puede cancelarse.',
      );
    }
  },
);
editorialRoutes.post(
  '/projects/:projectId/ideas/:candidateId/select',
  requirePermission('editorial:approve'),
  async (c) => {
    const user = c.get('user'),
      at = new Date().toISOString(),
      candidateId = c.req.param('candidateId');
    const candidate = await c.env.DB.prepare(
      `SELECT id FROM idea_candidates WHERE id=? AND project_id=? AND workspace_id=?`,
    )
      .bind(candidateId, c.req.param('projectId'), user.workspaceId)
      .first();
    if (!candidate) return problem(c, 404, 'Not Found', 'No se encontró la idea.');
    await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE idea_candidates SET status='CANDIDATE',updated_at=?,updated_by=?,version=version+1 WHERE project_id=? AND workspace_id=? AND status='SELECTED'`,
      ).bind(at, user.id, c.req.param('projectId'), user.workspaceId),
      c.env.DB.prepare(
        `UPDATE idea_candidates SET status='SELECTED',updated_at=?,updated_by=?,version=version+1 WHERE id=? AND workspace_id=?`,
      ).bind(at, user.id, candidateId, user.workspaceId),
    ]);
    await audit(c, 'idea.selected', 'idea_candidate', candidateId);
    return c.json({ id: candidateId, status: 'SELECTED' });
  },
);
