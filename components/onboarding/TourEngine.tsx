'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useTour } from './TourProvider';
import { TourTooltip } from './TourTooltip';
import type { TourStep } from '@/lib/onboarding/tourSteps';

/** '/g/[slug]' matches '/g/blog', etc. -- one dynamic segment per bracket pair, same shape every route in this app already uses. */
function routeMatches(pattern: string, pathname: string): boolean {
  const patternParts = pattern.split('/');
  const pathParts = pathname.split('/');
  if (patternParts.length !== pathParts.length) return false;
  return patternParts.every((part, i) => part.startsWith('[') || part === pathParts[i]);
}

/**
 * Opportunistic by default -- finds the first remaining step whose target
 * exists on the CURRENT route and renders its tooltip, without navigating
 * anywhere, as the person naturally clicks around. A checklist link can
 * override that pick via `requestStep`: when the requested step's own route
 * matches where we just navigated to, it wins over "whichever step for this
 * route happens to be first," so clicking a specific item highlights THAT
 * one rather than a different step that happens to share its route (`/`
 * alone covers two: `overview-sections` and `overview-charts`).
 */
export function TourEngine() {
  const tour = useTour();
  const pathname = usePathname();
  const [active, setActive] = useState<{ step: TourStep; el: Element } | null>(null);

  useEffect(() => {
    if (!tour) return;
    const requested = tour.requestedStepId ? tour.remaining.find((s) => s.id === tour.requestedStepId) : undefined;
    const candidate = requested && routeMatches(requested.route, pathname) ? requested : tour.remaining.find((s) => routeMatches(s.route, pathname));

    if (!candidate) {
      queueMicrotask(() => setActive(null));
      return;
    }

    // A target that hasn't rendered yet (still streaming in after a client
    // navigation) doesn't mean "give up" the way it used to when this only
    // ran opportunistically -- a checklist click just sent the person here
    // ON PURPOSE, so it's worth a few retries across the next ~600ms before
    // accepting there's genuinely nothing to anchor to yet.
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout>;
    function tryFind() {
      const el = document.querySelector(`[data-tour="${candidate!.id}"]`);
      if (el) {
        setActive({ step: candidate!, el });
        if (tour!.requestedStepId === candidate!.id) tour!.clearRequestedStep();
        return;
      }
      attempts++;
      if (attempts < 8) {
        timer = setTimeout(tryFind, 80);
      } else {
        setActive(null);
        if (tour!.requestedStepId === candidate!.id) tour!.clearRequestedStep();
      }
    }
    // Deferred a tick rather than called synchronously in the effect body --
    // this is a real DOM query (document.querySelector), not a mirror of
    // existing state.
    queueMicrotask(tryFind);
    return () => clearTimeout(timer);
  }, [tour, pathname]);

  if (!tour || !active) return null;
  return <TourTooltip step={active.step} anchor={active.el} onNext={() => tour.dismissStep(active.step.id)} />;
}
