# ADR-005: Spanish-first product and review locales

Status: Accepted globally for all future phases.

Decision date: 2026-09-03. This ADR records an architectural decision only; it does not authorize a Phase 2 UI translation or Phase 3 implementation.

## Decision

VISION MAXSON is Spanish-first for both its user interface and Fabian's review and supervision experience:

- `ui_locale = es`
- `review_locale = es`
- `content_language` / `output_language` are project-specific and independent

User-facing operational text defaults to Spanish. This includes menus, buttons, labels, alerts, explanations, AI recommendations, diagnostics, review comments, approval screens, project-status explanations, monetization explanations, cost/resource explanations and script-review assistance. Technical terms such as OAuth, API, RPM, CPM, Shorts, Reels, staging, workflow and prompt may remain in English when that is clearer.

The UI locale must never be used to infer a project's content or output language. Projects and channels may independently produce English, German, Spanish or additional future languages. Voice-over language, publication-metadata language and subtitle languages are likewise project/channel-specific and independent from the UI locale.

## Script review invariant

When a future production script is not Spanish, the canonical production-language script must remain unchanged and a faithful Spanish review representation must be available for Fabian's supervision. The review translation is a derivative, traceable representation; it must never replace or mutate the production source script.

Conceptually:

```text
Production Script — project output language
└── Review Version — Spanish (faithful, non-destructive derivative)
```

Future persistence and contracts must distinguish at least source script, source language, review representation, review locale, translation provenance and version linkage.

## Implementation constraint

Future UI work must use an i18n architecture with Spanish as the default locale instead of hardcoded Spanish strings. Locale keys and fallback behavior must permit English, German and other UI locales later without redesigning product modules. API/domain values remain stable locale-independent identifiers; localization occurs at presentation and review boundaries.

## Current boundary

Phase 2 remains closed as delivered. No broad translation, UI refactor, content-generation behavior or Phase 3 functionality is performed as part of this documentation change.

ADR-006 applies this locale separation to the future Review Read-Aloud / Preview TTS design: playback follows each artifact's language metadata, while Spanish remains the default review language.
