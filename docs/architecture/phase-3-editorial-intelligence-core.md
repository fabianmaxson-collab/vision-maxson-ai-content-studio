# Phase 3 editorial intelligence core

Status: implemented locally; remote migration and deployment not authorized.

## Scope and authority

ADR-007 resegments Phase 3 as AI Intelligence & Editorial Planning Core while preserving the Master Specification obligations. ADR-005 governs Spanish-first UI/review locales and ADR-006 governs browser-only Review Read-Aloud. The Master Specification remains unchanged.

## Artifact and version model

`editorial_artifacts` owns identity, type, lifecycle and the current-version pointer. `editorial_artifact_versions` is immutable and stores exact parent, language, bounded text/JSON, source type, optional intelligence-run/source-script linkage, creator, word count, timing reference and deterministic SHA-256 content hash. Human edits create new versions; historical and approved versions are never overwritten.

Dependencies identify exact source and dependent versions. Replacing an upstream current version atomically marks downstream links as `STALE`, `INVALIDATED`, `REGENERATION_REQUIRED` or `REAPPROVAL_REQUIRED`; history is retained. Approvals are append-only and version-specific. Ordinary editorial approval is available to owner/admin/operator; viewer is read-only.

Research claims classify evidence as `OBSERVED`, `AI_INFERENCE` or `UNKNOWN`; observed claims require a source. Ideas, briefs, critiques, script segments, storyboard scenes, narration-rate profiles and preflight checks are structured without fabricated content.

## Readiness and timing

The deterministic timing engine receives versioned Phase 2 external rules and internal strategy values as inputs. No TikTok duration is hardcoded. Missing inputs remain `UNKNOWN`; external-rule violations block, while strategy/timing mismatches warn.

`READY_FOR_GENERATION` is derived only when the project remains in `PREFLIGHT_REVIEW`, the current preflight passes and all required current versions and approvals are valid. It is not a canonical project status; `GENERATING` remains unavailable.

## Provider-neutral execution

`packages/providers` defines neutral adapter, capability, request, result, usage and error contracts without an SDK or provider. Provider/model catalogs and pricing snapshots may remain empty; unknown costs are null. Prompt definitions are seeded as legitimate catalog entries, while prompt versions are immutable. Intelligence runs separate bounded technical retries from at most two creative regenerations and use idempotency keys. Safe metadata excludes full prompts, scripts, credentials and secrets.

Until an Owner approves and configures a real provider, AI commands return a clear provider-not-configured problem and persist no synthetic artifacts. No Workflow, Queue, Durable Object, KV or R2 resource is part of this implementation.

## Locales and supervision

The web UI defaults and falls back to Spanish. `ui_locale` and `review_locale` remain independent of project `content_language`. Production scripts retain their actual language; Spanish review artifacts link to the exact source script version and never replace it. Review Read-Aloud uses browser `SpeechSynthesis`, selects voices from the artifact language, stores no audio and makes no backend or ElevenLabs call.

## Security

All Phase 3 API routes inherit Cloudflare Access verification, same-origin mutation protection, D1-backed provisioning, server-side RBAC and workspace isolation. Inputs use bounded Zod contracts, mutations use optimistic version checks where applicable, and business audit events contain identifiers and safe metadata rather than full editorial payloads.
