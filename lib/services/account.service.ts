import { randomBytes, createHash } from 'node:crypto';
import { centralPrisma } from '../db/central.ts';
import { hashPassword, verifyPassword } from '../auth/password.ts';
import { isRole, type Role } from '../auth/roles.ts';
import { logger } from '../logger.ts';

/**
 * Accounts, organisations and invitations.
 *
 * Identity is global (one User per email) but authority is per-organisation
 * (Membership). The same person can belong to two tenants with different roles,
 * and nothing anywhere may assume a user has exactly one.
 */

export interface SessionContext {
  userId: string;
  email: string;
  name: string | null;
  organizationId: string;
  organizationName: string;
  role: Role;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'org';
}

/** Slugs are user-visible and unique; collisions get a numeric suffix. */
async function uniqueSlug(base: string): Promise<string> {
  const root = slugify(base);
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? root : `${root}-${i + 1}`;
    const taken = await centralPrisma.organization.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!taken) return candidate;
  }
  return `${root}-${randomBytes(3).toString('hex')}`;
}

export type SignupResult =
  | { ok: true; userId: string; organizationId: string }
  | { ok: false; error: string };

/**
 * Creates an organisation and its first admin, atomically.
 *
 * An organisation with no admin is unusable and cannot be repaired through the
 * UI, so the two are never created separately.
 */
export async function signup(input: {
  email: string;
  password: string;
  name?: string;
  organizationName: string;
}): Promise<SignupResult> {
  const email = normalizeEmail(input.email);
  if (!email.includes('@')) return { ok: false, error: 'That does not look like an email address.' };
  if (input.password.length < 12) return { ok: false, error: 'Use a password of at least 12 characters.' };
  if (!input.organizationName.trim()) return { ok: false, error: 'Give your organisation a name.' };

  const existing = await centralPrisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) return { ok: false, error: 'An account already exists for that email. Sign in instead.' };

  const passwordHash = await hashPassword(input.password);
  const slug = await uniqueSlug(input.organizationName);

  const result = await centralPrisma.$transaction(async (tx) => {
    const org = await tx.organization.create({
      data: { name: input.organizationName.trim(), slug },
      select: { id: true },
    });
    const user = await tx.user.create({
      data: { email, name: input.name?.trim() || null, passwordHash },
      select: { id: true },
    });
    await tx.membership.create({ data: { userId: user.id, organizationId: org.id, role: 'admin' } });
    return { userId: user.id, organizationId: org.id };
  });

  logger.info({ email, organizationId: result.organizationId }, 'organisation created');
  return { ok: true, ...result };
}

/** One row of "which organisations can this user sign into" -- the org-picker's list. */
export interface MembershipSummary {
  organizationId: string;
  organizationName: string;
  role: Role;
}

/**
 * A user can genuinely belong to more than one organisation (e.g. a
 * consultant auditing several clients' sites) -- Membership is a real
 * many-to-many, `@@unique([userId, organizationId])`, both sides arrays.
 * This used to be resolved silently by always picking the OLDEST
 * membership (`findFirst({ orderBy: 'asc' })`), which was harmless while
 * every organisation shared one database. It stops being harmless once
 * organisations have their own separate databases -- picking wrong then
 * means opening the wrong database, not just showing wrong data -- so
 * every caller now gets the full list and asks explicitly when there's
 * more than one.
 */
async function membershipSummaries(userId: string): Promise<MembershipSummary[]> {
  const memberships = await centralPrisma.membership.findMany({
    where: { userId },
    orderBy: { createdAt: 'asc' },
    select: { organizationId: true, role: true, organization: { select: { name: true } } },
  });
  return memberships.map((m) => ({
    organizationId: m.organizationId,
    organizationName: m.organization.name,
    role: isRole(m.role) ? m.role : 'viewer',
  }));
}

/** For the org-picker page: what this pending sign-in can choose between. */
export async function membershipsForUser(userId: string): Promise<MembershipSummary[]> {
  return membershipSummaries(userId);
}

export type LoginOutcome =
  | { ok: true; kind: 'single'; context: SessionContext }
  | { ok: true; kind: 'choose'; userId: string; memberships: MembershipSummary[] }
  | { ok: false; error: string };

