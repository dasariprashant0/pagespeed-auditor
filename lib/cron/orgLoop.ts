/**
 * Runs `fn` once per organisation, catching and logging any error so one
 * org's failure (a revoked credential, a Neon outage) never stops the tick
 * from reaching the rest -- see app/api/cron/schedule-tick/route.ts, the
 * only caller. Pulled out of that route as its own tiny module so the
 * isolation guarantee has a test that doesn't need a real request/response
 * cycle or the route's real service-layer imports (centralPrisma,
 * withTenantPrisma, reconcileStaleRuns, ...), none of which resolve under
 * plain `node --test` since they go through the `@/` path alias that only
 * Next's own bundler and tsc understand.
 */
export async function forEachOrgIsolated<T>(
  orgs: T[],
  fn: (org: T) => Promise<void>,
  onError: (org: T, error: unknown) => void,
): Promise<void> {
  for (const org of orgs) {
    try {
      await fn(org);
    } catch (e) {
      onError(org, e);
    }
  }
}
