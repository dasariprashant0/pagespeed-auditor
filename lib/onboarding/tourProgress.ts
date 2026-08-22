import { can, type Role } from '../auth/roles.ts';
import { TOUR_STEPS, type TourStep } from './tourSteps.ts';

/**
 * Every step this role can currently reach, minus steps already seen.
 *
 * No write happens on a role change: this recomputes live, every time, so a
 * promotion surfaces the steps it newly unlocks without any reset, and a
 * demotion never re-shows something already seen just because the current
 * role can no longer reach its target.
 */
export function remainingTourSteps(role: Role, seen: string[]): TourStep[] {
  const seenSet = new Set(seen);
  return TOUR_STEPS.filter(
    (step) => (step.requiredCapability === null || can(role, step.requiredCapability)) && !seenSet.has(step.id),
  );
}

/**
 * Every step this role can currently reach, seen or not -- what the
 * checklist needs to show a tick next to what's already done instead of
 * just quietly dropping it from the list.
 */
export function applicableTourSteps(role: Role): TourStep[] {
  return TOUR_STEPS.filter((step) => step.requiredCapability === null || can(role, step.requiredCapability));
}
