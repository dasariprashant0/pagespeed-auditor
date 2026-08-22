import type { SiteRef } from '../services/tenant.service.ts';
import type { OnboardingState } from '../services/onboarding.service.ts';
import type {
  GroupSummaryDTO,
  PageListItemDTO,
  PageReportDTO,
  SiteSummaryDTO,
  TopIssueDTO,
} from '../services/types.ts';
import type { RunEstimate } from '../services/estimate.service.ts';

/**
 * What an unprovisioned organization sees instead of a real, empty (or
 * absent) database -- realistic enough that the tour has something to
 * point at, per docs/superpowers/specs/2026-08-22-onboarding-tour-design.md
 * section D. Plain in-memory objects shaped to match what the real service
 * functions return; never persisted anywhere, never mixed with real rows.
 */

export const DEMO_SITE: SiteRef = {
  id: 'demo-site',
  name: 'sample-site.com',
  baseUrl: 'https://sample-site.com',
  sitemapUrl: 'https://sample-site.com/sitemap.xml',
  organizationId: 'demo',
  hasPsiKey: true,
};

export const DEMO_GROUPS: GroupSummaryDTO[] = [
  {
    id: 'demo-group-home',
    sitemapIndex: 0,
    priority: null,
    slug: 'home',
    name: 'Home',
    isManual: false,
    pageCount: 1,
    auditedCount: 1,
    aggregate: { performance: 78, accessibility: 94, bestPractices: 88, seo: 96 },
    worstPerformance: 78,
    worstPageId: 'demo-page-home',
    distribution: { pass: 1, average: 0, fail: 0, unaudited: 0 },
    lastAuditedAt: new Date().toISOString(),
  },
  {
    id: 'demo-group-blog',
    sitemapIndex: 1,
    priority: null,
    slug: 'blog',
    name: 'Blog',
    isManual: false,
    pageCount: 12,
    auditedCount: 12,
    aggregate: { performance: 62, accessibility: 90, bestPractices: 85, seo: 91 },
    worstPerformance: 41,
    worstPageId: 'demo-page-blog-4',
    distribution: { pass: 3, average: 6, fail: 3, unaudited: 0 },
    lastAuditedAt: new Date().toISOString(),
  },
  {
    id: 'demo-group-pricing',
    sitemapIndex: 2,
    priority: null,
    slug: 'pricing',
    name: 'Pricing',
    isManual: false,
    pageCount: 1,
    auditedCount: 1,
    aggregate: { performance: 88, accessibility: 97, bestPractices: 92, seo: 98 },
    worstPerformance: 88,
    worstPageId: 'demo-page-pricing',
    distribution: { pass: 1, average: 0, fail: 0, unaudited: 0 },
    lastAuditedAt: new Date().toISOString(),
  },
];

function demoPage(overrides: Partial<PageListItemDTO> & Pick<PageListItemDTO, 'id' | 'url' | 'path' | 'groupSlug' | 'groupName'>): PageListItemDTO {
  return {
    title: null,
    isActive: true,
    scores: { performance: 75, accessibility: 92, bestPractices: 88, seo: 94 },
    lcp: 2.2,
    inp: null,
    cls: 0.05,
    hasError: false,
    lastAuditedAt: new Date().toISOString(),
    ...overrides,
  };
}

export const DEMO_PAGES_BY_GROUP: Record<string, PageListItemDTO[]> = {
  'demo-group-home': [
    demoPage({
      id: 'demo-page-home',
      url: 'https://sample-site.com/',
      path: '/',
      groupSlug: 'home',
      groupName: 'Home',
      scores: { performance: 78, accessibility: 94, bestPractices: 88, seo: 96 },
      lcp: 2.1,
      cls: 0.04,
    }),
  ],
  'demo-group-blog': Array.from({ length: 12 }, (_, i) =>
    demoPage({
      id: `demo-page-blog-${i}`,
      url: `https://sample-site.com/blog/post-${i + 1}`,
      path: `/blog/post-${i + 1}`,
      groupSlug: 'blog',
      groupName: 'Blog',
      scores: {
        performance: 55 + (i % 4) * 8,
        accessibility: 88 + (i % 3),
        bestPractices: 82 + (i % 5),
        seo: 89 + (i % 4),
      },
      lcp: 2.4 + (i % 3) * 0.6,
      cls: 0.03 + (i % 4) * 0.01,
      hasError: i === 4,
    }),
  ),
  'demo-group-pricing': [
    demoPage({
      id: 'demo-page-pricing',
      url: 'https://sample-site.com/pricing',
      path: '/pricing',
      groupSlug: 'pricing',
      groupName: 'Pricing',
      scores: { performance: 88, accessibility: 97, bestPractices: 92, seo: 98 },
      lcp: 1.6,
      cls: 0.01,
    }),
  ],
};

export const DEMO_SITE_SUMMARY: SiteSummaryDTO = {
  id: DEMO_SITE.id,
  name: DEMO_SITE.name,
  baseUrl: DEMO_SITE.baseUrl,
  sitemapUrl: DEMO_SITE.sitemapUrl,
  pageCount: 14,
  activePageCount: 14,
  groupCount: DEMO_GROUPS.length,
  auditedCount: 14,
  lastSweepAt: new Date().toISOString(),
  siteAverage: { performance: 68, accessibility: 91, bestPractices: 87, seo: 93 },
};

