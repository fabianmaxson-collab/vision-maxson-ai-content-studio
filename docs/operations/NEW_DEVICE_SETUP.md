# Vision Maxson — New Device Setup

## Purpose

This runbook covers a new phone, tablet, laptop, or desktop used primarily to access Vision Maxson as a product.

It is **not** the full development-workstation rebuild. For that, use `WORKSTATION_RECOVERY.md`.

## Target experience

A normal new device should require only:

1. Open a supported browser.
2. Go to `vision.directormaxson.com`.
3. Sign in through the approved identity provider.
4. Complete MFA when required.
5. Register the session/device.
6. Optionally name the device.
7. Mark it trusted only when appropriate.
8. Enter Vision Maxson.

No project migration, database copy, API-key entry, media copy, or local repository setup should be necessary.

## Expected future device-management UI

Canonical product location:

`Configuración → Permisos y seguridad → Dispositivos`

Expected capabilities:

- list registered devices/sessions;
- show browser and operating system;
- show registration time and last activity;
- show approximate IP-derived country/region without invasive GPS tracking;
- show `Trusted / Untrusted / Revoked`;
- revoke one device;
- sign out all other devices;
- require reauthentication / MFA for sensitive changes;
- notify the owner of a new-device login;
- allow “This was me” / “Revoke access” style response.

## Planned replacement flow

When replacing an old device:

1. Register the new device.
2. Confirm Vision Maxson access works.
3. Confirm required MFA/recovery methods are available.
4. Open `Configuración → Permisos y seguridad → Dispositivos`.
5. Revoke the retired device if it should no longer have access.

## Lost old device

If the previous device is lost or stolen, do not use this runbook alone. Start with `SECURITY_INCIDENT.md`, then use this runbook for the replacement device.

## Cloud continuity

The server is the source of truth. A new device should see the same projects, jobs, renders, approvals, costs, analytics, integrations, and publication state as any other authorized device.

For cloud jobs already accepted by Vision Maxson, closing the browser, switching devices, losing local Internet temporarily, or powering off the original device must not stop the server-side job.
