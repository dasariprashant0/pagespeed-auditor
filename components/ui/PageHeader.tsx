import Link from 'next/link';

export interface Crumb {
  label: string;
  href?: string;
}

/**
 * Every screen opens the same way: where you are, what it is, what you can do.
 *
 * This used to be the AppShell's job, which is why it had to be re-rendered on
 * every navigation. Moving it into the content means the shell can live in the
 * layout and survive route changes -- see docs/DECISIONS.md 10.1.
 */
export function PageHeader({
  crumbs,
  title,
  subtitle,
  actions,
  children,
}: {
  crumbs?: Crumb[];
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  /** Anything that belongs under the title -- score tiles, a spectrum strip. */
  children?: React.ReactNode;
}) {
  return (
    <header className="mb-6">
      {crumbs && crumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="mb-1.5">
          <ol className="flex flex-wrap items-center gap-1 text-[11px] text-[var(--muted)]">
            {crumbs.map((c, i) => (
              <li key={i} className="flex items-center gap-1">
                {i > 0 && <span aria-hidden="true" className="text-[var(--faint)]">/</span>}
                {c.href ? (
                  <Link
                    href={c.href}
                    className="rounded-[3px] transition-colors hover:text-[var(--foreground)]"
                  >
                    {c.label}
                  </Link>
                ) : (
                  <span className="text-[var(--foreground)]">{c.label}</span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      )}

      <div className="flex flex-wrap items-start justify-between gap-x-5 gap-y-2.5">
        <div className="min-w-0">
          <h1 className="title-xl">{title}</h1>
          {subtitle && <p className="mt-1.5 text-[12px] text-[var(--muted)]">{subtitle}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>

      {children}
    </header>
  );
}
