# ADR-008 — Production autonomy and resource routing

Status: **Accepted**

Decision date: 2026-09-03

Scope: future production-generation phases; documentation only at acceptance.

## Context

Production must continue with minimal interruption after the Owner reviews the recommended configuration, expected resource use and cost, and explicitly starts production. Autonomy needs a bounded authorization model rather than repeated approvals or unrestricted spending.

## Decision

Starting production creates a **Production Authorization Envelope** containing the approved project configuration, hard constraints, providers/fallbacks, quality requirements, cost estimate and authorization ceiling. Inside it, Vision Maxson may choose or switch valid providers/models, perform technical retries and allowed creative regenerations, rebalance quota usage, parallelize or reorder independent work, continue unaffected branches, and make traceable low-risk quality corrections.

The autonomous contingency ceiling is **115% of the approved project-total estimate**. It is one project-level ceiling, not 15% per scene or task, and is not a spending target. Before projecting an exceedance, the system must try reasonable alternatives and keep unrelated work moving. Only affected branches should block when possible. Exceeding the ceiling requires Owner action unless a newly approved envelope replaces it.

Routing priority is:

1. task suitability;
2. quality, character consistency and continuity;
3. hard project requirements;
4. availability;
5. efficiency;
6. cost/resource consumption;
7. speed.

The cheapest and most expensive options receive no automatic preference. `LOCKED` is never bypassed; `PREFER` deviations require rationale; `AUTO` permits selection only with adequate evidence.

No artificial quota reserve is established. The router dynamically considers reliable remaining quota, renewal time, historical success, priority and comparative capability. A low-balance provider remains eligible when it has a material required advantage. When quality is effectively equivalent, the router may prefer a less scarce resource.

In `AUTO`, failover to the next valid provider/model needs no repeated approval when requirements, continuity, quality and the authorization envelope remain satisfied. Every selection, rejected alternative, quota/cost input, retry and failover must be reconstructable from safe decision provenance.

Projects will support `HIGH`, `NORMAL` and `LOW` priority. Priority can justify scarce-resource use but never bypasses `LOCKED` or cost controls.

Controlled benchmarks of newly discovered providers/models are permitted only when Provider Intelligence identifies a plausible material workflow advantage. They must be small, attributable, logged and separated from production analytics; discovering a model alone does not trigger a benchmark.

## Orchestration boundary

Approved production starts immediately without day/night scheduling questions. Dependencies, priority, availability, quotas, concurrency and cost determine ordering and parallelism. Implementation may require durable cloud orchestration, but this ADR does **not** authorize any Workflow, Queue, Durable Object, KV or R2 resource.

## Consequences

- Owner intervention is exceptional rather than routine.
- Provider balance UI must show only reliable remaining/consumed quota, percentage, renewal date, warning and last-sync data; unknown remains unknown.
- Normal routing/retries are auditable but should not interrupt the Owner.
- Future infrastructure and provider choices require their own explicit authorization.
