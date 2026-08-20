'use server';

import { revalidatePath } from 'next/cache';
import { requireCapability, ForbiddenError } from '@/lib/http/auth-guard';
import { prisma } from '@/lib/db';
import { requireSiteAccess } from '@/lib/services/tenant.service';
import { runPagespeed } from '@/lib/psi/client';

export type SiteResult = { ok: true; message: string } | { ok: false; error: string };

function fail(e: unknown): SiteResult {
  if (e instanceof ForbiddenError) return { ok: false, error: e.message };
  return { ok: false, error: e instanceof Error ? e.message : 'Something went wrong.' };
}

/** Adding a site is how a new organisation gets started; admin only. */
export async function createSiteAction(_prev: unknown, form: FormData): Promise<SiteResult> {
  try {
    const ctx = await requireCapability('site:manage');
    const name = String(form.get('name') ?? '').trim();
    const baseUrl = String(form.get('baseUrl') ?? '').trim().replace(/\/+$/, '');
    const sitemapUrl = String(form.get('sitemapUrl') ?? '').trim();

    if (!name) return { ok: false, error: 'Give the site a name.' };
    for (const [label, value] of [['Base URL', baseUrl], ['Sitemap URL', sitemapUrl]] as const) {
      try {
        const u = new URL(value);
        if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error();
      } catch {
        return { ok: false, error: `${label} must be a full URL, starting with https://` };
      }
    }

    const site = await prisma.site.create({
      data: { organizationId: ctx.organizationId, name, baseUrl, sitemapUrl },
      select: { id: true },
    });
    // Both start disabled; nothing fires until someone opts in.
    await prisma.schedule.create({ data: { siteId: site.id, enabled: false } });
    await prisma.notificationSetting.create({ data: { siteId: site.id } });

    revalidatePath('/', 'layout');
    return { ok: true, message: `${name} added. Ingest its sitemap to start.` };
  } catch (e) {
    return fail(e);
  }
}

export async function updateSiteAction(_prev: unknown, form: FormData): Promise<SiteResult> {
  try {
    const ctx = await requireCapability('site:manage');
    const siteId = String(form.get('siteId') ?? '');
    await requireSiteAccess(ctx.organizationId, siteId);

    const name = String(form.get('name') ?? '').trim();
    const baseUrl = String(form.get('baseUrl') ?? '').trim().replace(/\/+$/, '');
    const sitemapUrl = String(form.get('sitemapUrl') ?? '').trim();
    if (!name || !baseUrl || !sitemapUrl) return { ok: false, error: 'Name, base URL and sitemap URL are all required.' };

    await prisma.site.update({ where: { id: siteId }, data: { name, baseUrl, sitemapUrl } });
    revalidatePath('/', 'layout');
    return { ok: true, message: 'Site updated. Re-ingest the sitemap if the URL changed.' };
  } catch (e) {
    return fail(e);
  }
}

/**
 * The PSI key is admin-only and write-only.
 *
 * It is never sent to the browser, so the form shows a masked placeholder and
 * an unchanged field must not overwrite the stored value with dots. Submitting
 * an empty field clears it deliberately.
 */
export async function updatePsiKeyAction(_prev: unknown, form: FormData): Promise<SiteResult> {
  try {
    const ctx = await requireCapability('site:manage');
    const siteId = String(form.get('siteId') ?? '');
    await requireSiteAccess(ctx.organizationId, siteId);

    const raw = String(form.get('psiApiKey') ?? '').trim();
    if (raw.includes('•')) return { ok: true, message: 'Key unchanged.' };

    if (raw) {
      // Verify before storing: a wrong key otherwise fails silently on every
      // page of the next sweep, hours later.
      const probe = await runPagespeed('https://example.com/', 'mobile', { apiKey: raw, timeoutMs: 45_000 });
      if (!probe.ok && probe.kind === 'permanent') {
        return { ok: false, error: `Google rejected that key: ${probe.message}` };
      }
    }

    await prisma.site.update({ where: { id: siteId }, data: { psiApiKey: raw || null } });
    revalidatePath('/settings/site');
    return { ok: true, message: raw ? 'API key saved and verified against Google.' : 'API key cleared.' };
  } catch (e) {
    return fail(e);
  }
}

/**
 * Re-reads the sitemap into Page rows.
 *
 * Idempotent: existing pages keep their history and their manual group, and a
 * URL that has left the sitemap is deactivated rather than deleted -- the past
 * results are the point of the tool.
 */
export async function ingestSitemapAction(siteId: string): Promise<SiteResult> {
  try {
    const ctx = await requireCapability('site:manage');
    await requireSiteAccess(ctx.organizationId, siteId);

    const { ingestSitemap } = await import('@/lib/services/ingest.service');
    const s = await ingestSitemap(prisma, siteId);

    const parts = [
      s.created > 0 ? `${s.created} new` : null,
      s.updated > 0 ? `${s.updated} unchanged` : null,
      s.reactivated > 0 ? `${s.reactivated} back` : null,
      s.deactivated > 0 ? `${s.deactivated} no longer listed` : null,
      s.groupsCreated > 0 ? `${s.groupsCreated} new sections` : null,
    ].filter(Boolean);

    const rejected = Object.entries(s.rejected).filter(([, n]) => n > 0);
    if (rejected.length) parts.push(`skipped ${rejected.map(([k, n]) => `${n} ${k}`).join(', ')}`);

    revalidatePath('/', 'layout');
    return { ok: true, message: `${s.discovered} pages found — ${parts.join(', ') || 'nothing changed'}.` };
  } catch (e) {
    return fail(e);
  }
}

/**
 * Deletes chosen historical checks entirely -- an operator picking specific
 * sweeps/sections to reclaim space, not the age-based prune that already runs
 * after every finalize. Pages, groups and site config are untouched.
 */
export async function deleteRunsAction(siteId: string, runIds: string[]): Promise<SiteResult> {
  try {
    const ctx = await requireCapability('site:manage');
    await requireSiteAccess(ctx.organizationId, siteId);
    if (runIds.length === 0) return { ok: false, error: 'Select at least one check to delete.' };

    const { deleteRuns } = await import('@/lib/services/retention.service');
    const { runsDeleted, resultsDeleted } = await deleteRuns(prisma, siteId, runIds);

    if (runsDeleted === 0) {
      return { ok: false, error: 'Nothing was deleted — a run still in progress cannot be removed this way.' };
    }

    revalidatePath('/settings/site');
    revalidatePath('/settings/automation');
    revalidatePath('/', 'layout');
    return {
      ok: true,
      message: `Deleted ${runsDeleted} check${runsDeleted === 1 ? '' : 's'}${
        resultsDeleted > 0 ? ` — ${resultsDeleted.toLocaleString()} results removed` : ''
      }.`,
    };
  } catch (e) {
    return fail(e);
  }
}
