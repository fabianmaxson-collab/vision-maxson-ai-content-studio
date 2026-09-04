# ADR-012 — Publishable media and third-party watermark policy

Status: **Accepted**

Decision date: 2026-09-04

Scope: cross-cutting requirement for future media discovery, acquisition, generation, editing, export, delivery and publishing; documentation only at acceptance.

## Context and authority

This ADR records a permanent Owner-approved requirement additional to Master Specification V1.1. It does not alter the original DOCX and does not authorize image/video generation, web discovery, downloading, watermark detection, provider integration, schema migration or deployment in Phase 3.

Public availability does not establish usage rights or production eligibility. A visible third-party watermark cannot be treated as a removable production defect.

## Invariant

Every image or video used in final editing, download, export, delivery or publication must be explicitly `PUBLISHABLE` and free of visible third-party watermarks. Vision Maxson must never remove, obscure, inpaint, crop around, blur or otherwise defeat an existing third-party watermark.

When a watermarked asset has no clean authorized source, its production status is `NOT_PUBLISHABLE`. Unknown provenance, rights or watermark status fails closed.

## Usage classes and states

`REFERENCE_INTERNAL` assets may support research, inspiration, storyboards, internal analysis and temporary planning when their source and permitted use allow it. A watermarked reference must remain isolated from production and final export.

`PRODUCTION_PUBLISHABLE` assets require known provenance, source/provider attribution, known rights or licence status where applicable, a recorded watermark decision, compatibility with the intended use and no watermark-removal operation in their lineage.

A future media model must represent at least these publishability outcomes:

- `PUBLISHABLE`
- `REFERENCE_ONLY`
- `NOT_PUBLISHABLE`
- `UNKNOWN`
- `WATERMARKED`
- `RIGHTS_UNKNOWN`
- `REJECTED`

Only `PUBLISHABLE` is eligible for final production. Naming may be normalized during schema design, but these semantics and fail-closed behavior are mandatory.

## Immutable provenance

A future dedicated media-asset model must preserve immutable, versioned provenance sufficient to identify:

- origin class: AI-generated, Owner-owned, licensed, imported or discovered;
- source and provider/model where applicable;
- generation, acquisition or import operation and timestamp;
- provider request ID where applicable;
- source-asset relationships and derived lineage;
- rights/licence evidence and intended-use compatibility;
- watermark observation and publishability decision;
- decision actor, rule version, evidence time and approval for production use.

Credentials, provider secrets and OAuth tokens never belong in provenance.

The existing Phase 3 editorial artifact tables are text-oriented and insufficient for this lifecycle. Future implementation should use a dedicated media asset, immutable media version, source/licence evidence, provenance edge and publishability-decision model rather than overloading `editorial_artifacts`.

## Provider and discovery requirements

Future image/video adapters must return enough safe metadata to evaluate media type, provider/model, provenance, watermark behavior, commercial eligibility, request identity, generation time and source relationships. Provider/model capability data must not assume watermark-free output.

A generation mode that returns visibly watermarked media may be eligible for `REFERENCE_INTERNAL` use only. It is ineligible for a publishable job; routing should prefer another approved provider/model with clean, authorized output.

Future web/media discovery follows:

```text
DISCOVER
→ SOURCE IDENTIFICATION
→ RIGHTS/LICENCE CHECK
→ PROVENANCE CAPTURE
→ WATERMARK/PUBLISHABILITY CHECK
→ INGEST
→ PRODUCTION ELIGIBILITY
```

Preferred sources are Owner-owned media, explicitly licensed stock/media providers, verified public-domain or compatible permissively licensed material, and suitable output from approved AI providers.

## Final export gate

Every future final render, downloadable package, delivery and publishing operation must enforce a server-side gate across the complete asset dependency graph. Any required asset whose latest applicable decision is not explicitly `PUBLISHABLE` blocks the operation. Client state, filename, public URL, prior use or successful download cannot bypass the gate.

The decision and rejection reason must be auditable without storing protected content or secrets.

## Phase boundaries

Phase 3 records this invariant and carries it into future planning. It introduces no media schema or migration because current Phase 3 editorial execution does not create image/video assets. Implementation belongs with the future media-asset model and must precede any production image/video generation, media acquisition or final export capability.
