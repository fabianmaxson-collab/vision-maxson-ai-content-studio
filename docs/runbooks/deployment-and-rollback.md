# Deployment and rollback

## Local verification

```sh
pnpm install --frozen-lockfile
pnpm check
```

## Staging

Staging deployment is an external action and requires explicit owner approval:

```sh
pnpm deploy:staging
```

After deployment, check Cloudflare Access, the application shell, and `GET /api/v1/health`.

### Current deployment target warning

As verified on 2026-09-03, `staging.vision.directormaxson.com` targets Worker `vision-maxson-ai-content-studio`, while `infra/cloudflare/wrangler.jsonc` declares the staging Worker as `vision-maxson-studio-staging`.

Do not run `pnpm deploy:staging` until the repository target and deployed Worker name have been aligned through an explicitly approved Phase 0 configuration correction. Running it in the current state would target a second Worker rather than update the verified staging deployment.

## Production

Production requires passing checks, reviewed configuration, and explicit approval. Use Cloudflare deployment versions and rollback controls to promote or restore a known-good build. Never copy staging secrets into production.
