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


## Platform intelligence guardrails

Before changing platform-specific publishing, monetization optimization, trend discovery, ranking/compilation workflows, source-clip ingestion, or platform duration rules, read:

- `docs/product/VISION_MAXSON_PLATFORM_INTELLIGENCE.md`

Mandatory rules:

1. Platform policies must be treated as dynamic, versioned rules sourced preferentially from official platform documentation.
2. Do not apply one platform's monetization thresholds to another platform.
3. Optimize for eligibility and performance within platform rules; do not design policy circumvention.
4. Watermark-free does not mean rights-free.
5. Ranking/compilation workflows require original editorial value and source/rights tracking.
6. Preserve the API-first + OAuth + manual bridge fallback for source intake.
7. Do not silently hard-code a platform rule without source/effective-date context.
