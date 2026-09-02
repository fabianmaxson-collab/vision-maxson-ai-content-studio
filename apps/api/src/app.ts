import { parseConfig } from '@vision-maxson/config';
import { updateSettingSchema } from '@vision-maxson/contracts';
import { hasPermission, newId, roles, type Permission, type Role } from '@vision-maxson/domain';
import { verifyAccessJwt, type AccessIdentity } from '@vision-maxson/security';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { secureHeaders } from 'hono/secure-headers';

export interface Bindings {
  ENVIRONMENT: 'local' | 'preview' | 'staging' | 'production';
  RELEASE_VERSION: string;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  APP_ORIGIN: string;
  OWNER_BOOTSTRAP_ENABLED: 'true' | 'false';
  BOOTSTRAP_OWNER_EMAIL: string;
  TOKEN_ENCRYPTION_KEY: string;
  DB: D1Database;
  ASSETS: Fetcher;
}
type Vars = { requestId: string; identity: AccessIdentity; user: AppUser };
type Env = { Bindings: Bindings; Variables: Vars };
interface AppUser {
  id: string;
  workspaceId: string;
  email: string;
  roles: Role[];
}
type IdentityVerifier = (
  token: string,
  teamDomain: string,
  audience: string,
) => Promise<AccessIdentity>;
const WORKSPACE_ID = 'workspace_primary';
const timestamp = () => new Date().toISOString();

const problem = <Path extends string>(
  c: Context<Env, Path>,
  status: 401 | 403 | 404 | 422 | 500,
  title: string,
  detail?: string,
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
    { 'Cache-Control': 'no-store' },
  );
