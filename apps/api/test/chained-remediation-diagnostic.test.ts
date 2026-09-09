import { describe, expect, it } from 'vitest';
import { classifyChainedRemediationDiagnostic } from '../src/editorial/chained-remediation-diagnostic';
type Issue = {
  code: unknown;
  path: unknown;
  pathTruncated: unknown;
  category: unknown;
  message?: unknown;
  [key: string]: unknown;
};
type Diagnostic = {
  validationLayer: unknown;
  schemaVersion: unknown;
  totalIssueCount: unknown;
  capturedIssueCount: unknown;
  truncated: unknown;
  issues: Issue[];
  [key: string]: unknown;
};
type Metadata = { validationDiagnostic: Diagnostic; [key: string]: unknown };
const canonical: Metadata = {
  validationDiagnostic: {
    validationLayer: 'application_schema',
    schemaVersion: 'storyboard-output-v2',
    totalIssueCount: 1,
    capturedIssueCount: 1,
    truncated: false,
    issues: [
      {
        code: 'custom',
        path: [],
        pathTruncated: false,
        category: 'duplicate_continuity_key',
        message: 'safe',
      },
    ],
  },
};
const enc = (value: unknown) => JSON.stringify(value);
const changed = (mutate: (value: Metadata) => void) => {
  const value = structuredClone(canonical);
  mutate(value);
  return enc(value);
};
describe('chained remediation structured diagnostic', () => {
  it('accepts canonical Run and attempt evidence without relying on message text', () => {
    expect(
      classifyChainedRemediationDiagnostic(
        changed((v) => (v.validationDiagnostic.issues[0]!.message = 'run')),
        changed((v) => (v.validationDiagnostic.issues[0]!.message = 'attempt')),
      ),
    ).toBe('duplicate_continuity_key');
  });
  it.each([
    ['null', null],
    ['missing', undefined],
    ['malformed', '{'],
    ['root', '[]'],
    ['missing diagnostic', '{}'],
    ['diagnostic type', '{"validationDiagnostic":[]}'],
    ['layer', changed((v) => (v.validationDiagnostic.validationLayer = 'x'))],
    ['schema', changed((v) => (v.validationDiagnostic.schemaVersion = 'x'))],
    ['total', changed((v) => (v.validationDiagnostic.totalIssueCount = 2))],
    ['captured', changed((v) => (v.validationDiagnostic.capturedIssueCount = 2))],
    ['truncated', changed((v) => (v.validationDiagnostic.truncated = true))],
    ['zero issues', changed((v) => (v.validationDiagnostic.issues = []))],
    [
      'multiple issues',
      changed((v) => v.validationDiagnostic.issues.push({ ...v.validationDiagnostic.issues[0]! })),
    ],
    ['code', changed((v) => (v.validationDiagnostic.issues[0]!.code = 'x'))],
    ['path', changed((v) => (v.validationDiagnostic.issues[0]!.path = ['x']))],
    ['path truncated', changed((v) => (v.validationDiagnostic.issues[0]!.pathTruncated = true))],
    ['category', changed((v) => (v.validationDiagnostic.issues[0]!.category = 'x'))],
    ['type', changed((v) => (v.validationDiagnostic.totalIssueCount = '1'))],
    ['extra diagnostic', changed((v) => (v.validationDiagnostic.extra = true))],
    ['extra issue', changed((v) => (v.validationDiagnostic.issues[0]!.extra = true))],
    ['oversized', JSON.stringify({ ...canonical, padding: 'x'.repeat(17000) })],
  ])('rejects %s', (_label, bad) => {
    expect(classifyChainedRemediationDiagnostic(bad, enc(canonical))).toBeNull();
    expect(classifyChainedRemediationDiagnostic(enc(canonical), bad)).toBeNull();
  });
});
