'use client';

import { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { markTourStepSeenAction, skipTourAction } from '@/app/actions/onboarding';
import type { TourStep } from '@/lib/onboarding/tourSteps';

interface TourContextValue {
  remaining: TourStep[];
  dismissStep: (stepId: string) => void;
  skipAll: () => void;
}

const TourContext = createContext<TourContextValue | null>(null);

export function useTour(): TourContextValue | null {
  return useContext(TourContext);
}

/** Holds the remaining-steps list client-side so dismissing a step updates the UI instantly, without waiting on the server round trip. */
export function TourProvider({ steps, children }: { steps: TourStep[]; children: React.ReactNode }) {
  const [remaining, setRemaining] = useState(steps);

  const dismissStep = useCallback((stepId: string) => {
    setRemaining((prev) => prev.filter((s) => s.id !== stepId));
    // Fire-and-forget: a failed background save just means this step can
    // show once more later, which isn't worth blocking the UI over.
    markTourStepSeenAction(stepId);
  }, []);

  const skipAll = useCallback(() => {
    setRemaining([]);
    skipTourAction();
  }, []);

  // Memoized so the context value's identity only changes when `remaining`
  // actually does -- TourEngine depends on this object in an effect, and an
  // identity that changed every render would make that dependency useless.
  const value = useMemo(() => ({ remaining, dismissStep, skipAll }), [remaining, dismissStep, skipAll]);

  return <TourContext.Provider value={value}>{children}</TourContext.Provider>;
}
