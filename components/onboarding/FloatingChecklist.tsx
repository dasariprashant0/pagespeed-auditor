'use client';

import { useState } from 'react';
import Link from 'next/link';
import { dismissChecklistAction, skipTourAction } from '@/app/actions/onboarding';
import type { OnboardingState } from '@/lib/services/onboarding.service';

/**
 * Bottom-left, persistent, dismissible -- see
 * docs/superpowers/specs/2026-08-22-onboarding-tour-design.md section C.
 * Replaces SetupChecklist's old placement as a panel on the dashboard;
 * SetupChecklist's own derivation logic (lib/services/onboarding.service.ts)
 * is reused unchanged, only re-homed here.
 */
export function FloatingChecklist({
  orgSteps,
  tourAreaCount,
  initiallyDismissed,
}: {
  orgSteps: OnboardingState;
  tourAreaCount: number;
  initiallyDismissed: boolean;
}) {
  const [dismissed, setDismissed] = useState(initiallyDismissed);
  const [collapsed, setCollapsed] = useState(false);
  if (dismissed) return null;
  if (orgSteps.complete && tourAreaCount === 0) return null;

  return (
    <div className="fixed bottom-4 left-4 z-40 max-w-[260px]">
      {collapsed ? (
        <button
          type="button"
          aria-label="Show onboarding checklist"
          onClick={() => setCollapsed(false)}
          className="panel flex h-10 w-10 items-center justify-center rounded-full text-[16px] sm:hidden"
        >
          ✓
        </button>
      ) : (
        <div className="panel p-3 shadow-lg">
          <div className="flex items-center justify-between gap-2">
            <span className="eyebrow">Getting set up</span>
            <button
              type="button"
              aria-label="Collapse"
              onClick={() => setCollapsed(true)}
              className="text-[11px] text-[var(--muted)] hover:text-[var(--foreground)] sm:hidden"
            >
              ‒
            </button>
          </div>
          <ol className="mt-2 space-y-1 text-[12px]">
            {orgSteps.steps
              .filter((s) => !s.done)
              .map((s) => (
                <li key={s.id}>
                  <Link href={s.href} className="underline decoration-[var(--border-strong)] underline-offset-2 hover:decoration-[var(--foreground)]">
                    {s.cta}
                  </Link>
                </li>
              ))}
          </ol>
          {tourAreaCount > 0 && (
            <p className="mt-2 text-[11px] text-[var(--muted)]">
              {tourAreaCount} more area{tourAreaCount === 1 ? '' : 's'} to see — keep clicking around, tooltips will point them out.
            </p>
          )}
          <div className="mt-2 flex gap-3 text-[11px]">
            <button
              type="button"
              onClick={() => {
                setDismissed(true);
                dismissChecklistAction();
              }}
              className="text-[var(--muted)] hover:text-[var(--foreground)]"
            >
              Hide
            </button>
            {tourAreaCount > 0 && (
              <button
                type="button"
                onClick={() => {
                  setDismissed(true);
                  skipTourAction();
                }}
                className="text-[var(--muted)] hover:text-[var(--foreground)]"
              >
                Skip the tour
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
