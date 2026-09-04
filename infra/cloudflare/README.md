# Cloudflare foundation

Phase 1 staging uses D1 `vision-maxson-data-staging` through binding `DB`. Production intentionally has no database binding. Follow the D1 migration/recovery and Phase 1 secret/bootstrap runbooks before changing database or secret configuration.

`wrangler.jsonc` is the repository source of truth for the Worker and Static Assets deployment. Dashboard-only configuration drift should be avoided.

The application has four named environments:

- `local`: local development through Wrangler.
- `preview`: isolated Cloudflare preview deployments when explicitly requested.
- `staging`: custom staging domain; external creation and deployment require owner approval.
- `production`: `vision.directormaxson.com`; deployment requires explicit owner approval.

Cloudflare Access, DNS, TLS, HSTS, DNSSEC, WAF and rate limiting are account-level controls and are documented in `docs/runbooks/cloudflare-access-setup.md`. This repository does not attempt to mutate them.

Resource bindings for D1, R2, Queues, Workflows and Durable Objects are intentionally absent in Phase 0.

## Staging release guard

GitHub CI validates only. Cloudflare Workers Builds may build main, but its Deploy command must be `npx wrangler versions upload` so a push cannot change staging traffic.

Require clean main, `main == origin/main`, green CI, and the full source SHA. Create a candidate with:

    pnpm staging:candidate -- <SOURCE_SHA>

Append `--enable-openai-connectivity` only for an Owner-approved connectivity candidate. Record its Version ID and inspect it with `wrangler versions view <VERSION_ID> --json`. Verify SHA, environment, D1, secret names, and flags without reading secret values.

After Owner approval, promote only the exact version:

    pnpm staging:promote -- <AUTHORIZED_VERSION_ID>

Immediately list deployments and confirm 100% traffic. Recheck after Workers Builds completes; any other active Version ID is drift and stops the release. Never rebuild between approval and promotion.
