# Phase 3 provider connectivity diagnostic

This diagnostic is a provider-neutral administrative capability at:

`POST /api/v1/admin/ai/providers/:providerId/connectivity-check`

It requires a Cloudflare Access identity provisioned as Owner or Admin, the normal
same-origin mutation check, `ENVIRONMENT=staging`,
`AI_PROVIDER_CONNECTIVITY_DIAGNOSTIC_ENABLED=true`, and the provider-specific
runtime enablement and credential. Production always rejects the diagnostic.

The service reads the requested provider and the approved diagnostic model from the
catalog. It does not change provider/model status, create an Intelligence Run, create
an editorial artifact, or retain the synthetic output. Its audit event contains only
provider/model identifiers, normalized usage, calculated cost when complete pricing
is available, outcome, and safe failure code.

The OpenAI adapter uses the Responses API with `store:false`,
`gpt-5.6-luna`, reasoning effort `none`, strict `{"ok":true}` output, no tools,
a 128-token output ceiling, one attempt, no SDK retry, and a 30-second timeout.
Provider SDK types and raw failures remain inside the provider package.

## Controlled staging activation

The remote Phase 3 OpenAI catalog seed is already applied. Do not apply it again.

1. Commit reviewed code and require green CI.
2. Create a pending staging candidate from the current approved code.
3. Attach `OPENAI_API_KEY` to that candidate through Cloudflare's masked
   interactive secret input. Never place it in source, arguments, logs, or docs.
4. Enable only `OPENAI_PROVIDER_ENABLED` and
   `AI_PROVIDER_CONNECTIVITY_DIAGNOSTIC_ENABLED` for the staging candidate.
5. Deploy or activate the candidate only under separate Owner authorization.
6. Execute exactly one connectivity request for `provider_openai`.
7. Inspect returned real usage and cost. A missing or incomplete pricing/usage basis
   returns `cost:null`.
8. After success, explicitly transition the provider and selected model operational
   state in a separately controlled action. The diagnostic never performs it.
9. Disable the diagnostic flag and proceed to the authenticated editorial E2E.

Production, unrelated Workers, Access, DNS, SSL/TLS, migrations, and remote D1 are
outside this procedure.
