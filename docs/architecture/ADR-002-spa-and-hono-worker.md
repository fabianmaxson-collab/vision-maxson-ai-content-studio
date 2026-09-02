# ADR-002: React/Vite SPA and Hono API Worker

- Status: Accepted by Master Specification V1.1
- Scope: Phase 0 foundation

## Decision

Build the private frontend as a React/Vite SPA and the API as a Hono Cloudflare Worker. Deploy them together: Workers Static Assets serves the SPA and Worker-first routing sends `/api/*` to Hono on the same origin.

## Consequences

- The browser needs no cross-origin API configuration.
- Static assets remain edge-cached while API routes execute in the Worker.
- Cloudflare Access will protect the complete hostname externally; application identity and RBAC are implemented in Phase 1.
