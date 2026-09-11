import { describe, it, expect } from 'vitest';
import {
  ideaRevisionCapacitySchema,
  intelligenceCommandSchema,
  ideaRevisionRecoverySchema,
  ideaRevisionRecoveryResultSchema,
} from './editorial';
const body = {
  expectedResearchVersionId: 'research-v2',
  expectedResearchArtifactRevision: 5,
  expectedResearchApprovalId: 'approval-v2',
  expectedProjectVersion: 2,
};
describe('strict Idea revision capacity contracts', () => {
  it('accepts only bounded expected state', () => {
    expect(ideaRevisionCapacitySchema.safeParse(body).success).toBe(true);
  });
  it.each([
    'profile',
    'stage',
    'ceiling',
    'provider',
    'model',
    'pricing',
    'prompt',
    'maxCalls',
    'retries',
    'fallback',
    'creativeRegeneration',
  ])('rejects %s policy override', (key) =>
    expect(ideaRevisionCapacitySchema.safeParse({ ...body, [key]: 1 }).success).toBe(false),
  );
  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid revision %s', (n) =>
    expect(
      ideaRevisionCapacitySchema.safeParse({ ...body, expectedProjectVersion: n }).success,
    ).toBe(false),
  );
  it('rejects unbounded IDs and mixed selectors', () => {
    expect(
      ideaRevisionCapacitySchema.safeParse({ ...body, expectedResearchVersionId: 'x'.repeat(101) })
        .success,
    ).toBe(false);
    expect(
      intelligenceCommandSchema.safeParse({
        mode: 'LOCKED',
        preferredProviderKey: 'openai',
        preferredModelKey: 'gpt-5.6-terra',
        inputArtifactVersionId: 'research-v2',
        ideaRevisionCapacityId: 'capacity',
        remediationId: 'remediation',
      }).success,
    ).toBe(false);
  });
});

describe('strict bounded capacity recovery contract', () => {
  const command = {
    expectedFailedRunId: 'failed-run',
    expectedFailedReservationId: 'failed-reservation',
    expectedProjectVersion: 3,
  };
  it('accepts only failure identities and expected project checkpoint', () =>
    expect(ideaRevisionRecoverySchema.parse(command)).toEqual(command));
  it.each([
    'researchVersionId',
    'revisionRequestId',
    'budgetId',
    'provider',
    'model',
    'prompt',
    'pricing',
    'ceiling',
    'maximumCalls',
    'maximumAttempts',
    'retries',
    'fallback',
    'externalTools',
    'actorId',
    'replacementEnvelopeId',
    'creativeRegeneration',
  ])('rejects client controlled %s', (key) => {
    expect(ideaRevisionRecoverySchema.safeParse({ ...command, [key]: 1 }).success).toBe(false);
  });
  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid project checkpoint %s', (n) =>
    expect(
      ideaRevisionRecoverySchema.safeParse({ ...command, expectedProjectVersion: n }).success,
    ).toBe(false),
  );
  it.each(['', 'x', 'a'.repeat(101), 'unsafe/id'])('rejects invalid failure identity %s', (id) => {
    expect(
      ideaRevisionRecoverySchema.safeParse({ ...command, expectedFailedRunId: id }).success,
    ).toBe(false);
    expect(
      ideaRevisionRecoverySchema.safeParse({ ...command, expectedFailedReservationId: id }).success,
    ).toBe(false);
  });
  it('strictly validates persisted recovery results and policy', () => {
    const result = {
      recoveryId: 'recovery',
      capacityId: 'capacity',
      projectId: 'project',
      revisionRequestId: 'request',
      researchArtifactId: 'research',
      researchVersionId: 'research-v2',
      researchApprovalId: 'approval',
      budgetId: 'budget',
      originalEnvelopeId: 'original-envelope',
      failedReservationId: 'reservation',
      failedRunId: 'failed-run',
      replacementEnvelopeId: 'replacement-envelope',
      originalProjectVersion: 2,
      recoveryProjectVersion: 3,
      auditEventId: 'audit',
      profileKey: 'phase3_idea_revision_v1',
      profileVersion: 1,
      stageKey: 'IDEA_GENERATION',
      monetaryCeilingMicrousd: 177920,
      maximumCalls: 1,
    };
    expect(ideaRevisionRecoveryResultSchema.parse(result)).toEqual(result);
    expect(ideaRevisionRecoveryResultSchema.safeParse({ ...result, maximumCalls: 2 }).success).toBe(
      false,
    );
    expect(
      ideaRevisionRecoveryResultSchema.safeParse({ ...result, monetaryCeilingMicrousd: 177921 })
        .success,
    ).toBe(false);
    expect(ideaRevisionRecoveryResultSchema.safeParse({ ...result, extra: true }).success).toBe(
      false,
    );
    expect(
      ideaRevisionRecoveryResultSchema.safeParse({ ...result, recoveryProjectVersion: '3' })
        .success,
    ).toBe(false);
  });
});
