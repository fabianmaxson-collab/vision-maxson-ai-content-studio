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

## Production

Production requires passing checks, reviewed configuration, and explicit approval. Use Cloudflare deployment versions and rollback controls to promote or restore a known-good build. Never copy staging secrets into production.
