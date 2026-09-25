# Vision Maxson Second Brain

**Status:** CANONICAL INTELLIGENCE ARCHITECTURE DIRECTION

## 1. Purpose

Vision Maxson must accumulate useful operational knowledge over time instead of treating every project,
provider call, publication, analytics result, policy change, QA result, or owner decision as an isolated
event.

The Second Brain is the governed knowledge layer that turns those observations into reusable context for
future decisions.

Its goal is to improve:

- production efficiency;
- provider routing;
- cost optimization;
- platform-specific publishing;
- project planning;
- channel strategy;
- QA;
- risk detection;
- automation;
- continuity across chats, agents, devices, and implementation phases.

The Second Brain must help Vision Maxson understand the system better over time without silently changing
owner-approved product rules.

## 2. Core principle

The repository stores the **rules, schemas, contracts, runbooks, and canonical decisions** that define the
brain.

The live product stores the **runtime knowledge** it learns from operations.

Do not put all learned runtime data into Git.

Canonical split:

```text
REPOSITORY
  product canon
  architecture
  policies
  runbooks
  schemas
  accepted decisions
  agent instructions

RUNTIME KNOWLEDGE
  analytics
  provider performance
  project outcomes
  cost history
  QA results
  channel learning
  platform rules
  user decisions
  experiments
  observations
```

## 3. Knowledge lifecycle

The Second Brain follows a governed learning loop:

```text
OBSERVE
  ↓
NORMALIZE
  ↓
SOURCE / PROVENANCE CHECK
  ↓
STORE
  ↓
COMPARE WITH HISTORY
  ↓
EXTRACT CANDIDATE INSIGHT
  ↓
CONFIDENCE / RISK CLASSIFICATION
  ↓
USE AS RECOMMENDATION
  ↓
MEASURE RESULT
  ↓
REINFORCE / WEAKEN / EXPIRE
  ↓
PROMOTE TO CANON ONLY WHEN APPROVED
```

Learning does not mean silently rewriting the Product Canon.

## 4. Knowledge states

Every learned item should have a state.

Recommended states:

- `OBSERVATION` — raw fact or event;
- `CANDIDATE_INSIGHT` — pattern inferred from one or more observations;
- `VERIFIED_INSIGHT` — supported by sufficient evidence;
- `OPERATIONAL_RULE` — allowed to influence automated decisions;
- `CANONICAL_POLICY` — explicit owner-approved authority;
- `STALE` — needs revalidation;
- `REJECTED` — disproven or intentionally not adopted.

Higher-risk knowledge requires stronger evidence and more explicit approval.

## 5. Primary knowledge domains

The Second Brain should learn across at least these domains.

### Product and architecture

- confirmed owner decisions;
- product/UI canon;
- security rules;
- deployment rules;
- storage lifecycle;
- integration policy;
- approved architecture decisions.

### Project intelligence

- project type;
- language;
- target format;
- duration;
- scene count;
- generation strategy;
- approval pattern;
- production cost;
- production time;
- QA failures;
- regeneration causes;
- final outcome.

### Channel intelligence

- brand/channel identity;
- language;
- audience;
- preferred formats;
- historical retention;
- CTR;
- watch time;
- publishing windows;
- monetization performance;
- successful hooks;
- successful durations;
- recurring content patterns.

### Platform intelligence

- YouTube rules;
- TikTok rules;
- Facebook/Instagram rules;
- monetization eligibility;
- originality requirements;
- publishing/API changes;
- format/duration rules;
- current source and verification date.

Platform rules must be revalidated because they change.

### Provider intelligence

For each provider/model/capability:

- quality;
- continuity;
- latency;
- reliability;
- failure rate;
- cost;
- free/included quota;
- credit health;
- supported duration;
- supported aspect ratios;
- reference-image/video support;
- voice/audio/SFX capability;
- observed strengths and weaknesses.

### Financial intelligence

- cost by provider;
- cost by attempt;
- cost by scene;
- cost by project;
- cost by channel;
- cost by month;
- expected vs actual cost;
- budget alerts;
- provider-credit consumption;
- production ROI where measurable.

### Audiovisual QA intelligence

- codec/resolution problems;
- aspect-ratio normalization;
- black/frozen frames;
- watermark detection;
- continuity failures;
- speech/audio problems;
- recurring regeneration causes;
- provider-specific failure patterns.

### Trend intelligence

