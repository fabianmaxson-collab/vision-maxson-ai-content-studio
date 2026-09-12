import { it, expect } from 'vitest';
import { contentBriefRevisionCapacitySchema, intelligenceCommandSchema } from './editorial';
const input = {
  researchVersionId: 'research-version',
  researchApprovalId: 'research-approval',
  expectedResearchArtifactRevision: 5,
  ideaCandidateId: 'candidate',
  expectedIdeaCandidateRevision: 2,
  ideaVersionId: 'idea-version',
  ideaApprovalId: 'idea-approval',
  expectedIdeaArtifactRevision: 3,
  expectedProjectVersion: 2,
};
it('strict creation accepts only expectations', () => {
  expect(contentBriefRevisionCapacitySchema.safeParse(input).success).toBe(true);
  for (const field of ['workspaceId', 'projectId', 'ceiling', 'profileKey', 'provider'])
    expect(
      contentBriefRevisionCapacitySchema.safeParse({ ...input, [field]: 'injected' }).success,
    ).toBe(false);
});
it.each([
  { ideaRevisionCapacityId: 'other' },
  { remediationId: 'other' },
  { mode: 'AUTO' },
  { preferredModelKey: 'gpt-5.6-luna' },
  { creativeRegeneration: true },
  { inputArtifactVersionId: null },
])('rejects incompatible selector %j', (drift) => {
  const command = {
    mode: 'LOCKED',
    preferredProviderKey: 'openai',
    preferredModelKey: 'gpt-5.6-terra',
    inputArtifactVersionId: 'idea-version',
    creativeRegeneration: false,
    contentBriefRevisionCapacityId: 'capacity',
  };
  expect(intelligenceCommandSchema.safeParse(command).success).toBe(true);
  expect(intelligenceCommandSchema.safeParse({ ...command, ...drift }).success).toBe(false);
});
