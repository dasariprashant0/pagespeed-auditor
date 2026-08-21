import { getTenantPrisma } from '../db/tenant.ts';
import { centralPrisma } from '../db/central.ts';
import { NotFoundError } from '../errors.ts';
import type { SmtpOverride } from '../notify/email.ts';

/**
 * Tenant scoping.
 *
 * Every read and write of site data goes through a site id that has been
 * checked against the caller's organisation. Resolving the site from the
 * session, rather than trusting an id from the request, is what stops one
 * tenant reading another's pages by guessing a cuid.
 *
 * The rule for the rest of the codebase: never take a siteId straight from a
 * URL or form. Pass it through requireSiteAccess first.
 */

export interface SiteRef {
  id: string;
  name: string;
  baseUrl: string;
  sitemapUrl: string;
  organizationId: string;
  hasPsiKey: boolean;
}

function toRef(s: {
  id: string; name: string; baseUrl: string; sitemapUrl: string;
  organizationId: string; psiApiKey: string | null;
}): SiteRef {
  return {
    id: s.id, name: s.name, baseUrl: s.baseUrl, sitemapUrl: s.sitemapUrl,
    organizationId: s.organizationId,
    // Presence only. The key itself never leaves the server.
    hasPsiKey: Boolean(s.psiApiKey),
  };
}

const SITE_SELECT = {
  id: true, name: true, baseUrl: true, sitemapUrl: true,
  organizationId: true, psiApiKey: true,
} as const;

export async function listSites(organizationId: string): Promise<SiteRef[]> {
  const prisma = await getTenantPrisma(organizationId);
  const sites = await prisma.site.findMany({
    where: { organizationId },
    orderBy: { createdAt: 'asc' },
    select: SITE_SELECT,
  });
  return sites.map(toRef);
}

/** The site to show when none was named. Null when the org has none yet. */
export async function defaultSite(organizationId: string): Promise<SiteRef | null> {
  const prisma = await getTenantPrisma(organizationId);
  const site = await prisma.site.findFirst({
    where: { organizationId },
    orderBy: { createdAt: 'asc' },
    select: SITE_SELECT,
  });
  return site ? toRef(site) : null;
}

/**
 * Resolves a site id, refusing anything outside the caller's organisation.
 *
 * Deliberately reports "not found" rather than "forbidden": telling an outsider
 * that an id exists but belongs to someone else is itself a disclosure.
 */
export async function requireSiteAccess(organizationId: string, siteId: string): Promise<SiteRef> {
  const prisma = await getTenantPrisma(organizationId);
  const site = await prisma.site.findFirst({
    where: { id: siteId, organizationId },
    select: SITE_SELECT,
  });
  if (!site) throw new NotFoundError('Site');
  return toRef(site);
}

/** The PSI key for a site. Server-side only; never returned to a component. */
export async function psiKeyForSite(organizationId: string, siteId: string): Promise<string | null> {
  const prisma = await getTenantPrisma(organizationId);
  const site = await prisma.site.findUnique({ where: { id: siteId }, select: { psiApiKey: true } });
  return site?.psiApiKey?.trim() || null;
}

/**
 * An organisation's SMTP override, if it has one -- null means "send
 * through the shared SMTP_* env vars instead," the same fallback shape as
 * psiKeyForSite above. Server-side only.
 */
export async function emailConfigForOrg(organizationId: string): Promise<SmtpOverride | null> {
  const org = await centralPrisma.organization.findUnique({
    where: { id: organizationId },
    select: { smtpHost: true, smtpPort: true, smtpUser: true, smtpPass: true, smtpFrom: true },
  });
  if (!org?.smtpHost || !org.smtpUser || !org.smtpPass) return null;
  return {
    host: org.smtpHost,
    port: org.smtpPort ?? 587,
    user: org.smtpUser,
    pass: org.smtpPass,
    from: org.smtpFrom ?? 'PageSpeed Auditor <noreply@localhost>',
  };
}

export interface OrgEmailRef {
  hasOverride: boolean;
  // Not secret -- safe to show and edit in the browser. Only smtpPass is withheld.
  host: string | null;
  port: number | null;
  user: string | null;
  from: string | null;
}

/** For the settings form: what's configured, without ever exposing the password. */
export async function orgEmailRef(organizationId: string): Promise<OrgEmailRef> {
  const org = await centralPrisma.organization.findUnique({
    where: { id: organizationId },
    select: { smtpHost: true, smtpPort: true, smtpUser: true, smtpFrom: true },
  });
  return {
    hasOverride: Boolean(org?.smtpHost),
    host: org?.smtpHost ?? null,
    port: org?.smtpPort ?? null,
    user: org?.smtpUser ?? null,
    from: org?.smtpFrom ?? null,
  };
}

/**
 * Confirms a page belongs to the caller's organisation before anything is
 * shown or changed. Page ids appear in URLs, so this is the check that stops
 * one tenant reading another's report by pasting an id.
 */
export async function requirePageAccess(organizationId: string, pageId: string) {
  const prisma = await getTenantPrisma(organizationId);
  const page = await prisma.page.findFirst({
    where: { id: pageId, site: { organizationId } },
    select: { id: true, siteId: true, url: true, path: true },
  });
  if (!page) throw new NotFoundError('Page');
  return page;
}

/** Same, for a group slug, which is only unique within a site. */
export async function requireGroupAccess(organizationId: string, slug: string, siteId?: string) {
  const prisma = await getTenantPrisma(organizationId);
  const group = await prisma.group.findFirst({
    where: { slug, site: { organizationId, ...(siteId ? { id: siteId } : {}) } },
    select: { id: true, slug: true, name: true, siteId: true },
  });
  if (!group) throw new NotFoundError('Group');
  return group;
}

/** Same, for a run id, which appears in progress-polling URLs. */
export async function requireRunAccess(organizationId: string, runId: string) {
  const prisma = await getTenantPrisma(organizationId);
  const run = await prisma.auditRun.findFirst({
    where: { id: runId, site: { organizationId } },
    select: { id: true, siteId: true },
  });
  if (!run) throw new NotFoundError('Run');
  return run;
}
