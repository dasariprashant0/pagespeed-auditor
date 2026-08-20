import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { redactKey } from '../lib/psi/client.ts';

/**
 * buildPsiUrl puts the API key in the query string, and a fetch-level
 * failure can embed the full request URL in Error#message. That message
 * used to only reach a server log; RunTerminal now shows it directly in
 * the browser to every role, so it has to be scrubbed before it becomes a
 * `message` field anyone downstream can display.
 */
describe('redactKey', () => {
  test('scrubs every occurrence of the key from a message', () => {
    const msg = redactKey(
      'fetch failed for https://example.com/?key=AIzaSecret123&strategy=mobile',
      'AIzaSecret123',
    );
    assert.ok(!msg.includes('AIzaSecret123'), 'the key must not survive redaction');
    assert.ok(msg.includes('[redacted]'));
  });

  test('scrubs multiple occurrences, not just the first', () => {
    assert.equal(redactKey('key key key', 'key'), '[redacted] [redacted] [redacted]');
  });

  test('a message with no key in it is untouched', () => {
    assert.equal(redactKey('HTTP 500', 'AIzaSecret123'), 'HTTP 500');
  });

  test('an empty api key is a no-op, not a crash', () => {
    assert.equal(redactKey('some message', ''), 'some message');
  });
});
