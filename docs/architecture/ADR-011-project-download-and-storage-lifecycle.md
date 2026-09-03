# ADR-011 — Project download, managed ingest and storage lifecycle

Status: **Accepted**

Decision date: 2026-09-03

Scope: future asset, handoff, publishing and cleanup phases; documentation only at acceptance.

## Context and authority

The V1 workflow requires a downloadable editing handoff, manual final assembly and a returned Final Master. This ADR makes that future lifecycle discoverable and records an explicit Owner override to the Master Specification V1.1 Final Master retention rule.

The approved 14/30-day defaults below supersede the former general minimum of 90 days or permanent for Final Masters. Ninety days, permanent retention and custom periods remain supported preservation policies rather than the mandatory default. The existing 30-day Drive recovery period for deleted objects is unchanged and is conceptually separate from active-asset retention.

This decision does not alter the original DOCX; it is the later, traceable Owner-approved decision governing future implementation.

## Download package identity

A downloadable project package and its user-facing folder use the human-readable project title, for example `El misterio de la ciudad perdida`. The package may contain generated clips, narration, sound and other editing assets.

Machine association must never depend only on the visible title or filename. A manifest or equivalent metadata must preserve the immutable `project_id` and relevant asset/version identifiers so duplicate titles and later title changes remain unambiguous.

## Manual Final Master return

The intended workflow is:

```text
Vision Maxson project generated
→ Owner downloads the project package
→ Owner edits externally and completes subtitles/final assembly
→ Owner exports a Final Master using the human-readable project title
→ Owner places it in an explicitly configured Vision Maxson local ingest folder
→ Vision Maxson associates it through project metadata/project_id
→ a future publishing workflow consumes the verified Final Master
```

The title is a human convention, not a filename-only identity mechanism.

## Local managed-folder boundary

Vision Maxson deletion authority is restricted to the explicitly configured managed local ingest folder. It must never delete arbitrary files elsewhere on the Owner's computer. A copy manually downloaded or moved outside the managed directory remains outside Vision Maxson lifecycle control and is untouched by cloud or managed-folder cleanup.

A returned Final Master remains in the managed ingest folder until publication is reliably confirmed. Only `PUBLISHED_CONFIRMED`, or a future canonical equivalent backed by reliable remote evidence, starts the 24-hour local cleanup timer. Attempted, failed, scheduled or externally unverified publication is insufficient.

Local cleanup requires the local device or a future approved local agent to be available. Cloud retention and cleanup should execute independently of whether the Owner's computer is powered on.

## Active retention defaults

Retention is lifecycle- and dependency-aware:

- Intermediate/generated production assets: maximum default of 5 days once expendable.
- Published short-form Final Masters, including Shorts, Reels, TikTok and equivalent formats: 14 days in Google Drive.
- Published long-form Final Masters: 30 days in Google Drive.

Elapsed time alone never authorizes unsafe deletion. Assets remain while required by active production, manual editing, recovery, retry/regeneration, publication, a valid dependency or an explicit preservation rule.

## Preservation and deletion safety

Channel Profile, project, asset or an explicit `KEEP`, `PRESERVE` or `LOCKED` action may extend retention to 90 days, a custom period or indefinitely/permanently. Explicit preservation always takes precedence over automatic cleanup.

Cleanup must follow the Master Specification safety controls: policy-driven eligibility, dry-run capability, recoverable trash before permanent deletion and an audit event for permanent deletion. The existing default 30-day recovery period for deleted Drive objects remains unchanged.

## Download-link lifecycle

A download link is available only while its underlying authorized assets exist. Once eligible assets are purged, the link must disappear or become unavailable cleanly; the Spanish-first UI should present an honest state such as **Descarga expirada**, never a broken link.

Cloud deletion must not reach a copy previously downloaded to an arbitrary local folder.

## Storage roles

- Owner computer: temporary working and editing storage.
- Google Drive: managed temporary/retention storage governed by lifecycle policy.
- Published platforms: distribution destinations, not automatic disaster recovery.
- Future server/cloud storage: only the material required by separately approved architecture.

## Consequences and implementation boundary

Future implementation must model asset identity, lifecycle events, dependencies, preservation overrides, download availability, publication confirmation and deletion auditability explicitly. Retention jobs must not be blind timers.

This ADR does not implement a file watcher, local deletion, Drive operation, retention job, Workflow, Queue, Durable Object, KV, R2 resource, schema migration, provider connection or deployment. It does not modify D1, Cloudflare, staging or production and does not start Phase 4.
