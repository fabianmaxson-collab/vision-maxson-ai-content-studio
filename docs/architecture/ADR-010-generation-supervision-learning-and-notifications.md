# ADR-010 — Generation supervision, protected edits, learning and notifications

Status: **Accepted**

Decision date: 2026-09-03

Scope: future media-generation and supervision phases; documentation only at acceptance.

## Generation monitoring

Preview geometry follows the actual format: `SHORT` uses 9:16, `LONG_FORM` uses 16:9, and future formats use their real aspect ratio. Preview assets are lightweight supervision assets, not forced full-quality production downloads.

Dashboards should emphasize overall progress, completed/active scene counts, representative thumbnails and a **Ver todas las escenas** action. Mobile clients must not automatically download every heavy clip. Playback and actions such as **Reproducir**, **Modificar** and **Regenerar** appear only after a real clip exists; fabricated previews are prohibited.

## Prompt-based clip modification and protection

The Owner will be able to modify an existing generated clip through natural-language instructions while preserving scene context, source-clip relationship, original provenance, Character Bible/version, continuity and prior prompt/parameters where relevant. Edit-capable workflows should model this as a derived version rather than an unrelated clip.

After an Owner-modified/replaced clip is approved, that exact version is protected from ordinary automatic replacement. A material upstream change may mark it stale or review-required, but may not silently overwrite it. Approved final clips remain available for export/download.

## Creative preference learning

Vision Maxson may aggregate evidence from repeated Owner corrections, rejections and modifications. An inferred pattern never silently becomes `LOCKED`. The lifecycle is:

```text
pattern detected
→ evidence accumulated
→ recommendation presented
→ Owner accepts, rejects or modifies
→ accepted preference becomes persistent configuration
```

Preference scope is `GLOBAL`, `CONTENT_BRAND` or `CHANNEL`; channel evidence must not contaminate unrelated channels.

## Decision provenance

Future history must reconstruct, where applicable, selected provider/model, rejected alternatives, rationale, quota state, cost, retry/failover, QC result, Owner modification, version graph and final accepted result. This supports audit, debugging, optimization, Provider Intelligence and learning without placing secrets or complete sensitive payloads in logs.

## Notification philosophy

Notifications use three severities:

- `INFO`: history/dashboard only by default, including successful retries and routine routing changes;
- `ATTENTION`: useful notice while work continues, including completion, low reliable quota or a useful benchmark;
- `ACTION_REQUIRED`: rare interruption when Owner input is genuinely required, such as projected project cost above 115% without an acceptable alternative, exhaustion of valid providers, an unsatisfied `LOCKED` requirement, an account/policy blocker or a critical conflict.

## Consequences and boundary

Supervision is truthful, bandwidth-aware and versioned. Learning remains explainable and Owner-controlled. This ADR authorizes no media generation, provider connection, storage/orchestration resource, migration or deployment.
