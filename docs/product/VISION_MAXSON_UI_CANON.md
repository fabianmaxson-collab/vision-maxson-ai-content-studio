# Vision Maxson AI Content Studio — UI Canon

**Status:** CANONICAL UI / UX AUTHORITY
**Relationship:** Companion to `VISION_MAXSON_PRODUCT_MASTER_MAP.md`

---

## 1. Purpose

This document prevents UI drift.

Approved mockups are visual references. Their sample metrics, dates, project names, costs, alerts, percentages, and other content are illustrative unless separately confirmed as real data.

Agents must preserve the approved structure and visual language instead of inventing new navigation or product modules.

---

## 2. Global Visual Language

Canonical characteristics:

- dark navy / deep blue base;
- restrained black/navy surfaces;
- gold accent for premium emphasis and active navigation;
- blue/cyan/purple/green status accents where semantically useful;
- glass/translucent panels;
- thin borders and subtle glow;
- rounded cards;
- high information density without visual clutter;
- desktop-first 16:9 dashboard composition;
- responsive implementation for tablet/mobile;
- official Vision Maxson logo visible;
- global search field at the top;
- Spanish primary UI;
- no owner name;
- no owner email;
- no owner personal photo/avatar.

Do not introduce unrelated visual identities, white SaaS themes, random brands, random product names, or different navigation styles.

---

## 3. Canonical Sidebar

Exactly these primary items:

```text
Inicio
Proyectos
Finanzas
Actualidades
Cuentas
Inteligencia IA
Analíticas
Publishing
Integraciones
Descargas
Configuración
```

Publishing may expand to:

- Listo para publicar
- Scheduler

Other feature groups remain internal page tabs/views, not new global sidebar items.

Configuration internal tabs:

- General
- Idioma y apariencia
- Permisos y seguridad
- Notificaciones
- Estado del sistema
- Actualizaciones

---

## 4. Global Header

Expected:

- global search input;
- optional keyboard shortcut hint;
- theme/display control;
- notifications;
- compact settings/filter control where appropriate;
- product slogan/accent text where appropriate.

Forbidden:

- owner real name;
- owner email;
- owner photo;
- visible internal AI-model selector in normal product UI.

Search should be able to locate relevant entities such as projects, assets, downloadable outputs, tools, and content according to the current page and permissions.

---

## 5. Inicio

Approved direction:

- executive summary;
- KPI cards;
- system health;
- current/recent activity;
- content performance;
- recent projects;
- upcoming publications;
- AI cost/usage or other operationally useful summary.

No personal greeting using owner identity.

---

## 6. Proyectos

Approved direction:

- project list/selector;
- progress/status;
- selected-project summary panel;
- project-specific navigation visible only once a project is opened.

Project workspace may expose internal modules such as:

- Resumen;
- Research;
- Brief;
- Guion;
- Critique;
- Storyboard;
- Escenas;
- Personajes/Voces;
- Assets;
- Generación;
- Audio;
- Rough Cut;
- QA;
- Master;
- Publicación;
- Métricas;
- Historial.

Do not move these into the global sidebar.

---

## 7. Finanzas

Approved direction:

- gross income;
- expenses;
- estimated taxes;
- net benefit;
- income/platform breakdown;
- principal expenses;
- monthly evolution;
- useful charts and forecasts.

Use Google Sheets where spreadsheet integration is shown. Do not show Notion.

---

## 8. Actualidades

Approved direction:

- feed of relevant updates;
- system/tool/AI/platform categories;
- priorities;
- alerts;
- monitored sources;
- recent activity.

Internal filters are preferred over sidebar expansion.

---

## 9. Cuentas

Approved direction:

- brands;
- connected channels;
- social accounts;
- brand identity;
- permissions/roles if needed;
- sync state/activity.

Do not expose owner personal identity.

---

## 10. Inteligencia IA

Approved Chat-tab direction:

- user messages on the LEFT;
- Vision Maxson AI responses on the opposite side;
- every AI text response can be played with voice;
- visible “Iniciar voz” action for a live voice conversation;
- internal model selection remains invisible;
- Vision Maxson is presented as one coherent system intelligence;
- background context/memory/analysis may be shown at a high level without exposing provider internals;
- tabs/views may include Chat, Memoria, Tareas, Acciones.

Do not show user-facing provider/model pickers as part of normal Intelligence UI.

---

## 11. Analíticas

Approved direction:

- global performance KPIs;
- evolution charts;
- platform performance;
- top content;
- audience;
- conversion funnel;
- publishing-time heatmap;
- AI insights.

---

## 12. Publishing

Approved parent view:

- publishing queue;
- distribution by platform;
- scheduler preview;
- final approval state;
- AI recommendations.

Only two canonical submenus:

- Listo para publicar
- Scheduler

### Listo para publicar

- content table;
- platform/filter controls;
- checklist;
- preview/review/publish actions;
- distribution summary.

### Scheduler

- weekly/monthly/list views;
- platform filters;
- schedule grid;
- queue;
- recommended times;
- automation settings;
- conflicts/alerts.

---

## 13. Integraciones

Approved direction:

- connected tools/providers;
- status;
- synchronization;
- automation/flows;
- API/webhook operational summaries;
- storage/service health.

Examples can include Agnes, OpenAI, Gemini, ElevenLabs, Google Flow, Cloudflare, Google Drive, Google Sheets, YouTube, TikTok, Meta.

Do not expose secrets or raw API keys.

---

## 14. Descargas

Approved direction:

- search files, final videos, or projects;
- filter by type;
- selectable rows;
- file preview/details;
- multi-select download action;
- focus on final masters and approved outputs.

Forbidden:

- “Nueva descarga” button;
- owner personal identity;
- unrelated upload/product-management features.

---

## 15. Configuración

Approved direction:

- compact internal tabs;
- administrative/technical settings;
- no duplication of other global sections.

Canonical tabs:

- General
- Idioma y apariencia
- Permisos y seguridad
- Notificaciones
- Estado del sistema
- Actualizaciones

---

## 16. Data Realism Rule

Mockup data is illustrative.

Frontend implementation must:

- bind to real system data where available;
- use explicit placeholders/skeletons where data is unavailable;
- never promote invented mockup values into production truth;
- never infer a real subscription, cost, project state, provider status, or analytics metric from an image mockup.

---

## 17. Agent UI Change Rule

Before any frontend/product/navigation change, the implementing agent must read:

1. `docs/product/VISION_MAXSON_PRODUCT_MASTER_MAP.md`
2. `docs/product/VISION_MAXSON_UI_CANON.md`

If a requested change conflicts with these documents, do not silently implement it.

Explicit owner approval is required for intentional canon changes.
