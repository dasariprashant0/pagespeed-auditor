'use client';

import Link from 'next/link';
import { useState, useSyncExternalStore } from 'react';
import { ActiveRunBar } from '@/components/runs/ActiveRunBar';
import { Tooltip } from '@/components/ui/Tooltip';
import { GroupRail, type RailGroup } from './GroupRail';
import { AccountMenu } from './AccountMenu';

export type { RailGroup };

const COLLAPSE_KEY = 'rail-collapsed';

// Same shape as ThemeToggle's stored-choice reader: nothing outside this
// component's own toggleCollapsed() ever changes the value, so there is
// nothing external to subscribe to, and useSyncExternalStore (rather than an
// effect) is what keeps the server snapshot (expanded) and the first client
// render in agreement.
function subscribeCollapsed(): () => void {
  return () => {};
}

function readStoredCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * The persistent frame: a recessed left rail and a thin top bar.
 *
 * Rendered once from app/(dash)/layout.tsx and kept mounted across every
 * navigation -- see the note there. Nothing in here may depend on which route
 * is showing, because it does not re-render when the route changes. The rail
 * gets the active section from usePathname on the client instead.
 *
 * pagespeed.web.dev has neither rail nor bar, because it is a one-report tool.
 * This one is a console over ~750 pages, so moving between sections should not
 * round-trip through the home page.
 */
export function AppShell({
  orgName,
  siteName,
  groups,
  canReorder = false,
  canRunAudits = false,
  children,
}: {
  /** The tenant. Always shown, because a person can belong to several. */
  orgName: string;
  /** The site whose sections the rail lists. Null before one is added. */
  siteName?: string | null;
  groups: RailGroup[];
  canReorder?: boolean;
  /** Whether Hold/Continue/Stop show on the global run bar -- audits:run. */
  canRunAudits?: boolean;
  children: React.ReactNode;
}) {
  const stored = useSyncExternalStore(subscribeCollapsed, readStoredCollapsed, () => false);
  const [override, setOverride] = useState<boolean | null>(null);
  const collapsed = override ?? stored;

  function toggleCollapsed() {
    const next = !collapsed;
    setOverride(next);
    try {
      localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
    } catch {
      /* private browsing; the choice still holds for this session */
    }
  }

  return (
    <div className="min-h-dvh bg-[var(--background)]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-[var(--radius)] focus:bg-[var(--surface)] focus:px-3 focus:py-2 focus:shadow-[var(--shadow-over)]"
      >
        Skip to content
      </a>

      <div className="flex">
        {/* The rail itself does NOT scroll. Only the section list inside it
            does. When the whole 2,200px rail was one scroll container, wheeling
            anywhere near the left edge scrolled the rail instead of the page
            and the app felt like it would not reach the bottom. Now the brand,
            the search box and the account links are pinned, and the bounded
            list is the only thing that moves. */}
        <nav
          aria-label="Sections"
          className={`sticky top-0 hidden h-dvh shrink-0 flex-col overflow-hidden border-r border-[var(--border)] bg-[var(--chrome)] py-3.5 lg:flex ${
            collapsed ? 'w-14 items-center px-2' : 'w-[var(--rail-w)] px-3'
          }`}
        >
          <div className={`mb-4 flex shrink-0 items-center gap-1 ${collapsed ? 'flex-col' : ''}`}>
            {/* Organisation above, site below. Passing one or the other made
                the sidebar label change between screens for no reason the
                reader could see. Hidden while collapsed -- there is no room
                for two lines of text in a 56px rail. */}
            {!collapsed && (
              <Link
                href="/"
                className="block min-w-0 flex-1 rounded-[var(--radius)] px-2 py-1.5 transition-colors hover:bg-[var(--surface-sunken)]"
              >
                <div className="eyebrow mb-0.5 truncate">{orgName}</div>
                <div className="title-sm truncate">{siteName ?? 'No site yet'}</div>
              </Link>
            )}
            <Tooltip content={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
              <button
                type="button"
                onClick={toggleCollapsed}
                aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius)] text-[var(--muted)] transition-colors hover:bg-[var(--surface-sunken)] hover:text-[var(--foreground)]"
              >
                <span aria-hidden="true" className={`inline-block transition-transform ${collapsed ? 'rotate-180' : ''}`}>
                  «
                </span>
              </button>
            </Tooltip>
          </div>

          <GroupRail groups={groups} canReorder={canReorder} collapsed={collapsed} />

          <div className={`mt-3 shrink-0 border-t border-[var(--border)] pt-3 ${collapsed ? '' : 'w-full'}`}>
            <AccountMenu orgName={orgName} iconOnly={collapsed} />
          </div>
        </nav>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Below lg the rail is hidden, so the section list and the account
              controls move into a disclosure here rather than disappearing. */}
          <header className="sticky top-0 z-20 border-b border-[var(--border)] bg-[var(--background)]/85 backdrop-blur-md lg:hidden">
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5">
                <span className="min-w-0">
                  <span className="eyebrow block truncate">{orgName}</span>
                  <span className="title-sm block truncate">{siteName ?? 'No site yet'}</span>
                </span>
                <span className="shrink-0 text-[11px] text-[var(--muted)]">
                  {groups.length} sections
                  <span aria-hidden="true" className="ml-1.5 inline-block transition-transform group-open:rotate-180">▾</span>
                </span>
              </summary>
              {/* max-h + its own overflow-y-auto: this sits inside a `sticky`
                  header, which has no way to scroll ITS content once that
                  content is taller than the viewport -- a site with dozens of
                  sections otherwise renders a menu with no way to reach the
                  bottom half of it. */}
              <div className="max-h-[70dvh] overflow-y-auto border-t border-[var(--border)] bg-[var(--chrome)] px-3 py-3">
                <GroupRail groups={groups} canReorder={canReorder} variant="compact" />
                <div className="mt-3 border-t border-[var(--border)] pt-3">
                  <AccountMenu orgName={orgName} />
                </div>
              </div>
            </details>
          </header>

          <ActiveRunBar canRunAudits={canRunAudits} />

          <main id="main" className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