/** Constant-ish cost regardless of outcome; see verifyPassword. */
export async function login(email: string, password: string): Promise<LoginOutcome> {
  const normalized = normalizeEmail(email);
  const user = await centralPrisma.user.findUnique({
    where: { email: normalized },
    select: { id: true, email: true, name: true, passwordHash: true },
  });

  // Always run a compare, even for an unknown address, so response time does
  // not reveal which emails have accounts.
  const ok = await verifyPassword(password, user?.passwordHash ?? '');
  if (!user || !ok) return { ok: false, error: 'Email or password is incorrect.' };

  const memberships = await membershipSummaries(user.id);
  if (memberships.length === 0) {
    return { ok: false, error: 'This account is not a member of any organisation. Ask an admin to invite you again.' };
  }

  // The password has already been verified at this point, regardless of
  // which organisation gets chosen next.
  await centralPrisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  if (memberships.length > 1) {
    return { ok: true, kind: 'choose', userId: user.id, memberships };
  }

  const m = memberships[0];
  return {
    ok: true,
    kind: 'single',
    context: {
      userId: user.id,
      email: user.email,
      name: user.name,
      organizationId: m.organizationId,
      organizationName: m.organizationName,
      role: m.role,
    },
  };
}

/**
 * Signs in an already-verified Google account. The caller (the OAuth
 * callback route) is responsible for verifying the id_token's signature
 * before this is ever reached -- this function trusts the email it's given.
 *
 * Deliberately does NOT create an account for an unknown email: unlike
 * signupWithGoogle/acceptInvitationWithGoogle, there is no organisation to
 * attach a brand-new user to here, and a User row with no Membership is a
 * dead end nobody can act on.
 */
export async function loginWithGoogle(email: string): Promise<LoginOutcome> {
  const normalized = normalizeEmail(email);
  const user = await centralPrisma.user.findUnique({
    where: { email: normalized },
    select: { id: true, email: true, name: true },
  });
  if (!user) {
    return { ok: false, error: 'No account uses that Google address yet. Ask an admin to invite you, or sign up.' };
  }

  const memberships = await membershipSummaries(user.id);
  if (memberships.length === 0) {
    return { ok: false, error: 'This account is not a member of any organisation. Ask an admin to invite you again.' };
  }

  await centralPrisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  if (memberships.length > 1) {
    return { ok: true, kind: 'choose', userId: user.id, memberships };
  }

  const m = memberships[0];
  return {
    ok: true,
    kind: 'single',
    context: {
      userId: user.id,
      email: user.email,
      name: user.name,
      organizationId: m.organizationId,
      organizationName: m.organizationName,
      role: m.role,
    },
  };
}

/** Google's equivalent of signup(): a verified email in place of a chosen password. */
export async function signupWithGoogle(input: {
  email: string;
  name?: string | null;
  organizationName: string;
}): Promise<SignupResult> {
  const email = normalizeEmail(input.email);
  if (!input.organizationName.trim()) return { ok: false, error: 'Give your organisation a name.' };

  const existing = await centralPrisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) return { ok: false, error: 'An account already exists for that email. Sign in instead.' };

  const slug = await uniqueSlug(input.organizationName);

  const result = await centralPrisma.$transaction(async (tx) => {
    const org = await tx.organization.create({
      data: { name: input.organizationName.trim(), slug },
      select: { id: true },
    });
    const user = await tx.user.create({
      data: { email, name: input.name?.trim() || null, passwordHash: null },
      select: { id: true },
    });
    await tx.membership.create({ data: { userId: user.id, organizationId: org.id, role: 'admin' } });
    return { userId: user.id, organizationId: org.id };
  });

  logger.info({ email, organizationId: result.organizationId }, 'organisation created via Google');
  return { ok: true, ...result };
}

/**
 * Google's equivalent of acceptInvitation(). The invited address is still
 * authoritative -- the same reason acceptInvitation() itself gives: the
 * Google account doing the accepting must be the exact address the
 * invitation named, or an intercepted link would let someone join as
 * somebody else, just via a different credential than a guessed password.
 */
