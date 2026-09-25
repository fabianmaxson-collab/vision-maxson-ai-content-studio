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


## Operations and recovery guardrails

Before changing device onboarding, authentication/session management, lost/stolen-device response, development-workstation setup, or recovery automation, read:

- `docs/operations/README.md`
- `docs/operations/NEW_DEVICE_SETUP.md`
- `docs/operations/WORKSTATION_RECOVERY.md`
- `docs/operations/SECURITY_INCIDENT.md`
- `docs/operations/DEVELOPMENT_ENVIRONMENT.md`

Mandatory operational rules:

1. Normal Vision Maxson product access must remain cloud-first and must not require the development workstation.
2. A new normal-access device must be onboardable through browser login, MFA, and device/session registration without copying project data or API secrets.
3. The primary Windows development workstation must be reconstructible from repository-backed runbooks without relying on the lost machine.
4. Never commit passwords, API keys, OAuth refresh tokens, recovery codes, or other secrets to the repository or workstation bootstrap scripts.
5. Developer-tool installation and versions must be audited against current vendor/repository requirements before being encoded in automation.
6. Lost/stolen workstation recovery starts with access/session revocation and exposure assessment before rebuilding the replacement machine.
7. Workstation verification must not use Production deployment as a health check.
8. When required workstation tooling changes, update the development manifest and recovery runbook in the same change set.