export const DEMO_TOP_ISSUES: TopIssueDTO[] = [
  { auditId: 'render-blocking-resources', title: 'Eliminate render-blocking resources', kind: 'opportunity', category: 'performance', pagesAffected: 9, pagesTotal: 14, totalSavingsMs: 850 },
  { auditId: 'unused-javascript', title: 'Reduce unused JavaScript', kind: 'opportunity', category: 'performance', pagesAffected: 7, pagesTotal: 14, totalSavingsMs: 620 },
  { auditId: 'image-alt', title: 'Images do not have alt attributes', kind: 'diagnostic', category: 'accessibility', pagesAffected: 3, pagesTotal: 14, totalSavingsMs: null },
];

export const DEMO_PAGE_REPORT: PageReportDTO = {
  page: { id: 'demo-page-home', url: 'https://sample-site.com/', path: '/', title: 'Sample Site — Home', groupSlug: 'home', groupName: 'Home' },
  strategy: 'mobile',
  availability: { mobile: true, desktop: true },
  result: {
    id: 'demo-result',
    status: 'ok',
    runtimeError: null,
    fetchedAt: new Date().toISOString(),
    lighthouseVersion: '13.4.1',
    scores: { performance: 78, accessibility: 94, bestPractices: 88, seo: 96 },
    previousScores: { performance: 74, accessibility: 94, bestPractices: 88, seo: 96 },
    lab: { lcp: 2.1, inp: null, cls: 0.04, fcp: 1.2, ttfb: 0.4, tbt: 120, speedIndex: 2.4 },
    field: { source: 'none', overall: null, metrics: {} },
    opportunities: [
      {
        auditId: 'render-blocking-resources',
        title: 'Eliminate render-blocking resources',
        description: 'Resources are blocking the first paint of your page.',
        category: 'performance',
        kind: 'opportunity',
        score: 0.5,
        displayValue: 'Potential savings of 850 ms',
        savingsMs: 850,
        savingsBytes: null,
        details: null,
      },
    ],
    diagnostics: [],
    other: [],
    passed: [
      {
        auditId: 'viewport',
        title: 'Has a viewport meta tag',
        description: 'A viewport meta tag optimizes your app for mobile screens.',
        category: 'best-practices',
        kind: 'other',
        score: 1,
        displayValue: null,
        savingsMs: null,
        savingsBytes: null,
        details: null,
      },
    ],
    notApplicable: [],
    screenshot: null,
    environment: {
      lighthouseVersion: '13.4.1',
      userAgent: 'Mozilla/5.0 (Linux; Android 11; moto g power)',
      device: 'Emulated Moto G Power',
      networkThrottling: '4x CPU slowdown, slow 4G',
      cpuThrottling: '4x slowdown',
      fetchedAt: new Date().toISOString(),
    },
    markdownReport: '# Sample Site — Home\n\nThis is a sample report shown while your organisation has not connected a real database yet.',
  },
  history: {
    performance: [
      { t: new Date(Date.now() - 6 * 86400000).toISOString(), v: 74 },
      { t: new Date().toISOString(), v: 78 },
    ],
    accessibility: [{ t: new Date().toISOString(), v: 94 }],
    bestPractices: [{ t: new Date().toISOString(), v: 88 }],
    seo: [{ t: new Date().toISOString(), v: 96 }],
  },
  recommendation: null,
};

export const DEMO_RUN_ESTIMATE: RunEstimate = {
  jobs: 0,
  medianCallMs: 0,
  throughputPerSecond: 0,
  seconds: 0,
  measured: false,
  sampleSize: 0,
};

/**
 * The `site` step's href deliberately points at /settings/database, not
 * /settings/site -- connecting a database is the real first blocker for a
 * genuinely new organization, structurally: Site rows live in the tenant
 * database, so nothing else in this list is actually reachable until
 * that's done.
 */
export const DEMO_ONBOARDING_STATE: OnboardingState = {
  complete: false,
  completedCount: 0,
  siteId: null,
  steps: [
    { id: 'site', title: 'Add your website', detail: 'The address of the site and its sitemap.', done: false, href: '/settings/database', cta: 'Connect your database first' },
    { id: 'key', title: 'Connect a Google API key', detail: 'Google does the measuring. The key is free and takes a minute to create.', done: false, href: '/settings/site', cta: 'Add key' },
    { id: 'pages', title: 'Read the sitemap', detail: 'Finds every page and sorts them into sections automatically.', done: false, href: '/settings/site', cta: 'Read sitemap' },
    { id: 'firstAudit', title: 'Measure something', detail: 'Test one section to see real scores before committing to the whole site.', done: false, href: '/', cta: 'Choose a section' },
    { id: 'schedule', title: 'Set it to run on its own', detail: 'A weekly check is what turns scores into a trend.', done: false, href: '/settings', cta: 'Set a schedule' },
  ],
};