export async function acceptInvitationWithGoogle(
  token: string,
  googleEmail: string,
  name?: string | null,
): Promise<AcceptOutcome> {
  const invite = await centralPrisma.invitation.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { id: true, organizationId: true, email: true, role: true, expiresAt: true, acceptedAt: true },
  });

  if (!invite) return { ok: false, error: 'That invitation link is not valid.' };
  if (invite.acceptedAt) return { ok: false, error: 'That invitation has already been used.' };
  if (invite.expiresAt < new Date()) return { ok: false, error: 'That invitation has expired. Ask for a new one.' };

  if (normalizeEmail(googleEmail) !== invite.email) {
    return {
      ok: false,
      error: `That invitation is for ${invite.email}. Sign in to Google with that address, not ${googleEmail}.`,
    };
  }

  const existing = await centralPrisma.user.findUnique({ where: { email: invite.email }, select: { id: true } });
  const role: Role = isRole(invite.role) ? invite.role : 'viewer';

  const userId = await centralPrisma.$transaction(async (tx) => {
    const user =
      existing ??
      (await tx.user.create({
        data: { email: invite.email, name: name?.trim() || null, passwordHash: null },
        select: { id: true },
      }));

    await tx.membership.upsert({
      where: { userId_organizationId: { userId: user.id, organizationId: invite.organizationId } },
      update: { role },
      create: { userId: user.id, organizationId: invite.organizationId, role },
    });
    await tx.invitation.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } });
    return user.id;
  });

  logger.info({ email: invite.email, organizationId: invite.organizationId, role }, 'invitation accepted via Google');
  return { ok: true, userId, organizationId: invite.organizationId, needsPassword: false };
}

/** Re-reads authority on every request; a revoked role must take effect at once. */
export async function contextFor(userId: string, organizationId?: string): Promise<SessionContext | null> {
  const user = await centralPrisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true },
  });
  if (!user) return null;

  const membership = await centralPrisma.membership.findFirst({
    where: { userId, ...(organizationId ? { organizationId } : {}) },
    orderBy: { createdAt: 'asc' },
    select: { organizationId: true, role: true, organization: { select: { name: true } } },
  });
  if (!membership) return null;

  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    organizationId: membership.organizationId,
    organizationName: membership.organization.name,
    role: isRole(membership.role) ? membership.role : 'viewer',
  };
}

// --- invitations -----------------------------------------------------------

const INVITE_TTL_DAYS = 7;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface CreatedInvite {
  token: string;
  email: string;
  role: Role;
  expiresAt: Date;
}

/**
 * The raw token is returned ONCE and never stored -- only its hash is. A leaked
 * database row therefore cannot be redeemed.
 */
export async function inviteMember(input: {
  organizationId: string;
  email: string;
  role: Role;
  invitedById: string;
}): Promise<{ ok: true; invite: CreatedInvite } | { ok: false; error: string }> {
  const email = normalizeEmail(input.email);
  if (!email.includes('@')) return { ok: false, error: 'That does not look like an email address.' };

  const already = await centralPrisma.membership.findFirst({
    where: { organizationId: input.organizationId, user: { email } },
    select: { id: true },
  });
  if (already) return { ok: false, error: `${email} is already a member.` };

  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000);

  // Re-inviting replaces the outstanding invite rather than accumulating rows.
  await centralPrisma.invitation.deleteMany({
    where: { organizationId: input.organizationId, email, acceptedAt: null },
  });
  await centralPrisma.invitation.create({
    data: {
      organizationId: input.organizationId,
      email,
      role: input.role,
      tokenHash: hashToken(token),
      invitedById: input.invitedById,
      expiresAt,
    },
  });

  return { ok: true, invite: { token, email, role: input.role, expiresAt } };
}

export type AcceptOutcome =
  | { ok: true; userId: string; organizationId: string; needsPassword: boolean }
  | { ok: false; error: string };

/**
 * Redeems an invitation, creating the account if this is a new person.
 *
 * The invited address is authoritative: accepting cannot be redirected to a
 * different email, or an intercepted link would let someone join as themselves.
 */
export async function acceptInvitation(token: string, password?: string, name?: string): Promise<AcceptOutcome> {
  const invite = await centralPrisma.invitation.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { id: true, organizationId: true, email: true, role: true, expiresAt: true, acceptedAt: true },
  });

  if (!invite) return { ok: false, error: 'That invitation link is not valid.' };
  if (invite.acceptedAt) return { ok: false, error: 'That invitation has already been used.' };
  if (invite.expiresAt < new Date()) return { ok: false, error: 'That invitation has expired. Ask for a new one.' };

  const existing = await centralPrisma.user.findUnique({
    where: { email: invite.email },
    select: { id: true },
  });

  if (!existing && (!password || password.length < 12)) {
    return { ok: false, error: 'Choose a password of at least 12 characters.' };
  }

  const role: Role = isRole(invite.role) ? invite.role : 'viewer';

  const userId = await centralPrisma.$transaction(async (tx) => {
    const user =
      existing ??
      (await tx.user.create({
        data: { email: invite.email, name: name?.trim() || null, passwordHash: await hashPassword(password!) },
        select: { id: true },
      }));

    await tx.membership.upsert({
      where: { userId_organizationId: { userId: user.id, organizationId: invite.organizationId } },
      update: { role },
      create: { userId: user.id, organizationId: invite.organizationId, role },
    });
    await tx.invitation.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } });
    return user.id;
  });

  logger.info({ email: invite.email, organizationId: invite.organizationId, role }, 'invitation accepted');
  return { ok: true, userId, organizationId: invite.organizationId, needsPassword: false };
}

