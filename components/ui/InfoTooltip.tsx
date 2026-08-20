'use client';

import { useEffect, useId, useRef, useState } from 'react';

/**
 * A "?" circle next to a label that shows explanatory text on hover, focus,
 * or tap -- for the how-do-I-get-this-value kind of hint that used to sit as
 * a permanent paragraph under every field. One shared component so every
 * settings form explains its fields the same way, not a different pattern
 * per form.
 *
 * This sits inside the same <label> as the field it explains, wrapping the
 * label text the way every field here already does. A real <button> is on
 * the HTML spec's list of "labelable" elements -- with two labelable
 * descendants (this trigger AND the actual <input>), a browser's implicit
 * label association could pick THIS as the label's target control instead
 * of the field, breaking click-to-focus on the label text. A
 * `role="button"` span is not labelable, so it's never a candidate; the
 * real input stays the label's one associated control regardless.
 *
 * Hover/focus tracking lives on the WRAPPER, not the trigger alone -- some
 * hint text (the SMTP password field's) contains a real link, and the
 * popover renders a few pixels below the trigger. Closing the instant the
 * pointer leaves the trigger meant it vanished before the pointer reached
 * the popover, so that link could never actually be hovered or clicked.
 * Closing is also debounced rather than immediate, so the small physical
 * gap between trigger and popover (which briefly resolves to neither
 * element) doesn't read as "left" and unmount the popover the pointer was
 * travelling toward.
 *
 * Not a dependency: this is a handful of lines of React plus CSS
 * positioning, the same reasoning as RecommendationPanel's own markdown
 * renderer.
 */
export function InfoTooltip({ text }: { text: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function cancelClose() {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }
  function scheduleClose() {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), 200);
  }

  useEffect(() => () => cancelClose(), []);

  useEffect(() => {
    if (!open) return;
    function onDocPointer(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
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

  return (
    <span
      ref={ref}
      className="relative inline-flex"
      onMouseEnter={() => { cancelClose(); setOpen(true); }}
      onMouseLeave={scheduleClose}
      onFocus={() => { cancelClose(); setOpen(true); }}
      onBlur={(e) => {
        // Moving focus to something still inside (e.g. the link in the
        // password hint) must not close it -- only leaving the whole
        // trigger+popover group should.
        if (!ref.current?.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <span
        role="button"
        tabIndex={0}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        aria-label="More about this field"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((o) => !o); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); setOpen((o) => !o); }
        }}
        className="inline-flex aspect-square w-4 shrink-0 cursor-pointer select-none items-center justify-center rounded-full border border-[var(--border-strong)] text-[10px] font-medium leading-none text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
      >
        ?
      </span>
      {open && (
        <span
          id={id}
          role="tooltip"
          // min(): as wide as is comfortable to read on a real screen, but
          // never wider than the viewport itself -- one rule that already
          // covers phone, tablet and desktop instead of a width per breakpoint.
          className="absolute left-1/2 top-full z-30 mt-1.5 w-[min(88vw,22rem)] -translate-x-1/2 rounded-[6px] border border-[var(--border)] bg-[var(--surface)] p-3 text-[12px] font-normal normal-case tracking-normal leading-snug text-[var(--foreground)] shadow-[var(--shadow-over)]"
        >
          {text}
        </span>
      )}
    </span>
  );
}
