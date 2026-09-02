# ADR-001: Cloudflare-first modular monolith

- Status: Accepted by Master Specification V1.1
- Scope: Phase 0 foundation

## Decision

Use TypeScript end-to-end and begin with a modular monolith on Cloudflare Workers. Keep domain boundaries explicit so internal Workers and service bindings can be introduced only when operational evidence justifies separation.

## Consequences

- One operational platform and one initial deployable reduce maintenance.
- External services may only enter through approved, versioned adapters in later phases.
- Phase 0 creates no database, queue, workflow, durable object, asset store, or provider integration.
