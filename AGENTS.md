# AGENTS.md — Vision Maxson Product Guardrails

Before changing product structure, navigation, frontend information architecture, or user-facing workflows, read:

- `docs/product/VISION_MAXSON_PRODUCT_MASTER_MAP.md`
- `docs/product/VISION_MAXSON_UI_CANON.md`

These documents are canonical product/UI authority.

Mandatory rules:

1. Do not invent new global sidebar sections.
2. Keep the canonical 11-item navigation stable.
3. Guion, Storyboard, Voces, Assets, Generación, QA, etc. belong inside Projects.
4. Publishing has only two canonical global submenus: Listo para publicar and Scheduler.
5. Do not display the owner’s real name, personal email, or personal photo in the normal UI.
6. Spanish is the primary interface language.
7. Preserve the approved dark navy/blue + gold + glass visual language.
8. Do not expose internal model/provider selection in normal Inteligencia IA UI.
9. Mockup values are illustrative unless backed by real data.
10. If product canon and an agent proposal conflict, the canon wins.
11. If the owner explicitly approves a canon change, update the canonical docs in the same change set.

Authority order:

1. Explicit owner-confirmed decision.
2. Product Master Map.
3. UI Canon.
4. Master Specification / accepted ADRs.
5. Existing implementation.
6. Agent proposal.

If uncertain, stop and ask rather than invent.


## Second Brain guardrails

Before changing memory, learning, analytics feedback, provider intelligence, channel learning, recommendation,
context retrieval, experiment learning, or canon-promotion behavior, read:

- `docs/intelligence/VISION_MAXSON_SECOND_BRAIN.md`

Mandatory intelligence rules:

1. Runtime learning must not silently overwrite owner-approved canon.
2. Store provenance, scope, confidence, freshness, and evidence for learned knowledge.
3. Separate raw observations, candidate insights, verified insights, operational rules, and canonical policy.
4. Use analytics, QA, cost, provider performance, platform changes, owner corrections, and experiments as
   learning inputs.
5. Prefer relevant context retrieval over loading unrelated historical data.
6. Show concise decision rationale, evidence, trade-offs, and confidence instead of exposing hidden
   chain-of-thought.
7. Apply authority ordering before using learned knowledge; lower-confidence insights never override current
   owner decisions or canonical policy.
8. Revalidate time-sensitive knowledge such as platform rules, provider pricing, model capabilities, and
   audience trends.
9. Keep secrets, transient provider credentials, and unrelated sensitive context out of the knowledge layer.
10. Durable owner-confirmed behavior changes must update the relevant canonical repository document.
