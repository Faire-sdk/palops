/**
 * Roles and the permissions they grant. The backend checks permissions on
 * every route; the frontend only uses them to hide things the user can't do.
 */
export const ROLES = ['owner', 'admin', 'moderator', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  'server.view',
  'server.control',
  'server.broadcast',
  'server.connection',
  'players.view',
  'players.kick',
  'players.ban',
  'players.note',
  'world.view',
  'console.view',
  'console.execute',
  'config.view',
  'config.edit',
  'logs.view',
  'audit.view',
  'backups.manage',
  'users.manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ownerOnly: Permission[] = ['server.connection', 'users.manage'];

const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  owner: new Set(PERMISSIONS),
  admin: new Set(PERMISSIONS.filter((p) => !ownerOnly.includes(p))),
  moderator: new Set<Permission>(['server.view', 'players.view', 'players.kick', 'players.note', 'world.view']),
  viewer: new Set<Permission>(['server.view', 'players.view']),
};

export const permissionsFor = (role: Role): Permission[] => [...ROLE_PERMISSIONS[role]];

export const hasPermission = (role: Role, permission: Permission): boolean => ROLE_PERMISSIONS[role].has(permission);

export const isRole = (value: unknown): value is Role => ROLES.includes(value as Role);
