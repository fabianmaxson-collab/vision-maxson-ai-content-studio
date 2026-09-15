import { describe, expect, it } from 'vitest';
import {
  intelligenceCommandSchema,
  productionScriptRetryAuthorizationResultSchema,
} from './editorial';

const command = {
  mode: 'LOCKED' as const,
  preferredProviderKey: 'openai',
  preferredModelKey: 'gpt-5.6-luna',
  inputArtifactVersionId: 'brief-version',
  creativeRegeneration: false,
  productionScriptRetryAuthorizationId: 'retry-capacity',
};

describe('production Script retry contracts', () => {
  it('accepts only the exact locked retry selector', () => {
    expect(intelligenceCommandSchema.safeParse(command).success).toBe(true);
    for (const drift of [
      { mode: 'AUTO' },
      { preferredProviderKey: 'other' },
      { preferredModelKey: 'gpt-5.6-terra' },
      { inputArtifactVersionId: null },
      { creativeRegeneration: true },
      { remediationId: 'other-capacity' },
      { ideaRevisionCapacityId: 'other-capacity' },
      { contentBriefRevisionCapacityId: 'other-capacity' },
    ])
      expect(intelligenceCommandSchema.safeParse({ ...command, ...drift }).success).toBe(false);
  });

  it('validates the immutable authorization receipt shape', () => {
    const receipt = {
      capacityId: 'capacity',
      attestationId: 'attestation',
      evidenceBundleHash: 'a'.repeat(64),
      observedState: 'PROVIDER_COMPLETED_NO_DURABLE_SCRIPT_SUCCESSOR',
      evidenceGap: 'PERSISTENCE_STAGE_CAUSE_NOT_DURABLY_RECORDED',
      exceptionClass: 'LEGACY_PRODUCTION_SCRIPT_REMEDIATION_V1',
      authorizationBasis: 'LEGACY_OWNER_ATTESTED_EXCEPTION',
      projectId: 'project',
      revisionRequestId: 'revision',
      failedRunId: 'failed-run',
      failedAttemptId: 'failed-attempt',
      failedReservationId: 'failed-reservation',
      failedEnvelopeId: 'failed-envelope',
      briefArtifactId: 'brief',
      briefVersionId: 'brief-version',
      scriptArtifactId: 'script',
      expectedCurrentScriptVersionId: 'script-version',
      budgetId: 'budget',
      envelopeId: 'envelope',
      auditEventId: 'audit',
      profileKey: 'phase3_production_script_retry_v1',
      profileVersion: 1,
      boundedProfileKey: 'phase3_short_de_review_es_v1',
      boundedProfileVersion: 1,
      stageKey: 'SCRIPT_WRITER_SHORT',
      monetaryCeilingMicrousd: 2970,
      maximumCalls: 1,
    };
    expect(productionScriptRetryAuthorizationResultSchema.parse(receipt)).toEqual(receipt);
    expect(
      productionScriptRetryAuthorizationResultSchema.safeParse({ ...receipt, maximumCalls: 2 })
        .success,
    ).toBe(false);
    expect(
      productionScriptRetryAuthorizationResultSchema.safeParse({ ...receipt, injected: true })
        .success,
    ).toBe(false);
  });
});
