import Link from 'next/link';
import { logoutAction } from '@/app/actions/auth';

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
  siteName,
  groups,
  activeSlug,
  breadcrumb,
  actions,
  children,
}: {
  siteName: string;
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
          <Link href="/" className="mb-4 block px-2">
            <div className="font-[family-name:var(--font-display)] text-sm font-semibold tracking-tight">
              PageSpeed Auditor
            </div>
            <div className="text-[11px] text-[var(--muted)]">{siteName}</div>
          </Link>

          <ul className="space-y-px">
            {groups.map((g) => (
              <li key={g.slug}>
                <Link
                  href={`/g/${g.slug}`}
                  aria-current={g.slug === activeSlug ? 'page' : undefined}
                  className={`flex items-center justify-between rounded-[5px] px-2 py-1.5 text-[12px] hover:bg-[var(--surface-sunken)] ${
                    g.slug === activeSlug
                      ? 'bg-[var(--surface-sunken)] font-medium text-[var(--foreground)]'
                      : 'text-[var(--muted)]'
                  }`}
                >
                  <span className="truncate">{g.name}</span>
                  <span className="tnum ml-2 shrink-0 text-[11px] text-[var(--muted)]">{g.pageCount}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-10 flex h-12 items-center justify-between gap-4 border-b border-[var(--border)] bg-[var(--background)]/95 px-4 backdrop-blur">
            <div className="min-w-0 truncate text-[12px] text-[var(--muted)]">{breadcrumb}</div>
            <div className="flex shrink-0 items-center gap-3">
              {actions}
              <Link href="/settings" className="text-[12px] text-[var(--muted)] hover:text-[var(--foreground)]">
                Settings
              </Link>
              <form action={logoutAction}>
                <button type="submit" className="text-[12px] text-[var(--muted)] hover:text-[var(--foreground)]">
                  Sign out
                </button>
              </form>
            </div>
          </header>

          <main id="main" className="px-4 py-5">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
