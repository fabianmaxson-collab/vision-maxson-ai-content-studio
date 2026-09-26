# Vision Maxson — Internal-First Capability Roadmap

**Status:** OWNER-APPROVED PRODUCT DIRECTION

**Scope:** Build-vs-buy policy, internal intelligence capabilities, future implementation priorities, and external dependency boundaries.

---

## 1. Core principle

Vision Maxson should remain operationally simple and fluid.

The default rule is:

> Build internally when the capability is primarily product logic, memory, workflow orchestration, scoring, analytics, governance, UI, or learning from Vision Maxson's own data.

External platforms should be added only when Vision Maxson genuinely needs a capability or authoritative data source that exists outside the system.

This avoids unnecessary SaaS dependencies, duplicate dashboards, extra accounts, API fragility, recurring cost, and fragmented memory.

---

## 2. One intelligence, not many disconnected brains

Vision Maxson must not create separate independent "brains" for thumbnails, titles, providers, analytics, trends, QA, or costs.

These are domains feeding the same governed intelligence and Second Brain.

Knowledge must retain scope and provenance:

- global system knowledge;
- platform-specific knowledge;
- channel-specific knowledge;
- format-specific knowledge;
- project-specific knowledge;
- provider-specific knowledge.

A rule learned from one channel must not automatically become a rule for every channel.

Canonical loop:

```text
PRODUCE
  ↓
PUBLISH
  ↓
MEASURE
  ↓
OBSERVE
  ↓
LEARN
  ↓
VERIFY
  ↓
IMPROVE FUTURE DECISIONS
```

---

## 3. Capabilities to build internally

These capabilities do not require adding a new SaaS product as their primary implementation.

### Director Review

Show the owner only items that genuinely benefit from human creative judgment or intervention.

Examples:

- questionable rough cuts;
- manual thumbnail review;
- failed or low-confidence QA;
- important creative decisions;
- blocked publications;
- exceptional spend decisions.

Normal successful content continues autonomously.

### Experiment Engine

Track controlled variants such as:

- thumbnail A/B;
- title A/B;
- hook variants;
- duration variants;
- voice/style variants;
- provider/model variants where useful.

Store hypothesis, variant, exposure, outcome, confidence, and conclusion.

The purpose is learning, not merely displaying A/B statistics.

### Provider Quality Intelligence

Learn provider performance from Vision Maxson's own production history.

Possible dimensions:

- output quality;
- continuity;
- QA failure rate;
- regeneration rate;
- latency;
- reliability;
- normalized cost;
- language performance;
- format capability;
- owner intervention rate.

Routing must optimize quality, cost, reliability, rights, latency, continuity, and project constraints rather than simply selecting the cheapest provider.

### Second Brain / Learning System

Persist observations, candidate insights, verified insights, operational rules, stale knowledge, rejected hypotheses, and owner-approved policy.

Learning must be evidence-backed and revisable.

### Thumbnail Intelligence

Track AI-generated, manually uploaded, and AI-edited thumbnails and connect them to downstream performance.

Manual owner intervention is optional and owner-initiated.

The system must not interrupt every publication asking whether the owner wants to replace the thumbnail.

If the owner initiates manual thumbnail review for a specific publication, only that publication is paused until the review is resolved.

### Title and Hook Intelligence

Connect title/hook decisions with downstream performance and use channel-specific evidence to improve future generations.

### Channel Creative DNA

Maintain a learnable profile per channel, including where useful:

- visual language;
- thumbnail patterns;
- title patterns;
- tone;
- pacing;
- hooks;
- voice preferences;
- duration behavior;
- publishing behavior;
- recurring audience response patterns.

This must remain evidence-based and editable, not a permanently frozen style preset.

### Internal QA Engine

Build Vision Maxson's own governed quality-control layer.

Possible domains:

- technical media validation;
- audiovisual continuity;
- audio presence/quality;
- watermark detection;
- format compliance;
- editorial/factual restrictions;
- rights/compliance;
- platform readiness.

### Automatic Failure Diagnosis

Classify failures and choose a governed next action.

Examples:

- provider capacity;
- rate limit;
- authentication;
- invalid request;
- policy rejection;
- timeout;
- ambiguous dispatch;
- corrupted output;
- download failure;
- QA failure;
- cost ceiling reached.

Possible actions:

- technical retry;
- poll existing job;
- reroute;
- normalize;
- fail closed;
- request human review.

### Cost Intelligence

