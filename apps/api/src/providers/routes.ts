import { hasPermission, newId, type Role } from '@vision-maxson/domain';
import type { ProviderConnectivityAdapter } from '@vision-maxson/providers';
import { OpenAIResponsesAdapter } from '@vision-maxson/providers/openai';
import { Hono } from 'hono';
import type { Bindings } from '../app';
import { ProviderConnectivityService } from './connectivity';

type User = { id: string; workspaceId: string; roles: Role[] };
type Vars = { requestId: string; identity: { issuer: string; subject: string }; user: User };
type Env = { Bindings: Bindings; Variables: Vars };
export type ConnectivityAdapterFactory = (
  providerKey: string,
  bindings: Bindings,
) => ProviderConnectivityAdapter | undefined;

const defaultFactory: ConnectivityAdapterFactory = (providerKey, bindings) =>
  providerKey === 'openai' && bindings.OPENAI_API_KEY
    ? new OpenAIResponsesAdapter(bindings.OPENAI_API_KEY, bindings.OPENAI_API_BASE_URL)
    : undefined;

export function createProviderAdminRoutes(factory: ConnectivityAdapterFactory = defaultFactory) {
  const routes = new Hono<Env>();
  routes.post('/admin/ai/providers/:providerId/connectivity-check', async (c) => {
    const user = c.get('user');
    if (!hasPermission(user.roles, 'providers:admin'))
      return c.json({ ok: false, code: 'forbidden', requestId: c.get('requestId') }, 403);
    const providerId = c.req.param('providerId');
    const adapter = factory('openai', c.env);
    const result = await new ProviderConnectivityService(
      c.env.DB,
      new Map(adapter ? [[adapter.providerKey, adapter]] : []),
    ).check(providerId, {
      environment: c.env.ENVIRONMENT,
      diagnosticEnabled: c.env.AI_PROVIDER_CONNECTIVITY_DIAGNOSTIC_ENABLED === 'true',
      providerEnabled: c.env.OPENAI_PROVIDER_ENABLED === 'true',
      credentialPresent: Boolean(c.env.OPENAI_API_KEY),
    });
    const at = new Date().toISOString();
    await c.env.DB.prepare(
      "INSERT INTO audit_events(id,workspace_id,actor_type,actor_id,actor_role,access_issuer,access_subject,action,resource_type,resource_id,outcome,reason,request_id,environment,metadata_json,occurred_at,ingested_at) VALUES(?,?,'user',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    )
      .bind(
        newId('audit'),
        user.workspaceId,
        user.id,
        user.roles[0] ?? null,
        c.get('identity').issuer,
        c.get('identity').subject,
        'provider.connectivity_checked',
        'ai_provider',
        providerId,
        result.ok ? 'success' : 'failure',
        result.ok ? null : result.code,
        c.get('requestId'),
        c.env.ENVIRONMENT,
        JSON.stringify(
          result.ok
            ? {
                providerKey: result.providerKey,
                modelKey: result.modelKey,
                usage: result.usage,
                cost: result.cost,
              }
            : {},
        ),
        at,
        at,
      )
      .run();
    return c.json({ ...result, requestId: c.get('requestId') }, result.ok ? 200 : 503);
  });
  return routes;
}
