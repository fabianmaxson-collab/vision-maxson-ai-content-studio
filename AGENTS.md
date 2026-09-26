# AGENTS.md — Vision Maxson Product Guardrails

Before changing product structure, navigation, frontend information architecture, or user-facing workflows, read:

- `docs/product/VISION_MAXSON_PRODUCT_MASTER_MAP.md`
- `docs/product/VISION_MAXSON_UI_CANON.md`
- `docs/product/VISION_MAXSON_INTERNAL_CAPABILITY_ROADMAP.md`

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
12. Keep provider integrations adapter-based and replaceable. Do not hard-code vendor-specific workflow logic when a stable internal provider contract can be used.
13. Current audiovisual provider families are Google/Flow, ElevenLabs, Agnes, and fal.ai. Future SELF_HOSTED/CogVideoX is approved as a roadmap direction, not an immediate dependency.
14. For coding-agent routing, follow `docs/product/VISION_MAXSON_INTERNAL_CAPABILITY_ROADMAP.md` §9. Codex defaults to GPT-6 Sol with effort matched to risk; Astra is exceptional. Antigravity/Gemini is the primary fallback when Codex quota is unavailable. Every change of application/model/effort must be visibly announced to the owner before an executable block.

Authority order:

1. Explicit owner-confirmed decision.
2. Product Master Map.
3. UI Canon.
4. Master Specification / accepted ADRs.
5. Existing implementation.
6. Agent proposal.

If uncertain, stop and ask rather than invent.