Calculate and learn:

- cost per attempt;
- cost per scene;
- cost per video;
- cost per project;
- cost per channel;
- cost per provider;
- monthly cost;
- expected vs actual cost.

Before execution, estimate:

- minimum;
- expected;
- worst case.

### Budget Intelligence

Apply project/channel/provider limits and alerts.

Support recommendations such as reducing expected cost while preserving an owner-defined quality threshold.

### Rights and Licensing Ledger

Track asset provenance, author/source, license, permission, attribution needs, commercial use, restrictions, and risk.

Watermark-free does not mean rights-free.

### Asset Intelligence

Build an internally searchable asset catalog with metadata, relationships, quality state, project/channel context, rights state, and semantic descriptors.

### Asset Versioning

Track versions and supersession for assets such as:

- thumbnail;
- rough cut;
- voice;
- captions;
- normalized media;
- final master.

### Manual Intervention Workflow

Human intervention is optional and targeted.

For example, a manually initiated thumbnail replacement pauses only the affected publication until the owner confirms, cancels, or restores the Vision-generated thumbnail.

### Multimodal Inteligencia IA

The central chat should be able to receive and reason over:

- text;
- images;
- audio;
- video;
- relevant documents.

Where context is known, the system should link the media to the relevant project, video, channel, language, platform, and workflow rather than forcing the owner to restate context.

### AI-Assisted Thumbnail Editing

A thumbnail associated with a publication can be opened/sent into Inteligencia IA, modified through natural-language instructions, previewed, versioned, and reapplied to the correct publication after owner confirmation.

### Content Repurposing Engine

Transform approved masters or source content into derived formats such as:

- Shorts;
- Reels;
- TikTok versions;
- teasers;
- highlights;
- quote clips;
- platform-specific derivatives.

Provider calls may still be required for generation, but orchestration, rules, lineage, QA, and learning belong to Vision Maxson.

### Localization Engine

Coordinate translation/adaptation of scripts, subtitles, metadata, voices, and visual/text elements while preserving canonical source language and allowing Spanish review assistance.

### Internal Notifications

Create a native attention system for meaningful events such as:

- blocked publication;
- failed generation;
- provider credit warning;
- budget threshold;
- account disconnect;
- pending manual review;
- rights risk;
- QA failure.

Avoid notification noise.

### Decision History and Audit

Persist important decisions, reasons, inputs, outcomes, approvals, and resulting performance.

The system may expose rationale, evidence, tradeoffs, and confidence, but not hidden model chain-of-thought.

### Opportunity Inbox

Allow Trend/Platform Intelligence to create structured opportunities that can be reviewed, ignored, prioritized, or converted into projects.

### Knowledge Decay and Revalidation

Insights can weaken, expire, or require revalidation when performance changes, providers change, platform rules change, or evidence becomes stale.

### Confidence and Evidence

Insights should carry confidence and evidence rather than being treated as absolute facts merely because an AI generated them.

### Performance Feedback Loop

Published performance must feed future content generation and routing decisions while preserving platform/channel scope.

### Internal Observability

Initially build native operational tracing instead of adding Langfuse.

Track where useful:

- workflow/job;
- model/provider;
- task type;
- latency;
- normalized cost;
- retry;
- outcome;
- QA result;
- routing decision;
- safe error classification.

External observability platforms can be reconsidered later if scale or engineering complexity justifies them.

### Internal Product Analytics

Initially build lightweight product analytics using Vision Maxson's own events rather than adding PostHog.

Measure only information that improves the product, such as:

- workflow completion;
- failure points;
- owner interventions;
- frequently used functions;
- processing time;
- automation success.

### Scheduler Intelligence

Learn publishing windows and scheduling patterns from authorized historical channel data.

Scheduling recommendations must remain channel/platform-specific.

### Publication Readiness

Calculate readiness based on concrete gates such as:

- media QA;
- thumbnail;
- metadata;
- captions;
- rights;
- platform constraints;
- account state.

Do not invent a vague subjective "content quality score" as a substitute for explicit checks.

### Project and Cross-Channel Learning

Projects can learn from past production performance.

Cross-channel learning is allowed only when the system retains scope and evidence and does not blindly transfer one channel's rule to another.

---

## 4. Capabilities that inherently depend on external systems

Vision Maxson should own the orchestration and intelligence, but some capabilities require an external source of truth or execution engine.

### Foundation and generative models