- emerging topics;
- search growth;
- viral formats;
- platform trends;
- ranking/list opportunities;
- source quality;
- channel fit;
- historical trend conversion into successful content.

## 6. Evidence and provenance

No learned claim should become trusted knowledge without provenance.

A knowledge item should be able to answer:

- What is the claim?
- Where did it come from?
- When was it observed?
- Which project/channel/provider/platform does it apply to?
- How strong is the evidence?
- Is it still current?
- What outcome followed when Vision Maxson acted on it?

Recommended provenance fields include:

- source type;
- source reference;
- observed time;
- effective time;
- workspace/project/channel scope;
- evidence class;
- confidence;
- verification status;
- expiry/review time.

## 7. Dynamic knowledge versus canon

The Second Brain must distinguish between:

### Dynamic knowledge

May change automatically as new evidence arrives.

Examples:

- Provider A has recently been faster than Provider B.
- 55-70 second Shorts perform better on Channel X this month.
- ElevenLabs credits are nearly exhausted.
- A current TikTok policy threshold changed.

### Canonical decisions

Must not be silently overwritten.

Examples:

- Spanish is the fixed owner-facing UI language.
- The canonical global navigation has 11 items.
- Production secrets stay server-side.
- Production deployment requires explicit authorization.
- Google Drive is the durable large-media archive.
- Technical retry is not a new creative Take.

If dynamic learning conflicts with canon, the system must surface the conflict instead of changing canon.

## 8. Decision memory

Important decisions should be recorded with:

- decision;
- rationale summary;
- evidence used;
- owner approval status;
- affected scope;
- date;
- superseded decision if applicable.

The purpose is to prevent repeated questions and contradictory implementation.

A later decision explicitly confirmed by the owner supersedes an older exploratory idea.

## 9. Analytics learning loop

Analytics should feed future production.

Canonical loop:

```text
CONTENT
  ↓
PUBLISH
  ↓
ANALYTICS
  ↓
SECOND BRAIN
  ↓
PATTERN / INSIGHT
  ↓
INTELLIGENCE
  ↓
NEXT PROJECT DECISION
  ↓
NEW CONTENT
```

Examples:

- detect the best duration range for one channel;
- identify hooks that improve retention;
- learn which publishing windows work;
- compare provider cost versus QA success;
- detect when expensive generation provides no measurable benefit;
- detect recurring scene types that can use cheaper/included providers.

## 10. Provider learning loop

Provider selection should improve from real outcomes.

Example:

```text
Scene type: talking character
Provider A:
  quality 9/10
  continuity 9/10
  cost high
  failure low

Provider B:
  quality 8/10
  continuity 8/10
  cost low
  failure low

Historical channel result:
  no measurable audience difference

Future routing:
  prefer Provider B unless the scene has premium continuity requirements
```

This is evidence-based optimization, not cheapest-first routing.

## 11. Cost learning

The Second Brain should compare:

- forecast minimum;
- forecast expected;
- forecast worst case;
- actual cost.

Over time it should improve forecasting for:

- Shorts;
- long-form;
- voice;
- SFX;
- image generation;
- video generation;
- normalization;
- rendering.

Current provisional Short ceiling remains an owner policy, not a learned prediction.

Learning may recommend raising or lowering a ceiling, but it cannot change the ceiling without authorization.

## 12. Self-feeding behavior

The Second Brain may automatically ingest trusted system observations such as:

- project state changes;
- generation outcomes;
- provider costs;
- provider failures;
- QA results;
- publication analytics;
- platform-rule updates;
- provider-credit status;
- owner approvals/rejections;
- manual corrections;
- experiment results.

External web/trend information enters first as evidence/observation, not as unquestioned truth.

## 13. Conflict prevention

Before using learned knowledge, Vision Maxson should resolve authority in this order:

1. explicit current owner decision;
2. Product Master Map and UI Canon;
3. accepted ADR/security/deployment policy;
4. verified operational rule;
5. verified insight;
6. candidate insight;
7. raw observation;
8. agent/model suggestion.

Lower levels never silently override higher levels.

## 14. Forgetting, decay, and revalidation

A useful Second Brain must also forget or downgrade stale information.

Examples:

- platform policies expire quickly;
- provider prices change;
- model quality changes;
- API capabilities change;
- audience behavior changes;
- channel performance trends drift.

Knowledge should support:

