import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, type Bindings } from '../src/app';
import { humanFixture, snapshot, type HumanFixture } from './content-brief-human-revision-fixture';
import { OpenAIResponsesAdapter } from '@vision-maxson/providers/openai';
let f: HumanFixture;
let providerSpy: ReturnType<typeof vi.spyOn>;
beforeEach(async () => {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No network permitted'));
  f = await humanFixture();
  providerSpy = vi
    .spyOn(OpenAIResponsesAdapter.prototype, 'execute')
    .mockRejectedValue(new Error('No provider permitted'));
});
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  expect(providerSpy).not.toHaveBeenCalled();
  f?.database.close();
  vi.restoreAllMocks();
});
const identity = {
  issuer: 'https://team.cloudflareaccess.com',
  subject: 'owner-subject',
  email: 'owner@example.test',
};
function post(
  body: unknown = f.edit,
  key = 'route-key',
  parentId = f.parentId,
  authenticated = true,
) {
  const bindings: Bindings = {
    ENVIRONMENT: 'staging',
    RELEASE_VERSION: 'test',
    ACCESS_TEAM_DOMAIN: identity.issuer,
    ACCESS_AUD: '1234567890123456',
    APP_ORIGIN: 'https://staging.vision.directormaxson.com',
    OWNER_BOOTSTRAP_ENABLED: 'false',
    BOOTSTRAP_OWNER_EMAIL: identity.email,
    TOKEN_ENCRYPTION_KEY: 'unused',
    OPENAI_PROVIDER_ENABLED: 'false',
    AI_PROVIDER_CONNECTIVITY_DIAGNOSTIC_ENABLED: 'false',
    DB: f.d1,
    ASSETS: {} as Fetcher,
  };
  return createApp(() => Promise.resolve(identity)).request(
    `/api/v1/editorial-artifact-versions/${parentId}/human-revision`,
    {
      method: 'POST',
      headers: {
        Origin: bindings.APP_ORIGIN,
        'Content-Type': 'application/json',
        ...(authenticated ? { 'Cf-Access-Jwt-Assertion': 'test-double' } : {}),
        'Idempotency-Key': key,
      },
      body: JSON.stringify(body),
    },
    bindings,
  );
}
it.each(['owner', 'admin', 'operator'])(
  'HTTP permits active %s with server-derived audit identity',
  async (role) => {
    f.database.prepare("UPDATE user_roles SET role_id=? WHERE user_id='owner'").run('role_' + role);
    const r = await post();
    expect(r.status).toBe(201);
    const body = await r.json<{ auditEventId: string }>();
    expect(
      f.database
        .prepare('SELECT actor_id,actor_role FROM audit_events WHERE id=?')
        .get(body.auditEventId),
    ).toEqual({ actor_id: 'owner', actor_role: role });
    expect((await post()).status).toBe(200);
  },
);
it.each(['viewer', 'inactive', 'no-membership', 'unauthenticated'])(
  'HTTP rejects %s without business writes',
  async (mode) => {
    if (mode === 'viewer')
      f.database.exec("UPDATE user_roles SET role_id='role_viewer' WHERE user_id='owner'");
    if (mode === 'inactive') f.database.exec("UPDATE users SET status='disabled' WHERE id='owner'");
    if (mode === 'no-membership') f.database.exec("DELETE FROM user_roles WHERE user_id='owner'");
    const before = snapshot(f),
      r = await post(f.edit, 'key', f.parentId, mode !== 'unauthenticated');
    expect([401, 403]).toContain(r.status);
    expect(snapshot(f)).toEqual(before);
  },
);
it('cross-workspace parent remains hidden', async () => {
  f.database.exec(
    "UPDATE access_identities SET workspace_id='other',user_id='other-user' WHERE id='identity-owner'",
  );
  const before = snapshot(f);
  expect((await post()).status).toBe(404);
  expect(snapshot(f)).toEqual(before);
});
it.each(['actor', 'role', 'artifactId', 'researchVersionIds', 'sourceType'])(
  'rejects client injection %s',
  async (field) => {
    const before = snapshot(f);
    expect((await post({ ...f.edit, [field]: 'injected' })).status).toBe(422);
    expect(snapshot(f)).toEqual(before);
  },
);
it.each(['', '   ', 'x'.repeat(201)])('requires valid key %s', async (key) => {
  const before = snapshot(f);
  expect((await post(f.edit, key)).status).toBe(422);
  expect(snapshot(f)).toEqual(before);
});
it.each([
  'research-v1',
  'new-idea-v1',
  'script-v1',
  'translation-v1',
  'critique-v1',
  'storyboard-v1',
])('rejects other artifact type %s', async (parent) => {
  const before = snapshot(f);
  expect((await post(f.edit, 'key', parent)).status).toBe(422);
  expect(snapshot(f)).toEqual(before);
});
it('reports sanitized transaction failure without orphan state', async () => {
  f.faults.failIndex = 4;
  const before = snapshot(f),
    r = await post();
  expect(r.status).toBe(500);
  expect(await r.text()).not.toContain('SQLite');
  expect(snapshot(f)).toEqual(before);
});
