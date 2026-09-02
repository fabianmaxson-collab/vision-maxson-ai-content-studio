# D1 migrations and recovery runbook

## Forward migration

1. Review the Drizzle schema and ordered SQL migration together.
2. Apply locally with `pnpm db:migrate:local`.
3. Run `pnpm check` and `pnpm dry-run:staging`.
4. List remote pending migrations with `pnpm db:migrations:list:staging`.
5. After approval, apply with `pnpm db:migrate:staging`.
6. Re-list migrations and inspect schema and seed invariants with read-only D1 queries.

Never edit an applied migration; add the next numbered migration.

## Recovery

D1 migrations are forward-only. For a bad migration, stop deployment, record the incident, identify a safe D1 Time Travel point, and obtain Owner approval before restoration because newer data may be lost. Prefer a compensating forward migration where integrity permits. Validate any restore in a separate recovery database first. Production recovery always needs separate explicit approval.
