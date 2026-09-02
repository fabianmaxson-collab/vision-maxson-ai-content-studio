export const roles = ['owner', 'admin', 'operator', 'viewer'] as const;
export type Role = (typeof roles)[number];

export type Permission =
  'system:read' | 'settings:read' | 'settings:write' | 'users:read' | 'roles:write' | 'audit:read';

const permissions: Record<Role, ReadonlySet<Permission>> = {
  owner: new Set([
    'system:read',
    'settings:read',
    'settings:write',
    'users:read',
    'roles:write',
    'audit:read',
  ]),
  admin: new Set(['system:read', 'settings:read', 'settings:write', 'users:read', 'audit:read']),
  operator: new Set(['system:read', 'settings:read']),
  viewer: new Set(['system:read', 'settings:read']),
};

export function hasPermission(userRoles: readonly Role[], permission: Permission): boolean {
  return userRoles.some((role) => permissions[role].has(permission));
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}
