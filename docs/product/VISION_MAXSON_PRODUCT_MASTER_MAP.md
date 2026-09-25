# Vision Maxson AI Content Studio — Product Master Map

**Status:** CANONICAL PRODUCT AUTHORITY

**Language:** Spanish-fixed UI; project content may operate in Spanish, German, or English

**Scope:** Product structure, end-to-end system functionality, menu ownership, user-facing responsibilities

**Applies to:** All frontend, product, agent, UX, workflow, documentation, and implementation changes

---

## 1. Purpose

Vision Maxson AI Content Studio is a governed AI content-production studio. It is not merely a video generator or a collection of disconnected tools.

Its purpose is to coordinate the complete lifecycle of content production:

```text
IDEA
  ↓
RESEARCH
  ↓
BRIEF
  ↓
SCRIPT
  ↓
CRITIQUE / FACTUAL REVIEW
  ↓
STORYBOARD
  ↓
AUDIOVISUAL PRODUCTION
  ↓
FINAL MASTER
  ↓
PUBLISHING
  ↓
ANALYTICS
  ↓
LEARNING
  ↓
OPTIMIZATION OF FUTURE CONTENT
```

The central AI understands projects, accounts, integrations, costs, historical performance, editorial context, operational state, and user-approved rules.

---

## 2. Canonical Global Navigation

The primary left sidebar is intentionally short and stable.

```text
INICIO
PROYECTOS
FINANZAS
ACTUALIDADES
CUENTAS
INTELIGENCIA IA
ANALÍTICAS
PUBLISHING
INTEGRACIONES
DESCARGAS
CONFIGURACIÓN
```

Do not add global menu items for Guion, Storyboard, Voces, Assets, Monetización, or other project-level functions. Those functions belong inside the appropriate domain, primarily inside Projects.

---

## 3. Inicio

Inicio is the executive command center. It answers what is active, what is in progress, what needs attention, what is performing well, what is scheduled next, whether the system is healthy, and what the current AI cost/usage picture looks like.

Typical content includes active projects, productions this month, publications, general performance, AI costs, system health, relevant system activity, recent projects, upcoming publications, and high-priority alerts.

Inicio is a summary, not the place where every function is executed.

---

## 4. Proyectos

This is where the real content-production work lives.

The global Projects page lists projects, their state, progress, type, recent activity, and current phase. Once a project is opened, the user enters a project workspace.

Canonical internal project flow:

```text
Resumen
→ Research
→ Brief
→ Guion
→ Critique / revisión editorial
→ Storyboard
→ Escenas
→ Personajes / Voces
→ Assets
→ Generación
   → Imagen
   → Vídeo
→ Audio
   → Narración
   → Música
   → SFX
→ Montaje / Rough Cut
→ QA audiovisual
→ Master final
→ Publicación
→ Métricas
→ Historial / versiones / aprobaciones
```

These are project-level functions, not global navigation items.

### Project language behavior

The Vision Maxson interface remains in Spanish. Channel/project production may operate natively in Spanish, German, or English. The canonical source language of scripts, voice, assets, captions, and publishing material follows the project/channel configuration.

When source content is German or English, the owner must have an optional translate-to-Spanish control for comprehension. For audio/video review, a Spanish listening/translation aid may be generated for review without replacing the canonical source-language media.

### Project progression UI

The project workspace should expose an editor-like visual progression/timeline for the production lifecycle, complemented by tabs/views for the detailed modules. This is a production-control timeline, not a requirement to reproduce a full Premiere-style nonlinear editor in V1.

---

## 5. Finanzas

Finanzas contains the operational economics of Vision Maxson AI Content Studio.

Its internal views may cover gross income, expenses, AI/provider costs, cost per project, cost per asset/video, estimated taxes, net benefit, evolution over time, forecasts, source/platform breakdowns, and Google Sheets synchronization where useful.

There is no standalone global “Monetization Strategy” menu. Monetization optimization is handled by the Intelligence layer using financial and analytics data.

Notion is not part of the canonical product direction. Google Sheets is the preferred spreadsheet integration.

---

## 6. Actualidades

Actualidades is the studio radar.

