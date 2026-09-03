import {
  createBrandSchema,
  createCharacterProfileSchema,
  createCharacterVersionSchema,
  createChannelSchema,
  createProjectSchema,
  createSocialAccountSchema,
  createVoiceProfileSchema,
  deriveShortSchema,
} from '@vision-maxson/contracts';
import { hasPermission, newId, type Permission, type Role } from '@vision-maxson/domain';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import type { Bindings } from '../app';
import { ProductRepository, type Actor } from './repository';

type Vars = {
  requestId: string;
  identity: { issuer: string; subject: string; email: string };
  user: Actor & { roles: Role[] };
};
type Env = { Bindings: Bindings; Variables: Vars };
const problem = (c: Context<Env>, status: 403 | 404 | 409 | 422, title: string, detail: string) =>
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
  outcome = 'success',
) {
  const u = c.get('user'),
    i = c.get('identity'),
    at = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO audit_events(id,workspace_id,actor_type,actor_id,actor_role,access_issuer,access_subject,action,resource_type,resource_id,outcome,request_id,environment,metadata_json,occurred_at,ingested_at) VALUES(?,?,'user',?,?,?,?,?,?,?,?,?,?, '{}',?,?)`,
  )
    .bind(
      newId('audit'),
      u.workspaceId,
      u.id,
      u.roles[0] ?? null,
      i.issuer,
      i.subject,
      action,
      resourceType,
      resourceId,
      outcome,
      c.get('requestId'),
      c.env.ENVIRONMENT,
      at,
      at,
    )
    .run();
}
const parse = async <T>(
  c: Context<Env>,
  schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false } },
) => {
  const result = schema.safeParse(await c.req.json().catch(() => null));
  if (!result.success) throw new Error('validation');
  return result.data;
};
export const productRoutes = new Hono<Env>();
productRoutes.get('/catalogs', requirePermission('catalogs:read'), async (c) =>
  c.json(await new ProductRepository(c.env.DB, c.get('user')).listCatalogs()),
);
productRoutes.get('/content-brands', requirePermission('brands:read'), async (c) =>
  c.json({ items: await new ProductRepository(c.env.DB, c.get('user')).listBrands() }),
);
productRoutes.post('/content-brands', requirePermission('brands:write'), async (c) => {
  try {
    const item = await new ProductRepository(c.env.DB, c.get('user')).createBrand(
      await parse(c, createBrandSchema),
    );
    await audit(c, 'content_brand.created', 'content_brand', item.id);
    return c.json(item, 201);
  } catch (e) {
    return problem(c, 422, 'Validation Failed', e instanceof Error ? e.message : 'Invalid brand');
  }
});
productRoutes.delete('/content-brands/:id', requirePermission('brands:write'), async (c) => {
  const version = Number(c.req.query('version'));
  if (!Number.isInteger(version))
    return problem(c, 422, 'Validation Failed', 'A version is required.');
  const result = await new ProductRepository(c.env.DB, c.get('user')).archiveBrand(
    c.req.param('id'),
    version,
  );
  if (!result.meta.changes)
    return problem(c, 409, 'Conflict', 'The record is missing or has changed.');
  await audit(c, 'content_brand.archived', 'content_brand', c.req.param('id'));
  return c.json({ archived: true });
});
productRoutes.get('/channel-profiles', requirePermission('channels:read'), async (c) =>
  c.json({
    items: await new ProductRepository(c.env.DB, c.get('user')).listChannels(
      c.req.query('brandId'),
    ),
  }),
);
productRoutes.post(
  '/content-brands/:brandId/channel-profiles',
  requirePermission('channels:write'),
  async (c) => {
    try {
      const item = await new ProductRepository(c.env.DB, c.get('user')).createChannel(
        c.req.param('brandId'),
        await parse(c, createChannelSchema),
      );
      await audit(c, 'channel_profile.created', 'channel_profile', item.id);
      return c.json(item, 201);
    } catch (e) {
      return problem(
        c,
        422,
        'Validation Failed',
        e instanceof Error ? e.message : 'Invalid channel',
      );
    }
  },
);
productRoutes.get('/social-accounts', requirePermission('social_accounts:read'), async (c) =>
  c.json({ items: await new ProductRepository(c.env.DB, c.get('user')).listSocialAccounts() }),
);
productRoutes.get('/voice-profiles', requirePermission('profiles:read'), async (c) =>
  c.json({ items: await new ProductRepository(c.env.DB, c.get('user')).listVoiceProfiles() }),
);
productRoutes.post('/voice-profiles', requirePermission('profiles:write'), async (c) => {
  try {
    const item = await new ProductRepository(c.env.DB, c.get('user')).createVoiceProfile(
      await parse(c, createVoiceProfileSchema),
    );
    await audit(c, 'voice_profile.created', 'voice_profile', item.id);
    return c.json(item, 201);
  } catch (e) {
    return problem(
      c,
      422,
      'Validation Failed',
      e instanceof Error ? e.message : 'Invalid voice profile',
    );
  }
});
productRoutes.get('/character-profiles', requirePermission('profiles:read'), async (c) =>
  c.json({ items: await new ProductRepository(c.env.DB, c.get('user')).listCharacterProfiles() }),
);
productRoutes.post('/character-profiles', requirePermission('profiles:write'), async (c) => {
  try {
    const item = await new ProductRepository(c.env.DB, c.get('user')).createCharacterProfile(
      await parse(c, createCharacterProfileSchema),
    );
    await audit(c, 'character_profile.created', 'character_profile', item.id);
    return c.json(item, 201);
  } catch (e) {
    return problem(
      c,
      422,
      'Validation Failed',
      e instanceof Error ? e.message : 'Invalid character profile',
    );
  }
});
productRoutes.post(
  '/character-profiles/:id/versions',
  requirePermission('profiles:write'),
  async (c) => {
    try {
      const body = await parse(c, createCharacterVersionSchema),
        item = await new ProductRepository(c.env.DB, c.get('user')).createCharacterVersion(
          c.req.param('id'),
          body.definition,
        );
      await audit(c, 'character_profile.version_created', 'character_profile', c.req.param('id'));
      return c.json(item, 201);
    } catch (e) {
      return problem(
        c,
        422,
        'Validation Failed',
        e instanceof Error ? e.message : 'Invalid character version',
      );
    }
  },
);
productRoutes.post('/social-accounts', requirePermission('social_accounts:write'), async (c) => {
  try {
    const item = await new ProductRepository(c.env.DB, c.get('user')).createSocialAccount(
      await parse(c, createSocialAccountSchema),
    );
    await audit(c, 'social_account.created', 'social_account', item.id);
    return c.json(item, 201);
  } catch (e) {
    return problem(c, 422, 'Validation Failed', e instanceof Error ? e.message : 'Invalid account');
  }
});
productRoutes.get('/projects', requirePermission('projects:read'), async (c) =>
  c.json({ items: await new ProductRepository(c.env.DB, c.get('user')).listProjects() }),
);
productRoutes.get(
  '/projects/:id/monetization-eligibility',
  requirePermission('monetization:read'),
  async (c) => {
    const result = await new ProductRepository(c.env.DB, c.get('user')).evaluateProject(
      c.req.param('id'),
    );
    return result ? c.json(result) : problem(c, 404, 'Not Found', 'Project not found.');
  },
);
productRoutes.get(
  '/projects/:id/opportunity',
  requirePermission('monetization:read'),
  async (c) => {
    const result = await new ProductRepository(c.env.DB, c.get('user')).opportunity(
      c.req.param('id'),
    );
    return result ? c.json(result) : problem(c, 404, 'Not Found', 'Project not found.');
  },
);
productRoutes.get('/projects/:id', requirePermission('projects:read'), async (c) => {
  const item = await new ProductRepository(c.env.DB, c.get('user')).getProject(c.req.param('id'));
  return item ? c.json(item) : problem(c, 404, 'Not Found', 'Project not found.');
});
productRoutes.post('/projects/:id/derive-short', requirePermission('projects:write'), async (c) => {
  try {
    const item = await new ProductRepository(c.env.DB, c.get('user')).deriveShort(
      c.req.param('id'),
      await parse(c, deriveShortSchema),
    );
    await audit(c, 'project.derived', 'project', item.id);
    return c.json(item, 201);
  } catch (e) {
    return problem(
      c,
      422,
      'Validation Failed',
      e instanceof Error ? e.message : 'Invalid derivation',
    );
  }
});
productRoutes.post('/projects', requirePermission('projects:write'), async (c) => {
  try {
    const item = await new ProductRepository(c.env.DB, c.get('user')).createProject(
      await parse(c, createProjectSchema),
    );
    await audit(c, 'project.created', 'project', item.id);
    return c.json(item, 201);
  } catch (e) {
    return problem(c, 422, 'Validation Failed', e instanceof Error ? e.message : 'Invalid project');
  }
});
productRoutes.delete('/projects/:id', requirePermission('projects:write'), async (c) => {
  const version = Number(c.req.query('version'));
  if (!Number.isInteger(version))
    return problem(c, 422, 'Validation Failed', 'A version is required.');
  const result = await new ProductRepository(c.env.DB, c.get('user')).archiveProject(
    c.req.param('id'),
    version,
  );
  if (!result.meta.changes)
    return problem(c, 409, 'Conflict', 'The record is missing or has changed.');
  await audit(c, 'project.archived', 'project', c.req.param('id'));
  return c.json({ archived: true });
});
