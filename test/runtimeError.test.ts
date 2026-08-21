import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { explainRuntimeError, isPageContentFailure, EXPLAIN_RUNTIME_ERROR } from '../lib/report/runtimeError.ts';

describe('explainRuntimeError', () => {
  test('translates a known Lighthouse code', () => {
    assert.equal(explainRuntimeError('NO_FCP'), EXPLAIN_RUNTIME_ERROR.NO_FCP);
  });

  test('falls back to a generic message for an unrecognized SCREAMING_CASE code', () => {
    assert.match(explainRuntimeError('SOME_NEW_LH_CODE'), /Lighthouse reported "SOME_NEW_LH_CODE"/);
  });

  test('returns a free-form message verbatim, without the "Lighthouse reported" wrapper', () => {
    // A PermanentError's own .message (e.g. a missing API key or a
    // misconfigured D1) is stored directly here, not as a code -- wrapping
    // it as "Lighthouse reported ..." would misattribute an operational
    // problem to Lighthouse.
    const message = 'No Google API key is configured for this site. An admin can add one under Settings → Site.';
    assert.equal(explainRuntimeError(message), message);
  });

  test('null/undefined get a plain fallback', () => {
    assert.equal(explainRuntimeError(null), 'Lighthouse did not say why.');
    assert.equal(explainRuntimeError(undefined), 'Lighthouse did not say why.');
  });
});

describe('isPageContentFailure', () => {
  test('true for known Lighthouse content-failure codes', () => {
    for (const code of Object.keys(EXPLAIN_RUNTIME_ERROR)) {
      assert.equal(isPageContentFailure(code), true, code);
    }
  });

  test('false for a free-form operational message', () => {
    assert.equal(isPageContentFailure('Cloudflare D1 is not configured (CLOUDFLARE_ACCOUNT_ID / ...).'), false);
  });

  test('false for null/undefined/unrecognized', () => {
    assert.equal(isPageContentFailure(null), false);
    assert.equal(isPageContentFailure(undefined), false);
    assert.equal(isPageContentFailure('SOME_NEW_LH_CODE'), false);
  });
});
