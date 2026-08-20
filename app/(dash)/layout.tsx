import { requireSession } from '@/lib/http/auth-guard';
import { defaultSite } from '@/lib/services/tenant.service';
import { listGroupsWithAggregates } from '@/lib/services/results.service';
import { can } from '@/lib/auth/roles';
import { toRailGroups } from '@/lib/view/rail';
import { AppShell } from '@/components/shell/AppShell';

/**
 * The frame every signed-in screen shares.
 *
 * This is a LAYOUT and not a per-page component, and that distinction is the
 * whole reason navigation feels instant. A layout is preserved across
 * navigation between its children: React keeps it mounted, Next does not
 * re-render it, and its data is not re-fetched.
 *
 * Previously each page called <AppShell> itself, so every single click
 * re-ran listGroupsWithAggregates over ~1,500 results, re-serialised ~200 KB of
 * sidebar into the RSC payload, remounted the rail -- discarding its search
 * text, sort choice and scroll position -- and restarted the run poller. See
 * docs/DECISIONS.md 10.1.
 *
 * Page-specific chrome (breadcrumb, title, actions) moved into <PageHeader>,
 * which each page renders as its first block.
 *
 * Also defence in depth: proxy.ts already redirects unauthenticated requests,
 * but it is a UX layer, not the authorization boundary, so every protected
 * surface re-checks. See docs/DECISIONS.md 2.9.
 */
export default async function DashLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireSession();
  const site = await defaultSite(ctx.organizationId);

  // The one place the section list is loaded. Everything else reads it from
  // the rendered rail rather than querying again.
  const groups = site ? await listGroupsWithAggregates(site.id, { strategy: 'mobile' }) : [];

  return (
    <AppShell
      orgName={ctx.organizationName}
      siteName={site?.name}
      groups={toRailGroups(groups)}
      canReorder={can(ctx.role, 'groups:manage')}
      canRunAudits={can(ctx.role, 'audits:run')}
    >
      {children}
    </AppShell>
  );
}
