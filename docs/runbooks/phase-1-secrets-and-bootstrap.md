# Phase 1 secrets and Owner bootstrap

Normal staging variables are `ACCESS_TEAM_DOMAIN`, the existing Access `ACCESS_AUD`, `APP_ORIGIN`, and `OWNER_BOOTSTRAP_ENABLED`. The last is `true` only for controlled bootstrap.

Worker secrets are `BOOTSTRAP_OWNER_EMAIL` and `TOKEN_ENCRYPTION_KEY` (32 random bytes, base64 encoded). Values must never be committed, printed or included in audit events.

## Controlled bootstrap

1. Deploy only after explicit approval.
2. Sign in through existing Access application `staging.vision` as the authorized Owner.
3. Call `/api/v1/me`; verify the exact email and `owner` role.
4. Verify `/api/v1/system/bootstrap-status` reports `ownerPresent=true`.
5. Verify one active Owner assignment and the bootstrap audit event in D1.
6. Set `OWNER_BOOTSTRAP_ENABLED=false`, dry-run, obtain approval, and deploy that configuration.
7. Confirm the Owner remains and new unprovisioned identities are denied.

Never add a bootstrap form or accept an email or role from frontend input.
