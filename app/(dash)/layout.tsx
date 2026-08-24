import { requireSession } from '@/lib/http/auth-guard';
import { can } from '@/lib/auth/roles';
import { toRailGroups } from '@/lib/view/rail';
import { AppShell } from '@/components/shell/AppShell';
import { demoAwareDefaultSite, demoAwareListGroupsWithAggregates } from '@/lib/onboarding/demoTenant';
// Onboarding tour guide, engine, and floating checklist are disabled for now --
// not working properly. See app/(dash)/layout.tsx history for the wiring if
// re-enabling.
// import { type OnboardingState } from '@/lib/services/onboarding.service';
// import { centralPrisma } from '@/lib/db/central';
// import { applicableTourSteps } from '@/lib/onboarding/tourProgress';
// import { demoAwareOnboardingState } from '@/lib/onboarding/demoTenant';
// import { TourProvider } from '@/components/onboarding/TourProvider';
// import { TourEngine } from '@/components/onboarding/TourEngine';
// import { FloatingChecklist } from '@/components/onboarding/FloatingChecklist';

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

  // An org that hasn't finished provisioning its own database yet sees
  // realistic canned data instead -- see
  // docs/superpowers/specs/2026-08-22-onboarding-tour-design.md section D.
  // This layout wraps every (dash) page -- including /settings/database,
  // the only page that can fix that -- so it must never redirect (a
  // redirect from here would loop) or crash.
  const site = await demoAwareDefaultSite(ctx.organizationId);
  // The one place the section list is loaded. Everything else reads it from
  // the rendered rail rather than querying again.
  const groups = site ? await demoAwareListGroupsWithAggregates(ctx.organizationId, site.id, { strategy: 'mobile' }) : [];

  // Onboarding tour guide, engine, and floating checklist are disabled for
  // now -- not working properly.
  // const setup: OnboardingState = await demoAwareOnboardingState(ctx.organizationId);
  // const membership = await centralPrisma.membership.findUnique({
  //   where: { userId_organizationId: { userId: ctx.userId, organizationId: ctx.organizationId } },
  //   select: { tourStepsSeen: true, checklistDismissedAt: true },
  // });
  // const allTourSteps = applicableTourSteps(ctx.role);

  return (
    // <TourProvider steps={allTourSteps} seenIds={membership?.tourStepsSeen ?? []}>
    <AppShell
      orgName={ctx.organizationName}
      siteName={site?.name}
      groups={toRailGroups(groups)}
      canReorder={can(ctx.role, 'groups:manage')}
      canRunAudits={can(ctx.role, 'audits:run')}
    >
      {children}
    </AppShell>
    // <TourEngine />
    // <FloatingChecklist orgSteps={setup} initiallyCollapsed={membership?.checklistDismissedAt != null} />
    // </TourProvider>
  );
}