It consolidates information that can affect operations, content opportunities, cost, provider choices, publishing, or strategy.

Internal filters may cover AI news, tool/provider updates, API/platform changes, system alerts, opportunities, market/content trends, and reminders. These remain filters inside Actualidades, not additional global menu entries.

The system should analyze relevance rather than merely display a generic news feed.

---

## 7. Cuentas

Cuentas groups identity, brands, destinations, and connected social/channel profiles.

Internal views may include Marcas, Canales, Cuentas sociales, brand identity, channel rules, languages, audiences, and permissions/roles associated with brands and channels.

Example hierarchy:

```text
Marca
└─ Canales
   ├─ YouTube
   ├─ TikTok
   ├─ Instagram
   └─ Facebook
```

---

## 8. Inteligencia IA

Inteligencia IA is the brain of Vision Maxson.

The user interacts with Vision Maxson itself, not with a visible list of underlying foundation models. The system may internally use ChatGPT/OpenAI, Gemini, Claude, Agnes, or future providers, but model routing is internal.

Canonical user-facing modes:

```text
INTELIGENCIA IA
├─ Chat
├─ Memoria / contexto
├─ Tareas
└─ Acciones
```

### Chat

User messages appear on the left. Vision Maxson responses appear on the opposite side. Every textual response can be played with voice. Chat can access relevant system/project context according to permissions.

### Voice

A visible **“Iniciar voz”** action starts a live voice conversation similar in interaction concept to ChatGPT Voice or Gemini Live.

The system listens, understands context, responds by voice, and can prepare or execute authorized actions.

### Background intelligence

While the user talks or writes, the system may detect intent, retrieve relevant context, inspect project/system data, select internal capabilities/models, plan, respond or act, and record/audit permitted actions.

The user does not need to see which internal model performed each step.

---

## 9. Analíticas

Analíticas is the performance intelligence layer.

It may include views, watch time, engagement, conversion, growth, platform performance, channel performance, audience, top content, publishing windows, historical patterns, and AI-generated insights.

The purpose is not only reporting. Analytics feed back into future decisions.

Canonical learning loop:

```text
CONTENT
  ↓
PUBLISH
  ↓
ANALYTICS
  ↓
INTELLIGENCE
  ↓
LEARNING
  ↓
BETTER NEXT CONTENT
```

---

## 10. Publishing

Publishing has exactly two global submenus:

```text
PUBLISHING
├─ Listo para publicar
└─ Scheduler
```

### Listo para publicar

Contains masters that have passed the necessary project/QA gates and are ready for publication review.

Typical checks include title, description, thumbnail, captions, CTA, hashtags, target account/platform, format, and policy/compliance status.

### Scheduler

Calendar and multi-channel scheduling.

It can support schedule creation, rescheduling, conflict detection, recommended publishing windows, automated publishing, and platform/channel visibility.

---

## 11. Integraciones

Integraciones contains the external tools and services available to Vision Maxson.

Examples include Agnes, OpenAI, Gemini/Google, Google Flow, ElevenLabs, Cloudflare, Google Drive, Google Sheets, YouTube, TikTok, Instagram/Meta, and future providers.

Key principle:

**Integrations shows what tools exist. Intelligence decides how to use them.**

Do not create one global sidebar item per provider.

---

## 12. Descargas

Descargas is a simple retrieval interface for generated outputs. It is not the general storage architecture.

The user can search by filename, video, image, document, or project.

Primary use cases include final masters, approved clips, images, documents, audio, and ZIP/export packages.

No “Nueva descarga” action is required. Files are selected and downloaded.

Search must be able to find a desired project and its downloadable outputs.

---

## 13. Configuración

Configuration contains administrative and technical settings that should not pollute daily navigation.

Canonical internal tabs:

```text
CONFIGURACIÓN
├─ General
├─ Idioma y apariencia
├─ Permisos y seguridad
├─ Notificaciones
├─ Estado del sistema
└─ Actualizaciones
```

### Estado del sistema / System Check

This can show health of the core platform, AI processing, database, storage, rendering, APIs/integrations, and background jobs.

### Actualizaciones

This can show the current version, release notes, fixes, new features, and available updates.

