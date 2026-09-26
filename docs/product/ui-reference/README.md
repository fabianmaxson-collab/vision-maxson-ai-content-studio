# Vision Maxson AI Content Studio — Approved UI Reference Set

**Status:** APPROVED VISUAL REFERENCE

**Relationship:** Companion visual reference to `docs/product/VISION_MAXSON_UI_CANON.md` and `docs/product/VISION_MAXSON_PRODUCT_MASTER_MAP.md`

---

## 1. Purpose

These screenshots establish the owner-approved visual direction, composition, information density, component language, and overall UX character of Vision Maxson AI Content Studio.

They serve as **aspirational visual references** to guide frontend development and design integrity; they are **not pixel-perfect final implementation requirements**.

---

## 2. Core Design Principles

All frontend interfaces must reflect the approved visual language:

- **Dark Navy / Deep Blue Visual Foundation:** Sleek dark navy and deep blue background palette (`#0B0F19`, `#0D1527`, `#111C38`) creating a cohesive studio atmosphere.
- **Gold Premium Accent:** Strategic gold accents (`#D4AF37`, `#F59E0B`, warm metallic tones) designating active navigation states, primary highlights, and premium brand status.
- **Glass / Translucent Panel Language:** Glassmorphic card surfaces with subtle backdrop blur, light transparency, and layered visual depth.
- **Thin Blue Borders and Restrained Glow:** Delicate border lines (`rgba(59, 130, 246, 0.15)` - `rgba(59, 130, 246, 0.3)`) paired with controlled, non-distracting luminescent halos on focus and active states.
- **Rounded Modular Dashboard Cards:** Clean, rounded card containers (`border-radius: 12px` to `16px`) organizing dense studio workflows into digestible modular components.
- **High Information Density Desktop Composition:** Desktop-first 16:9 widescreen layout calibrated for high-volume content operations without feeling cluttered.
- **Global Left Navigation:** Canonical 11-item vertical navigation sidebar anchored on the left.
- **Global Search & Header:** Prominent global search bar positioned in the top header with keyboard shortcuts, global controls, and notifications.
- **Strong Visual Hierarchy:** Immediate typographical contrast distinguishing primary metrics, section headings, and subordinate telemetry.
- **Clear KPI and Status Components:** Standardized badges and KPI blocks utilizing semantically colored indicators (success, warning, processing, error).
- **Responsive Adaptation:** Responsive reflow and adaptive scaling for tablet and mobile viewports are fully permitted.
- **Evolutionary Consistency:** The user interface may evolve and refine layout details as long as the approved core visual language and written product canon are preserved.

---

## 3. Important Data Rule (Mock Data vs. Runtime Truth)

> [!IMPORTANT]
> **Mockup data is strictly illustrative.**
>
> All sample numbers, percentages, dates, costs, currency amounts, project titles, channel names, storage sizes, provider states, software versions, alerts, and analytics shown inside these screenshots are **MOCK / ILLUSTRATIVE** unless backed by canonical written specifications or real runtime system data.
>
> **Do NOT convert screenshot sample data into runtime truth.**

---

## 4. Visual Reference Manifest

### `01-inicio.jpg`

- **Purpose:** Executive studio dashboard / command center reference.
- **Key Elements:** High-level studio KPIs, active production overview, platform health summary, recent project activity, upcoming scheduled publications, and executive resource telemetry.

### `02-proyectos.jpg`

- **Purpose:** Projects overview and selected-project workspace reference.
- **Key Elements:** Multi-project grid/list selector, status badges, progress indicators, metadata cards, and project-level workspace drill-down container.

### `03-finanzas.jpg`

- **Purpose:** Financial dashboard composition reference.
- **Key Elements:** Studio budget tracking, AI provider inference expenditures, revenue attribution, margin analytics, historical expense curves, and modular billing KPI widgets.

### `04-actualidades.jpg`

- **Purpose:** News, platform intelligence, alerts, and monitored-source reference.
- **Key Elements:** Curated intelligence feeds, trend monitoring cards, news source health status, platform policy update alerts, and editorial discovery streams.

### `05-cuentas.jpg`

- **Purpose:** Brands, channels, accounts, roles, and identity reference.
- **Key Elements:** Brand entity registry, social channel connection states, team roles, workspace permissions, and channel identity profiles.

### `06-inteligencia-ia.jpg`

- **Purpose:** Vision Maxson Intelligence chat / memory / tasks / actions reference.
- **Key Elements:** Studio assistant conversational console, memory inspection panel, proactive workflow recommendations, and task action triggers.
- **Special Layout Invariants:**
  - User messages visually belong on the **LEFT** and Vision Maxson responses on the opposite side.
  - Voice interaction triggers ("Iniciar voz") and voice playback controls are prominent interactive elements.
  - Internal AI model/provider selection dropdowns must **never** be exposed in normal product UI.

### `07-analiticas.jpg`

- **Purpose:** Cross-platform analytics and AI insight dashboard reference.
- **Key Elements:** Multi-platform engagement graphs, retention heatmaps, comparative video performance matrices, and automated AI audience insights.

### `08-publishing.jpg`

- **Purpose:** Publishing overview / queue / platform distribution / scheduler reference.
- **Key Elements:** Distribution hub displaying global release pipeline, staging status, multi-channel broadcast matrix, and immediate queue overview.

### `09-listo-para-publicar.jpg`

- **Purpose:** Ready-to-publish review, checklist, and distribution reference.
- **Key Elements:** Final distribution gate, automated preflight compliance checklist, multi-platform title/tag/caption packaging, thumbnail selector, and manual release sign-off.

### `10-scheduler.jpg`

- **Purpose:** Multi-platform scheduling calendar and publishing automation reference.
- **Key Elements:** Interactive multi-channel monthly/weekly calendar grid, optimal posting time recommendation markers, drag-and-drop rescheduling, and queue slot monitors.

### `11-integraciones.jpg`

- **Purpose:** Integration/provider/service status dashboard reference.
- **Key Elements:** External service connector grid (Cloudflare, AI video providers, YouTube, TikTok, Google Drive), latency/uptime indicators, API health telemetry, and credential status cards.

### `12-descargas.jpg`

- **Purpose:** Searchable downloadable output / file retrieval reference.
- **Key Elements:** Searchable output archive, file resolution/format badges, multi-file selection controls, batch download trigger, and R2/Drive asset retrieval status.
- **Strict Constraint:** Do **NOT** infer that a _"Nueva descarga"_ action button is required. Current written canon explicitly forbids that behavior; downloads represent generated outputs, not manual uploads or creation requests.

### `13-configuracion.jpg`

- **Purpose:** Configuration page and internal-tab composition reference.
- **Key Elements:** Studio administration settings, environment configuration, system preferences, and security controls.
- **Canonical Internal Tabs:**
  1. `General`
  2. `Idioma y apariencia`
  3. `Permisos y seguridad`
  4. `Notificaciones`
  5. `Estado del sistema`
  6. `Actualizaciones`
