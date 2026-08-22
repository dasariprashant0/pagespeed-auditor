'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

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
 *
 * The popover is positioned in JS, not pure CSS, and clamped to the
 * viewport: "centered under the trigger" is fine in the middle of a form,
 * but this trigger can also sit right against a screen edge (the
 * onboarding checklist is pinned bottom-left), where a centered popover
 * would run off the side or bottom of the screen. `position: fixed` with
 * measured, clamped coordinates works the same regardless of where in the
 * page the trigger lives -- CSS alone can't do the "flip above if there's
 * no room below" part without knowing the popover's real rendered size.
 */
export function InfoTooltip({ text }: { text: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
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

  useLayoutEffect(() => {
    // Stale pos from a previous open is harmless -- nothing reads it while
    // closed, since the popover itself isn't rendered.
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
    // Runs before paint (useLayoutEffect), then measures the popover's real
    // rendered size on this same pass -- the first commit renders it
    // invisible at its natural position so offsetWidth/offsetHeight are
    // real numbers, not a guess, before it's ever shown.
    reposition();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
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
          ref={popoverRef}
          id={id}
          role="tooltip"
          style={pos ? { left: pos.left, top: pos.top, visibility: 'visible' } : { left: 0, top: 0, visibility: 'hidden' }}
          // min(): as wide as is comfortable to read on a real screen, but
          // never wider than the viewport itself -- one rule that already
          // covers phone, tablet and desktop instead of a width per breakpoint.
          // `fixed` + JS-computed left/top (not the usual absolute +
          // left-1/2 + -translate-x-1/2) is what lets this clamp to the
          // viewport instead of running off it -- see the useLayoutEffect
          // above.
          className="fixed z-30 w-[min(88vw,22rem)] rounded-[6px] border border-[var(--border)] bg-[var(--surface)] p-3 text-[12px] font-normal normal-case tracking-normal leading-snug text-[var(--foreground)] shadow-[var(--shadow-over)]"
        >
          {text}
        </span>
      )}
    </span>
  );
}
