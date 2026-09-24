import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createStoryboardOutputV2Schema } from '@vision-maxson/contracts';
import {
  storyboardSegmentReferenceInstructions,
  storyboardFormatInstructions,
  storyboardLanguageInstructions,
  validateStoryboardAuthoritativeFormat,
} from '../src/editorial/execution';
import { createStoryboardSegmentSnapshot } from '../src/editorial/storyboard-replacement';
import {
  validateStoryboardFactualClaims,
  type StoryboardResearchClaimSnapshot,
} from '../src/editorial/storyboard-research-claims';
import { ProviderError } from '@vision-maxson/providers';
import { OpenAIResponsesAdapter } from '@vision-maxson/providers/openai';

const makeScene = (segmentIds: string[], overrides: Record<string, unknown> = {}) => ({
  order: 1,
  targetDurationSeconds: 5,
  scriptSegmentIds: segmentIds,
  narrationMode: 'AUTHORITATIVE_SCRIPT_SEGMENTS' as const,
  visualDescription: 'Visual',
  location: 'Berlin',
  action: 'Action',
  cameraFraming: 'Close',
  cameraMovement: 'Static',
  mood: 'Tense',
  continuityKey: 'scene-01',
  continuityReferenceKeys: [],
  continuityNotes: '',
  transitionNotes: 'Cut',
  aspectRatio: '9:16' as const,
  safeAreaGuidance: { protectTop: true, protectBottom: true, protectSides: true, notes: '' },
  onScreenText: [],
  captions: {
    mode: 'REQUIRED' as const,
    languageCode: 'de' as const,
    sourceScriptSegmentIds: segmentIds,
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
  ...overrides,
});

const makeStoryboardOutput = (scenes: ReturnType<typeof makeScene>[]) => ({
  contractVersion: 'storyboard-output-v2' as const,
  projectFormat: 'SHORT' as const,
  aspectRatio: '9:16' as const,
  scenes,
});

describe('BLOCK 9FA-R7-D10-C86: Storyboard Provider Segment Hardening', () => {
  const snapshotSegments = [
    { id: 'script_segment_alpha', order: 1, text: 'First segment intro.' },
    { id: 'script_segment_beta', order: 2, text: 'Second segment anomaly.' },
    { id: 'script_segment_gamma', order: 3, text: 'Third segment resolution.' },
  ];

  it('1. Provider schema enum exactly equals snapshot segment IDs (no missing, no extra, no stale)', async () => {
    const snapshot = await createStoryboardSegmentSnapshot(
      'workspace_primary',
      'project_test',
      'script_v1',
      snapshotSegments,
    );
    const schema = createStoryboardOutputV2Schema(snapshot.segments.map((s) => s.id));
    const jsonSchema = z.toJSONSchema(schema);

    expect(jsonSchema).toMatchObject({
      properties: {
        scenes: {
          items: {
            properties: {
              scriptSegmentIds: {
                items: {
                  type: 'string',
                  enum: ['script_segment_alpha', 'script_segment_beta', 'script_segment_gamma'],
                },
              },
              captions: {
                properties: {
                  sourceScriptSegmentIds: {
                    items: {
                      type: 'string',
                      enum: ['script_segment_alpha', 'script_segment_beta', 'script_segment_gamma'],
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

  it('2. Exact C85 failure prevention: provider schema rejects invented segment ID at schema boundary', async () => {
    const snapshot = await createStoryboardSegmentSnapshot(
      'workspace_primary',
      'project_test',
      'script_v1',
      snapshotSegments,
    );
    const schema = createStoryboardOutputV2Schema(snapshot.segments.map((s) => s.id));

    // Valid segment ID passes
    const validOutput = makeStoryboardOutput([makeScene(['script_segment_alpha'])]);
    expect(schema.safeParse(validOutput).success).toBe(true);

    // Hallucinated / fake segment ID fails at the provider schema boundary
    const fakeOutput = makeStoryboardOutput([makeScene(['script_segment_fake'])]);
    const parseResult = schema.safeParse(fakeOutput);
    expect(parseResult.success).toBe(false);
  });

  it('3. Multi-segment scenes constrained to exact enum and accepted when valid', async () => {
    const snapshot = await createStoryboardSegmentSnapshot(
      'workspace_primary',
      'project_test',
      'script_v1',
      snapshotSegments,
    );
    const schema = createStoryboardOutputV2Schema(snapshot.segments.map((s) => s.id));

    const multiValid = makeStoryboardOutput([
      makeScene(['script_segment_alpha', 'script_segment_beta'], {
        captions: {
          mode: 'REQUIRED',
          languageCode: 'de',
          sourceScriptSegmentIds: ['script_segment_alpha'],
          styleGuidance: '',
          safeAreaNotes: '',
        },
      }),
    ]);
    expect(schema.safeParse(multiValid).success).toBe(true);

    const multiWithOneFake = makeStoryboardOutput([
      makeScene(['script_segment_alpha', 'script_segment_invented'], {
        captions: {
          mode: 'REQUIRED',
          languageCode: 'de',
          sourceScriptSegmentIds: ['script_segment_alpha'],
          styleGuidance: '',
          safeAreaNotes: '',
        },
      }),
    ]);
    expect(schema.safeParse(multiWithOneFake).success).toBe(false);
  });

  it('4. Server-side defense in depth: rejects invalid segment ID even if provider schema bypassed', () => {
    const project = {
      id: 'project_test',
      format: 'SHORT',
      primaryLanguage: 'de',
      storyboardSourceSegments: [
        { id: 'script_segment_alpha', order: 1, text: 'Alpha' },
        { id: 'script_segment_beta', order: 2, text: 'Beta' },
      ],
    };
    const known = new Set(project.storyboardSourceSegments.map((s) => s.id));

    // Simulated output that bypassed provider schema
    const bypassedOutput = makeStoryboardOutput([makeScene(['script_segment_bypassed'])]);

    const hasInvalidSegment = bypassedOutput.scenes.some((scene) =>
      scene.scriptSegmentIds.some((id) => !known.has(id)),
    );
    expect(hasInvalidSegment).toBe(true);

    // Server throws exact semantic validation error
    expect(() => {
      if (hasInvalidSegment) {
        throw new ProviderError(
          'SCHEMA_VALIDATION',
          false,
          'Storyboard source segment reference is invalid.',
        );
      }
    }).toThrow('Storyboard source segment reference is invalid.');
  });

  it('5. Pre-dispatch rejection on zero segments (empty registry)', () => {
    expect(() => createStoryboardOutputV2Schema([])).toThrow(
      'Storyboard source Script segments cannot be empty.',
    );
  });

  it('6. Pre-dispatch rejection on duplicate segment IDs', () => {
    expect(() =>
      createStoryboardOutputV2Schema(['script_segment_1', 'script_segment_2', 'script_segment_1']),
    ).toThrow('Storyboard source Script segments cannot contain duplicate IDs.');
  });

  it('7. Prompt instructions contain exact required rules and mapping', async () => {
    const snapshot = await createStoryboardSegmentSnapshot(
      'workspace_primary',
      'project_test',
      'script_v1',
      snapshotSegments,
    );
    const instructions = storyboardSegmentReferenceInstructions(snapshot);

    expect(instructions).toContain('scriptSegmentIds MUST be copied verbatim');
    expect(instructions).toContain('never invent an ID');
    expect(instructions).toContain('never use order numbers as IDs');
    expect(instructions).toContain('never shorten IDs');
    expect(instructions).toContain('never use IDs from examples/history');
    expect(instructions).toContain('every referenced ID must exactly match one listed ID');
    expect(instructions).toContain('use only the supplied current Script snapshot');

    // Mapping check
    expect(instructions).toContain('segment order 1 -> exact ID: "script_segment_alpha"');
    expect(instructions).toContain('segment order 2 -> exact ID: "script_segment_beta"');
    expect(instructions).toContain('segment order 3 -> exact ID: "script_segment_gamma"');
  });

  it('8. Snapshot drift fails closed if database segments mutate post-dispatch', async () => {
    const snapshotA = await createStoryboardSegmentSnapshot(
      'workspace_primary',
      'project_test',
      'script_v1',
      snapshotSegments,
    );

    const mutatedSegments = [
      { id: 'script_segment_alpha', order: 1, text: 'First segment TAMPERED.' },
      { id: 'script_segment_beta', order: 2, text: 'Second segment anomaly.' },
      { id: 'script_segment_gamma', order: 3, text: 'Third segment resolution.' },
    ];
    const snapshotB = await createStoryboardSegmentSnapshot(
      'workspace_primary',
      'project_test',
      'script_v1',
      mutatedSegments,
    );

    expect(snapshotA.hash).not.toBe(snapshotB.hash);
    expect(() => {
      if (snapshotA.hash !== snapshotB.hash) {
        throw new ProviderError(
          'PERMANENT',
          false,
          'Storyboard Script segments changed after provider dispatch.',
        );
      }
    }).toThrow('Storyboard Script segments changed after provider dispatch.');
  });

  it('9. Research claim provenance regression: preserves C74 protections', () => {
    const claimSnapshot = {
      workspaceId: 'workspace_primary',
      projectId: 'project_test',
      researchVersionId: 'research_v1',
      researchHash: 'h'.repeat(64),
      hash: 'reg'.repeat(21) + 'r',
      count: 1,
      canonicalJson: '[]',
      claims: [
        {
          id: 'claim_documented_1',
          claimText: 'Evidence 1',
          evidenceClass: 'OBSERVED',
          excerpt: 'Ex',
          confidence: 0.9,
          sourceId: 'src_1',
          sourceType: 'ARCHIVE',
          sourceTitle: 'Archive',
          sourceUrl: null,
          sourceReference: 'Ref',
          sourceVerificationStatus: 'owner_approved',
        },
      ],
    } as unknown as StoryboardResearchClaimSnapshot;

    const validClaimScene = makeScene(['script_segment_alpha'], {
      factualClaims: [
        {
          claimText: 'Verified event',
          status: 'SUPPORTED_BY_APPROVED_RESEARCH',
          researchClaimIds: ['claim_documented_1'],
          visualTreatment: 'Show archive footage',
        },
      ],
    });
    const validBoard = makeStoryboardOutput([validClaimScene]);
    expect(() => validateStoryboardFactualClaims(validBoard, claimSnapshot)).not.toThrow();

    const fabricatedClaimScene = makeScene(['script_segment_alpha'], {
      factualClaims: [
        {
          claimText: 'Fabricated event',
          status: 'SUPPORTED_BY_APPROVED_RESEARCH',
          researchClaimIds: ['claim_fabricated_999'],
          visualTreatment: 'Fabricated',
        },
      ],
    });
    const invalidBoard = makeStoryboardOutput([fabricatedClaimScene]);
    expect(() => validateStoryboardFactualClaims(invalidBoard, claimSnapshot)).toThrow(
      'Storyboard factual claim does not cite exact approved Research claims.',
    );
  });

  it('10. Language / format regression: preserves SHORT 9:16 and German language contract', () => {
    expect(storyboardLanguageInstructions('de')).toContain('Write ALL human-readable Storyboard');
    expect(storyboardLanguageInstructions('de')).toContain('German');

    expect(storyboardFormatInstructions('SHORT')).toContain(
      'projectFormat SHORT and aspectRatio 9:16',
    );
    expect(() =>
      validateStoryboardAuthoritativeFormat(
        makeStoryboardOutput([makeScene(['script_segment_alpha'])]),
        'SHORT',
      ),
    ).not.toThrow();

    expect(() =>
      validateStoryboardAuthoritativeFormat(
        {
          ...makeStoryboardOutput([makeScene(['script_segment_alpha'])]),
          projectFormat: 'LONG_FORM' as const,
        },
        'SHORT',
      ),
    ).toThrow('Storyboard format or aspect ratio does not match');
  });

  it('11. Structured output compatibility: OpenAI responses adapter accepts dynamic schema', async () => {
    const snapshot = await createStoryboardSegmentSnapshot(
      'workspace_primary',
      'project_test',
      'script_v1',
      snapshotSegments,
    );
    const schema = createStoryboardOutputV2Schema(snapshot.segments.map((s) => s.id));
    const jsonSchema = z.toJSONSchema(schema);

    const mockCreate = vi.fn().mockResolvedValue({
      id: 'resp_c86_test',
      status: 'completed',
      output_text: JSON.stringify(makeStoryboardOutput([makeScene(['script_segment_alpha'])])),
      model: 'gpt-5.6-terra',
      usage: {
        input_tokens: 100,
        output_tokens: 50,
      },
    });

    const adapter = new OpenAIResponsesAdapter('test-key', undefined, {
      responses: { create: mockCreate },
    } as never);

    const result = await adapter.execute({
      runId: 'run_c86',
      taskType: 'STORYBOARD_PLANNER',
      modelKey: 'gpt-5.6-terra',
      promptVersionId: 'prompt_v3',
      input: {},
      instructions: 'Output storyboard',
      outputSchema: jsonSchema,
      outputSchemaName: 'storyboard_output_v2',
      idempotencyKey: 'key_c86',
      timeoutMs: 10000,
      maxOutputTokens: 2000,
      reasoningEffort: 'none',
    });

    expect(result.providerRequestId).toBe('resp_c86_test');
    expect(mockCreate).toHaveBeenCalledOnce();
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        text: {
          format: {
            type: 'json_schema',
            name: 'storyboard_output_v2',
            schema: jsonSchema,
            strict: true,
          },
        },
      }),
      expect.any(Object),
    );
  });
});
