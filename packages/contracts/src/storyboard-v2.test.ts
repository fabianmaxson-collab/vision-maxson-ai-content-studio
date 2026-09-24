import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  createStoryboardOutputV2Schema,
  storyboardOutputV1Schema,
  storyboardOutputV2Schema,
} from './editorial';
const scene = {
  order: 1,
  targetDurationSeconds: 5,
  scriptSegmentIds: ['segment_1'],
  narrationMode: 'AUTHORITATIVE_SCRIPT_SEGMENTS' as const,
  visualDescription: 'Visual',
  location: 'Berlin',
  action: 'Action',
  cameraFraming: 'Close',
  cameraMovement: 'Static',
  mood: 'Tense',
  continuityKey: 'scene-a',
  continuityReferenceKeys: [],
  continuityNotes: '',
  transitionNotes: 'Cut',
  aspectRatio: '9:16' as const,
  safeAreaGuidance: { protectTop: true, protectBottom: true, protectSides: true, notes: '' },
  onScreenText: [],
  captions: {
    mode: 'REQUIRED' as const,
    languageCode: 'de',
    sourceScriptSegmentIds: ['segment_1'],
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
};
describe('Storyboard contracts', () => {
  it('preserves V1', () =>
    expect(
      storyboardOutputV1Schema.safeParse({
        scenes: [
          {
            order: 1,
            targetDurationSeconds: null,
            scriptSegmentIds: [],
            visualDescription: 'v',
            location: '',
            action: '',
            cameraFraming: '',
            mood: '',
            continuityNotes: '',
            generationInstructions: '',
            recommendedMediaType: 'UNKNOWN',
            assetRequirements: [],
            transitionNotes: '',
            characterVersionIds: [],
          },
        ],
      }).success,
    ).toBe(true));
  it('accepts bounded SHORT V2', () =>
    expect(
      storyboardOutputV2Schema.safeParse({
        contractVersion: 'storyboard-output-v2',
        projectFormat: 'SHORT',
        aspectRatio: '9:16',
        scenes: [scene],
      }).success,
    ).toBe(true));
  it.each([
    ['top ratio', { aspectRatio: '16:9' }],
    ['scene ratio', { scenes: [{ ...scene, aspectRatio: '16:9' }] }],
    ['empty links', { scenes: [{ ...scene, scriptSegmentIds: [] }] }],
    ['duplicate links', { scenes: [{ ...scene, scriptSegmentIds: ['segment_1', 'segment_1'] }] }],
    [
      'caption link',
      {
        scenes: [
          { ...scene, captions: { ...scene.captions, sourceScriptSegmentIds: ['segment_2'] } },
        ],
      },
    ],
    [
      'unsupported rights',
      {
        scenes: [
          { ...scene, mediaReferences: [{ ...scene.mediaReferences[0], rightsStatus: 'CLEARED' }] },
        ],
      },
    ],
    [
      'supported without evidence',
      {
        scenes: [
          {
            ...scene,
            factualClaims: [
              { ...scene.factualClaims[0], status: 'SUPPORTED_BY_APPROVED_RESEARCH' },
            ],
          },
        ],
      },
    ],
  ])('rejects %s', (_n, patch) =>
    expect(
      storyboardOutputV2Schema.safeParse({
        contractVersion: 'storyboard-output-v2',
        projectFormat: 'SHORT',
        aspectRatio: '9:16',
        scenes: [scene],
        ...patch,
      }).success,
    ).toBe(false),
  );
  it('rejects inverted timing and extra fields', () => {
    expect(
      storyboardOutputV2Schema.safeParse({
        contractVersion: 'storyboard-output-v2',
        projectFormat: 'SHORT',
        aspectRatio: '9:16',
        scenes: [
          {
            ...scene,
            onScreenText: [
              {
                text: 'x',
                languageCode: 'de',
                placement: 'TOP',
                startOffsetSeconds: 3,
                endOffsetSeconds: 2,
                purpose: 'TITLE',
              },
            ],
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      storyboardOutputV2Schema.safeParse({
        contractVersion: 'storyboard-output-v2',
        projectFormat: 'SHORT',
        aspectRatio: '9:16',
        scenes: [{ ...scene, extra: true }],
      }).success,
    ).toBe(false);
  });
  describe('Dynamic segment enum schema (C86)', () => {
    const validIds = ['segment_1', 'segment_2', 'segment_3'] as const;
    const dynamicSchema = createStoryboardOutputV2Schema(validIds);

    it('generates provider-facing JSON schema with exact segment enum', () => {
      const jsonSchema = z.toJSONSchema(dynamicSchema);
      expect(jsonSchema).toMatchObject({
        properties: {
          scenes: {
            items: {
              properties: {
                scriptSegmentIds: {
                  items: {
                    type: 'string',
                    enum: ['segment_1', 'segment_2', 'segment_3'],
                  },
                },
                captions: {
                  properties: {
                    sourceScriptSegmentIds: {
                      items: {
                        type: 'string',
                        enum: ['segment_1', 'segment_2', 'segment_3'],
                      },
                    },
                  },
                },
              },
            },
          },
        },
      });
    });

    it('accepts output referencing exact valid segment IDs', () => {
      expect(
        dynamicSchema.safeParse({
          contractVersion: 'storyboard-output-v2',
          projectFormat: 'SHORT',
          aspectRatio: '9:16',
          scenes: [
            {
              ...scene,
              scriptSegmentIds: ['segment_1', 'segment_2'],
              captions: { ...scene.captions, sourceScriptSegmentIds: ['segment_1'] },
            },
          ],
        }).success,
      ).toBe(true);
    });

    it('rejects output referencing fake/unknown segment ID at schema boundary', () => {
      expect(
        dynamicSchema.safeParse({
          contractVersion: 'storyboard-output-v2',
          projectFormat: 'SHORT',
          aspectRatio: '9:16',
          scenes: [
            {
              ...scene,
              scriptSegmentIds: ['script_segment_fake'],
              captions: { ...scene.captions, sourceScriptSegmentIds: ['script_segment_fake'] },
            },
          ],
        }).success,
      ).toBe(false);
    });

    it('rejects empty segment registry at pre-dispatch construction', () => {
      expect(() => createStoryboardOutputV2Schema([])).toThrow(
        'Storyboard source Script segments cannot be empty.',
      );
    });

    it('rejects duplicate segment IDs at pre-dispatch construction', () => {
      expect(() => createStoryboardOutputV2Schema(['segment_1', 'segment_2', 'segment_1'])).toThrow(
        'Storyboard source Script segments cannot contain duplicate IDs.',
      );
    });
  });
});
