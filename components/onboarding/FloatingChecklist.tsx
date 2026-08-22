'use client';

import { useState } from 'react';
import Link from 'next/link';
import { dismissChecklistAction, reopenChecklistAction } from '@/app/actions/onboarding';
import { useTour } from './TourProvider';
import { InfoTooltip } from '@/components/ui/InfoTooltip';
import type { OnboardingState } from '@/lib/services/onboarding.service';

/** A filled circle with a check for done, an empty ring for not -- the one "done" indicator used everywhere in the app. */
function Tick({ done }: { done: boolean }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-[8px] font-semibold leading-none"
      style={{
        background: done ? 'var(--score-pass)' : 'transparent',
        border: done ? 'none' : '1.5px solid var(--border-strong)',
        color: '#fff',
      }}
    >
      {done ? '✓' : ''}
    </span>
  );
}

/**
 * Bottom-left, persistent -- see
 * docs/superpowers/specs/2026-08-22-onboarding-tour-design.md section C.
 * The one place org setup steps render now -- they used to also get a full
 * panel on the overview page (the old `SetupChecklist` component, since
 * removed), which was pure duplication once this widget grew ticks for
 * done steps too. `lib/services/onboarding.service.ts` still derives the
 * step list; this is just the one place it's shown.
 *
 * Reads the tour's remaining steps from TourProvider directly rather than a
 * count passed down from the layout, so dismissing a step (TourEngine) is
 * reflected here immediately instead of only after the next navigation.
 *
 * There is no way to make this vanish outright while there's still setup
 * left to do or tour content unseen -- only collapse it to the small circle
 * and reopen it later. `dismissChecklistAction`/`reopenChecklistAction`
 * persist which of those two states this is in, at every breakpoint, not
 * just collapse-when-there's-nothing-left-to-show.
 */
export function FloatingChecklist({
  orgSteps,
  initiallyCollapsed,
}: {
  orgSteps: OnboardingState;
  initiallyCollapsed: boolean;
}) {
  const [collapsed, setCollapsed] = useState(initiallyCollapsed);
  const tour = useTour();
  const allTourSteps = tour?.all ?? [];
  const seenTourStepIds = tour?.seenIds ?? new Set<string>();
  if (orgSteps.complete && (tour?.remaining.length ?? 0) === 0) return null;

  // Only the tour steps with one real, linkable destination get listed here.
  // 'group-run-audit' and 'report-recommendation' target a specific section
  // or page report that doesn't exist yet from this list's point of view --
  // there's no single URL to send someone to. They still fire on their own,
  // opportunistically, via TourEngine the moment the person opens any
  // section or report page; they just don't belong in a list of things to
  // click from here. Shown for every applicable step, not just what's left,
  // so a ticked-off one stays visible as done instead of quietly vanishing.
  const listableTourSteps = allTourSteps.filter((s) => !s.route.includes('['));

  return (
    <div className="fixed bottom-4 left-4 z-40 max-w-[300px]">
      {collapsed ? (
        <button
          type="button"
          aria-label="Show onboarding checklist"
          onClick={() => {
            setCollapsed(false);
            reopenChecklistAction();
          }}
          className="onboarding-gradient-panel flex h-10 w-10 items-center justify-center rounded-full text-[16px] shadow-lg"
        >
          ✓
        </button>
      ) : (
        <div className="onboarding-gradient-panel rounded-[var(--radius-lg)] p-3.5 shadow-lg">
          <div className="flex items-center justify-between gap-2">
            <span className="eyebrow">Getting set up</span>
            <button
              type="button"
              aria-label="Collapse"
              onClick={() => {
                setCollapsed(true);
                dismissChecklistAction();
              }}
              className="text-[13px] leading-none text-[var(--muted)] hover:text-[var(--foreground)]"
            >
              ‒
            </button>
          </div>
          {orgSteps.steps.length > 0 && (
            <ol className="mt-2.5 space-y-1.5 text-[12px]">
              {orgSteps.steps.map((s) => (
                <li key={s.id} className="flex items-center gap-1.5">
                  <Tick done={s.done} />
                  {s.done ? (
                    <span className="text-[var(--muted)] line-through">{s.cta}</span>
                  ) : (
                    <Link href={s.href} className="underline decoration-[var(--border-strong)] underline-offset-2 hover:decoration-[var(--foreground)]">
                      {s.cta}
                    </Link>
                  )}
                </li>
              ))}
            </ol>
          )}
          {listableTourSteps.length > 0 && (
            <>
              <div className="my-3 h-px bg-[var(--border)]" />
              <p className="eyebrow">Tour</p>
              <ol className="mt-2 space-y-2 text-[12px]">
                {listableTourSteps.map((s) => {
                  const done = seenTourStepIds.has(s.id);
                  return (
                    <li key={s.id} className="flex items-center gap-1.5">
                      <Tick done={done} />
                      {done ? (
                        <span className="text-[var(--muted)] line-through">{s.title}</span>
                      ) : (
                        <>
                          <Link
                            href={s.route}
                            onClick={() => tour?.requestStep(s.id)}
                            className="underline decoration-[var(--border-strong)] underline-offset-2 hover:decoration-[var(--foreground)]"
                          >
                            {s.title}
                          </Link>
                          <InfoTooltip text={s.body} />
                        </>
                      )}
                    </li>
                  );
                })}
              </ol>
            </>
          )}
        </div>
      )}
    </div>
  );
}
