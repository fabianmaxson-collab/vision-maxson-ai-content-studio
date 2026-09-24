import type { z } from 'zod';
import { languageCodeSchema, type scriptCritiqueSchema } from '@vision-maxson/contracts';

type Critique = z.infer<typeof scriptCritiqueSchema>;
export const SCRIPT_CRITIQUE_SUPPORTED_PRIMARY_LANGUAGES = ['de', 'es', 'en'] as const;
type Language = (typeof SCRIPT_CRITIQUE_SUPPORTED_PRIMARY_LANGUAGES)[number];

export class ScriptCritiqueLanguageCapabilityError extends Error {
  readonly status = 422;
  readonly code = 'script_critic_language_not_supported';
  readonly stage = 'SCRIPT_CRITIC';
  readonly primaryLanguage: string;
  readonly supportedPrimaryLanguages = SCRIPT_CRITIQUE_SUPPORTED_PRIMARY_LANGUAGES;

  constructor(readonly sourceLanguage: string) {
    const primaryLanguage = sourceLanguage.split('-')[0]?.toLowerCase() ?? '';
    super(
      `script_critic_language_not_supported: stage=SCRIPT_CRITIC; sourceLanguage=${sourceLanguage}; primaryLanguage=${primaryLanguage}; supportedPrimaryLanguages=${SCRIPT_CRITIQUE_SUPPORTED_PRIMARY_LANGUAGES.join(',')}`,
    );
    this.primaryLanguage = primaryLanguage;
  }
}

export function scriptCritiqueSourcePrimaryLanguage(sourceLanguage: string): Language {
  const primaryLanguage = sourceLanguage.split('-')[0]?.toLowerCase();
  if (
    !languageCodeSchema.safeParse(sourceLanguage).success ||
    !SCRIPT_CRITIQUE_SUPPORTED_PRIMARY_LANGUAGES.some((language) => language === primaryLanguage)
  )
    throw new ScriptCritiqueLanguageCapabilityError(sourceLanguage);
  return primaryLanguage as Language;
}

// Closed, deliberately small function-word models. Proper names, numerals and technical
// terms contribute no evidence; an uncertain result is rejected instead of guessed.
const words: Record<Language, ReadonlySet<string>> = {
  de: new Set(
    'der die das den dem des ein eine einer einen einem und oder aber nicht ist sind war waren wird werden mit für von vom im in am an auf aus bei zu zur zum als dass weil wenn durch über unter nach vor auch nur noch keine kein einen einer dieser diese dieses sein seine ihrer ihre er sie es wir sich hat haben wurde wurden kann können soll müssen zwischen gegen ohne sowie dabei damit jedoch deshalb dadurch genau klar bleibt entsprechen entspricht enthält zeigt erklärt nennt beschreibt geprüft belegt präzise unmittelbar weiterhin'.split(
      ' ',
    ),
  ),
  es: new Set(
    'el la los las un una uno unos unas y o pero no es son fue fueron será con para por del al en de desde como que porque cuando durante entre sobre sin también sólo se su sus este esta estos estas hay tiene tienen debe puede mantiene coincide funciona bien aprobado aprobada guion investigación inmediatamente claro sobrio documental narración datos causa información trayectoria vehículo'.split(
      ' ',
    ),
  ),
  en: new Set(
    'the a an and or but not is are was were with for from in on at to of as that because when by about between without also this these those it they we has have should must can remains follows source script research approved evidence'.split(
      ' ',
    ),
  ),
};

export type CritiqueLanguageFinding = {
  field: string;
  expected: string;
  detected: Language | 'mixed' | 'unknown';
  reason:
    | 'aggregate_language_mismatch'
    | 'aggregate_language_unknown'
    | 'field_conflicting_language'
    | 'substantial_mixed_language';
};

function detect(text: string): Language | 'mixed' | 'unknown' {
  const tokens = text.toLocaleLowerCase('und').match(/\p{L}+/gu) ?? [];
  const score: Record<Language, number> = { de: 0, es: 0, en: 0 };
  for (const token of tokens) {
    for (const language of SCRIPT_CRITIQUE_SUPPORTED_PRIMARY_LANGUAGES)
      if (words[language].has(token)) score[language] += 1;
  }
  const ordered = [...SCRIPT_CRITIQUE_SUPPORTED_PRIMARY_LANGUAGES].sort(
    (a, b) => score[b] - score[a],
  );
  const top = ordered[0]!;
  const runnerUp = ordered[1]!;
  if (score[top] >= 2 && score[runnerUp] >= 2 && score[runnerUp] / score[top] >= 0.3)
    return 'mixed';
  if (score[top] < 2 || score[top] - score[runnerUp] < 2) return 'unknown';
  return top;
}

export function editorialLanguageFindings(
  fields: readonly { field: string; text: string }[],
  sourceLanguage: string,
): CritiqueLanguageFinding[] {
  const expected = scriptCritiqueSourcePrimaryLanguage(sourceLanguage);
  const corpus = fields.map(({ text }) => text).join(' ');
  const findings = fields.map(({ field, text }): CritiqueLanguageFinding => {
    const detected = detect(text);
    return {
      field,
      expected,
      detected,
      reason: detected === 'mixed' ? 'substantial_mixed_language' : 'field_conflicting_language',
    };
  });
  const aggregate = detect(corpus);
  if (aggregate !== expected)
    return [
      {
        field: 'editorialProse',
        expected,
        detected: aggregate,
        reason:
          aggregate === 'unknown'
            ? 'aggregate_language_unknown'
            : aggregate === 'mixed'
              ? 'substantial_mixed_language'
              : 'aggregate_language_mismatch',
      },
      ...findings.filter(
        (finding) => finding.detected !== 'unknown' && finding.detected !== expected,
      ),
    ];
  return findings.filter(
    (finding) => finding.detected !== 'unknown' && finding.detected !== expected,
  );
}

export function critiqueLanguageFindings(
  critique: Critique,
  sourceLanguage: string,
): CritiqueLanguageFinding[] {
  return editorialLanguageFindings(
    [
      ...critique.strengths.map((text, index) => ({ field: `strengths[${index}]`, text })),
      ...critique.issues.flatMap((issue, index) => [
        { field: `issues[${index}].issue`, text: issue.issue },
        { field: `issues[${index}].recommendation`, text: issue.recommendation },
      ]),
    ],
    sourceLanguage,
  );
}
