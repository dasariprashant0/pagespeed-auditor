'use client';

import { useEffect, useState } from 'react';
import type { TourStep } from '@/lib/onboarding/tourSteps';

/**
 * A positioned popover anchored under the target element, with the target
 * itself scrolled into view and ringed -- landing on a route doesn't mean
 * the anchor is actually on screen (a section grid, say, can be well below
 * the fold), so just drawing a tooltip near its last-known position isn't
 * enough to make clear what it's pointing at.
 *
 * "Got it" is both Next and Skip-this-one -- dismissing one tooltip always
 * means the same thing (mark this step seen, move to whatever's next); a
 * distinct "skip the WHOLE tour" affordance lives on the floating
 * checklist, not here.
 *
 * `rect` is state, not a plain render-time `getBoundingClientRect()` call,
 * because `position: fixed` coordinates need to keep tracking the anchor
 * for as long as `scrollIntoView`'s smooth animation is still moving it --
 * computing it once at mount would draw the tooltip at where the anchor
 * WAS, not where it ends up.
 */
export function TourTooltip({ step, anchor, onNext }: { step: TourStep; anchor: Element; onNext: () => void }) {
  const [rect, setRect] = useState(() => anchor.getBoundingClientRect());

  useEffect(() => {
    anchor.scrollIntoView({ behavior: 'smooth', block: 'center' });
    let frame: number;
    let stillFrames = 0;
    let last = anchor.getBoundingClientRect();
    function track() {
      const next = anchor.getBoundingClientRect();
      stillFrames = Math.abs(next.top - last.top) < 0.5 && Math.abs(next.left - last.left) < 0.5 ? stillFrames + 1 : 0;
      last = next;
      setRect(next);
      // Stops once the position holds steady for a few frames in a row,
      // rather than a fixed guessed duration -- smooth-scroll timing isn't
      // the same for a target 50px away as one 3000px away.
      if (stillFrames < 6) frame = requestAnimationFrame(track);
    }
    frame = requestAnimationFrame(track);
    return () => cancelAnimationFrame(frame);
  }, [anchor]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onNext();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onNext]);

  // `fixed` coordinates are already viewport-relative -- no window.scrollY/X
  // term here, unlike an `absolute`-positioned element would need.
  const pos = { top: rect.bottom + 8, left: rect.left };

  return (
    <>
      <div
        aria-hidden="true"
        className="pointer-events-none fixed z-40 rounded-[8px] ring-2 ring-[var(--info)] ring-offset-2 ring-offset-[var(--background)]"
        style={{ top: rect.top - 4, left: rect.left - 4, width: rect.width + 8, height: rect.height + 8 }}
      />
      <div
        role="dialog"
        aria-live="polite"
        aria-label={step.title}
        className="panel fixed z-50 w-72 p-3 shadow-lg"
        style={{ top: pos.top, left: pos.left }}
      >
        <h3 className="title-sm">{step.title}</h3>
        <p className="mt-1 text-[12px] text-[var(--muted)]">{step.body}</p>
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={onNext}
            className="rounded-[6px] border border-[var(--border-strong)] px-3 py-1.5 text-[12px] font-medium hover:bg-[var(--surface-subtle)]"
          >
            Got it
          </button>
        </div>
      </div>
    </>
  );
}