These remain internal tabs, not required global sidebar entries.

---

## 14. End-to-End Example

User intent:

> “Quiero un short en alemán sobre el fallo de Ariane 5.”

Canonical journey:

```text
1. Create/Open Project
2. Research
3. Brief
4. Script
5. Critique / factual review
6. Storyboard
7. Scene production
8. Image/video asset generation
9. Voice/narration
10. Music/SFX
11. Composition / Rough Cut
12. Audiovisual QA
13. Final Master
14. Ready to Publish
15. Scheduler / Immediate Publish
16. Platform distribution
17. Analytics collection
18. Intelligence learns from results
19. Future content optimization
```

---

## 15. Functional Master Map

```text
                         ┌─────────────────────┐
                         │   INTELIGENCIA IA   │
                         │ Cerebro del sistema │
                         └──────────┬──────────┘
                                    │
                ┌───────────────────┼────────────────────┐
                │                   │                    │
                ▼                   ▼                    ▼
           ACTUALIDADES         ANALÍTICAS          FINANZAS
                │                   │                    │
                └──────────────┬────┴──────────────┬─────┘
                               │                   │
                               ▼                   │
                         RECOMENDACIONES           │
                               │                   │
                               ▼                   │
 CUENTAS ───────────────► ┌───────────┐ ◄──────────┘
 Marcas / Canales         │ PROYECTOS │
                          └─────┬─────┘
                                │
              Research → Brief → Guion → Critique
                                ↓
                            Storyboard
                                ↓
                             Escenas
                                ↓
                          Assets / Voces
                                ↓
                       Generación audiovisual
                                ↓
                          Rough Cut / QA
                                ↓
                          MASTER FINAL
                                ↓
                            PUBLISHING
                          ↙            ↘
                Listo para publicar   Scheduler
                          \            /
                           ▼          ▼
                     REDES / PLATAFORMAS
                               │
                               ▼
                           ANALÍTICAS
                               │
                               └─────► INTELIGENCIA IA
                                       aprende y optimiza

INTEGRACIONES = tools/providers available to the system
DESCARGAS = output retrieval
CONFIGURACIÓN = administration and technical settings
INICIO = executive summary of everything
```

---

## 16. Production Governance Defaults

Current confirmed production-governance rules:

- provider behavior supports `Auto / Prefer / Locked`;
- before generation, Vision Maxson shows recommended parameters, allows parameter changes, and presents provider-aware estimated cost;
- cost visibility should support generation/attempt, scene, project, and remaining budget;
- budget controls exist per project, channel, provider, and month;
- alert thresholds are 70%, 90%, and 100%;
- Assisted is the default posture for early production workflows;
- human approval is required for important spend, regenerations outside configured limits, and other critical actions;
- no more than 2 automatic regenerations may occur within policy before human approval is required;
- technical retry does not create a new creative Take;
- creative regeneration creates a new Take and preserves prior Takes.

No absolute EUR ceiling is canonical until explicitly approved.

---

## 17. Product Authority Hierarchy

When implementation, mockups, agent suggestions, or existing code conflict, use this order:

```text
1. Explicit owner-confirmed decisions.
2. This Product Master Map.
3. VISION_MAXSON_UI_CANON.md.
4. Master Specification / accepted ADRs.
5. Existing implementation.
6. Agent proposals.
```

Lower levels must not silently override higher levels.

If unclear, stop and ask rather than invent.

---

## 18. Privacy Invariants

The normal Vision Maxson UI must not show the owner real name, personal email, or personal photo/avatar.

These may exist internally where technically necessary for authentication/security and may appear in protected administrative/security contexts when required.

Downloaded PDFs, exports, invoices, reports, legal documents, and other generated files may contain owner/personal/legal identity when required by their purpose or explicitly requested. The privacy invariant is primarily a normal-interface visibility rule, including protection against casual shoulder-surfing.

---

## 19. Change Control

Any change to the 11-item global navigation, project-level ownership of Guion/Storyboard/Voces/etc., Publishing submenu structure, Intelligence AI behavior, owner privacy, primary interface language, or canonical visual identity requires explicit owner approval before implementation.
