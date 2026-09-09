type JsonObject = Record<string, unknown>;
export type ChainedRemediationDiagnostic = 'duplicate_continuity_key';
const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
function parseDiagnostic(serialized: unknown, maximumBytes: number) {
  if (typeof serialized !== 'string' || new TextEncoder().encode(serialized).length > maximumBytes)
    return null;
  let metadata: unknown;
  try {
    metadata = JSON.parse(serialized);
  } catch {
    return null;
  }
  if (!isObject(metadata) || !isObject(metadata.validationDiagnostic)) return null;
  const diagnostic = metadata.validationDiagnostic;
  const expected = [
    'capturedIssueCount',
    'issues',
    'schemaVersion',
    'totalIssueCount',
    'truncated',
    'validationLayer',
  ].sort();
  if (JSON.stringify(Object.keys(diagnostic).sort()) !== JSON.stringify(expected)) return null;
  if (
    diagnostic.validationLayer !== 'application_schema' ||
    diagnostic.schemaVersion !== 'storyboard-output-v2' ||
    diagnostic.totalIssueCount !== 1 ||
    diagnostic.capturedIssueCount !== 1 ||
    diagnostic.truncated !== false ||
    !Array.isArray(diagnostic.issues) ||
    diagnostic.issues.length !== 1
  )
    return null;
  const issues: unknown[] = diagnostic.issues;
  const issue = issues[0];
  if (!isObject(issue)) return null;
  const keys = Object.keys(issue).sort(),
    allowed = ['category', 'code', 'message', 'path', 'pathTruncated'].sort();
  if (
    keys.some((key) => !allowed.includes(key)) ||
    !['category', 'code', 'path', 'pathTruncated'].every((key) => keys.includes(key)) ||
    ('message' in issue && typeof issue.message !== 'string') ||
    issue.code !== 'custom' ||
    !Array.isArray(issue.path) ||
    issue.path.length !== 0 ||
    issue.pathTruncated !== false ||
    issue.category !== 'duplicate_continuity_key'
  )
    return null;
  return {
    validationLayer: diagnostic.validationLayer,
    schemaVersion: diagnostic.schemaVersion,
    totalIssueCount: diagnostic.totalIssueCount,
    capturedIssueCount: diagnostic.capturedIssueCount,
    truncated: diagnostic.truncated,
    issue: {
      code: issue.code,
      path: issue.path,
      pathTruncated: issue.pathTruncated,
      category: issue.category,
    },
  };
}
export function classifyChainedRemediationDiagnostic(
  runSafeMetadataJson: unknown,
  attemptSafeMetadataJson: unknown,
): ChainedRemediationDiagnostic | null {
  const run = parseDiagnostic(runSafeMetadataJson, 16384),
    attempt = parseDiagnostic(attemptSafeMetadataJson, 8192);
  return run && attempt && JSON.stringify(run) === JSON.stringify(attempt)
    ? 'duplicate_continuity_key'
    : null;
}
