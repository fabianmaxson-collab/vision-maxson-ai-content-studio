# Cloudflare staging and Access setup

This runbook describes owner-operated external work. Do not execute it without explicit approval.

## Required owner inputs

- Cloudflare account and zone containing `directormaxson.com`.
- Confirmed staging hostname: `staging.vision.directormaxson.com`.
- Cloudflare Zero Trust team domain.
- Owner email address to allowlist.
- Google identity provider configured in Cloudflare Access.

## Staging sequence

1. Review the proposed staging hostname and Wrangler configuration.
2. Authenticate Wrangler with a least-privilege Cloudflare token or approved interactive login.
3. Create a self-hosted Cloudflare Access application for the staging hostname.
4. Add an allow policy for the explicit Owner identity.
5. Require identity-provider MFA for Owner/Admin and use a short session duration.
6. Run `pnpm check` locally or in CI.
7. With explicit approval, run `pnpm deploy:staging`.
8. Verify that an unauthenticated browser is stopped by Access.
9. Authenticate as Owner and verify the SPA and `/api/v1/health`.
10. Record the deployment version and rollback target.

## Security sequence after validation

- Enable strict TLS and then HSTS only after every required hostname is confirmed operational.
- Enable DNSSEC according to the zone change procedure.
- Apply managed WAF rules and conservative rate limits after observing staging behavior.
- Do not expose preview URLs for staging or production.

Application-side Access JWT validation and RBAC are Phase 1 work and are not implemented here.
