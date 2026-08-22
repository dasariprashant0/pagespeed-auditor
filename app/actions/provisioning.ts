'use server';

import { revalidatePath } from 'next/cache';
import { requireCapability, ForbiddenError } from '@/lib/http/auth-guard';
import { centralPrisma } from '@/lib/db/central';
import { encryptSecret, decryptSecret } from '@/lib/crypto/secretBox';
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
 * Neon and D1 are two fully independent panels, each with its own Test /
 * Save / Clear -- rotating the D1 token was already independent of the
 * Neon URL before this split; this makes the UI match that independence
 * instead of hiding six operations behind one combined submit.
 */

export type ProvisionResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

function fail(e: unknown): ProvisionResult {
  if (e instanceof ForbiddenError) return { ok: false, error: e.message };
  return { ok: false, error: e instanceof Error ? e.message : 'Something went wrong.' };
}

const DOT_PLACEHOLDER = '•';

// --- Neon -------------------------------------------------------------------

/**
 * Validates a Neon connection string without persisting or migrating
 * anything. If the field still shows the masked placeholder, tests the
 * already-saved connection instead of the literal dots -- "does what I
 * already have still work" is a meaningful question on its own.
 */
export async function testNeonConnectionAction(_prev: ProvisionResult | null, form: FormData): Promise<ProvisionResult> {
  try {
    const ctx = await requireCapability('org:provision');
    const raw = String(form.get('tenantDbUrl') ?? '').trim();

    let connectionString: string;
    if (raw.includes(DOT_PLACEHOLDER)) {
      const org = await centralPrisma.organization.findUnique({
        where: { id: ctx.organizationId },
        select: { tenantDbUrlEnc: true },
      });
      if (!org?.tenantDbUrlEnc) return { ok: false, error: 'Nothing saved yet to test.' };
      connectionString = decryptSecret(org.tenantDbUrlEnc, `${ctx.organizationId}:tenantDbUrl`);
    } else {
      if (!raw) return { ok: false, error: 'The Neon connection string is required.' };
      connectionString = raw;
    }

    const error = await validateNeonUrl(connectionString);
    if (error) return { ok: false, error };
    return { ok: true, message: 'Connected. This database is reachable and empty.' };
  } catch (e) {
    return fail(e);
  }
}

/** Validates, migrates, and persists a new Neon connection string. */
export async function saveNeonConnectionAction(_prev: ProvisionResult | null, form: FormData): Promise<ProvisionResult> {
  try {
    const ctx = await requireCapability('org:provision');
    const organizationId = ctx.organizationId;
    const raw = String(form.get('tenantDbUrl') ?? '').trim();

    if (raw.includes(DOT_PLACEHOLDER)) return { ok: true, message: 'Nothing changed.' };
    if (!raw) return { ok: false, error: 'The Neon connection string is required.' };

    const neonError = await validateNeonUrl(raw);
    if (neonError) return { ok: false, error: neonError };

    await centralPrisma.organization.update({
      where: { id: organizationId },
      // 'provisioning' first, not 'ready' -- a crash mid-migration then
      // reads as visibly stuck, not silently fine.
      data: { provisionStatus: 'provisioning', provisionError: null },
    });
    try {
      await runTenantMigrations(raw);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await centralPrisma.organization.update({
        where: { id: organizationId },
        data: { provisionStatus: 'failed', provisionError: message },
      });
      return { ok: false, error: `Migration failed: ${message}` };
    }
    await centralPrisma.organization.update({
      where: { id: organizationId },
      data: {
        provisionStatus: 'ready',
        provisionedAt: new Date(),
        provisionError: null,
        tenantDbUrlEnc: encryptSecret(raw, `${organizationId}:tenantDbUrl`),
      },
    });

    revalidatePath('/settings/database');
    return { ok: true, message: 'Saved and verified.' };
  } catch (e) {
    return fail(e);
  }
}

/**
 * Forgets this organisation's saved Neon connection -- only the pointer
 * kept in OUR database. Never touches the organisation's actual Neon
 * database or its data; it just stops using it until reconnected.
 */
export async function clearNeonConnectionAction(): Promise<ProvisionResult> {
  try {
    const ctx = await requireCapability('org:provision');
    await centralPrisma.organization.update({
      where: { id: ctx.organizationId },
      data: {
        tenantDbUrlEnc: null,
        provisionStatus: 'unprovisioned',
        provisionedAt: null,
        provisionError: null,
      },
    });
    revalidatePath('/settings/database');
    return { ok: true, message: 'Disconnected.' };
  } catch (e) {
    return fail(e);
  }
}

// --- D1 -----------------------------------------------------------------

