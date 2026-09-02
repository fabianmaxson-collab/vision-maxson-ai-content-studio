# Cloudflare foundation

`wrangler.jsonc` is the repository source of truth for the Worker and Static Assets deployment. Dashboard-only configuration drift should be avoided.

The application has four named environments:

- `local`: local development through Wrangler.
- `preview`: isolated Cloudflare preview deployments when explicitly requested.
- `staging`: custom staging domain; external creation and deployment require owner approval.
- `production`: `vision.directormaxson.com`; deployment requires explicit owner approval.

Cloudflare Access, DNS, TLS, HSTS, DNSSEC, WAF and rate limiting are account-level controls and are documented in `docs/runbooks/cloudflare-access-setup.md`. This repository does not attempt to mutate them.

Resource bindings for D1, R2, Queues, Workflows and Durable Objects are intentionally absent in Phase 0.
