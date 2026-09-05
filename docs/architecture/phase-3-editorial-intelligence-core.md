# Phase 3 editorial intelligence core

Status: implemented and validated in STAGING for the bounded German script and Spanish review slice.

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

## Validated bounded execution

The profile `phase3_short_de_review_es_v1` has passed a real STAGING E2E using OpenAI `gpt-5.6-luna`. It produced a German `PRODUCTION_SCRIPT` from an approved `HUMAN_EDITED` brief, enforced human approval of that exact current script version, and then produced a Spanish `REVIEW_TRANSLATION` without replacing or mutating the authoritative German artifact.

Each step allowed one technical attempt with SDK retries disabled. Fallback, creative regeneration and external research remained disabled. Durable reservation occurred before dispatch, actual cost was reconciled afterward, idempotency prevented duplicate execution, and exact provenance, dependency and audit records were retained. The two-call envelope transitioned to `CONSUMED` with 1,083 micro-USD of total reconciled provider cost under its 7,000 micro-USD ceiling.

Provider-bound input sizing serializes only the minimal context required by the selected task. An E2E-discovered duplicated-input path was removed, and `REVIEW_TRANSLATION_ES` now sends minimal provider-bound context while the server continues to validate the complete authoritative project, approval, artifact-version and dependency state before dispatch.

## Locales and supervision

The web UI defaults and falls back to Spanish. `ui_locale` and `review_locale` remain independent of project `content_language`. Production scripts retain their actual language; Spanish review artifacts link to the exact source script version and never replace it. Review Read-Aloud uses browser `SpeechSynthesis`, selects voices from the artifact language, stores no audio and makes no backend or ElevenLabs call.

## Publishable media invariant

ADR-012 records the permanent cross-cutting rule for future image/video work: only media explicitly classified as `PUBLISHABLE`, with known provenance and rights and no visible third-party watermark, may enter final editing, export, delivery or publishing. Watermark removal or concealment is prohibited; unknown status fails closed. Phase 3 introduces no media pipeline or migration for this future requirement.

## Security

All Phase 3 API routes inherit Cloudflare Access verification, same-origin mutation protection, D1-backed provisioning, server-side RBAC and workspace isolation. Inputs use bounded Zod contracts, mutations use optimistic version checks where applicable, and business audit events contain identifiers and safe metadata rather than full editorial payloads.
