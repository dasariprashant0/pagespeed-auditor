'use client';

import { usePathname } from 'next/navigation';
import { NavLink } from './NavLink';

/**
 * A rail link that knows whether it is the current route.
 *
 * The shell lives in the layout and therefore does not re-render on
 * navigation, so "which route am I on" cannot be passed down as a prop -- it
 * has to be read on the client. That is the trade for a rail that never
 * remounts.
 */
export function RailActiveMark({ href, match, label }: { href: string; match: string; label: string }) {
  const pathname = usePathname();
  const active = pathname.startsWith(match);

  return (
    <NavLink
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`flex items-center justify-between gap-2 rounded-[var(--radius)] px-2 py-[5px] text-[12px] transition-colors ${
        active
          ? 'bg-[var(--surface-sunken)] font-medium text-[var(--foreground)]'
          : 'text-[var(--muted)] hover:bg-[var(--surface-sunken)] hover:text-[var(--foreground)]'
      }`}
    >
      {label}
    </NavLink>
  );
}
