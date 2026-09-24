import { describe, expect, it } from 'vitest';
import { storyboardOutputV2Schema } from '@vision-maxson/contracts';
import { storyboardLanguageFindings } from '../src/editorial/storyboard-language';

const storyboard = () =>
  storyboardOutputV2Schema.parse({
    contractVersion: 'storyboard-output-v2',
    projectFormat: 'SHORT',
    aspectRatio: '9:16',
    scenes: [
      {
        order: 1,
        targetDurationSeconds: 60,
        scriptSegmentIds: ['segment_1'],
        narrationMode: 'AUTHORITATIVE_SCRIPT_SEGMENTS',
        visualDescription: 'Die Kamera zeigt die H0-Zeitachse und erklärt den Ablauf.',
        location: 'Die Szene ist im Kontrollraum.',
        action: 'Die Grafik zeigt die Umwandlung von 64-Bit zu 16-Bit.',
        cameraFraming: 'Die Kamera bleibt nah an der Anzeige.',
        cameraMovement: 'Die Kamera fährt langsam nach links.',
        mood: 'Die Szene bleibt ruhig und sachlich.',
        continuityKey: 'timeline',
        continuityReferenceKeys: [],
        continuityNotes: 'Die Anzeige bleibt in der nächsten Szene gleich.',
        transitionNotes: 'Der Schnitt folgt dem Signal.',
        aspectRatio: '9:16',
        safeAreaGuidance: {
          protectTop: true,
          protectBottom: true,
          protectSides: true,
          notes: 'Der Text bleibt in der Mitte.',
        },
        onScreenText: [
          {
            text: 'H0-Zeitachse',
            languageCode: 'de',
            placement: 'CENTER',
            startOffsetSeconds: 0,
            endOffsetSeconds: 5,
            purpose: 'LABEL',
          },
        ],
        captions: {
          mode: 'REQUIRED',
          languageCode: 'de',
          sourceScriptSegmentIds: ['segment_1'],
          styleGuidance: 'Die Untertitel bleiben gut lesbar.',
          safeAreaNotes: 'Die Zeile steht über dem Rand.',
        },
        factualClaims: [
          {
            claimText: 'Die Diagnosedaten sind nicht die Flugdaten.',
            status: 'OPEN',
            researchClaimIds: [],
            visualTreatment: 'Die Grafik zeigt den Unterschied.',
          },
        ],
        recommendedMediaType: 'MIXED',
        assetRequirements: ['Die historische Aufnahme wird geprüft.'],
        mediaReferences: [
          {
            requirement: 'Die Quelle muss eindeutig sein.',
            kind: 'ARCHIVE',
            sourceReferenceIds: [],
            rightsStatus: 'REQUIRES_VERIFICATION',
            notes: 'Die Rechte müssen geprüft werden.',
          },
        ],
        generationInstructions: 'Die Darstellung bleibt sachlich und ohne erfundene Details.',
        characterVersionIds: [],
        audioGuidance: {
          ambience: 'Die Geräusche bleiben leise.',
          soundEffects: ['Das Signal fällt aus.'],
          music: {
            use: 'OPTIONAL',
            guidance: 'Die Musik bleibt leise und ohne dramatische Wirkung.',
            rightsStatus: 'REQUIRES_VERIFICATION',
          },
        },
      },
    ],
  });

describe('Storyboard v2 source-language validation', () => {
  it('accepts German editorial prose with short technical phrases', () => {
    expect(storyboardLanguageFindings(storyboard(), 'de')).toEqual([]);
  });

  it('rejects Spanish prose despite German metadata', () => {
    const output = storyboard();
    output.scenes[0]!.visualDescription =
      'La cámara muestra la escena y explica la información de la trayectoria.';
    expect(storyboardLanguageFindings(output, 'de').length).toBeGreaterThan(0);
  });

  it('rejects substantial German and Spanish editorial mixing', () => {
    const output = storyboard();
    output.scenes[0]!.action =
      'La cámara muestra la escena y la información de la trayectoria con una narración clara.';
    expect(storyboardLanguageFindings(output, 'de').length).toBeGreaterThan(0);
  });

  it('rejects an ambiguous aggregate and mismatched overlay language code', () => {
    const output = storyboard();
    const scene = output.scenes[0]!;
    scene.visualDescription = 'H0-Zeitachse';
    scene.location = '';
    scene.action = '64-Bit / 16-Bit';
    scene.cameraFraming = '';
    scene.cameraMovement = '';
    scene.mood = '';
    scene.continuityNotes = '';
    scene.transitionNotes = '';
    scene.safeAreaGuidance.notes = '';
    scene.captions.styleGuidance = '';
    scene.captions.safeAreaNotes = '';
    scene.factualClaims = [];
    scene.assetRequirements = [];
    scene.mediaReferences = [];
    scene.generationInstructions = '';
    scene.audioGuidance.ambience = '';
    scene.audioGuidance.soundEffects = [];
    scene.audioGuidance.music.guidance = '';
    expect(storyboardLanguageFindings(output, 'de')).toEqual(
      expect.arrayContaining([expect.objectContaining({ reason: 'aggregate_language_unknown' })]),
    );
    scene.onScreenText[0]!.languageCode = 'es';
    expect(storyboardLanguageFindings(output, 'de')).toEqual(
      expect.arrayContaining([expect.objectContaining({ reason: 'language_code_mismatch' })]),
    );
  });
  it('fails closed with a Storyboard-specific capability error for unsupported languages', () => {
    expect(() => storyboardLanguageFindings(storyboard(), 'fr')).toThrow(
      'storyboard_language_not_supported',
    );
  });
});
