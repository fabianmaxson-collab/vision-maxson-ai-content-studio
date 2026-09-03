# ADR-009 — Device-independent execution and mobile control

Status: **Accepted**

Decision date: 2026-09-03

Scope: future production execution and clients; documentation only at acceptance.

## Context

An approved production project must not depend on a browser tab or the Owner's computer remaining online. Supervision must remain useful across desktop, tablets, foldables and phones, while preserving a backend suitable for future native clients.

## Decision

Once production starts, closing the browser, losing connectivity, sleeping or shutting down the device must not cancel work. Persistent project/job state and execution belong to cloud infrastructure. The Owner can reconnect from another device and observe the same authoritative state.

The web UI remains responsive across desktop, laptop, tablet, narrow foldable cover displays, unfolded foldables and mobile phones. Desktop remains preferred for complex editing, but smaller devices must support meaningful supervision and control.

Business logic, authorization, state transitions and audit stay behind shared cloud APIs rather than being coupled to React/web state. This preserves future iOS/iPadOS and Android clients using the same backend, projects, jobs, security and data. Native biometrics, push notifications and share/export are possible future client features, not current commitments.

Future responsive/mobile controls include Approve, Reject, Regenerate, Pause, Resume, Cancel and Publish when their phases authorize them. Current web confirmation policy is:

- **Pause:** single confirmation/action;
- **Resume:** double confirmation because resource consumption resumes;
- **Cancel:** double Spanish-first confirmation with an explicit irreversible warning.

No biometric requirement applies to the current web client. Authentication and privileged authorization remain server-side.

## Consequences

- Client disconnect is not a cancellation signal.
- APIs and persistent job state are the source of truth for every client.
- Mobile views must avoid unnecessary heavy downloads and preserve accessible touch targets.
- This ADR does not create cloud orchestration or native-app resources.
