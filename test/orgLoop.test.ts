import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { forEachOrgIsolated } from '../lib/cron/orgLoop.ts';

/**
 * app/api/cron/schedule-tick/route.ts's whole reason for wrapping each
 * org's work separately: one org's tenant database being unreachable must
 * not stop the tick from reaching the rest. The route itself isn't
 * importable under plain `node --test` (its imports go through the `@/`
 * path alias that only Next's bundler and tsc resolve), so this pins down
 * the extracted loop it delegates to instead.
 */
describe('forEachOrgIsolated', () => {
  test('one org throwing does not stop the next org from being processed', async () => {
    const processed: string[] = [];
    const errors: Array<{ id: string; error: unknown }> = [];

    await forEachOrgIsolated(
      [{ id: 'org-a' }, { id: 'org-b' }, { id: 'org-c' }],
      async (org) => {
        if (org.id === 'org-b') throw new Error('Neon outage');
        processed.push(org.id);
      },
      (org, error) => {
        errors.push({ id: org.id, error });
      },
    );

    assert.deepEqual(processed, ['org-a', 'org-c']);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].id, 'org-b');
  });

  test('no orgs is a no-op', async () => {
    let calls = 0;
    await forEachOrgIsolated([], async () => { calls++; }, () => { calls++; });
    assert.equal(calls, 0);
  });
});
