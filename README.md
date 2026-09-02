# VISION MAXSON AI CONTENT STUDIO

Cloudflare-first TypeScript monorepo for the private VISION MAXSON application. This repository is being implemented phase-by-phase from the approved Master Specification V1.1.

## Phase 0 commands

Prerequisites: Node.js 22+, Corepack, and pnpm 10.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm dev
```

The local Worker serves the built React SPA and the API from one origin. The health endpoint is `GET /api/v1/health`.

Environment deployment commands exist for preview, staging, and production. They intentionally require an authenticated Cloudflare account and configured routes before they can change external infrastructure.

## Repository boundaries

- `.dev.vars` files and all secrets are ignored.
- Production deployment requires explicit owner approval.
- Phase 0 contains no D1 schema, RBAC, encryption, queues, workflows, provider integrations, or production credentials.
- Architecture and operational notes live under `docs/`.
