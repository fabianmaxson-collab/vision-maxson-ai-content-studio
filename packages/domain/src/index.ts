export * from './lifecycle';
export * from './monetization';
export * from './parameters';
export * from './editorial';
export * from './terminal-pipeline';
export * from './intelligence';
export * from './timing';

export const roles = ['owner', 'admin', 'operator', 'viewer'] as const;
export type Role = (typeof roles)[number];

export type Permission =
  | 'system:read'
  | 'settings:read'
  | 'settings:write'
  | 'users:read'
  | 'roles:write'
  | 'audit:read'
  | 'catalogs:read'
  | 'brands:read'
  | 'brands:write'
  | 'channels:read'
  | 'channels:write'
  | 'profiles:read'
  | 'profiles:write'
  | 'social_accounts:read'
  | 'social_accounts:write'
  | 'monetization:read'
  | 'monetization:write_status'
  | 'projects:read'
  | 'projects:write'
  | 'editorial:read'
  | 'editorial:write'
  | 'editorial:approve'
  | 'intelligence:execute'
  | 'intelligence:read'
  | 'prompts:admin'
  | 'providers:admin';

const readProduct: Permission[] = [
  'catalogs:read',
  'brands:read',
  'channels:read',
  'profiles:read',
  'social_accounts:read',
  'monetization:read',
  'projects:read',
  'editorial:read',
  'intelligence:read',
];
const editProduct: Permission[] = [
  'brands:write',
  'channels:write',
  'profiles:write',
  'social_accounts:write',
  'projects:write',
  'editorial:write',
  'editorial:approve',
  'intelligence:execute',
];

const permissions: Record<Role, ReadonlySet<Permission>> = {
  owner: new Set([
    'system:read',
    'settings:read',
    'settings:write',
    'users:read',
    'roles:write',
    'audit:read',
    'monetization:write_status',
    'prompts:admin',
    'providers:admin',
    ...readProduct,
    ...editProduct,
  ]),
  admin: new Set([
    'system:read',
    'settings:read',
    'settings:write',
    'users:read',
    'audit:read',
    'monetization:write_status',
    'prompts:admin',
    'providers:admin',
    ...readProduct,
    ...editProduct,
  ]),
  operator: new Set(['system:read', 'settings:read', ...readProduct, ...editProduct]),
  viewer: new Set(['system:read', 'settings:read', ...readProduct]),
};

export function hasPermission(userRoles: readonly Role[], permission: Permission): boolean {
  return userRoles.some((role) => permissions[role].has(permission));
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}
