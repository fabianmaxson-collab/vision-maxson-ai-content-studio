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

Application records use prefixed UUIDs. Seed identifiers are stable for idempotency. Timestamps are UTC ISO-8601 text and mutable records use integer `version` fields. Large assets and OAuth integrations remain intentionally absent.

## Phase 2 forward-only extension

Migration `0001_phase_2_product_channel_monetization.sql` adds 25 tables without altering Phase 1 tables:

- Global catalogs: `platforms`, `monetization_objectives`, `platform_monetization_programs`, `platform_monetization_rule_versions`, `platform_strategy_rule_versions`.
- Brand/channel: `voice_profiles`, `character_profiles`, `character_profile_versions`, `content_brands`, `channel_profiles`, `channel_profile_platforms`, `channel_profile_characters`, `channel_bibles`.
- Accounts: `social_accounts`, `social_account_monetization_statuses`.
- Projects: `projects`, `project_objectives`, `project_targets`, `project_variants`, `language_variants`, `project_parameters`, `project_parameter_revisions`, `project_dependencies`.
- Decisions: `monetization_eligibility_assessments`, `opportunity_assessments`.

External platform rules and internal strategy rules are immutable, independently versioned models. Social accounts are reference-only and contain no credentials. Business deletion is logical. Projects start in canonical `DRAFT`, use `ASSISTED` by default, and always receive one reusable master variant.
