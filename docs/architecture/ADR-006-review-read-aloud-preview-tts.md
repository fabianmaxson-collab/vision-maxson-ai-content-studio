# ADR-006: Review Read-Aloud / Preview TTS

Status: accepted for Phase 3 design; not implemented.

Decision date: 2026-09-03. This ADR records a requirement for the Phase 3 PRE-IMPLEMENTATION design. It does not authorize Phase 3 implementation, a paid TTS integration, or production voice generation.

## Decision

VISION MAXSON will treat review playback and production narration as separate concepts:

- **Review Read-Aloud / Preview TTS** is a read-only accessibility and supervision capability inside the product UI. Phase 3 should prefer browser/system speech synthesis, with no persisted audio, provider call, production credit consumption, or production asset creation.
- **Production Voice-over** is a future media-generation capability. It uses the project's production Voice Profile and produces the narration asset intended for publication. It is outside the Phase 3 Review Read-Aloud scope.

Review playback must never change artifact content or version, approval state, dependency validity, project lifecycle, or production assets. It must not invoke ElevenLabs or replace a production Voice Profile.

## Language and locale model

ADR-005 remains authoritative. Speech language is selected from the language metadata of the artifact or segment being read, never from `ui_locale` alone.

The following concepts remain independent:

- `ui_locale = es`: Spanish-first product interface.
- `review_locale = es`: Spanish-first supervision and review experience.
- `content_language` / `output_language`: project- or artifact-specific production language.
- Review speech voice preference: optional client preference per language, independent from production Voice Profiles.

For a German production script with a Spanish review version, the production script is spoken in German and the separate review version is spoken in Spanish. Playback must not merge, replace, or mutate either artifact.

## Preferred Phase 3 design direction

The Phase 3 PRE-IMPLEMENTATION design must evaluate the Web Speech API (`SpeechSynthesis`) or an equivalent browser-native capability as the default adapter. The preferred implementation:

- begins only after explicit user interaction;
- synthesizes locally and transiently where the browser permits;
- automatically prefers an available voice compatible with the artifact language;
- exposes honest capability states such as `available`, `voice_unavailable`, and `speech_not_supported`;
- uses clear Spanish fallback messages without claiming unavailable voice quality;
- keeps an adapter boundary for a future, separately approved provider fallback;
- requires no backend, API, database, storage, upload, or generation job unless the PRE-IMPLEMENTATION analysis proves one necessary.

A paid TTS provider must not be introduced for review playback without a separately approved, evidenced technical need. Preview speech must not be stored in R2, Google Drive, or another persistent store.

## Reusable UI capability

Design Review Read-Aloud as a reusable component and client service, not duplicated screen-specific playback code. Appropriate consumers include substantial editorial material such as research summaries, Idea Candidates, Content Briefs, production scripts, Spanish review versions, critiques, storyboard or scene descriptions, preflight explanations, and AI recommendations.

Do not add playback controls to small labels, navigation text, or technical identifiers.

The minimum interaction model is:

- `Escuchar`;
- `Pausar` / `Reanudar`;
- `Detener`;
- visible and programmatically exposed playback state.

The design must evaluate playback speed, restart, and optional voice selection when multiple language-compatible voices exist. Suggested speed choices such as 0.75x, 1.0x, 1.25x, and 1.5x are non-binding and should follow browser capabilities and clean UX.

The architecture must support both complete-artifact playback and bounded segment playback, including paragraphs, script segments, storyboard scenes, and critique sections. It must evaluate `Escuchar selección` for highlighted text; selection playback may be deferred if browser limitations make it disproportionate, but the component boundary must permit adding it without redesign.

## Client, privacy, and accessibility constraints

The design must account for browser and operating-system differences, delayed voice availability, missing language-compatible voices, and mobile autoplay restrictions. Desktop, tablet, and mobile controls must remain compact and start playback only from an explicit user action.

Controls must be keyboard operable, have appropriate accessible names, expose playback state to assistive technology, and never rely on color alone.

Browser-native synthesis is preferred so editorial text is not sent to another provider solely for review. Any future provider fallback requires explicit approval plus provider, privacy, and data-handling configuration.

## Required Phase 3 PRE-IMPLEMENTATION report section

The Phase 3 PRE-IMPLEMENTATION REPORT must include a dedicated section titled `REVIEW READ-ALOUD / PREVIEW TTS DESIGN` covering:

1. proposed browser technology;
2. reusable component and adapter architecture;
3. artifact-language selection;
4. automatic and optional manual voice selection;
5. playback controls and state model;
6. full-artifact and segment playback;
7. text-selection feasibility;
8. desktop, tablet, and mobile behavior;
9. browser and operating-system limitations;
10. fallback strategy;
11. privacy implications;
12. accessibility behavior;
13. whether backend, API, or database changes are necessary;
14. the exact boundary from future Production Voice-over.

## Current boundary

This is documentation only. No playback component, Web Speech integration, backend route, schema change, storage resource, provider integration, production voice generation, or Phase 3 functionality is created by this decision.
