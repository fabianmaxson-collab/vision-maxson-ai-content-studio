import { describe, expect, it } from 'vitest';
import { languageCodeSchema, scriptCritiqueSchema } from '@vision-maxson/contracts';
import {
  critiqueLanguageFindings,
  scriptCritiqueSourcePrimaryLanguage,
  SCRIPT_CRITIQUE_SUPPORTED_PRIMARY_LANGUAGES,
  ScriptCritiqueLanguageCapabilityError,
} from '../src/editorial/critique-language';
import { scriptCritiqueLanguageInstructions } from '../src/editorial/execution';

const dimensions = [
  'FACTUAL_CONSISTENCY',
  'BRIEF_ALIGNMENT',
  'RESEARCH_ALIGNMENT',
  'CLARITY',
  'HOOK',
  'PACING',
  'REDUNDANCY',
  'CTA',
  'TECHNICAL_ACCURACY',
  'SHORT_FORMAT_SUITABILITY',
  'LANGUAGE_AND_EDITORIAL_CONSTRAINTS',
];
const german = () =>
  scriptCritiqueSchema.parse({
    sourceScriptVersionId: 'script-v3',
    languageCode: 'de',
    strengths: [
      'Der deutsche Kurzfilm erklärt, warum bei Ariane 5 ein 64-Bit-Gleitkommawert aus dem SRI in eine 16-Bit-Ganzzahl umgewandelt wurde.',
      'Die Erzählung nennt den Vulcain und zeigt die technische Ursache klar, ohne unbelegte Behauptungen zu ergänzen.',
    ],
    issues: [
      {
        dimension: 'PACING',
        issue:
          'Der zweite Abschnitt ist für das kurze Video zu dicht und braucht eine klarere Pause.',
        severity: 'MEDIUM',
        recommendation:
          'Die deutsche Erklärung soll einen Nebensatz entfernen und den technischen Übergang präzise beibehalten.',
        confidence: 0.9,
        evidenceType: 'RULE_BASED',
        segmentOrders: [2],
      },
    ],
    dimensionsEvaluated: dimensions,
  });

describe('SCRIPT_CRITIC source-language contract', () => {
  it('derives the prompt from source language, never from review language', () => {
    expect(scriptCritiqueLanguageInstructions('de')).toContain('German');
    expect(scriptCritiqueLanguageInstructions('es')).toContain('Spanish');
    expect(scriptCritiqueLanguageInstructions('en')).toContain('English');
    expect(() => scriptCritiqueLanguageInstructions('xx')).toThrow();
  });
  it('accepts complete German technical prose and empty issues', () => {
    expect(critiqueLanguageFindings(german(), 'de')).toEqual([]);
    expect(critiqueLanguageFindings({ ...german(), issues: [] }, 'de')).toEqual([]);
  });
  it('rejects the actual Spanish-strengths defect even with empty issues', () => {
    const critique = {
      ...german(),
      strengths: [
        'El guion abre inmediatamente con el hook aprobado y mantiene un tono claro, sobrio y documental.',
        'La cadena causal coincide con el brief y la investigación, pero la explicación necesita más tiempo.',
      ],
      issues: [],
    };
    expect(critiqueLanguageFindings(critique, 'de').length).toBeGreaterThan(0);
    expect(critiqueLanguageFindings(critique, 'de')[0]?.detected).toBe('es');
  });
  it('rejects substantial German/Spanish mixture', () => {
    const critique = {
      ...german(),
      strengths: [
        ...german().strengths,
        'El guion mantiene una narración clara, pero la secuencia necesita más tiempo para explicar la causa.',
      ],
    };
    expect(critiqueLanguageFindings(critique, 'de').length).toBeGreaterThan(0);
  });
  it('checks each issue prose field, not just aggregate strengths', () => {
    for (const field of ['issue', 'recommendation'] as const) {
      const critique = german();
      const issues = [
        {
          ...critique.issues[0]!,
          [field]:
            'El guion mantiene una narración clara, pero la secuencia necesita más tiempo para explicar la causa.',
        },
      ];
      expect(
        critiqueLanguageFindings({ ...critique, issues }, 'de').some(
          (f) => f.field === `issues[0].${field}`,
        ),
      ).toBe(true);
    }
  });
  it('fails closed on too little evidence and foreign-language metadata', () => {
    expect(
      critiqueLanguageFindings({ ...german(), strengths: ['Ariane 5'], issues: [] }, 'de').length,
    ).toBeGreaterThan(0);
    expect(() => critiqueLanguageFindings(german(), 'fr')).toThrow(
      ScriptCritiqueLanguageCapabilityError,
    );
  });
});

