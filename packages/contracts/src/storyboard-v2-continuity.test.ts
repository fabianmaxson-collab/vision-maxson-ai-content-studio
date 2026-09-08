import { describe, expect, it } from 'vitest';
import { storyboardOutputV2Schema } from './editorial';

const scene = (
  order: number,
  continuityKey: string | null = `scene-${String(order).padStart(2, '0')}`,
) => ({
  order,
  targetDurationSeconds: 5,
  scriptSegmentIds: [`segment_${order}`],
  narrationMode: 'AUTHORITATIVE_SCRIPT_SEGMENTS' as const,
  visualDescription: 'Visual',
  location: 'Berlin',
  action: 'Action',
  cameraFraming: 'Close',
  cameraMovement: 'Static',
  mood: 'Tense',
  continuityKey,
  continuityReferenceKeys: [] as string[],
  continuityNotes: '',
  transitionNotes: 'Cut',
  aspectRatio: '9:16' as const,
  safeAreaGuidance: { protectTop: true, protectBottom: true, protectSides: true, notes: '' },
  onScreenText: [],
  captions: {
    mode: 'REQUIRED' as const,
    languageCode: 'de',
    sourceScriptSegmentIds: [`segment_${order}`],
    styleGuidance: '',
    safeAreaNotes: '',
  },
  factualClaims: [
    {
      claimText: 'Unconfirmed',
      status: 'UNCERTAIN' as const,
      researchClaimIds: [],
      visualTreatment: 'Do not present as fact',
    },
  ],
  recommendedMediaType: 'MIXED' as const,
  assetRequirements: [],
  mediaReferences: [
    {
      requirement: 'Archive image',
      kind: 'ARCHIVE' as const,
      sourceReferenceIds: [],
      rightsStatus: 'REQUIRES_VERIFICATION' as const,
      notes: '',
    },
  ],
  generationInstructions: 'Vertical',
  characterVersionIds: [],
  audioGuidance: {
    ambience: 'Room',
    soundEffects: [],
    music: { use: 'NONE' as const, guidance: '', rightsStatus: 'UNKNOWN' as const },
  },
});
const output = (scenes: ReturnType<typeof scene>[]) => ({
  contractVersion: 'storyboard-output-v2' as const,
  projectFormat: 'SHORT' as const,
  aspectRatio: '9:16' as const,
  scenes,
});

describe('Storyboard V2 continuity regression', () => {
  it('accepts stable unique identities through scene 10', () => {
    const scenes = Array.from({ length: 10 }, (_, index) => scene(index + 1));
    expect(scenes[4]?.continuityKey).toBe('scene-05');
    expect(scenes[9]?.continuityKey).toBe('scene-10');
    expect(storyboardOutputV2Schema.safeParse(output(scenes)).success).toBe(true);
  });

  it('preserves historical nullable continuity behavior', () => {
    expect(storyboardOutputV2Schema.safeParse(output([scene(1, null)])).success).toBe(true);
  });

  it('rejects duplicate and unresolved continuity keys', () => {
    expect(
      storyboardOutputV2Schema.safeParse(output([scene(1, 'scene-05'), scene(2, 'scene-05')]))
        .success,
    ).toBe(false);
    const unresolved = scene(1);
    unresolved.continuityReferenceKeys = ['scene-99'];
    expect(storyboardOutputV2Schema.safeParse(output([unresolved])).success).toBe(false);
  });

  it('preserves strict SHORT, factual-claim, media-rights, and segment rules', () => {
    expect(
      storyboardOutputV2Schema.safeParse({ ...output([scene(1)]), aspectRatio: '16:9' }).success,
    ).toBe(false);
    const invalidClaim = scene(1);
    invalidClaim.factualClaims = [
      {
        claimText: 'Claim',
        status: 'SUPPORTED_BY_APPROVED_RESEARCH',
        researchClaimIds: [],
        visualTreatment: '',
      },
    ] as unknown as typeof invalidClaim.factualClaims;
    expect(storyboardOutputV2Schema.safeParse(output([invalidClaim])).success).toBe(false);
    const invalidRights = scene(1);
    invalidRights.mediaReferences = [
      { ...invalidRights.mediaReferences[0]!, rightsStatus: 'CLEARED' },
    ] as never;
    expect(storyboardOutputV2Schema.safeParse(output([invalidRights])).success).toBe(false);
    const duplicateSegments = scene(1);
    duplicateSegments.scriptSegmentIds = ['segment_1', 'segment_1'];
    expect(storyboardOutputV2Schema.safeParse(output([duplicateSegments])).success).toBe(false);
  });
});
