import { getTenantPrisma } from '../db/tenant.ts';
import { defaultSite } from './tenant.service.ts';

/**
 * Where a new organisation is in getting set up.
 *
 * Derived from the actual data rather than a "hasOnboarded" flag, so it stays
 * truthful: if someone deletes their site or clears their key, the checklist
 * says so instead of insisting they are finished.
 */

export type StepId = 'site' | 'key' | 'pages' | 'firstAudit' | 'schedule';

export interface OnboardingStep {
  id: StepId;
  title: string;
  /** What this step gets you, in the user's terms. */
  detail: string;
  done: boolean;
  href: string;
  cta: string;
}

export interface OnboardingState {
  complete: boolean;
  completedCount: number;
  steps: OnboardingStep[];
  siteId: string | null;
}

export async function onboardingState(organizationId: string): Promise<OnboardingState> {
  const site = await defaultSite(organizationId);
  const prisma = await getTenantPrisma(organizationId);

  const [pageCount, resultCount, schedule] = site
    ? await Promise.all([
        prisma.page.count({ where: { siteId: site.id, isActive: true } }),
        prisma.auditResult.count({ where: { page: { siteId: site.id } } }),
        prisma.schedule.findUnique({ where: { siteId: site.id }, select: { enabled: true } }),
      ])
    : [0, 0, null];

  const steps: OnboardingStep[] = [
    {
      id: 'site',
      title: 'Add your website',
      detail: 'The address of the site and its sitemap.',
      done: Boolean(site),
      href: '/settings/site',
      cta: 'Add site',
    },
    {
      id: 'key',
      title: 'Connect a Google API key',
      detail: 'Google does the measuring. The key is free and takes a minute to create.',
      done: Boolean(site?.hasPsiKey),
      href: '/settings/site',
      cta: 'Add key',
    },
    {
      id: 'pages',
      title: 'Read the sitemap',
      detail: 'Finds every page and sorts them into sections automatically.',
      done: pageCount > 0,
      href: '/settings/site',
      cta: 'Read sitemap',
    },
    {
      id: 'firstAudit',
      title: 'Measure something',
      detail: 'Test one section to see real scores before committing to the whole site.',
      done: resultCount > 0,
      href: '/',
      cta: 'Choose a section',
    },
    {
      id: 'schedule',
      title: 'Set it to run on its own',
      detail: 'A weekly check is what turns scores into a trend.',
      done: Boolean(schedule?.enabled),
      href: '/settings',
      cta: 'Set a schedule',
    },
  ];

  const completedCount = steps.filter((s) => s.done).length;
  return { complete: completedCount === steps.length, completedCount, steps, siteId: site?.id ?? null };
}
