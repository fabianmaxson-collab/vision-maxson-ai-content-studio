# Phase 3 — AI Intelligence & Editorial Planning Core

Status: **PHASE 3 CORE — STAGING VALIDATED**

Owner decision date: 2026-09-03.

## Authority and completed local scope

ADR-007 records the Owner-approved roadmap resegmentation and traceability to Master Specification V1.1. ADR-005 remains authoritative for Spanish-first UI/review locales. ADR-006 remains authoritative for browser-native Review Read-Aloud and its strict separation from Production Voice-over.

The local candidate completes the Phase 2 Drizzle debt remediation and introduces forward-only migration `0002_phase_3_editorial_intelligence.sql` with the approved 22-table direction. It implements immutable, versioned editorial artifacts; exact dependencies and invalidation; version-specific approvals; research provenance; ideas; briefs; scripts and Spanish review linkage; critiques; storyboard/scenes; deterministic timing/preflight foundations; derived generation readiness; prompt/intelligence-run persistence; provider-neutral contracts; server-side RBAC/audit routes; Spanish-first UI; and browser-native Preview TTS.

Bounded editorial text/JSON remains in D1. No R2, KV, Queue, Durable Object or Workflow resource is introduced.

## Completion gate

No real AI provider is configured. AI generation routes report `Proveedor de IA no configurado` and create no fabricated output. Phase 3 must not be declared **COMPLETED** until an approved real provider is integrated and this authenticated staging flow passes with real output:

```text
Research
→ Idea Candidates
→ approved Idea
→ Content Brief
→ Production Script
→ Spanish Review when required
→ Critique
→ Storyboard
→ Preflight
→ READY_FOR_GENERATION
```

`READY_FOR_GENERATION` remains derived while `project.status` is `PREFLIGHT_REVIEW`; it is not a competing canonical status.

## Staging validation

The Owner completed authenticated desktop validation against `https://staging.vision.directormaxson.com/` on 2026-09-03.

- Worker: `vision-maxson-ai-content-studio`
- Active version: `331fe174-0e94-4db2-9fbe-5294777d5bb2`
- Deployment: `d00a96e7-42a4-46de-900b-8150a110b2e8`
- Traffic: 100% staging

The application renders correctly and the previous blank-screen React runtime issue is resolved. The Spanish-first interface, navigation and **Inteligencia IA** load correctly; D1 reports `ready`; the Owner session is active; and no fabricated projects or content appear.

The visible editorial stages are Resumen, Investigación, Ideas, Brief, Guion, Storyboard and Preflight. The project selector contains no fabricated project. The UI truthfully reports **Proveedor de IA no configurado**.

Authenticated API validation passed:

- `GET /api/v1/health`: `status=ok`, `service=vision-maxson-api`, `environment=staging`.
- `GET /api/v1/me`: `visionmaxson@gmail.com`, role `owner`, workspace `workspace_primary`, `environment=staging`, `database=ready`.
- `GET /api/v1/ai/catalog`: `configured=false`, `items=[]`.

The empty AI catalog is intentional because no real AI provider is connected.

## Remaining completion gates

This desktop staging PASS validates **Phase 3 Core**, but Phase 3 is not formally `COMPLETED`. Completion still requires:

- integration of an explicitly approved real AI provider;
- authenticated staging validation using real AI output through the representative editorial flow to derived `READY_FOR_GENERATION`;
- Preview TTS validation on a legitimate real, manually authored or imported editorial artifact.

Responsive real-device validation remains a separate validation item and does not invalidate the desktop staging PASS. Phase 4 has not started.

## Discoverable future-phase decisions

ADRs 008–010 record Owner-approved future production behavior: bounded autonomy and dynamic resource routing; device-independent cloud execution and responsive/mobile control; and generation supervision, protected clip edits, creative learning, decision provenance and low-noise notifications. They are documentation-only and do not expand the Phase 3 implementation or authorize infrastructure, providers, migration or deployment.

ADR-011 records the Owner-approved future project download, managed local ingest and storage-retention lifecycle. It is documentation-only and explicitly supersedes the Master Specification V1.1 general Final Master minimum with configurable 14/30-day defaults while preserving longer KEEP/PRESERVE/LOCKED policies.
ADR-012 records the permanent publishable-media invariant for all future image/video generation and acquisition: visible third-party watermarks may never be removed or concealed, unknown provenance/rights/watermark status fails closed, and only explicitly `PUBLISHABLE` assets may enter final export or publication. It is documentation-only in Phase 3; the dedicated media-asset/provenance model and server-side export gate remain mandatory before future media production work.
