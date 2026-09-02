# ADR-003: D1 canonical data and application RBAC

Status: Accepted by Master Specification V1.1 and Phase 1 approval.

Cloudflare D1 is the canonical relational store. The Drizzle TypeScript schema and ordered SQL files in `packages/db/migrations` are the reproducible schema source. Tenant-owned records carry `workspace_id`; mutable records carry timestamps and a version, and business records support soft deletion.

Cloudflare Access remains the outer authentication gate. The Worker cryptographically validates its JWT against the configured team issuer and application AUD, then maps `(issuer, subject)` to an active internal user. Application permissions are centrally denied by default.

The roles are `owner`, `admin`, `operator`, and `viewer`. **`operator` is the functional equivalent of the `Editor` role named in Master Specification V1.1.** This preserves the approved semantics.

Audit events are append-only; database triggers reject update and delete. Owner bootstrap is server-only, idempotent, and enabled only by configuration. It accepts only a verified Access JWT whose normalized email exactly matches the configured secret. The frontend cannot supply an email or role.

Production has no D1 binding until separately approved. Staging keeps its current 24-hour Access session. OAuth integrations remain out of scope; only the AES-256-GCM primitive is implemented.
