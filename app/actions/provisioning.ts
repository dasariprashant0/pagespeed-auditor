'use server';

import { revalidatePath } from 'next/cache';
import { requireCapability, ForbiddenError } from '@/lib/http/auth-guard';
import { prisma } from '@/lib/db';
import { encryptSecret } from '@/lib/crypto/secretBox';
import { provisionRefFor } from '@/lib/services/org.service';
import { validateNeonUrl, validateD1Credentials, ensureD1Schema, runTenantMigrations } from '@/lib/tenantDb/provision';

/**
 * Connects an organisation's own Neon Postgres and Cloudflare D1 databases
 * -- see docs/DECISIONS.md §19. Same shape as updatePsiKeyAction/
 * updateOrgEmailAction in app/actions/site.ts: a dot-filled field is
 * "untouched, keep what's saved," and the real credential is verified
 * live (lib/tenantDb/provision.ts) before anything is persisted -- a
 * wrong one otherwise fails silently on the next audit, not here where it
 * can actually be fixed.
 *
 * The two halves (Neon, D1) are independent: rotating the D1 token
 * shouldn't force re-pasting the Neon URL, and vice versa. Each is
 * validated and persisted only if its own fields changed.
 */

export type ProvisionResult =
  | { ok: true; message: string }
  | { ok: false; error: string; field?: 'neon' | 'd1' };

function fail(e: unknown): ProvisionResult {
  if (e instanceof ForbiddenError) return { ok: false, error: e.message };
  return { ok: false, error: e instanceof Error ? e.message : 'Something went wrong.' };
}

export async function provisionTenantAction(_prev: ProvisionResult | null, form: FormData): Promise<ProvisionResult> {
  try {
    const ctx = await requireCapability('org:provision');
    const organizationId = ctx.organizationId;

    const neonRaw = String(form.get('tenantDbUrl') ?? '').trim();
    const d1AccountRaw = String(form.get('d1AccountId') ?? '').trim();
    const d1DatabaseRaw = String(form.get('d1DatabaseId') ?? '').trim();
    const d1TokenRaw = String(form.get('d1ApiToken') ?? '').trim();

    const neonUnchanged = neonRaw.includes('•');
    // The three D1 fields are one unit -- a partial credential change (e.g.
    // rotating only the token but leaving the account id field showing dots)
    // doesn't make sense on its own, so any of the three still showing dots
    // means "D1 as a whole is unchanged."
    const d1Unchanged = d1AccountRaw.includes('•') || d1DatabaseRaw.includes('•') || d1TokenRaw.includes('•');

    if (neonUnchanged && d1Unchanged) {
      return { ok: true, message: 'Nothing changed.' };
    }

    const current = await provisionRefFor(organizationId);

    if (!neonUnchanged) {
      if (!neonRaw) return { ok: false, error: 'The Neon connection string is required.', field: 'neon' };
      const neonError = await validateNeonUrl(neonRaw, current.status === 'ready');
      if (neonError) return { ok: false, error: neonError, field: 'neon' };
    }

    if (!d1Unchanged) {
      if (!d1AccountRaw || !d1DatabaseRaw || !d1TokenRaw) {
        return { ok: false, error: 'All three D1 fields are required together.', field: 'd1' };
      }
      const d1Error = await validateD1Credentials(d1AccountRaw, d1DatabaseRaw, d1TokenRaw);
      if (d1Error) return { ok: false, error: d1Error, field: 'd1' };
      // Credentials alone don't get raw JSON storage working -- a fresh D1
      // database has no raw_json_blobs table until this creates it.
      const schemaError = await ensureD1Schema(d1AccountRaw, d1DatabaseRaw, d1TokenRaw);
      if (schemaError) return { ok: false, error: schemaError, field: 'd1' };
    }

    // Both validations (whichever ran) passed -- persist. Neon first, since
    // migrating is the slower, more failure-prone half; D1 only gets written
    // once Neon (if it changed) is confirmed ready.
    if (!neonUnchanged) {
      await prisma.organization.update({
        where: { id: organizationId },
        // 'provisioning' first, not 'ready' -- a crash mid-migration then
        // reads as visibly stuck, not silently fine.
        data: { provisionStatus: 'provisioning', provisionError: null },
      });
      try {
        await runTenantMigrations(neonRaw);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        await prisma.organization.update({
          where: { id: organizationId },
          data: { provisionStatus: 'failed', provisionError: message },
        });
        return { ok: false, error: `Migration failed: ${message}`, field: 'neon' };
      }
      await prisma.organization.update({
        where: { id: organizationId },
        data: {
          provisionStatus: 'ready',
          provisionedAt: new Date(),
          provisionError: null,
          tenantDbUrlEnc: encryptSecret(neonRaw, `${organizationId}:tenantDbUrl`),
        },
      });
    }

    if (!d1Unchanged) {
      await prisma.organization.update({
        where: { id: organizationId },
        data: {
          d1AccountIdEnc: encryptSecret(d1AccountRaw, `${organizationId}:d1AccountId`),
          d1DatabaseIdEnc: encryptSecret(d1DatabaseRaw, `${organizationId}:d1DatabaseId`),
          d1ApiTokenEnc: encryptSecret(d1TokenRaw, `${organizationId}:d1ApiToken`),
        },
      });
    }

    revalidatePath('/settings/database');
    return { ok: true, message: 'Saved and verified.' };
  } catch (e) {
    return fail(e);
  }
}
