type CtxAuth = { organizationId?: string; extra?: { organizationId?: unknown } };

/**
 * MCP SDK v2 hands a tool its auth at `ctx.http.authInfo`; v1 used
 * `ctx.authInfo`. Reading only the v1 spot made every token look
 * org-less after the upgrade. The org id is read from the spec's `extra`
 * field first, since custom top-level fields are not guaranteed to survive.
 */
export function orgIdOf(ctx: unknown): string {
  const c = ctx as { http?: { authInfo?: CtxAuth }; authInfo?: CtxAuth } | undefined;
  const auth = c?.http?.authInfo ?? c?.authInfo;
  const org = typeof auth?.extra?.organizationId === 'string' ? auth.extra.organizationId : auth?.organizationId;
  if (!org) throw new Error('This token is not associated with an organisation.');
  return org;
}
