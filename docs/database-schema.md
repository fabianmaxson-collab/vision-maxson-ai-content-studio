# Phase 1 database schema

Database: `vision-maxson-data-staging` (`30385914-561a-42f9-9c81-381dc109e18c`), EU jurisdiction, binding `DB`, read replication disabled.

## Tables

- `workspaces`: tenant boundary.
- `users`: internal active/disabled identities with soft deletion.
- `roles`: reproducible owner/admin/operator/viewer seeds.
- `user_roles`: workspace-scoped assignments.
- `access_identities`: immutable Access issuer/subject mapping.
- `sessions`: internal session metadata; Access remains the login authority.
- `application_settings`: versioned validated settings.
- `feature_flags`: versioned switches for later approved phases.
- `audit_events`: structured append-only events.
- `d1_migrations`: Wrangler-managed migration ledger.

Application records use prefixed UUIDs. Seed identifiers are stable for idempotency. Timestamps are UTC ISO-8601 text and mutable records use integer `version` fields. Large assets, OAuth integrations and Phase 2 entities are intentionally absent.
