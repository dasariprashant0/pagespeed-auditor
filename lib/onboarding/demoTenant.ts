import { NotProvisionedError, NotFoundError } from '../errors.ts';
import { getTenantPrisma } from '../db/tenant.ts';
import {
  defaultSite,
  listSites,
  requireGroupAccess,
  requirePageAccess,
  type SiteRef,
} from '../services/tenant.service.ts';
import { onboardingState, type OnboardingState } from '../services/onboarding.service.ts';
import { listGroupsWithAggregates, listPagesInGroup, type StrategyOptions } from '../services/results.service.ts';
import { getSiteSummary } from '../services/site.service.ts';
import { getTopIssues, type TopIssueOptions } from '../services/issues.service.ts';
import { getPageReport } from '../services/report.service.ts';
import { regressionsForPage } from '../services/regression.service.ts';
import { estimateRun } from '../services/estimate.service.ts';
import { historyOverview } from '../services/retention.service.ts';
import type {
  GroupSummaryDTO,
  PageListItemDTO,
  PageReportDTO,
  PsiStrategy,
  SiteSummaryDTO,
  TopIssueDTO,
} from '../services/types.ts';
import type { Regression } from '../services/regression.service.ts';
import type { RunEstimate } from '../services/estimate.service.ts';
import {
  DEMO_GROUPS,
  DEMO_ONBOARDING_STATE,
  DEMO_PAGES_BY_GROUP,
  DEMO_PAGE_REPORT,
  DEMO_RUN_ESTIMATE,
  DEMO_SITE,
  DEMO_SITE_SUMMARY,
  DEMO_TOP_ISSUES,
} from './demoData.ts';

/**
 * What an unprovisioned organization sees instead of a redirect to
 * /settings/database -- see docs/superpowers/specs/2026-08-22-onboarding-tour-design.md
 * section D and E. Each wrapper below tries the real, per-tenant read and
 * falls back to canned demo data only on NotProvisionedError -- any other
 * error (not-found, a real DB outage) still propagates.
 */
async function demoAware<T>(real: () => Promise<T>, demo: T): Promise<T> {
  try {
    return await real();
  } catch (e) {
    if (e instanceof NotProvisionedError) return demo;
    throw e;
  }
}

export function demoAwareDefaultSite(organizationId: string): Promise<SiteRef | null> {
  return demoAware(() => defaultSite(organizationId), DEMO_SITE);
}

export function demoAwareListSites(organizationId: string): Promise<SiteRef[]> {
  return demoAware(() => listSites(organizationId), [DEMO_SITE]);
}

export function demoAwareOnboardingState(organizationId: string): Promise<OnboardingState> {
  return demoAware(() => onboardingState(organizationId), DEMO_ONBOARDING_STATE);
}

export function demoAwareListGroupsWithAggregates(
  organizationId: string,
  siteId: string,
  opts: StrategyOptions,
): Promise<GroupSummaryDTO[]> {
  return demoAware(() => listGroupsWithAggregates(organizationId, siteId, opts), DEMO_GROUPS);
}

/** Same shape requireGroupAccess returns for a real group: {id, slug, name, siteId}. */
export async function demoAwareRequireGroupAccess(
  organizationId: string,
  slug: string,
  siteId?: string,
): Promise<{ id: string; slug: string; name: string; siteId: string }> {
  try {
    return await requireGroupAccess(organizationId, slug, siteId);
  } catch (e) {
    if (!(e instanceof NotProvisionedError)) throw e;
    const demoGroup = DEMO_GROUPS.find((g) => g.slug === slug);
    if (!demoGroup) throw new NotFoundError('Group');
    return { id: demoGroup.id, slug: demoGroup.slug, name: demoGroup.name, siteId: DEMO_SITE.id };
  }
}

/** Same shape requirePageAccess returns for a real page: {id, siteId, url, path}. */
export async function demoAwareRequirePageAccess(
  organizationId: string,
  pageId: string,
): Promise<{ id: string; siteId: string; url: string; path: string }> {
  try {
    return await requirePageAccess(organizationId, pageId);
  } catch (e) {
    if (!(e instanceof NotProvisionedError)) throw e;
    const demoPage = Object.values(DEMO_PAGES_BY_GROUP)
      .flat()
      .find((p) => p.id === pageId);
    if (!demoPage) throw new NotFoundError('Page');
    return { id: demoPage.id, siteId: DEMO_SITE.id, url: demoPage.url, path: demoPage.path };
  }
}