/** Validates D1 credentials without persisting or creating the schema table. */
export async function testD1ConnectionAction(_prev: ProvisionResult | null, form: FormData): Promise<ProvisionResult> {
  try {
    const ctx = await requireCapability('org:provision');
    const accountRaw = String(form.get('d1AccountId') ?? '').trim();
    const databaseRaw = String(form.get('d1DatabaseId') ?? '').trim();
    const tokenRaw = String(form.get('d1ApiToken') ?? '').trim();
    const anyPlaceholder = [accountRaw, databaseRaw, tokenRaw].some((v) => v.includes(DOT_PLACEHOLDER));

    let accountId: string, databaseId: string, apiToken: string;
    if (anyPlaceholder) {
      const org = await centralPrisma.organization.findUnique({
        where: { id: ctx.organizationId },
        select: { d1AccountIdEnc: true, d1DatabaseIdEnc: true, d1ApiTokenEnc: true },
      });
      if (!org?.d1AccountIdEnc || !org.d1DatabaseIdEnc || !org.d1ApiTokenEnc) {
        return { ok: false, error: 'Nothing saved yet to test.' };
      }
      accountId = decryptSecret(org.d1AccountIdEnc, `${ctx.organizationId}:d1AccountId`);
      databaseId = decryptSecret(org.d1DatabaseIdEnc, `${ctx.organizationId}:d1DatabaseId`);
      apiToken = decryptSecret(org.d1ApiTokenEnc, `${ctx.organizationId}:d1ApiToken`);
    } else {
      if (!accountRaw || !databaseRaw || !tokenRaw) {
        return { ok: false, error: 'All three D1 fields are required together.' };
      }
      accountId = accountRaw;
      databaseId = databaseRaw;
      apiToken = tokenRaw;
    }

    const error = await validateD1Credentials(accountId, databaseId, apiToken);
    if (error) return { ok: false, error };
    return { ok: true, message: 'Connected.' };
  } catch (e) {
    return fail(e);
  }
}

/** Validates D1 credentials, ensures the raw_json_blobs table exists, and persists. */
export async function saveD1ConnectionAction(_prev: ProvisionResult | null, form: FormData): Promise<ProvisionResult> {
  try {
    const ctx = await requireCapability('org:provision');
    const organizationId = ctx.organizationId;
    const accountRaw = String(form.get('d1AccountId') ?? '').trim();
    const databaseRaw = String(form.get('d1DatabaseId') ?? '').trim();
    const tokenRaw = String(form.get('d1ApiToken') ?? '').trim();
    const anyPlaceholder = [accountRaw, databaseRaw, tokenRaw].some((v) => v.includes(DOT_PLACEHOLDER));

    if (anyPlaceholder) return { ok: true, message: 'Nothing changed.' };
    if (!accountRaw || !databaseRaw || !tokenRaw) {
      return { ok: false, error: 'All three D1 fields are required together.' };
    }

    const d1Error = await validateD1Credentials(accountRaw, databaseRaw, tokenRaw);
    if (d1Error) return { ok: false, error: d1Error };
    // Credentials alone don't get raw JSON storage working -- a fresh D1
    // database has no raw_json_blobs table until this creates it.
    const schemaError = await ensureD1Schema(accountRaw, databaseRaw, tokenRaw);
    if (schemaError) return { ok: false, error: schemaError };

    await centralPrisma.organization.update({
      where: { id: organizationId },
      data: {
        d1AccountIdEnc: encryptSecret(accountRaw, `${organizationId}:d1AccountId`),
        d1DatabaseIdEnc: encryptSecret(databaseRaw, `${organizationId}:d1DatabaseId`),
        d1ApiTokenEnc: encryptSecret(tokenRaw, `${organizationId}:d1ApiToken`),
      },
    });

    revalidatePath('/settings/database');
    return { ok: true, message: 'Saved and verified.' };
  } catch (e) {
    return fail(e);
  }
}

/**
 * Forgets this organisation's saved D1 credentials -- only the pointer
 * kept in OUR database. Never touches the organisation's actual D1
 * database or the raw JSON already stored there.
 */
export async function clearD1ConnectionAction(): Promise<ProvisionResult> {
  try {
    const ctx = await requireCapability('org:provision');
    await centralPrisma.organization.update({
      where: { id: ctx.organizationId },
      data: { d1AccountIdEnc: null, d1DatabaseIdEnc: null, d1ApiTokenEnc: null },
    });
    revalidatePath('/settings/database');
    return { ok: true, message: 'Disconnected.' };
  } catch (e) {
    return fail(e);
  }
}

// --- Single-action-per-form dispatch ---------------------------------------

/**
 * Each panel is one <form> with one useActionState, so there is exactly one
 * result to show -- whichever of test/save/clear the caller most recently
 * clicked -- rather than three independent hooks racing to display stale
 * results from an earlier click. The buttons pick the operation via a
 * hidden `intent` field; the six functions above stay separately exported
 * and independently callable (and testable) for anything that wants one
 * directly, this is just the form-facing entry point.
 */
export async function neonConnectionAction(prev: ProvisionResult | null, form: FormData): Promise<ProvisionResult> {
  const intent = String(form.get('intent') ?? '');
  if (intent === 'test') return testNeonConnectionAction(prev, form);
  if (intent === 'clear') return clearNeonConnectionAction();
  return saveNeonConnectionAction(prev, form);
}

export async function d1ConnectionAction(prev: ProvisionResult | null, form: FormData): Promise<ProvisionResult> {
  const intent = String(form.get('intent') ?? '');
  if (intent === 'test') return testD1ConnectionAction(prev, form);
  if (intent === 'clear') return clearD1ConnectionAction();
  return saveD1ConnectionAction(prev, form);
}
