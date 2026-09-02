import { describe, expect, it } from 'vitest';
import { hasPermission } from './index';

describe('RBAC', () => {
  it('denies permissions by default', () => expect(hasPermission([], 'system:read')).toBe(false));
  it('allows owner administration', () =>
    expect(hasPermission(['owner'], 'roles:write')).toBe(true));
  it('keeps operator read-only in Phase 1', () =>
    expect(hasPermission(['operator'], 'settings:write')).toBe(false));
});
