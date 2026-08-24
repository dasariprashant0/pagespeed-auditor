'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { logoutAction } from '@/app/actions/auth';
import { ThemeToggle } from './ThemeToggle';

/**
 * Settings, theme, and sign-out used to be three permanent rows at the
 * bottom of the rail -- always taking up space whether or not anyone was
 * about to use them, and each one needing its own layout in the collapsed
 * (icon-only) rail. Folded into one trigger + popover instead, the same
 * "avatar menu" pattern most dashboards use for exactly this cluster of
 * low-frequency account actions.
 *
 * Positioning is measured and clamped like InfoTooltip/Tooltip -- this
 * trigger sits at the very bottom of the rail, so the panel opens upward,
 * and needs its real height before it can decide that.
 */
export function AccountMenu({ orgName, iconOnly = false }: { orgName: string; iconOnly?: boolean }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null);

  // Closing on navigation -- otherwise clicking "Settings" leaves the panel
  // open, floating over whatever page it navigated to. Adjusted during
  // render (React's documented alternative to an effect for "reset state
  // when a prop changes") rather than in a useEffect, which would commit
  // the open panel for one extra frame before closing it.
  const [lastPathname, setLastPathname] = useState(pathname);
  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    if (open) setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    function onDocPointer(e: PointerEvent) {
      if (
        triggerRef.current && !triggerRef.current.contains(e.target as Node) &&
        panelRef.current && !panelRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', onDocPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDocPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !panelRef.current) return;
    const trigger = triggerRef.current.getBoundingClientRect();
    const margin = 8;
    const left = Math.max(margin, Math.min(trigger.left, window.innerWidth - panelRef.current.offsetWidth - margin));
    const bottom = window.innerHeight - trigger.top + 6;
    setPos({ left, bottom });
  }, [open]);

  const initial = orgName.trim().charAt(0).toUpperCase() || '?';

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Account menu"
        className={
          iconOnly
            ? 'flex h-8 w-8 items-center justify-center rounded-full border border-[var(--border)] text-[12px] font-medium text-[var(--muted)] transition-colors hover:bg-[var(--surface-sunken)] hover:text-[var(--foreground)]'
            : 'flex w-full items-center gap-2 rounded-[var(--radius)] px-2 py-[5px] text-left text-[12px] text-[var(--muted)] transition-colors hover:bg-[var(--surface-sunken)] hover:text-[var(--foreground)]'
        }
      >
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--surface-sunken)] text-[10px] font-medium">
          {initial}
        </span>
        {!iconOnly && <span className="truncate">Account</span>}
      </button>

      {open && (
        <div
          ref={panelRef}
          style={pos ? { left: pos.left, bottom: pos.bottom, visibility: 'visible' } : { left: 0, bottom: 0, visibility: 'hidden' }}
          className="fixed z-30 w-44 space-y-px rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-1.5 shadow-[var(--shadow-over)]"
        >
          <Link
            href="/settings/profile"
            className="block rounded-[var(--radius)] px-2 py-[5px] text-[12px] text-[var(--muted)] transition-colors hover:bg-[var(--surface-sunken)] hover:text-[var(--foreground)]"
          >
            Settings
          </Link>
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
      )}
    </div>
  );
}
