# Coding standards

- TypeScript strict mode is mandatory.
- Domain boundaries must not depend directly on provider SDKs.
- Validate data at trust boundaries; Phase 1 introduces shared Zod contracts.
- Do not log secrets, tokens, authorization headers, or sensitive prompt content.
- Use structured errors and stable HTTP status codes.
- Every behavior change requires proportionate automated tests.
- Keep environment-specific values in Wrangler configuration and secrets outside Git.
- Use Conventional Commit-style subjects when the repository history begins.
- `main` is the intended releasable branch; production promotion requires explicit approval.