/**
 * Removing the last admin would leave the organisation unmanageable, with no
 * way back through the UI. Both removal and demotion are blocked.
 */
export async function wouldOrphanOrganization(organizationId: string, userId: string): Promise<boolean> {
  const admins = await centralPrisma.membership.count({ where: { organizationId, role: 'admin' } });
  if (admins > 1) return false;
  const target = await centralPrisma.membership.findFirst({
    where: { organizationId, userId },
    select: { role: true },
  });
  return target?.role === 'admin';
}

// --- password reset --------------------------------------------------------

const RESET_TTL_MINUTES = 30;

/**
 * Starts a reset.
 *
 * Always reports the same thing to the caller whether or not the address has an
 * account: a differing response turns this endpoint into a way to enumerate who
 * has signed up.
 */
export async function requestPasswordReset(
  email: string,
  appUrl: string,
): Promise<{ url: string | null }> {
  const normalized = normalizeEmail(email);
  const user = await centralPrisma.user.findUnique({ where: { email: normalized }, select: { id: true } });
  if (!user) return { url: null };

  const token = randomBytes(32).toString('base64url');

  // Outstanding resets are replaced, so an older link stops working the moment
  // a newer one is requested.
  await centralPrisma.passwordReset.deleteMany({ where: { userId: user.id, usedAt: null } });
  await centralPrisma.passwordReset.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + RESET_TTL_MINUTES * 60_000),
    },
  });

  logger.info({ email: normalized }, 'password reset requested');
  return { url: `${appUrl}/reset?token=${token}` };
}

export interface ResetTokenInfo {
  valid: boolean;
  email?: string;
  reason?: string;
}

export async function inspectResetToken(token: string): Promise<ResetTokenInfo> {
  const row = await centralPrisma.passwordReset.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { expiresAt: true, usedAt: true, user: { select: { email: true } } },
  });
  if (!row) return { valid: false, reason: 'That reset link is not valid.' };
  if (row.usedAt) return { valid: false, reason: 'That reset link has already been used.' };
  if (row.expiresAt < new Date()) return { valid: false, reason: 'That reset link has expired. Request a new one.' };
  return { valid: true, email: row.user.email };
}

export type ResetOutcome =
  | { ok: true; kind: 'single'; userId: string; organizationId: string }
  | { ok: true; kind: 'choose'; userId: string; memberships: MembershipSummary[] }
  | { ok: true; kind: 'none'; userId: string }
  | { ok: false; error: string };

export async function completePasswordReset(token: string, password: string): Promise<ResetOutcome> {
  if (password.length < 12) return { ok: false, error: 'Use a password of at least 12 characters.' };

  const row = await centralPrisma.passwordReset.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { id: true, userId: true, expiresAt: true, usedAt: true },
  });
  if (!row) return { ok: false, error: 'That reset link is not valid.' };
  if (row.usedAt) return { ok: false, error: 'That reset link has already been used.' };
  if (row.expiresAt < new Date()) return { ok: false, error: 'That reset link has expired.' };

  const passwordHash = await hashPassword(password);
  await centralPrisma.$transaction([
    centralPrisma.user.update({ where: { id: row.userId }, data: { passwordHash } }),
    // Marked used inside the same transaction, so the link cannot be replayed
    // even if two requests arrive together.
    centralPrisma.passwordReset.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
  ]);

  logger.info({ userId: row.userId }, 'password reset completed');

  const memberships = await membershipSummaries(row.userId);
  if (memberships.length === 0) return { ok: true, kind: 'none', userId: row.userId };
  if (memberships.length > 1) return { ok: true, kind: 'choose', userId: row.userId, memberships };
  return { ok: true, kind: 'single', userId: row.userId, organizationId: memberships[0].organizationId };
}
