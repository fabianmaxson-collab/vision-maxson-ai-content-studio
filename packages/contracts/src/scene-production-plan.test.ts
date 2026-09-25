import { describe, expect, it } from 'vitest';
import {
  providerRoutingDecisionSchema,
  sceneProductionPlanSchema,
  videoGenerationIntentSchema,
  type SceneProductionPlan,
  type VideoGenerationIntent,
} from './scene-production-plan';

describe('SceneProductionPlan Contract', () => {
  const validScene1Plan: SceneProductionPlan = {
    id: 'spp_scene_1_ariane5_launch',
    projectId: 'project_2135b883-8499-48e9-a4a7-bb04b970d72a',
    sourceStoryboardVersionId: 'artifact_version_657186df-c6f7-45ab-aa94-31353b135f45',
    sceneOrder: 1,
    scriptSegmentIds: ['script_segment_d0e96bb9-9fb7-46c7-bec2-b8a64c08cbd7'],
    targetDurationSeconds: 6,
    aspectRatio: '9:16',
    visualStrategy: 'GENERATIVE_VIDEO',
    mediaType: 'VIDEO',
    visualDescription:
      'Stilisierte, eindeutig nicht-historische 3D-Raketenillustration startet vor dunklem, abstraktem Nachthimmel. Großes Hook-Overlay eröffnet sofort; darunter erscheint eine neutrale Datumszeile.',
    promptIntent:
      'Abstract schematic 3D rocket animation ascending vertically against a minimalist dark navy background. High-tech documentary aesthetic, clean technical lines, slow upward tilt camera motion, smooth subtle thrust, no realistic flames, no historical NASA/ESA logos, no text, no numbers, perfectly centered vertical composition with generous margins.',
    negativeConstraints: [
      'text',
      'numbers',
      'logos',
      'historical footage',
      'real telemetry',
      'watermark',
      'subtitles',
    ],
    continuityKey: 'scene-01',
    continuityReferenceKeys: [],
    cameraFraming: 'Vertikale Totale mit Rakete zentral im sicheren Mittelbereich.',
    cameraMovement: 'Langsamer Aufwärtsschwenk, danach kurzer digitaler Glitch.',
    motionPacing: 'MEASURED',
    lightingStyle: 'Minimalist technical lighting on dark navy background',
    safeAreaGuidance: {
      protectTop: true,
      protectBottom: true,
      protectSides: true,
      notes:
        'Hook und Datum im mittleren sicheren Bereich platzieren; obere und untere Plattformzonen freihalten.',
    },
    onScreenElements: [
      {
        id: 'element_title_hook',
        kind: 'TITLE',
        text: 'ZAHLENKONVERTIERUNG MIT FOLGEN',
        languageCode: 'de',
        startOffsetSeconds: 0,
        endOffsetSeconds: 3.2,
        placement: 'CENTER',
        renderEngine: 'DETERMINISTIC_OVERLAY',
        notes: 'Rendered at composition time in Remotion, NOT generated in video.',
      },
      {
        id: 'element_date_label',
        kind: 'LABEL',
        text: 'Erster Ariane-5-Start · 4. Juni 1996',
        languageCode: 'de',
        startOffsetSeconds: 3.2,
        endOffsetSeconds: 6,
        placement: 'CUSTOM',
        renderEngine: 'DETERMINISTIC_OVERLAY',
        notes: 'Neutral date line overlay, NOT generated in video prompt.',
      },
    ],
    captions: {
      mode: 'REQUIRED',
      languageCode: 'de',
      sourceScriptSegmentIds: ['script_segment_d0e96bb9-9fb7-46c7-bec2-b8a64c08cbd7'],
      styleGuidance:
        'Wortgenaue deutsche Untertitel, maximal zwei Zeilen, hohe Lesbarkeit in Weiß auf halbtransparenter dunkler Fläche.',
      safeAreaNotes: 'Untertitel oberhalb der unteren Plattform-Sicherheitszone führen.',
      renderEngine: 'DETERMINISTIC_OVERLAY',
    },
    audioRequirements: {
      voiceoverRequired: true,
      sourceScriptSegmentIds: ['script_segment_d0e96bb9-9fb7-46c7-bec2-b8a64c08cbd7'],
      ambience: 'Dezentes, abstraktes Raumrauschen.',
      soundEffects: ['Leiser Startimpuls', 'Kurzer digitaler Glitch beim Warnsymbol'],
      musicGuidance: 'Zurückhaltender dokumentarischer Puls, Sprache stets klar priorisieren.',
    },
    factualRestrictions: [
      'Der erste Ariane-5-Start fand am 4. Juni 1996 statt.',
      'Die Rakete ist eine schematische Illustration, keine historische Archivaufnahme.',
    ],
    rightsRequirements: 'ORIGINAL_GENERATIVE',
    qualityTier: 'PRODUCTION',
    costCeilingMicroUsd: 150000,
    approvalStatus: 'APPROVED',
  };

  it('A. SceneProductionPlan accepts a provider-neutral valid plan', () => {
    const parsed = sceneProductionPlanSchema.safeParse(validScene1Plan);
    expect(parsed.success).toBe(true);
  });

  it('B. SceneProductionPlan strictly rejects provider binding fields', () => {
    const planWithProvider = {
      ...validScene1Plan,
      preferredProvider: 'agnes',
      preferredModel: 'agnes-video-2.5-flash',
    };
    const parsed = sceneProductionPlanSchema.safeParse(planWithProvider);
    expect(parsed.success).toBe(false);
  });

  it('C. VideoGenerationIntent validates valid intent', () => {
    const validIntent: VideoGenerationIntent = {
      id: 'intent_scene_1_take_1',
      projectId: 'project_2135b883-8499-48e9-a4a7-bb04b970d72a',
      sceneProductionPlanId: 'spp_scene_1_ariane5_launch',
      sceneId: 'scene-01',
      takeNumber: 1,
      targetDurationSeconds: 6,
      targetAspectRatio: '9:16',
      targetQualityTier: 'PRODUCTION',
      prompt:
        'Abstract schematic 3D rocket animation ascending vertically against a minimalist dark navy background. High-tech documentary aesthetic, clean technical lines, slow upward tilt camera motion.',
      negativePrompt:
        'text, titles, subtitles, words, letters, numbers, logos, historical footage, real people',
      referenceAssetIds: [],
      styleReferenceAssetIds: [],
      seedPolicy: { mode: 'RANDOM' },
      factualRestrictions: ['Abstract schematic only; no historical footage'],
      costCeilingMicroUsd: 150000,
      idempotencyKey: 'intent-s1-t1-9d088aed16729c94',
    };
    const parsed = videoGenerationIntentSchema.safeParse(validIntent);
    expect(parsed.success).toBe(true);
  });

  it('D. VideoGenerationIntent rejects takeNumber = 0 or negative', () => {
    const invalidIntentZero = {
      id: 'intent_scene_1_take_0',
      projectId: 'project_2135b883-8499-48e9-a4a7-bb04b970d72a',
      sceneProductionPlanId: 'spp_scene_1_ariane5_launch',
      sceneId: 'scene-01',
      takeNumber: 0,
      targetDurationSeconds: 6,
      targetAspectRatio: '9:16',
      targetQualityTier: 'PRODUCTION',
      prompt: 'Abstract schematic 3D rocket animation',
      negativePrompt: 'text',
      referenceAssetIds: [],
      styleReferenceAssetIds: [],
      seedPolicy: { mode: 'RANDOM' },
      factualRestrictions: [],
      costCeilingMicroUsd: 150000,
      idempotencyKey: 'intent-s1-t0-9d088aed16729c94',
    };
    const parsedZero = videoGenerationIntentSchema.safeParse(invalidIntentZero);
    expect(parsedZero.success).toBe(false);

    const invalidIntentNegative = { ...invalidIntentZero, takeNumber: -1 };
    const parsedNegative = videoGenerationIntentSchema.safeParse(invalidIntentNegative);
    expect(parsedNegative.success).toBe(false);
  });

  it('E. ProviderRoutingDecision validates routing decision decoupled from creative plan', () => {
    const routingDecision = {
      videoGenerationIntentId: 'intent_scene_1_take_1',
      providerId: 'agnes',
      modelId: 'agnes-video-2.5-flash',
      capabilityProfileVersion: '2026-09-agnes-flash-v1',
      estimatedCostMicroUsd: 60000,
      routingReason: 'PRIMARY_TIER1_SHORT_MATCH',
      routingFactors: {
        aspectRatioMatch: true,
        durationSupported: true,
        qualityTier: 'PRODUCTION',
        estimatedLatencySeconds: 120,
      },
      decisionTimestamp: '2026-09-25T16:30:00.000Z',
    };
    const parsed = providerRoutingDecisionSchema.safeParse(routingDecision);
    expect(parsed.success).toBe(true);
  });

  it('T. Scene 1 pilot fixture strictly isolates critical text from generation prompt', () => {
    const prompt = validScene1Plan.promptIntent.toLowerCase();

    // Critical on-screen text must NEVER appear in the video generation prompt
    expect(prompt).not.toContain('zahlenkonvertierung');
    expect(prompt).not.toContain('folgen');
    expect(prompt).not.toContain('ariane-5-start');
    expect(prompt).not.toContain('4. juni 1996');

    // On-screen elements must be specified as deterministic overlays
    expect(validScene1Plan.onScreenElements).toHaveLength(2);
    expect(validScene1Plan.onScreenElements[0]?.renderEngine).toBe('DETERMINISTIC_OVERLAY');
    expect(validScene1Plan.onScreenElements[1]?.renderEngine).toBe('DETERMINISTIC_OVERLAY');
    expect(validScene1Plan.captions.renderEngine).toBe('DETERMINISTIC_OVERLAY');
  });
});
