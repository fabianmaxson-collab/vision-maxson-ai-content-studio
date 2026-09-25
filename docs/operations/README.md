# Vision Maxson Operations & Recovery Canon

This directory is the canonical operational reference for device onboarding, account recovery, lost/stolen-device response, and reconstruction of the Vision Maxson development workstation.

## Core principle

Vision Maxson is a cloud-first production infrastructure. User devices are control surfaces; projects, jobs, state, media metadata, permissions, and durable system records must not depend on one personal computer.

Two recovery problems are intentionally separated:

1. **Product access recovery** — regain secure access to `vision.directormaxson.com` from a new or replacement device.
2. **Development workstation recovery** — rebuild the Windows development environment used to develop and operate Vision Maxson.

## Canonical runbooks

- `NEW_DEVICE_SETUP.md` — quick onboarding for a new phone, tablet, or normal access computer.
- `WORKSTATION_RECOVERY.md` — full rebuild of the primary Vision Maxson development workstation.
- `SECURITY_INCIDENT.md` — lost/stolen-device and suspected-compromise response.
- `DEVELOPMENT_ENVIRONMENT.md` — required workstation capabilities, tool inventory, and verification rules.

## Product requirements

- A new normal-access device must be usable in minutes: browser → login → MFA → device registration/trust → Vision Maxson.
- A replacement development workstation must be recoverable from documented steps without relying on the lost computer.
- The workstation recovery process must be reproducible, auditable, and partially automatable.
- No API keys, passwords, OAuth refresh tokens, or other secrets may be committed to the repository or embedded in bootstrap scripts.
- GitHub is the durable source for source code; the workstation is a disposable working copy.
- Cloud jobs already accepted by Vision Maxson must not depend on the browser remaining open or on the workstation staying powered on.
- Device/session revocation, trusted-device management, step-up authentication, recovery, and new-device alerts are required future account-security capabilities.

## Future automation

A later implementation phase should add, after auditing the current machine and exact vendor installation methods:

- `scripts/workstation/bootstrap-windows.ps1`
- `scripts/workstation/verify-workstation.ps1`
- `scripts/workstation/diagnose-workstation.ps1`

Those scripts must install or verify only non-secret local tooling and must pause for explicit interactive authentication when GitHub, Cloudflare, AI development tools, or other protected services require login.

Do not invent installation commands, versions, package sources, or secret-handling behavior. Audit current vendor guidance and the active workstation before locking the bootstrap implementation.