export function demoAwareListPagesInGroup(
  organizationId: string,
  groupId: string,
  opts: StrategyOptions,
): Promise<PageListItemDTO[]> {
  return demoAware(() => listPagesInGroup(organizationId, groupId, opts), DEMO_PAGES_BY_GROUP[groupId] ?? []);
}

export function demoAwareGetPageReport(
  organizationId: string,
  pageId: string,
  strategy: PsiStrategy,
): Promise<PageReportDTO> {
  return demoAware(() => getPageReport(organizationId, pageId, strategy), DEMO_PAGE_REPORT);
}

export function demoAwareRegressionsForPage(
  organizationId: string,
  pageId: string,
  strategy: string,
): Promise<Regression[]> {
  return demoAware(() => regressionsForPage(organizationId, pageId, strategy), []);
}

export function demoAwareGetSiteSummary(
  organizationId: string,
  siteId: string,
  strategy: PsiStrategy = 'mobile',
): Promise<SiteSummaryDTO> {
  return demoAware(() => getSiteSummary(organizationId, siteId, strategy), DEMO_SITE_SUMMARY);
}

export function demoAwareGetTopIssues(organizationId: string, opts: TopIssueOptions): Promise<TopIssueDTO[]> {
  return demoAware(() => getTopIssues(organizationId, opts), DEMO_TOP_ISSUES);
}

export function demoAwareEstimateRun(organizationId: string, jobs: number, siteId?: string): Promise<RunEstimate> {
  return demoAware(() => estimateRun(organizationId, jobs, siteId), DEMO_RUN_ESTIMATE);
}

type ScheduleData = {
  cronExpr: string | null;
  timezone: string;
  enabled: boolean;
  nextRunAt: Date | null;
  lastRunAt: Date | null;
};

type RecentRun = {
  id: string;
  type: string;
  triggeredBy: string;
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
  completedJobs: number;
  totalJobs: number;
  failedJobs: number;
};

/**
 * Bundles the automation page's two raw prisma reads -- resolving its own
 * tenant client rather than taking one as a parameter, so the caller never
 * needs its own try/catch around getTenantPrisma just to reach this.
 */
export async function demoAwareScheduleAutomationData(
  organizationId: string,
  siteId: string,
): Promise<{ schedule: ScheduleData | null; recentRuns: RecentRun[] }> {
  try {
    const prisma = await getTenantPrisma(organizationId);
    const [schedule, recentRuns] = await Promise.all([
      prisma.schedule.findUnique({ where: { siteId } }),
      prisma.auditRun.findMany({
        where: { siteId },
        orderBy: { startedAt: 'desc' },
        take: 30,
        select: {
          id: true, type: true, triggeredBy: true, status: true,
          startedAt: true, finishedAt: true,
          completedJobs: true, totalJobs: true, failedJobs: true,
        },
      }),
    ]);
    return { schedule, recentRuns };
  } catch (e) {
    if (!(e instanceof NotProvisionedError)) throw e;
    return { schedule: null, recentRuns: [] };
  }
}

type NotificationSettingData = {
  emailEnabled: boolean;
  emailTo: string | null;
  slackEnabled: boolean;
  slackWebhookUrl: string | null;
};

/** Bundles the notifications page's raw prisma.notificationSetting.findUnique read. */
export async function demoAwareNotificationSetting(
  organizationId: string,
  siteId: string,
): Promise<NotificationSettingData | null> {
  try {
    const prisma = await getTenantPrisma(organizationId);
    return await prisma.notificationSetting.findUnique({ where: { siteId } });
  } catch (e) {
    if (!(e instanceof NotProvisionedError)) throw e;
    return null;
  }
}

const DEMO_HISTORY_OVERVIEW = {
  keepRuns: 10,
  totalResults: 28,
  distinctRuns: 2,
  oldest: new Date(Date.now() - 6 * 86400000),
  storageBytes: 4_200_000,
  blobBackedResults: 0,
};

/** Bundles retention.service's historyOverview, which needs a resolved tenant client. */
export async function demoAwareHistoryOverview(
  organizationId: string,
  siteId: string,
): Promise<Awaited<ReturnType<typeof historyOverview>>> {
  try {
    const prisma = await getTenantPrisma(organizationId);
    return await historyOverview(prisma, siteId);
  } catch (e) {
    if (!(e instanceof NotProvisionedError)) throw e;
    return DEMO_HISTORY_OVERVIEW;
  }
}
