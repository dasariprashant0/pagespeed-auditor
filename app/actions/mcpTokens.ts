'use server';

import { revalidatePath } from 'next/cache';
import { requireCapability } from '@/lib/http/auth-guard';
import { friendlyErrorMessage } from '@/lib/http/actionError';
import { centralPrisma } from '@/lib/db/central';
import { createMcpToken } from '@/lib/mcp/auth';

export type CreateTokenResult = { ok: true; token: string } | { ok: false; error: string };

export async function createMcpTokenAction(_prev: unknown, form: FormData): Promise<CreateTokenResult> {
  try {
    const ctx = await requireCapability('developer:access');
    const token = await createMcpToken(ctx.organizationId, String(form.get('label') ?? '').slice(0, 60), ctx.userId);
    revalidatePath('/settings/agents');
    return { ok: true, token };
  } catch (e) {
    return { ok: false, error: friendlyErrorMessage(e, 'Could not create the token.') };
  }
}

export async function revokeMcpTokenAction(id: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const ctx = await requireCapability('developer:access');
    // Scoped by organisation: a token id from another tenant matches nothing.
    await centralPrisma.mcpToken.updateMany({
      where: { id, organizationId: ctx.organizationId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    revalidatePath('/settings/agents');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: friendlyErrorMessage(e, 'Could not revoke the token.') };
  }
}
