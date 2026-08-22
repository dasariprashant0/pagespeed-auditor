'use client';

import { useEffect } from 'react';
import type { TourStep } from '@/lib/onboarding/tourSteps';

/**
 * A positioned popover anchored under the target element. "Got it" is both
 * Next and Skip-this-one -- dismissing one tooltip always means the same
 * thing (mark this step seen, move to whatever's next); a distinct "skip
 * the WHOLE tour" affordance lives on the floating checklist, not here.
 *
 * Position is computed directly during render, not via an effect+state --
 * `anchor` is a real, already-mounted DOM node by the time this ever
 * renders (TourEngine only creates one after a successful querySelector),
 * so there is no SSR/pre-mount case to guard against, and no need to
 * mirror a DOM measurement into extra state just to redraw it once.
 */
export function TourTooltip({ step, anchor, onNext }: { step: TourStep; anchor: Element; onNext: () => void }) {
  const rect = anchor.getBoundingClientRect();
  const pos = { top: rect.bottom + window.scrollY + 8, left: rect.left + window.scrollX };

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onNext();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onNext]);

  return (
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
  );
}
