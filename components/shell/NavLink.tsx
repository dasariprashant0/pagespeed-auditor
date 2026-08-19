'use client';

import Link, { useLinkStatus } from 'next/link';

/**
 * A link that shows it was clicked.
 *
 * Next keeps the current page on screen while the next one's data is fetched,
 * which is the right behaviour but reads as a dead click if nothing
 * acknowledges it. `useLinkStatus` gives us the pending state of this exact
 * link, so the row you clicked is the row that responds -- not a global bar
 * that leaves you guessing which navigation it belongs to.
 */
function Pending() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span
      aria-hidden="true"
      className="h-2.5 w-2.5 shrink-0 animate-spin rounded-full border border-[var(--faint)] border-t-transparent"
    />
  );
}

export function NavLink({
  href,
  children,
  className,
  'aria-current': ariaCurrent,
  prefetch,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
  'aria-current'?: React.AriaAttributes['aria-current'];
  prefetch?: boolean;
}) {
  return (
    <Link href={href} className={className} aria-current={ariaCurrent} prefetch={prefetch}>
      {children}
      <Pending />
    </Link>
  );
}

/** The pending indicator alone, for links that lay out their own children. */
export { Pending as LinkPending };
