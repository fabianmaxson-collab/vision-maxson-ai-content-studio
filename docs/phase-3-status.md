# Phase 3 — AI Intelligence & Editorial Planning Core

Status: **LOCAL PRE-MIGRATION / PRE-DEPLOYMENT CANDIDATE VERIFIED**

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

## Current boundary

Migration 0002 has been applied only to disposable local state. Remote staging D1, staging traffic, Cloudflare resources and production remain unchanged. The next approval boundary is remote staging D1 migration 0002 only, followed by a separate staging Worker deployment authorization. Phase 4 has not started.

## Discoverable future-phase decisions

ADRs 008–010 record Owner-approved future production behavior: bounded autonomy and dynamic resource routing; device-independent cloud execution and responsive/mobile control; and generation supervision, protected clip edits, creative learning, decision provenance and low-noise notifications. They are documentation-only and do not expand the Phase 3 implementation or authorize infrastructure, providers, migration or deployment.
