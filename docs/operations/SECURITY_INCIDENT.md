# Vision Maxson — Lost / Stolen Device Security Incident

## Purpose

Use this runbook when a phone, tablet, laptop, or primary development workstation is lost, stolen, or reasonably suspected to be compromised.

## Immediate objective

Remove the missing device as an authorized control surface without destroying cloud project state.

Cloud projects, jobs, media, metadata, integrations, and audit history must remain server-side.

## 1. Use a trusted replacement device

From another trusted device, authenticate to Vision Maxson through the approved identity provider and MFA/recovery mechanism.

Future canonical UI:

`Configuración → Permisos y seguridad → Dispositivos`

## 2. Revoke the missing device

- locate the lost device/session;
- revoke access;
- if there is uncertainty about which session belongs to the device, use “Sign out all other devices”;
- record the security action in the central audit trail.

A revoked device must be rejected on subsequent authenticated API requests even if a browser tab remains open.

## 3. Review related identity/provider sessions

For a lost **development workstation**, assess whether sessions for the following were present and revoke them when appropriate:

- GitHub;
- Cloudflare;
- approved identity provider;
- Antigravity;
- Agnes Code;
- Codex;
- Google or other connected service accounts used interactively.

The correct action is revocation/rotation based on actual exposure. Do not rotate every unrelated provider secret automatically.

## 4. Evaluate secret exposure

Vision Maxson's target security model keeps provider/API secrets server-side, not inside frontend JavaScript, public files, GitHub source, or browser databases.

If the missing machine contained an exceptional local secret or credential, rotate/revoke that specific credential.

Document what was rotated and why.

## 5. Protect the owner account

Where risk warrants it:

- confirm MFA/recovery factors;
- change the identity-provider password;
- revoke suspicious sessions;
- review recent login/security notifications;
- use step-up authentication for sensitive account changes.

## 6. Check audit evidence

Review, when implemented:

- device/session creation;
- session revocation;
- security-setting changes;
- integration changes;
- provider dispatches;
- publishing actions;
- other sensitive actions after the estimated loss time.

Do not expose personal email/name in normal product UI merely to provide auditability; identity details belong in protected security/admin contexts.

## 7. Replace the device

For normal product access, follow `NEW_DEVICE_SETUP.md`.

For a replacement primary development machine, follow `WORKSTATION_RECOVERY.md`.

## Required future security capabilities

Vision Maxson must eventually provide:

- Device Registry;
- active-session management;
- per-device revoke;
- sign out all other devices;
- trusted/untrusted/revoked states;
- new-device alerts;
- MFA and granular step-up authentication;
- recovery workflow;
- session expiration/inactivity policy;
- immediate invalidation of revoked sessions.

No invasive GPS requirement is needed; approximate IP-derived region/device metadata is sufficient for normal security context.
