# Vision Maxson — Primary Workstation Recovery

## Purpose

Reconstruct the primary Windows development workstation used to build and operate Vision Maxson after:

- theft or loss;
- hardware/SSD failure;
- planned replacement;
- clean Windows reinstall;
- migration to a more powerful computer.

The procedure must not depend on access to the old machine.

## Recovery objective

The final state is objective and verifiable:

```text
Windows                  READY
PowerShell               READY
Git                      READY
GitHub authentication    READY
Node.js                  READY
pnpm                     READY
Repository               READY
Dependencies             READY
pnpm check               PASS
Antigravity              READY
Agnes Code               READY
Codex                    READY
Cloudflare tooling       READY
Cloudflare auth          READY
Audiovisual local tools  VERIFIED
STAGING access           VERIFIED

WORKSTATION_READY = YES
```

Exact versions and install sources must be taken from the repository/runtime requirements and current vendor documentation at recovery time, not from stale assumptions in this file.

## A. If the old workstation was lost or stolen

Run `SECURITY_INCIDENT.md` first.

Do not begin by cloning repositories onto the new machine while an obviously compromised old device still has active sessions.

## B. Prepare Windows

1. Complete Windows setup and security updates.
2. Install current device/chipset/GPU/network drivers as appropriate.
3. Enable disk encryption and normal OS security controls where supported.
4. Install/verify PowerShell 7.
5. Install/verify Git.
6. Install the repository-required Node.js version.
7. Install/verify pnpm.
8. Install/verify any local audiovisual runtime required by current Vision Maxson development, such as FFmpeg/Remotion dependencies when the repository actually requires them.

A future `bootstrap-windows.ps1` should automate the safe, non-secret portion after the workstation manifest has been audited.

## C. Authenticate protected developer services

Authentication is interactive and must not be stored in scripts.

Verify access to the currently approved services used by the project, including as applicable:

- GitHub;
- Cloudflare / Wrangler;
- Antigravity;
- Agnes Code;
- Codex;
- approved identity provider;
- any additional developer service documented in `DEVELOPMENT_ENVIRONMENT.md`.

Do not copy credentials from the old PC by placing them in Git, chat, scripts, browser local storage exports, or public files.

## D. Restore the repository

GitHub is the durable source of source code.

1. Authenticate GitHub.
2. Clone `fabianmaxson-collab/vision-maxson-ai-content-studio`.
3. Checkout the canonical branch required by the current workflow.
4. Install dependencies using the repository package manager.
5. Run the complete repository verification gate:

```text
pnpm install
pnpm check
```

The exact install command may include the repository's frozen-lockfile policy when appropriate.

Do not proceed to deployment or provider execution if the repository gate is not green.

## E. Restore AI development tools

The primary development workstation must be able to use the approved coding agents/tools needed for the current project workflow.

Required by current owner workflow:

- Antigravity;
- Agnes Code;
- Codex.

For each tool, the future workstation manifest must document:

- official installation source;
- authentication method;
- required permissions/settings;
- repository access;
- terminal/shell integration where applicable;
- verification procedure.

Known Antigravity operating preferences for the current project include Full Access, terminal command auto-execution set to Always Proceed, and Shell Integration enabled. These settings must still be reviewed against current product capabilities and security policy when rebuilding.

Do not hard-code obsolete vendor-specific installation steps here. Update `DEVELOPMENT_ENVIRONMENT.md` when a tool or installation method changes.

## F. Restore Cloudflare development access

1. Verify Wrangler/tooling required by the repository.
2. Authenticate interactively.
3. Verify access to the correct Vision Maxson account/resources.
4. Confirm STAGING configuration is visible.
5. Do **not** modify Production merely to prove workstation recovery.
6. Do **not** reconnect automatic Git deployment unless that is separately approved by current deployment policy.

Secrets remain server-side in approved secret stores. They are not recovered by copying them into the workstation repository.

## G. Verify local audiovisual tooling

Audit the current repository and actual production workflow before installing local media tooling.

Examples that may be required by the project include:

- Remotion;
- FFmpeg;
- browser/runtime dependencies used by media tooling.

The workstation should only install tools that the current Vision Maxson architecture actually uses locally.

Cloud-first product execution must remain conceptually separate from development-only local rendering.

## H. Final verification

The future `verify-workstation.ps1` should check:

- expected command availability;
- supported runtime versions;
- Git authentication/repository access;
- clean repository checkout;
- dependency install;
- `pnpm check`;
- developer-tool presence where machine-readable;
- Wrangler availability/auth state where safely inspectable;
- local media-tool availability;
- STAGING reachability without writing to Production.

It should report a deterministic result:

`WORKSTATION_READY = YES / NO`.

## I. Planned replacement vs. incident recovery

For a planned replacement, perform this runbook first and revoke/retire the old workstation after the new machine passes verification.

For a theft/loss event, revoke the old workstation and affected sessions first, evaluate credential exposure, then execute this runbook.

## J. Prohibited recovery shortcuts

Never:

- commit secrets;
- copy a plaintext API-key archive into the repository;
- put passwords in bootstrap scripts;
- assume the old PC is the only source of project state;
- bypass MFA/recovery controls;
- deploy to Production as a workstation health check;
- reuse an ambiguous or already-consumed provider idempotency key merely because the machine changed.
