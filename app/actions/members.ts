'use server';

import { revalidatePath } from 'next/cache';
import { requireCapability, ForbiddenError } from '@/lib/http/auth-guard';
import { prisma } from '@/lib/db';
import { inviteMember, wouldOrphanOrganization, normalizeEmail } from '@/lib/services/account.service';
import { isRole, type Role } from '@/lib/auth/roles';
import { getEnv } from '@/lib/env';
import { sendEmail } from '@/lib/notify/email';

export type MemberResult = { ok: true; message: string; inviteUrl?: string } | { ok: false; error: string };

function fail(e: unknown): MemberResult {
  if (e instanceof ForbiddenError) return { ok: false, error: e.message };
  return { ok: false, error: e instanceof Error ? e.message : 'Something went wrong.' };
}

export async function inviteMemberAction(_prev: unknown, form: FormData): Promise<MemberResult> {
  try {
    const ctx = await requireCapability('members:manage');
    const email = String(form.get('email') ?? '');
    const roleRaw = String(form.get('role') ?? 'viewer');
    if (!isRole(roleRaw)) return { ok: false, error: 'Pick a valid role.' };

    const result = await inviteMember({
      organizationId: ctx.organizationId,
      email,
      role: roleRaw,
      invitedById: ctx.userId,
    });
    if (!result.ok) return { ok: false, error: result.error };

    const url = `${getEnv().APP_URL}/invite?token=${result.invite.token}`;

    // Best-effort: email is often not configured yet, and an invitation that
    // cannot be sent is still usable as a link. Failing the whole action would
    // waste the token.
    const sent = await sendEmail(
      [result.invite.email],
      `You have been invited to ${ctx.organizationName} on PageSpeed Auditor`,
      `<p>${ctx.name ?? ctx.email} invited you to <strong>${ctx.organizationName}</strong>.</p>
       <p><a href="${url}">Accept the invitation</a></p>
       <p style="color:#78716c">The link expires in 7 days.</p>`,
      `${ctx.name ?? ctx.email} invited you to ${ctx.organizationName}.\n\n${url}\n\nThe link expires in 7 days.`,
    );

    revalidatePath('/settings/team');
    return {
      ok: true,
      message: sent.sent
        ? `Invitation emailed to ${result.invite.email}.`
        : `Invitation created. Email could not be sent (${sent.reason}) — copy the link below and send it yourself.`,
      // Always returned: the admin may need to pass it on by hand.
      inviteUrl: url,
    };
  } catch (e) {
    return fail(e);
  }
}

export async function changeRoleAction(userId: string, roleRaw: string): Promise<MemberResult> {
  try {
    const ctx = await requireCapability('members:manage');
    if (!isRole(roleRaw)) return { ok: false, error: 'Pick a valid role.' };
    const role: Role = roleRaw;

    // Demoting the last admin locks everyone out of settings with no way back
    // through the UI.
    if (role !== 'admin' && (await wouldOrphanOrganization(ctx.organizationId, userId))) {
      return { ok: false, error: 'This is the only admin. Promote someone else first.' };
    }

    await prisma.membership.updateMany({
      where: { organizationId: ctx.organizationId, userId },
      data: { role },
    });
    revalidatePath('/settings/team');
    return { ok: true, message: 'Role updated.' };
  } catch (e) {
    return fail(e);
  }
}

export async function removeMemberAction(userId: string): Promise<MemberResult> {
  try {
    const ctx = await requireCapability('members:manage');
    if (userId === ctx.userId) return { ok: false, error: 'You cannot remove yourself.' };
    if (await wouldOrphanOrganization(ctx.organizationId, userId)) {
      return { ok: false, error: 'This is the only admin. Promote someone else first.' };
    }

    await prisma.membership.deleteMany({ where: { organizationId: ctx.organizationId, userId } });
    revalidatePath('/settings/team');
    return { ok: true, message: 'Member removed.' };
  } catch (e) {
    return fail(e);
  }
}

export async function revokeInviteAction(inviteId: string): Promise<MemberResult> {
  try {
    const ctx = await requireCapability('members:manage');
    await prisma.invitation.deleteMany({
      where: { id: inviteId, organizationId: ctx.organizationId, acceptedAt: null },
    });
    revalidatePath('/settings/team');
    return { ok: true, message: 'Invitation revoked.' };
  } catch (e) {
    return fail(e);
  }
}

export async function updateProfileAction(_prev: unknown, form: FormData): Promise<MemberResult> {
  try {
    // No capability needed: everyone may edit their own profile.
    const ctx = await requireCapability('reports:read');
    const name = String(form.get('name') ?? '').trim();
    const email = normalizeEmail(String(form.get('email') ?? ''));

    if (!email.includes('@')) return { ok: false, error: 'That does not look like an email address.' };
    if (email !== ctx.email) {
      const taken = await prisma.user.findUnique({ where: { email }, select: { id: true } });
      if (taken) return { ok: false, error: 'Another account already uses that email.' };
    }

    await prisma.user.update({ where: { id: ctx.userId }, data: { name: name || null, email } });
    revalidatePath('/settings/profile');
    return { ok: true, message: 'Profile updated.' };
  } catch (e) {
    return fail(e);
  }
}

export async function changePasswordAction(_prev: unknown, form: FormData): Promise<MemberResult> {
  try {
    const ctx = await requireCapability('reports:read');
    const current = String(form.get('currentPassword') ?? '');
    const next = String(form.get('newPassword') ?? '');
    if (next.length < 12) return { ok: false, error: 'Use a password of at least 12 characters.' };

    const { verifyPassword, hashPassword } = await import('@/lib/auth/password');
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: ctx.userId },
      select: { passwordHash: true },
    });
    // Requiring the current password stops a borrowed open session from
    // locking the real owner out.
    if (!(await verifyPassword(current, user.passwordHash))) {
      return { ok: false, error: 'Your current password is not correct.' };
    }

    await prisma.user.update({
      where: { id: ctx.userId },
      data: { passwordHash: await hashPassword(next) },
    });
    return { ok: true, message: 'Password changed.' };
  } catch (e) {
    return fail(e);
  }
}
