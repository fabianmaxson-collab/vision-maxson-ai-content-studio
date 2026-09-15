import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const routes = readFileSync(new URL('../src/editorial/routes.ts', import.meta.url), 'utf8');
const service = readFileSync(
  new URL('../src/editorial/production-script-retry-authorization.ts', import.meta.url),
  'utf8',
);

describe('production Script retry authorization API surface', () => {
  it('exposes one empty-command idempotent owner-admin route', () => {
    expect(routes).toContain("'/projects/:projectId/scripts/retry-authorizations'");
    expect(routes).toContain("requirePermission('providers:admin')");
    expect(routes).toContain('Object.keys(body).length !== 0');
    expect(routes).toContain("c.req.header('Idempotency-Key')");
    expect(service).toContain("this.actor.roles.includes('owner')");
    expect(service).toContain('production_script_retry_idempotency_conflict');
  });

  it('pins authorization to an atomic budget, envelope, audit and receipt batch', () => {
    expect(service).toContain('await this.db.batch([');
    expect(service).toContain('researchRemediationClaimGuard(this.db, identity)');
    expect(service).toContain('INSERT INTO editorial_project_execution_budgets');
    expect(service).toContain('INSERT INTO editorial_execution_envelopes');
    expect(service).toContain("'editorial.legacy_remediation_attested'");
    expect(service).toContain('INSERT INTO editorial_production_script_retry_capacities');
    expect(service).toContain('PRODUCTION_SCRIPT_RETRY_CEILING = 2970');
  });

  it('fails closed on schema and binds execution through the immutable eligibility receipt', () => {
    expect(service).toContain('production_script_retry_schema_unavailable');
    expect(service).toContain('production_script_retry_execution_eligible');
    expect(service).toContain('production_script_retry_execution_binding_invalid');
    expect(service).toContain('c.failed_execution_idempotency_key<>?');
  });
});
