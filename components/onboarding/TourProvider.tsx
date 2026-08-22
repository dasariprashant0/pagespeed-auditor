'use client';

import { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { markTourStepSeenAction } from '@/app/actions/onboarding';
import type { TourStep } from '@/lib/onboarding/tourSteps';

interface TourContextValue {
  /** Every step this role can reach, seen or not -- for rendering a tick next to what's done. */
  all: TourStep[];
  seenIds: Set<string>;
  remaining: TourStep[];
  dismissStep: (stepId: string) => void;
  /** Which step was explicitly asked for (a checklist link click), if any -- TourEngine prefers this over its normal first-match-on-route pick, so clicking a specific item scrolls to and highlights THAT one, not whichever tour step for the same route happens to be earliest in the list. */
  requestedStepId: string | null;
  requestStep: (stepId: string) => void;
  clearRequestedStep: () => void;
}

const TourContext = createContext<TourContextValue | null>(null);

export function useTour(): TourContextValue | null {
  return useContext(TourContext);
}

/**
 * Holds seen-step ids client-side so dismissing a step (ticking it off, or
 * TourEngine advancing past it) updates the UI instantly, without waiting on
 * the server round trip. `steps` is every step this role can reach
 * (`applicableTourSteps`), not pre-filtered to what's remaining -- the
 * checklist needs the full set to show completed items with a tick rather
 * than just dropping them.
 */
export function TourProvider({ steps, seenIds: initialSeenIds, children }: { steps: TourStep[]; seenIds: string[]; children: React.ReactNode }) {
  const [seenIds, setSeenIds] = useState(() => new Set(initialSeenIds));
  const [requestedStepId, setRequestedStepId] = useState<string | null>(null);

  const remaining = useMemo(() => steps.filter((s) => !seenIds.has(s.id)), [steps, seenIds]);

  const dismissStep = useCallback((stepId: string) => {
    setSeenIds((prev) => (prev.has(stepId) ? prev : new Set(prev).add(stepId)));
    // Fire-and-forget: a failed background save just means this step can
    // show once more later, which isn't worth blocking the UI over.
    markTourStepSeenAction(stepId);
  }, []);

  const requestStep = useCallback((stepId: string) => setRequestedStepId(stepId), []);
  const clearRequestedStep = useCallback(() => setRequestedStepId(null), []);

  // Memoized so the context value's identity only changes when something in
  // it actually does -- TourEngine depends on `remaining` in an effect, and
  // an identity that changed every render would make that dependency useless.
  const value = useMemo(
    () => ({ all: steps, seenIds, remaining, dismissStep, requestedStepId, requestStep, clearRequestedStep }),
    [steps, seenIds, remaining, dismissStep, requestedStepId, requestStep, clearRequestedStep],
  );

  return <TourContext.Provider value={value}>{children}</TourContext.Provider>;
}
