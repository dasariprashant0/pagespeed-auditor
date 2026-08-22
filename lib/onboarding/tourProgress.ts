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

/** Every step CURRENTLY applicable to this role, seen or not -- what "skip the whole tour" marks seen in one write. */
export function applicableTourStepIds(role: Role): string[] {
  return TOUR_STEPS.filter((step) => step.requiredCapability === null || can(role, step.requiredCapability)).map((s) => s.id);
}
