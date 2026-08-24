'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * Wraps a trigger element (a button, usually) and shows floating text on
 * hover/focus without affecting layout -- unlike a native `title` attribute
 * (slow, inconsistent styling) or rendering hint text as a sibling element
 * (which reflows whatever sits next to the trigger the moment it appears).
 *
 * Positioning logic mirrors InfoTooltip's: `position: fixed` with
 * JS-measured, viewport-clamped coordinates, because CSS alone can't flip
 * above when there's no room below without knowing the popover's real
 * rendered size first.
 */
export function Tooltip({ content, children }: { content: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const popoverRef = useRef<HTMLSpanElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  function cancelClose() {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }
  function scheduleClose() {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), 100);
  }
  useEffect(() => () => cancelClose(), []);

  useLayoutEffect(() => {
    if (!open) return;
    function reposition() {
      if (!ref.current || !popoverRef.current) return;
      const trigger = ref.current.getBoundingClientRect();
      const width = popoverRef.current.offsetWidth;
      const height = popoverRef.current.offsetHeight;
      const margin = 8;
      const left = Math.max(margin, Math.min(trigger.left + trigger.width / 2 - width / 2, window.innerWidth - width - margin));
      const belowTop = trigger.bottom + 6;
      const top = belowTop + height > window.innerHeight - margin ? trigger.top - height - 6 : belowTop;
      setPos({ left, top });
    }
    reposition();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open]);

  if (!content) return <>{children}</>;

  return (
    <span
      ref={ref}
      className="relative inline-flex"
      onMouseEnter={() => { cancelClose(); setOpen(true); }}
      onMouseLeave={scheduleClose}
      onFocus={() => { cancelClose(); setOpen(true); }}
      onBlur={(e) => {
        if (!ref.current?.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      {children}
      {open && (
        <span
          ref={popoverRef}
          role="tooltip"
          style={pos ? { left: pos.left, top: pos.top, visibility: 'visible' } : { left: 0, top: 0, visibility: 'hidden' }}
          className="fixed z-30 w-max max-w-[min(88vw,22rem)] rounded-[6px] border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-[11px] font-normal leading-snug text-[var(--foreground)] shadow-[var(--shadow-over)]"
        >
          {content}
        </span>
      )}
    </span>
  );
}