- `last_verified_at`;
- `valid_from`;
- `valid_until`;
- confidence decay;
- scheduled revalidation;
- supersession.

Historical evidence remains auditable even when it is no longer active guidance.

## 15. Runtime storage direction

The live Second Brain should use the existing Cloudflare-first architecture.

Recommended responsibilities:

### D1

Structured knowledge, provenance, decisions, insights, scores, relationships, status, and auditability.

### Google Drive

Durable large documents, reports, research bundles, project archives, and large reference material.

### R2

Operational media, temporary processing material, and transient large assets.

### Semantic retrieval index

A later implementation may add a semantic retrieval/indexing layer for efficient context lookup if needed.

Do not make the runtime brain depend on a local workstation.

## 16. Retrieval for Inteligencia IA

When the user opens `Inteligencia IA`, Vision Maxson should retrieve only the context relevant to the current
question.

Example:

```text
User:
"Why did Scene 4 cost more?"

Retrieve:
  Project
  Scene 4
  Attempts
  Provider routing
  QA
  Cost records
  Relevant budget policy

Do not retrieve:
  unrelated projects
  unrelated personal data
  random historical conversations
```

This keeps context useful, fast, cheaper, and safer.

## 17. Reasoning presentation

The system may show **decision rationale**, evidence, trade-offs, confidence, and recommended actions.

Example:

```text
Recommendation:
Use Provider B.

Why:
- 32% cheaper for this scene type
- same QA pass rate in the last 18 comparable scenes
- current Provider A credit balance is critical
- expected quality difference is low

Confidence:
82%

Alternatives:
Provider A — higher continuity, higher cost
```

Do not expose hidden chain-of-thought or raw private model reasoning.

The product should provide concise, auditable reasoning summaries.

## 18. Learning from owner corrections

Owner corrections are high-value learning signals.

Examples:

- "This provider is not acceptable for faces."
- "Do not stretch videos just for monetization."
- "Keep the interface in Spanish."
- "Use free Google voice when quality is equivalent."
- "This channel should sound more documentary and less promotional."

The system should store the correction with scope and authority so the same mistake is not repeatedly proposed.

## 19. Learning from experiments

Vision Maxson should support controlled experiments.

Examples:

- two hooks;
- two thumbnails;
- two publishing times;
- two narration styles;
- two providers;
- two duration ranges.

An experiment must record:

- hypothesis;
- variants;
- sample/context;
- metric;
- result;
- confidence;
- whether the result should influence future routing.

Do not generalize from one result across every channel.

## 20. Security and privacy

The Second Brain must obey workspace, permissions, and privacy boundaries.

It must not:

- leak one workspace's knowledge into another;
- expose secrets;
- store raw provider bearer URLs as knowledge;
- surface owner identity in normal UI;
- retrieve unrelated sensitive context simply because it exists.

Security-relevant actions remain auditable.

## 21. Human governance

Autonomy increases only when evidence and policy allow it.

Recommended progression:

```text
OBSERVE
→ RECOMMEND
→ ASSIST
→ AUTO-EXECUTE WITHIN POLICY
→ ESCALATE EXCEPTIONS
```

Critical spend, security changes, Production changes, or policy overrides remain governed.

## 22. Repository learning contract

When a durable owner-confirmed decision changes how Vision Maxson should work, update the relevant canonical
repository document in the same change set.

When a runtime insight is merely probabilistic or temporary, keep it in runtime knowledge instead of
promoting it into Git canon.

## 23. Future implementation modules

A later implementation phase should define runtime services equivalent to:

- Knowledge Ingest;
- Provenance Registry;
- Decision Memory;
- Insight Engine;
- Confidence/Decay Engine;
- Platform Intelligence;
- Provider Intelligence;
- Channel Learning;
- Analytics Learning;
- Experiment Registry;
- Retrieval/Context Builder;
- Recommendation Engine;
- Canon Conflict Detector.

Names may change, but these responsibilities should remain.

## 24. Success criterion

The Second Brain is working correctly when Vision Maxson becomes measurably better at:

- choosing providers;
- forecasting cost;
- reducing unnecessary regenerations;
- detecting policy changes;
- selecting duration;
- improving channel-specific content;
- identifying trends;
- explaining recommendations;
- avoiding repeated mistakes;
- maintaining continuity across agents and chats.

The owner should need to repeat confirmed decisions less often over time.