describe('hierarchical short-field evidence', () => {
  it('accepts the exact C44 short German field when the aggregate is confidently German', () => {
    const critique = {
      ...german(),
      strengths: [
        'Der Hook funktioniert.',
        'Die Erzählung erklärt den technischen Fehler klar und präzise.',
      ],
      issues: [],
    };
    expect(critiqueLanguageFindings(critique, 'de')).toEqual([]);
  });
  it('accepts short technical and proper-name German fields within a German corpus', () => {
    const critique = {
      ...german(),
      strengths: [
        'Der SRI fällt aus.',
        'Der 64-Bit-Wert ist kritisch.',
        'Vulcain startet korrekt.',
        'Die Erzählung erklärt Flight 501, Software und System Engineering klar und präzise.',
      ],
      issues: [],
    };
    expect(critiqueLanguageFindings(critique, 'de')).toEqual([]);
  });
  it.each(['El guion funciona bien.', 'La narración mantiene un tono claro.'])(
    'rejects short Spanish prose despite a German aggregate: %s',
    (wrong) => {
      const critique = { ...german(), strengths: [...german().strengths, wrong] };
      const findings = critiqueLanguageFindings(critique, 'de');
      expect(findings).toContainEqual({
        field: 'strengths[2]',
        expected: 'de',
        detected: 'es',
        reason: 'field_conflicting_language',
      });
    },
  );
  it('rejects Spanish issue and recommendation fields in an otherwise German critique', () => {
    const critique = german();
    const issues = [
      {
        ...critique.issues[0]!,
        issue: 'El guion funciona bien, pero la explicación de la causa necesita más tiempo.',
        recommendation:
          'La narración debe mantener un tono claro y la secuencia necesita una pausa.',
      },
    ];
    expect(critiqueLanguageFindings({ ...critique, issues }, 'de').map((f) => f.field)).toEqual(
      expect.arrayContaining(['issues[0].issue', 'issues[0].recommendation']),
    );
  });
  it('fails closed when all editorial fields are ambiguous', () => {
    const critique = { ...german(), strengths: ['Ariane 5.', 'SRI.', 'Flight 501.'], issues: [] };
    expect(critiqueLanguageFindings(critique, 'de')).toContainEqual({
      field: 'editorialProse',
      expected: 'de',
      detected: 'unknown',
      reason: 'aggregate_language_unknown',
    });
  });
});

describe('SCRIPT_CRITIC BCP-47 primary-language capability', () => {
  it('keeps the global product language contract broad', () => {
    for (const tag of ['de-DE', 'es-MX', 'en-GB', 'fr', 'fr-FR', 'pt-BR'])
      expect(languageCodeSchema.safeParse(tag).success).toBe(true);
  });

  it.each([
    ['de', 'de', 'German'],
    ['de-DE', 'de', 'German'],
    ['de-AT', 'de', 'German'],
    ['es', 'es', 'Spanish'],
    ['es-ES', 'es', 'Spanish'],
    ['es-MX', 'es', 'Spanish'],
    ['en', 'en', 'English'],
    ['en-US', 'en', 'English'],
    ['en-GB', 'en', 'English'],
  ])('supports %s as %s without review-language fallback', (tag, primary, name) => {
    expect(scriptCritiqueSourcePrimaryLanguage(tag)).toBe(primary);
    expect(scriptCritiqueLanguageInstructions(tag)).toContain(name);
    expect(scriptCritiqueLanguageInstructions(tag)).toContain('review language');
  });

  it.each([
    ['de-DE', 'Die Erzählung erklärt den technischen Fehler klar und präzise.'],
    ['de-AT', 'Die Erzählung erklärt den technischen Fehler klar und präzise.'],
    [
      'es-ES',
      'El guion mantiene una narración clara y explica la causa con datos de la investigación.',
    ],
    [
      'es-MX',
      'El guion mantiene una narración clara y explica la causa con datos de la investigación.',
    ],
    [
      'en-US',
      'The script explains the cause and follows the approved research with clear evidence.',
    ],
    [
      'en-GB',
      'The script explains the cause and follows the approved research with clear evidence.',
    ],
  ])('routes %s through normal semantic prose validation', (tag, prose) => {
    expect(critiqueLanguageFindings({ ...german(), strengths: [prose], issues: [] }, tag)).toEqual(
      [],
    );
  });
  it.each([
    ['fr', 'fr'],
    ['fr-FR', 'fr'],
    ['pt-BR', 'pt'],
  ])('rejects %s with typed stage-specific evidence', (tag, primary) => {
    expect(SCRIPT_CRITIQUE_SUPPORTED_PRIMARY_LANGUAGES).toEqual(['de', 'es', 'en']);
    try {
      scriptCritiqueSourcePrimaryLanguage(tag);
      throw new Error('Expected a capability rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(ScriptCritiqueLanguageCapabilityError);
      expect(error).toMatchObject({
        status: 422,
        code: 'script_critic_language_not_supported',
        stage: 'SCRIPT_CRITIC',
        sourceLanguage: tag,
        primaryLanguage: primary,
        supportedPrimaryLanguages: ['de', 'es', 'en'],
      });
    }
  });
});
