# ADR-007: Phase 3 roadmap resegmentation and editorial core

Status: accepted by Owner for architectural reconciliation.

Decision date: 2026-09-03. This ADR records roadmap and architecture decisions only. It does not authorize Phase 3 functional implementation, migration `0002`, an AI provider integration, a Cloudflare resource, or a deployment.

## Roadmap resegmentation

Phase 3 is resegmented as **AI Intelligence & Editorial Planning Core**. This changes delivery grouping, not product scope: no requirement from Master Specification V1.1 is deleted. Requirements moved from their original phase remain mandatory and must be traceable through later status, implementation and closeout records.

The resegmented Phase 3 owns the editorial planning path:

```text
Project
→ Research
→ Idea Candidates
→ Selected and approved Idea
→ Content Brief
→ Production Script
→ Spanish Review Version when required
→ Script Critique
→ Storyboard / Scene Plan
→ Preflight
→ READY_FOR_GENERATION
```

Phase 3 prepares a project for media generation. It does not perform media generation, production voice-over, publishing, social OAuth or analytics ingestion.

## Traceability to Master Specification V1.1

The following obligations remain attributable to their Master Specification areas even when delivered in the resegmented Phase 3:

- Project pipeline: Analysis, Script/Storyboard and Preflight planning behavior.
- Provider layer: provider-neutral text-model contracts, capability discovery, estimates, safe errors and adapter isolation. A real adapter is deferred pending Owner selection.
- AI Intelligence: read/analyze/propose boundaries, provenance and the prohibition on autonomous production mutation.
- Cost and budget enforcement: cost provenance, unknown/null values and future preflight gates. Provider prices must never be fabricated.
- Quality and hard blockers: deterministic checks precede heuristic quality assessments; `UNKNOWN` is not converted to `PASS`.
- Security and observability: Access, application RBAC, workspace isolation, validation, safe logs, audit history and secret minimization remain unchanged.
- Orchestration: durable or resumable AI execution may later use Cloudflare Workflows when justified and separately authorized. The original Workflows, Queues and Durable Objects obligations remain traceable to the later delivery slices that actually need them.
- Testing: domain, contract, Worker integration, migration, security and resilience obligations remain mandatory for the corresponding implementation.

Every future Phase 3 implementation/status record must identify the applicable Master Specification obligation. Deferred original-roadmap requirements must remain visible rather than being treated as cancelled.

## Canonical lifecycle and derived readiness

`READY_FOR_GENERATION` is not a canonical `project.status` and must not compete with the Master Specification state machine.

The Phase 3 terminal condition is represented as:

```text
project.status = PREFLIGHT_REVIEW
generation_readiness = READY_FOR_GENERATION
```

`generation_readiness` is derived only when the current required artifact versions, approvals and current preflight satisfy the approved readiness rules. Editing a required approved artifact can make downstream artifacts or approvals stale and therefore revoke the derived readiness result. Transition to canonical `GENERATING` belongs to a future media-generation phase.

## Editorial artifact architecture

Phase 3 will use the approved hybrid model:

- stable editorial artifact identities;
- immutable artifact versions;
- explicit version-to-version dependencies and invalidation;
- version-specific approvals;
- specialized relational structures for research provenance, idea scoring, script segments, storyboard scenes, timing, preflight, prompt versions and Intelligence Runs.

The approved schema direction contains 22 Phase 3 tables across artifact control, research/provenance, ideas, scripts/storyboards, timing/preflight, prompts, providers and Intelligence Runs. The exact forward-only SQL remains subject to migration review. Migration `0002` is not created by this ADR.

Reasonably bounded editorial text and structured JSON remain initially in D1. Phase 3 must not introduce R2 merely to hold editorial artifacts.

The existing Phase 2 Drizzle schema mapping is incomplete relative to migration `0001`. Phase 3 technical preparation may map the existing Phase 2 tables required by Phase 3, but this mapping must not change the existing database schema or remote D1 data.

## RBAC and operating boundaries

The existing roles remain `owner`, `admin`, `operator` and `viewer`. `operator` remains the functional equivalent of the Master Specification Editor and may perform ordinary editorial approvals. Provider credentials, provider administration, budget overrides, `LOCKED` overrides and other privileged operations retain stricter Owner/Admin authorization. Viewer remains read-only.

`ASSISTED` remains the default operating mode. No operating mode may use Phase 3 to bypass version-specific approvals, future media-generation gates or publishing controls.

## Infrastructure boundaries

Cloudflare Workflows may be proposed for AI executions only when durable, long-running or resumable execution genuinely requires them. No Workflow resource or binding may be created without a separate infrastructure authorization.

Queues, Durable Objects, KV and R2 are not approved for Phase 3 at this point. D1 remains the only approved persistence direction for the editorial core, subject to a separately authorized migration.

## Provider deferral and completion gate

Phase 3 must establish provider-neutral contracts before selecting a provider. OpenAI, Gemini, Anthropic and other providers remain unselected and unconnected. Credentials, models, privacy, budget, retention and fallback policy require later explicit Owner approval.

Phase 3 may reach PRE-DEPLOYMENT without a real AI provider, but it cannot be declared **COMPLETED** until at least one approved real provider is integrated and an authenticated staging end-to-end validation succeeds using real provider output through the essential editorial pipeline. Hardcoded or fabricated staging AI outputs cannot satisfy this gate.

## Relationship to ADR-005 and ADR-006

ADR-005 remains authoritative: the product and review experience are Spanish-first while production/content language remains project-specific. Production-language artifacts and Spanish review artifacts have separate version identities and traceable relationships.

ADR-006 remains authoritative: browser-native `SpeechSynthesis` is the default Review Read-Aloud direction. Preview TTS is read-only, transient and separate from Production Voice-over. It must not use ElevenLabs, production voice credits or persisted audio in Phase 3.

## ADR numbering reconciliation

Repository ADR identifiers are chronological repository records. Appendix B identifiers in Master Specification V1.1 describe required decision topics and are not treated as filenames after the repository numbering diverged.

Future documentation must therefore reference both:

1. the repository ADR filename/number; and
2. the corresponding Master Specification decision topic or section.

Existing ADRs will not be renumbered because renumbering would damage historical links and auditability. A required Appendix B topic not yet covered must receive a new chronological repository ADR when its implementation phase is reached.

## Current authorization boundary

This ADR does not implement Phase 3, modify functional schema/code, create migration `0002`, apply a migration, modify D1, create Cloudflare resources, deploy staging or production, connect an AI provider, request credentials, or start Phase 4.
