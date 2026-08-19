import Link from 'next/link';
import { logoutAction } from '@/app/actions/auth';
import { ActiveRunBar } from '@/components/runs/ActiveRunBar';

export interface RailGroup {
  slug: string;
  name: string;
  pageCount: number;
}

/**
 * The persistent frame: a left rail of groups plus a thin top bar.
 *
 * pagespeed.web.dev has neither, because it is a one-report-at-a-time tool.
 * This one is a console over ~750 pages, so moving between groups should not
 * round-trip through the home page.
 */
export function AppShell({
  orgName,
  siteName,
  groups,
  activeSlug,
  breadcrumb,
  actions,
  children,
}: {
  /** The tenant. Always shown, because a person can belong to several. */
  orgName: string;
  /** The site whose sections the rail lists. Null before one is added. */
  siteName?: string | null;
  groups: RailGroup[];
  activeSlug?: string;
  breadcrumb?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[var(--background)]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded focus:bg-[var(--surface)] focus:px-3 focus:py-2"
      >
        Skip to content
      </a>

      <div className="flex">
        <nav
          aria-label="Groups"
          className="sticky top-0 hidden h-screen w-[var(--rail-w)] shrink-0 overflow-y-auto border-r border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-4 lg:block"
        >
          {/* Organisation above, site below. Passing one or the other made the
              sidebar label change between screens for no reason the reader
              could see. */}
          <Link href="/" className="mb-5 block px-2">
            <div className="eyebrow mb-0.5 truncate">{orgName}</div>
            <div className="title-md truncate">{siteName ?? 'No site yet'}</div>
          </Link>

          <div className="eyebrow mb-1.5 px-2">Sections</div>
          <ul className="space-y-px">
            {groups.map((g) => (
              <li key={g.slug}>
                <Link
                  href={`/g/${g.slug}`}
                  aria-current={g.slug === activeSlug ? 'page' : undefined}
                  className={`group flex items-center justify-between gap-2 rounded-[6px] px-2 py-[5px] text-[12px] transition-colors ${
                    g.slug === activeSlug
                      ? 'bg-[var(--surface-sunken)] font-medium text-[var(--foreground)]'
                      : 'text-[var(--muted)] hover:bg-[var(--surface-sunken)] hover:text-[var(--foreground)]'
                  }`}
                >
                  <span className="truncate">{g.name}</span>
                  <span className="tnum shrink-0 text-[10px] text-[var(--faint)]">{g.pageCount}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--background)]/85 backdrop-blur-md">
            <div className="flex min-h-12 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-2 sm:px-4">
              <div className="min-w-0 flex-1 truncate text-[12px] text-[var(--muted)]">{breadcrumb}</div>
              <div className="flex shrink-0 items-center gap-3">
                {actions}
                <Link
                  href="/settings/profile"
                  className="text-[12px] text-[var(--muted)] transition-colors hover:text-[var(--foreground)]"
                >
                  Settings
                </Link>
                <form action={logoutAction}>
                  <button
                    type="submit"
                    className="text-[12px] text-[var(--muted)] transition-colors hover:text-[var(--foreground)]"
                  >
                    Sign out
                  </button>
                </form>
              </div>
            </div>
          </header>

          <ActiveRunBar />

          {/* Below lg the rail is hidden, so the group list moves here rather
              than becoming unreachable on a phone. */}
          <details className="border-b border-[var(--border)] bg-[var(--surface-subtle)] lg:hidden">
            <summary className="cursor-pointer list-none px-3 py-2 text-[12px] text-[var(--muted)]">
              Groups ({groups.length})
            </summary>
            <ul className="grid grid-cols-2 gap-1 px-3 pb-3 sm:grid-cols-3">
              {groups.map((g) => (
                <li key={g.slug}>
                  <Link
                    href={`/g/${g.slug}`}
                    aria-current={g.slug === activeSlug ? 'page' : undefined}
                    className="flex items-center justify-between gap-2 rounded-[5px] px-2 py-1.5 text-[12px] hover:bg-[var(--surface-sunken)]"
                  >
                    <span className="truncate">{g.name}</span>
                    <span className="tnum shrink-0 text-[11px] text-[var(--muted)]">{g.pageCount}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </details>

          <main id="main" className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
