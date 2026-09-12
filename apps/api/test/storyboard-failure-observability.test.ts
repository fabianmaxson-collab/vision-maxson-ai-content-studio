import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sanitizeValidationIssues } from '../src/editorial/execution';

const execution = readFileSync(new URL('../src/editorial/execution.ts', import.meta.url), 'utf8');

describe('Storyboard V2 failure observability', () => {
  it('captures bounded sanitized issues without rejected values or raw output', () => {
    const issues = Array.from({ length: 15 }, (_, index) => ({
      code: index === 0 ? 'custom' : 'invalid_type',
      path: ['scenes', index, 'captions', 'sourceScriptSegmentIds', 0],
      message: index === 0 ? 'Caption links must belong to the scene' : `secret-value-${index}`,
    }));
    const diagnostic = sanitizeValidationIssues(issues, 'storyboard-output-v2');

    expect(diagnostic).toMatchObject({
      validationLayer: 'application_schema',
      schemaVersion: 'storyboard-output-v2',
      totalIssueCount: 15,
      capturedIssueCount: 8,
      truncated: true,
    });
    expect(diagnostic.issues[0]).toMatchObject({
      code: 'custom',
      path: ['scenes', 0, 'captions', 'sourceScriptSegmentIds', 0],
      category: 'caption_segment_outside_scene',
      message: 'Value does not satisfy the active output contract.',
    });
    expect(JSON.stringify(diagnostic)).not.toContain('secret-value');
    expect(JSON.stringify(diagnostic)).not.toContain('rawOutput');
  });

  it('bounds deep paths and long path segments', () => {
    const diagnostic = sanitizeValidationIssues(
      [
        {
          code: 'custom',
          path: Array.from({ length: 12 }, () => 'x'.repeat(100)),
          message: 'unknown',
        },
      ],
      'storyboard-output-v2',
    );
    expect(diagnostic.issues[0]?.path).toHaveLength(6);
    expect(diagnostic.issues[0]?.pathTruncated).toBe(true);
    expect(String(diagnostic.issues[0]?.path[0])).toHaveLength(48);
    expect(diagnostic.issues[0]?.category).toBe('custom_contract_rule');
  });

  it('persists safe provider accounting before application schema validation', () => {
    const providerBoundary = execution.indexOf(
      'providerCompletion = { result, costs, metadata, actualMicrousd }',
    );
    const schemaValidation = execution.indexOf('selectedOutputSchema.safeParse(result.output)');
    expect(providerBoundary).toBeGreaterThan(0);
    expect(providerBoundary).toBeLessThan(schemaValidation);
    expect(execution).toContain('provider_request_id=?,safe_metadata_json=?');
    expect(execution).toContain('input_units=?,output_units=?,actual_cost=?,currency=?');
    expect(execution).toContain('cachedInputUnits: result.usage.cachedInputUnits');
    expect(execution).toContain('reasoningOutputUnits: result.usage.reasoningOutputUnits');
  });

  it('reconciles known post-provider failures while preserving ambiguous unknown cost', () => {
    expect(execution).toContain("reconciledKnownCost ? 'RECONCILED' : 'AMBIGUOUS'");
    expect(execution).toContain(
      'const knownActualMicrousd = providerCompletion?.actualMicrousd ?? null',
    );
    expect(execution).toContain('undispatchedIdea ? 0 : knownActualMicrousd');
    expect(execution).not.toContain('reconciledKnownCost ? knownActualMicrousd : null');
    expect(execution).toContain(
      "terminalStatus = mapped.retryable ? 'FAILED_RETRYABLE' : 'FAILED_PERMANENT'",
    );
    expect(execution).toContain("'intelligence.run_failed'");
  });

  it('does not persist raw failed provider output or introduce retry and fallback', () => {
    const failureBlock = execution.slice(
      execution.indexOf('const failureMetadata'),
      execution.indexOf('throw mapped;'),
    );
    expect(failureBlock).not.toContain('result.output');
    expect(failureBlock).not.toContain('rawOutput');
    expect(failureBlock.match(/terminalAuditStatement\(/gu)).toHaveLength(1);
    expect(execution).toContain('maximumAttempts: stepPolicy.maximumAttempts');
  });
});
