import Link from 'next/link';
import { logoutAction } from '@/app/actions/auth';
import { ActiveRunBar } from '@/components/runs/ActiveRunBar';
import { GroupRail, type RailGroup } from './GroupRail';
import { RailActiveMark } from './RailActiveMark';
import { ThemeToggle } from './ThemeToggle';

export type { RailGroup };

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
  children,
}: {
  /** The tenant. Always shown, because a person can belong to several. */
  orgName: string;
  /** The site whose sections the rail lists. Null before one is added. */
  siteName?: string | null;
  groups: RailGroup[];
  canReorder?: boolean;
  children: React.ReactNode;
}) {
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
          className="sticky top-0 hidden h-dvh w-[var(--rail-w)] shrink-0 flex-col overflow-hidden border-r border-[var(--border)] bg-[var(--chrome)] px-3 py-3.5 lg:flex"
        >
          {/* Organisation above, site below. Passing one or the other made the
              sidebar label change between screens for no reason the reader
              could see. */}
          <Link
            href="/"
            className="mb-4 block shrink-0 rounded-[var(--radius)] px-2 py-1.5 transition-colors hover:bg-[var(--surface-sunken)]"
          >
            <div className="eyebrow mb-0.5 truncate">{orgName}</div>
            <div className="title-sm truncate">{siteName ?? 'No site yet'}</div>
          </Link>

          <GroupRail groups={groups} canReorder={canReorder} />

          <div className="mt-3 shrink-0 space-y-px border-t border-[var(--border)] pt-3">
            <RailActiveMark href="/settings/profile" match="/settings" label="Settings" />
            <ThemeToggle />
            <form action={logoutAction}>
              <button
                type="submit"
                className="w-full rounded-[var(--radius)] px-2 py-[5px] text-left text-[12px] text-[var(--muted)] transition-colors hover:bg-[var(--surface-sunken)] hover:text-[var(--foreground)]"
              >
                Sign out
              </button>
            </form>
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
              <div className="border-t border-[var(--border)] bg-[var(--chrome)] px-3 py-3">
                <GroupRail groups={groups} canReorder={canReorder} variant="compact" />
                <div className="mt-3 flex items-center gap-3 border-t border-[var(--border)] pt-3 text-[12px]">
                  <Link href="/settings/profile" className="text-[var(--muted)] hover:text-[var(--foreground)]">
                    Settings
                  </Link>
                  <ThemeToggle compact />
                  <form action={logoutAction}>
                    <button type="submit" className="text-[var(--muted)] hover:text-[var(--foreground)]">
                      Sign out
                    </button>
                  </form>
                </div>
              </div>
            </details>
          </header>

          <ActiveRunBar />

          <main id="main" className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
