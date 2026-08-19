/**
 * Roles and what they may do.
 *
 * Capabilities are named rather than checked as `role === 'admin'` scattered
 * through the code. When a role's powers change, they change here, and no call
 * site silently keeps the old rule.
 */

export const ROLES = ['viewer', 'editor', 'developer', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export function isRole(v: unknown): v is Role {
  return typeof v === 'string' && (ROLES as readonly string[]).includes(v);
}

export type Capability =
  /** Read reports, history, top issues; download the agent markdown. */
  | 'reports:read'
  /** Trigger audits for a page or a group. */
  | 'audits:run'
  /** Generate or regenerate AI recommendations (these cost money). */
  | 'recommendations:generate'
  /** Rename and merge groups, set sweep order. */
  | 'groups:manage'
  /** See and rotate the MCP token; read raw PSI JSON. */
  | 'developer:access'
  /** Site config: sitemap, base URL, PSI key. */
  | 'site:manage'
  /** Invite, remove, and change the role of teammates. */
  | 'members:manage'
  /** Schedule and notification settings. */
  | 'automation:manage';

const CAPABILITIES: Record<Role, Capability[]> = {
  viewer: ['reports:read'],

  editor: ['reports:read', 'audits:run', 'recommendations:generate', 'groups:manage'],

  // A developer is an editor who also gets the machine-readable surfaces --
  // the MCP token and the raw PSI response -- but not the billing-adjacent or
  // people-management powers.
  developer: [
    'reports:read',
    'audits:run',
    'recommendations:generate',
    'groups:manage',
    'developer:access',
  ],

  admin: [
    'reports:read',
    'audits:run',
    'recommendations:generate',
    'groups:manage',
    'developer:access',
    'site:manage',
    'members:manage',
    'automation:manage',
  ],
};

export function can(role: Role, capability: Capability): boolean {
  return CAPABILITIES[role].includes(capability);
}

export const ROLE_LABEL: Record<Role, string> = {
  viewer: 'Viewer',
  editor: 'Editor',
  developer: 'Developer',
  admin: 'Admin',
};

export const ROLE_DESCRIPTION: Record<Role, string> = {
  viewer: 'Read reports and download them. Cannot change anything.',
  editor: 'Everything a viewer can do, plus run audits and organise groups.',
  developer: 'Everything an editor can do, plus agent (MCP) access and raw PSI data.',
  admin: 'Full control, including teammates, the API key and the schedule.',
};

/** Ordered least to most privileged, for pickers. */
export const ROLE_ORDER: Role[] = ['viewer', 'editor', 'developer', 'admin'];