Examples include GPT/OpenAI, Gemini, Claude, Agnes, Veo/Flow, ElevenLabs, and future providers.

They are interchangeable execution/intelligence engines, not the product brain.

### Social/platform publishing

YouTube, TikTok, Instagram/Meta, Facebook, and future distribution channels require their official APIs or a governed manual bridge.

### Platform analytics

Views, CTR, retention, watch time, revenue, engagement, and other authoritative performance metrics originate with the platform.

### External trends and news

Vision Maxson can own ranking, relevance, memory, opportunity detection, and learning, but the underlying current-world signals originate externally.

### Google Drive

Google Drive remains the preferred durable archive for large media assets under the current architecture.

### Cloudflare

Workers, D1, R2, Queues, DNS, and security are infrastructure dependencies deliberately chosen by the architecture.

### Provider account balances and quotas

Exact remaining balance/credits require provider-supported account data, usage APIs, or a manual bridge.

### External provenance standards

Vision Maxson can maintain its own provenance ledger internally. Interoperable standards such as C2PA may be added later if there is a real product need.

---

## 5. Explicitly deferred third-party products

The following are not required for the initial architecture:

- PostHog;
- Langfuse;
- Zapier;
- Make;
- Notion;
- an additional external scheduler;
- an additional external memory/knowledge SaaS.

This is not a permanent prohibition.

Reconsider one only when there is a demonstrated capability, scale, compliance, maintenance, or economic advantage that is materially better than the internal implementation.

Any new dependency should answer:

1. What capability can we not reasonably provide internally?
2. What operational cost does the dependency add?
3. What data leaves Vision Maxson?
4. What failure/vendor-lock-in risk does it add?
5. Is there an API-first and reversible integration path?

---

## 6. Implementation priority

These are roadmap capabilities, not instructions to implement everything immediately.

Suggested sequence after core Phase 4 production becomes operational:

1. native observability and failure diagnosis;
2. Director Review and targeted manual intervention;
3. Provider Quality + Cost Intelligence;
4. publication/performance feedback loop;
5. Channel Creative DNA;
6. thumbnail/title/hook learning;
7. Experiment Engine;
8. Asset/Rights Intelligence;
9. repurposing/localization expansion;
10. progressively richer Second Brain automation.

Do not let roadmap work destabilize the core audiovisual pipeline.

---

## 7. Architecture rule

Prefer a small number of durable primitives over many disconnected micro-products.

A capability should reuse, where appropriate:

- D1 for structured state, metadata, learning, events, and relationships;
- R2 for operational media;
- Google Drive for durable large-asset archive;
- Cloudflare Workers/Queues for orchestration/background execution;
- the central Second Brain for governed learning;
- the central Intelligence layer for user interaction and reasoning;
- existing provider adapters for external execution.

The desired result is a system that remains understandable, auditable, fluid, and replaceable at provider boundaries.


---

## 8. Canonical audiovisual provider strategy

Vision Maxson must remain provider-pluggable. Provider integrations are adapters behind a stable internal contract, not hard-coded workflow branches.

### Current audiovisual provider families

The approved provider set for the current architecture is:

1. **Google / Flow**
   - direct Google audiovisual generation family;
   - Veo and Google-native audiovisual models/capabilities available to the connected account;
   - use direct Google access when quality, quota, latency, rights, or economics make it preferable.

2. **ElevenLabs**
   - remains a primary voice/audio provider;
   - may also expose image/video generation models through the connected ElevenLabs account;
   - Vision Maxson should treat each available model as a capability behind the ElevenLabs provider, not assume permanent availability of any specific third-party model.

3. **Agnes**
   - existing audiovisual provider with an approved provider adapter foundation;
   - remains part of the production routing pool.

4. **fal.ai**
   - approved additional API provider / model aggregator;
   - intended primarily to increase audiovisual model choice, concurrency, fallback capacity, and economic routing flexibility;
   - should be integrated through the same provider registry and execution contracts as other providers;
   - Vision Maxson may route to individual video/image models exposed through fal.ai according to verified capability, quality, cost, latency, rights, and availability.

No additional aggregator is required by default after fal.ai. New aggregators/providers are added only when they demonstrate a material advantage.

### Future self-hosted provider

A future provider family is approved in principle:

**SELF_HOSTED**

Initial target model:

**CogVideoX**

This is a future capability, not an immediate implementation requirement.

The intended architecture is:

