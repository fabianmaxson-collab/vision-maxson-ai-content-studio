import { approvalSchema, createArtifactVersionSchema } from '@vision-maxson/contracts';
import { hasPermission, newId, type Permission } from '@vision-maxson/domain';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import type { Bindings } from '../app';
import { EditorialRepository, type EditorialActor } from './repository';

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
async function audit(c: Context<Env>, action: string, resourceType: string, resourceId: string) {
  const user = c.get('user'),
    identity = c.get('identity'),
    at = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO audit_events(id,workspace_id,actor_type,actor_id,actor_role,access_issuer,access_subject,action,resource_type,resource_id,outcome,request_id,environment,metadata_json,occurred_at,ingested_at) VALUES(?,?,'user',?,?,?,?,?,?,?,'success',?,?, '{}',?,?)`,
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
    const [artifacts, providers] = await Promise.all([
      repository.list(c.req.param('projectId')),
      repository.providerCatalog(),
    ]);
    return c.json({ artifacts, aiProviderConfigured: providers.configured });
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
for (const route of [
  '/projects/:projectId/research/generate',
  '/projects/:projectId/ideas/generate',
  '/projects/:projectId/content-brief/generate',
  '/projects/:projectId/scripts/generate',
  '/projects/:projectId/scripts/:versionId/translate-review',
  '/projects/:projectId/scripts/:versionId/critique',
  '/projects/:projectId/storyboards/generate',
] as const)
  editorialRoutes.post(route, requirePermission('intelligence:execute'), (c) =>
    problem(
      c,
      503,
      'AI Provider Not Configured',
      'Proveedor de IA no configurado. No se ha generado ningún artefacto.',
    ),
  );
