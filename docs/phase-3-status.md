# Phase 3 — AI Intelligence & Editorial Planning Core

Status: **ARCHITECTURAL RECONCILIATION COMPLETE; IMPLEMENTATION NOT STARTED**

Owner decision date: 2026-09-03.

## Approved direction

ADR-007 records the Owner-approved roadmap resegmentation, traceability to Master Specification V1.1, hybrid editorial artifact/version architecture, derived `READY_FOR_GENERATION` readiness, infrastructure boundaries, provider deferral and the real-provider staging validation required before Phase 3 can be declared completed.

ADR-005 remains authoritative for Spanish-first UI/review locales. ADR-006 remains authoritative for browser-native Review Read-Aloud / Preview TTS and its strict separation from Production Voice-over.

The approved schema direction contains 22 proposed Phase 3 tables, but no migration has been created or applied. Reasonably bounded editorial text/JSON is planned for D1; no R2 usage is approved for Phase 3 editorial artifacts.

## Existing-schema preparation note

The checked-in Phase 2 SQL migration defines 25 Phase 2 tables, while the current Drizzle mapping covers only a subset. Phase 3 preparation is authorized to map the existing structures that Phase 3 needs. That future mapping is code-only and must reproduce the existing schema exactly; it must not alter remote Phase 2 D1 schema or data.

## Completion gate

Phase 3 may reach PRE-DEPLOYMENT without a configured AI provider. It must not be declared **COMPLETED** until an approved real provider is integrated and the authenticated staging editorial flow is validated end to end with real output:

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

Fake or hardcoded staging AI output cannot satisfy this criterion.

## Current boundaries

No Phase 3 functional code, migration, D1 change, Cloudflare resource, staging deployment, production change, AI provider connection, credential request, media generation, social OAuth, publishing or Phase 4 work is authorized or underway.