```text
Vision Maxson
  ↓
Provider Router
  ↓
SELF_HOSTED adapter
  ↓
Dedicated GPU worker
  ↓
CogVideoX
  ↓
secure ingest / QA / R2 / Drive
```

The self-hosted worker may live on a dedicated always-on computer or future GPU infrastructure.

Google Drive may store model artifacts or durable media, but storage itself does not execute inference. The self-hosted provider requires compute/GPU resources.

If the self-hosted worker is unavailable, routing can fall back to another eligible provider according to policy.

### Provider replacement and future onboarding

The architecture must make adding a future provider straightforward.

A new provider must not require rewriting the production pipeline.

A provider adapter should declare or expose, where applicable:

- provider identity;
- model identity;
- modality;
- text-to-video / image-to-video / reference capabilities;
- supported aspect ratios;
- supported durations;
- supported resolutions and frame rates;
- audio generation capability;
- first/last-frame capability;
- reference-image/video/audio capability;
- concurrency/queue behavior;
- polling/webhook behavior;
- output retrieval behavior;
- estimated and actual normalized cost;
- provider quota/balance health where available;
- rights/commercial-use constraints;
- known reliability/quality observations.

The Provider Registry and Provider Intelligence decide how to use providers.

Workflows must target internal contracts, not vendor-specific UI behavior.

### Routing principle

Provider selection is dynamic.

Vision Maxson should compare eligible routes using factors such as:

- required capability;
- expected quality;
- continuity;
- cost;
- available/free/included quota;
- latency;
- current capacity;
- provider reliability;
- language;
- rights/commercial constraints;
- scene complexity;
- prior QA outcomes;
- channel/project quality requirements.

The system is not cheapest-first and is not permanently tied to one provider.

### Current strategic boundary

For the current roadmap, the provider pool is intentionally kept compact:

```text
GOOGLE
ELEVENLABS
AGNES
FAL.AI

FUTURE:
SELF_HOSTED → CogVideoX
```

This is enough diversity for the current stage.

Future providers may be added when they are measurably better, cheaper, more reliable, or uniquely capable, provided they fit the same adapter-based architecture.


---

## 9. Development agent and model routing policy

This policy governs which coding agent/model should be recommended for Vision Maxson development work. It is an owner-approved operating rule and may be revised when model availability or measured performance changes.

### Codex

Preferred default coding environment when quota is available.

Current routing:

- **GPT-6 Sol Medium**: normal implementation, bounded refactors, mechanical repository work, and well-specified changes.
- **GPT-6 Sol High**: default for architecture, database migrations, D1, security, provider integrations, complex debugging, and changes with meaningful cross-system risk.
- **GPT-6 Sol Extra High / XHigh**: use only when there is a concrete reason, such as a difficult forensic inconsistency, ambiguous state recovery, complex migration failure, deep multi-system debugging, or when High does not provide enough confidence.
- **GPT-6 Astra**: exceptional escalation only. Use when the task is materially more difficult than Sol can handle reliably and the expected gain justifies its higher token/quota consumption. Astra is not the routine default.

Do not escalate merely because a higher setting exists.

### Antigravity

Use Antigravity when Codex quota is exhausted/unavailable, or when its model/tooling is a better fit for the block.

Current available routing:

- **Gemini 3.8 Flash Medium**: small, focused, lower-risk or forensic tasks.
- **Gemini 3.8 Flash High**: larger implementations, broad repository inspection, high-volume coding, and tasks where speed/capability efficiency is valuable.

Claude Sonnet/Opus may be reconsidered when they become available again. Do not assume availability.

### Switching rule

Whenever a block changes coding application, model family, or reasoning level, the instruction given to the owner must start with a conspicuous alert.

Examples:

```text
🚨 CAMBIO DE HERRAMIENTA — ESTE BLOQUE ES PARA ANTIGRAVITY, NO CODEX
Modelo: Gemini 3.8 Flash High
```

```text
🚨 CAMBIO DE NIVEL — CODEX
Subir temporalmente de GPT-6 Sol High → GPT-6 Sol Extra High
Motivo: <specific risk>
```

Every executable coding block should state:

- application;
- model;
- reasoning/effort level;
- reason for escalation when above the normal default.

### Efficiency principle

Use the least expensive/limited reasoning level that is still appropriate for the risk.

The target is not maximum model consumption. The target is reliable progress, strong safety, and efficient use of available quota.

If a model or plan changes in the future, preserve the decision logic above even if the exact product/model names change.
