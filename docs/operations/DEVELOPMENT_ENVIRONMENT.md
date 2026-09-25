# Vision Maxson — Development Environment Manifest

## Purpose

Maintain the recovery-relevant definition of the primary Vision Maxson development workstation.

This file is an operational manifest, not a secret store.

## Current platform direction

- Primary developer operating system: Windows 11.
- Primary repository: `fabianmaxson-collab/vision-maxson-ai-content-studio`.
- Repository package workflow: Node.js + pnpm, as defined by the repository.
- Terminal/shell: PowerShell 7 is part of the current owner workflow.
- Source control: Git + GitHub.
- Cloud tooling: Cloudflare tooling/Wrangler as required by the repository.
- Development AI tools required by the owner workflow:
  - Antigravity;
  - Agnes Code;
  - Codex.
- Local audiovisual tooling: audit against the active repository/workflow before locking exact requirements; Remotion and FFmpeg-related capabilities may be required.

## Important distinction

These developer tools are **not** runtime dependencies that a normal Vision Maxson user must install.

Normal product access is browser-based and follows `NEW_DEVICE_SETUP.md`.

This manifest exists only to rebuild the development/operations workstation.

## Manifest rules

Before implementing a bootstrap script, audit and record:

1. exact supported Node.js version/range;
2. exact pnpm requirement;
3. Git requirement;
4. PowerShell requirement;
5. Cloudflare/Wrangler requirement;
6. Antigravity installation source and current settings;
7. Agnes Code installation source and current settings;
8. Codex installation source and current settings;
9. required local media/runtime binaries;
10. required browser;
11. optional IDE/editor dependencies;
12. repository clone path conventions;
13. machine-readable verification commands.

## Known project-specific developer settings

Antigravity is currently used as the primary coding agent while Codex is conserved as a limited reserve. Current owner preferences include:

- Full Access;
- Terminal Command Auto Execution: Always Proceed;
- Shell Integration: ON.

Those settings are operational context, not a justification to bypass project safety gates. Agents must still obey repository guardrails, STAGING-first policy, Production approval requirements, no-blind-retry rules, and secret-handling rules.

## Secrets

Never store in this file or future bootstrap scripts:

- passwords;
- API keys;
- OAuth refresh tokens;
- Cloudflare account tokens;
- provider bearer tokens;
- private recovery codes.

The workstation recovery process should authenticate interactively to protected services and rely on server-side secrets/configuration where the Vision Maxson architecture provides it.

## Future automation contract

After auditing the real workstation, implement:

### `scripts/workstation/bootstrap-windows.ps1`

Responsibilities:

- install/verify safe local dependencies;
- make repeated execution idempotent where practical;
- never embed secrets;
- stop and request user authentication when required;
- produce a machine-readable summary.

### `scripts/workstation/verify-workstation.ps1`

Responsibilities:

- verify required commands and versions;
- verify repository health;
- run `pnpm check`;
- verify approved developer tools where safely detectable;
- verify Cloudflare developer tooling/auth without Production mutation;
- verify local audiovisual dependencies;
- output `WORKSTATION_READY = YES / NO`.

### `scripts/workstation/diagnose-workstation.ps1`

Responsibilities:

- explain missing requirements;
- distinguish installation failures from authentication failures;
- avoid destructive repairs by default;
- never print secret values.

## Change policy

Whenever Vision Maxson adds, removes, or replaces a development tool that is required to rebuild the primary workstation, update this manifest and the recovery runbook in the same change set.

The owner must not be expected to remember historical setup instructions from chat.
