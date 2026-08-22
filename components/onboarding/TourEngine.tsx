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
 * Opportunistic, not a forced wizard: finds the first remaining step whose
 * target exists on the CURRENT route and renders its tooltip. Does not
 * navigate anywhere -- as the person naturally clicks around, whichever step
 * applies to what's on screen lights up.
 */
export function TourEngine() {
  const tour = useTour();
  const pathname = usePathname();
  const [active, setActive] = useState<{ step: TourStep; el: Element } | null>(null);

  useEffect(() => {
    if (!tour) return;
    const candidate = tour.remaining.find((s) => routeMatches(s.route, pathname));
    // Deferred a tick rather than called synchronously in the effect body --
    // this is a real DOM query (document.querySelector), not a mirror of
    // existing state, but the setState call itself is pushed past the
    // effect's own execution so it can never cascade into the same commit.
    if (!candidate) {
      queueMicrotask(() => setActive(null));
      return;
    }
    const el = document.querySelector(`[data-tour="${candidate.id}"]`);
    // A target that hasn't rendered yet (still streaming) simply shows
    // nothing this pass -- the next navigation or remaining-list change
    // re-runs this effect, rather than retrying aggressively or erroring.
    queueMicrotask(() => setActive(el ? { step: candidate, el } : null));
  }, [tour, pathname]);

  if (!tour || !active) return null;
  return <TourTooltip step={active.step} anchor={active.el} onNext={() => tour.dismissStep(active.step.id)} />;
}