async function findUser(db: D1Database, identity: AccessIdentity): Promise<AppUser | null> {
  const row = await db
    .prepare(
      `SELECT u.id,u.workspace_id AS workspaceId,u.email,group_concat(r.key) AS roleList FROM access_identities ai JOIN users u ON u.id=ai.user_id AND u.deleted_at IS NULL AND u.status='active' LEFT JOIN user_roles ur ON ur.user_id=u.id AND ur.workspace_id=u.workspace_id LEFT JOIN roles r ON r.id=ur.role_id WHERE ai.issuer=? AND ai.subject=? AND ai.deleted_at IS NULL GROUP BY u.id`,
    )
    .bind(identity.issuer, identity.subject)
    .first<{ id: string; workspaceId: string; email: string; roleList: string | null }>();
  return row
    ? {
        id: row.id,
        workspaceId: row.workspaceId,
        email: row.email,
        roles: row.roleList?.split(',').filter((r): r is Role => roles.includes(r as Role)) ?? [],
      }
    : null;
}
async function audit(
  db: D1Database,
  event: {
    actor?: AppUser;
    identity?: AccessIdentity;
    action: string;
    resourceType: string;
    resourceId?: string;
    outcome: string;
    reason?: string;
    requestId: string;
    environment: string;
    metadata?: Record<string, unknown>;
  },
) {
  const at = timestamp();
  await db
    .prepare(
      `INSERT INTO audit_events(id,workspace_id,actor_type,actor_id,actor_role,access_issuer,access_subject,action,resource_type,resource_id,outcome,reason,request_id,environment,metadata_json,occurred_at,ingested_at) SELECT ?,id,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? FROM workspaces WHERE id=?`,
    )
    .bind(
      newId('audit'),
      event.actor ? 'user' : 'access_identity',
      event.actor?.id ?? null,
      event.actor?.roles[0] ?? null,
      event.identity?.issuer ?? null,
      event.identity?.subject ?? null,
      event.action,
      event.resourceType,
      event.resourceId ?? null,
      event.outcome,
      event.reason ?? null,
      event.requestId,
      event.environment,
      JSON.stringify(event.metadata ?? {}),
      at,
      at,
      WORKSPACE_ID,
    )
    .run();
}
async function bootstrapOwner(
  db: D1Database,
  identity: AccessIdentity,
  ownerEmail: string,
  requestId: string,
  environment: string,
): Promise<AppUser> {
  if (identity.email !== ownerEmail) throw new Error('not_provisioned');
  const at = timestamp(),
    userId = 'user_owner_bootstrap';
  await db.batch([
    db
      .prepare(
        `INSERT OR IGNORE INTO workspaces(id,slug,name,created_at,updated_at,version) VALUES(?,?,?,?,?,1)`,
      )
      .bind(WORKSPACE_ID, 'vision-maxson', 'Vision Maxson', at, at),
    db
      .prepare(
        `INSERT OR IGNORE INTO users(id,workspace_id,email,display_name,status,created_at,updated_at,version,created_by,updated_by) VALUES(?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        userId,
        WORKSPACE_ID,
        ownerEmail,
        'Vision Maxson Owner',
        'active',
        at,
        at,
        1,
        userId,
        userId,
      ),
    db
      .prepare(
        `INSERT OR IGNORE INTO access_identities(id,workspace_id,user_id,issuer,subject,email,last_seen_at,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?,?,1)`,
      )
      .bind(
        'identity_owner_bootstrap',
        WORKSPACE_ID,
        userId,
        identity.issuer,
        identity.subject,
        identity.email,
        at,
        at,
        at,
      ),
    db
      .prepare(
        `INSERT OR IGNORE INTO user_roles(workspace_id,user_id,role_id,created_at,created_by) VALUES(?,?,?,?,?)`,
      )
      .bind(WORKSPACE_ID, userId, 'role_owner', at, userId),
  ]);
  const user = await findUser(db, identity);
  if (!user?.roles.includes('owner')) throw new Error('bootstrap_failed');
  await audit(db, {
    actor: user,
    identity,
    action: 'identity.owner_bootstrapped',
    resourceType: 'user',
    resourceId: user.id,
    outcome: 'success',
    requestId,
    environment,
  });
  return user;
}
const requirePermission =
  (permission: Permission): MiddlewareHandler<{ Bindings: Bindings; Variables: Vars }> =>
  async (c, next) =>
    hasPermission(c.get('user').roles, permission)
      ? next()
      : problem(c, 403, 'Forbidden', 'The current user does not have this permission.');

export function createApp(verifyIdentity: IdentityVerifier = verifyAccessJwt) {
  const app = new Hono<{ Bindings: Bindings; Variables: Vars }>();
  app.use('*', secureHeaders());
  app.use('/api/*', async (c, next) => {
    c.set('requestId', c.req.header('Cf-Ray') ?? crypto.randomUUID());
    await next();
    c.header('Cache-Control', 'no-store');
    c.header('X-Request-Id', c.get('requestId'));
  });
  app.get('/api/v1/health', (c) =>
    c.json({
      status: 'ok',
      service: 'vision-maxson-api',
      environment: c.env.ENVIRONMENT,
      version: c.env.RELEASE_VERSION,
    }),
  );
  app.use('/api/v1/*', async (c, next) => {
    const cfg = parseConfig(c.env),
      token = c.req.header('Cf-Access-Jwt-Assertion');
    if (!token)
      // Hono middleware path inference uses `any`; the runtime context is still bound to Env.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      return problem(c, 401, 'Unauthorized', 'A valid Cloudflare Access identity is required.');
    let identity: AccessIdentity;
    try {
      identity = await verifyIdentity(token, cfg.ACCESS_TEAM_DOMAIN, cfg.ACCESS_AUD);
    } catch {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      return problem(c, 401, 'Unauthorized', 'The Cloudflare Access assertion is invalid.');
    }
    c.set('identity', identity);
    let user = await findUser(c.env.DB, identity);
    if (!user && cfg.OWNER_BOOTSTRAP_ENABLED) {
      try {
        user = await bootstrapOwner(
          c.env.DB,
          identity,
          cfg.BOOTSTRAP_OWNER_EMAIL,
          c.get('requestId'),
          cfg.ENVIRONMENT,
        );
      } catch {
        /* deny below */
      }
    }
    if (!user) {
      await audit(c.env.DB, {
        identity,
        action: 'identity.resolution',
        resourceType: 'user',
        outcome: 'denied',
        reason: 'not_provisioned',
        requestId: c.get('requestId'),
        environment: cfg.ENVIRONMENT,
      });
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      return problem(c, 403, 'Forbidden', 'This authenticated identity is not provisioned.');
    }
    c.set('user', user);
    await next();
  });
  app.use('/api/v1/*', async (c, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) return next();
    if (c.req.header('Origin') !== parseConfig(c.env).APP_ORIGIN)
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      return problem(c, 403, 'Forbidden', 'The request origin is not allowed.');
    return next();
  });
  app.get('/api/v1/me', (c) =>
    c.json({ user: c.get('user'), environment: c.env.ENVIRONMENT, database: 'ready' }),
  );
  app.get('/api/v1/system/bootstrap-status', requirePermission('system:read'), async (c) => {
    const row = await c.env.DB.prepare(
      `SELECT EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id JOIN users u ON u.id=ur.user_id WHERE r.key='owner' AND u.status='active' AND u.deleted_at IS NULL) AS present`,
    ).first<{ present: number }>();
    return c.json({
      ownerPresent: row?.present === 1,
      bootstrapEnabled: c.env.OWNER_BOOTSTRAP_ENABLED === 'true',
      database: 'ready',
    });
  });
  app.get('/api/v1/settings', requirePermission('settings:read'), async (c) => {
    const result = await c.env.DB.prepare(
      `SELECT key,value_json AS valueJson,version FROM application_settings WHERE workspace_id=? AND deleted_at IS NULL AND is_public=1 ORDER BY key`,
    )
      .bind(c.get('user').workspaceId)
      .all();
    return c.json({
      items: result.results.map((row) => ({
        key: row.key,
        value: JSON.parse(String(row.valueJson)) as unknown,
        version: row.version,
      })),
    });
  });
  app.patch('/api/v1/settings/:key', requirePermission('settings:write'), async (c) => {
    const parsed = updateSettingSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return problem(c, 422, 'Validation Failed', 'The setting value is invalid.');
    const user = c.get('user'),
      at = timestamp(),
      key = c.req.param('key');
    await c.env.DB.prepare(
      `INSERT INTO application_settings(workspace_id,key,value_json,is_public,created_at,updated_at,version,created_by,updated_by) VALUES(?,?,?,1,?,?,1,?,?) ON CONFLICT(workspace_id,key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at,updated_by=excluded.updated_by,version=application_settings.version+1`,
    )
      .bind(user.workspaceId, key, JSON.stringify(parsed.data.value), at, at, user.id, user.id)
      .run();
    await audit(c.env.DB, {
      actor: user,
      identity: c.get('identity'),
      action: 'setting.updated',
      resourceType: 'application_setting',
      resourceId: key,
      outcome: 'success',
      requestId: c.get('requestId'),
      environment: c.env.ENVIRONMENT,
    });
    return c.json({ key, value: parsed.data.value });
  });
  app.get('/api/v1/admin/users', requirePermission('users:read'), async (c) => {
    const result = await c.env.DB.prepare(
      `SELECT u.id,u.email,u.status,group_concat(r.key) AS roles FROM users u LEFT JOIN user_roles ur ON ur.user_id=u.id LEFT JOIN roles r ON r.id=ur.role_id WHERE u.workspace_id=? AND u.deleted_at IS NULL GROUP BY u.id ORDER BY u.email`,
    )
      .bind(c.get('user').workspaceId)
      .all();
    return c.json({ items: result.results });
  });
  app.put(
    '/api/v1/admin/users/:userId/roles/:role',
    requirePermission('roles:write'),
    async (c) => {
      const role = c.req.param('role') as Role;
      if (!roles.includes(role)) return problem(c, 422, 'Validation Failed', 'Unknown role.');
      const user = c.get('user'),
        target = c.req.param('userId');
      await c.env.DB.prepare(
        `INSERT OR IGNORE INTO user_roles(workspace_id,user_id,role_id,created_at,created_by) SELECT ?,u.id,r.id,?,? FROM users u JOIN roles r ON r.key=? WHERE u.id=? AND u.workspace_id=?`,
      )
        .bind(user.workspaceId, at(), user.id, role, target, user.workspaceId)
        .run();
      await audit(c.env.DB, {
        actor: user,
        identity: c.get('identity'),
        action: 'role.granted',
        resourceType: 'user',
        resourceId: target,
        outcome: 'success',
        requestId: c.get('requestId'),
        environment: c.env.ENVIRONMENT,
        metadata: { role },
      });
      return c.json({ ok: true });
    },
  );
  app.get('/api/v1/audit-events', requirePermission('audit:read'), async (c) => {
    const result = await c.env.DB.prepare(
      `SELECT id,actor_id AS actorId,actor_role AS actorRole,action,resource_type AS resourceType,resource_id AS resourceId,outcome,reason,request_id AS requestId,environment,metadata_json AS metadataJson,occurred_at AS occurredAt FROM audit_events WHERE workspace_id=? ORDER BY occurred_at DESC LIMIT 100`,
    )
      .bind(c.get('user').workspaceId)
      .all();
    return c.json({ items: result.results });
  });
  app.notFound((c) =>
    c.req.path.startsWith('/api/')
      ? problem(c, 404, 'Not Found', 'The requested API resource does not exist.')
      : c.env.ASSETS.fetch(c.req.raw),
  );
  app.onError((error, c) => {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'unhandled_request_error',
        requestId: c.get('requestId'),
        method: c.req.method,
        path: c.req.path,
        message: error.message,
      }),
    );
    return problem(c, 500, 'Internal Server Error');
  });
  return app;
}

function at() {
  return timestamp();
}
