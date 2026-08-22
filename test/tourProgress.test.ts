import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { remainingTourSteps } from '../lib/onboarding/tourProgress.ts';
import { TOUR_STEPS } from '../lib/onboarding/tourSteps.ts';

describe('remainingTourSteps', () => {
  test('a brand-new viewer sees every viewer-visible step', () => {
    const remaining = remainingTourSteps('viewer', []);
    assert.ok(remaining.some((s) => s.id === 'overview-sections'));
    assert.ok(!remaining.some((s) => s.id === 'settings-database')); // admin-only
  });

  test('a step already in seen[] does not reappear', () => {
    const remaining = remainingTourSteps('admin', ['overview-sections']);
    assert.ok(!remaining.some((s) => s.id === 'overview-sections'));
  });

  test('promoting a viewer to admin surfaces admin-only steps without needing seen[] reset', () => {
    const seenAsViewer = TOUR_STEPS.filter((s) => s.requiredCapability === null).map((s) => s.id);
    const remaining = remainingTourSteps('admin', seenAsViewer);
    assert.ok(remaining.some((s) => s.id === 'settings-database'));
    assert.ok(!remaining.some((s) => seenAsViewer.includes(s.id)));
  });

  test('a demoted role does not re-show a step already seen under a higher role', () => {
    const remaining = remainingTourSteps('viewer', ['settings-database']);
    assert.ok(!remaining.some((s) => s.id === 'settings-database'));
  });
});
