import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orgIdOf } from '../lib/mcp/orgContext.ts';

test('orgIdOf reads SDK v2 ctx.http.authInfo.extra', () => {
  assert.equal(orgIdOf({ http: { authInfo: { extra: { organizationId: 'org_1' } } } }), 'org_1');
});

test('orgIdOf still accepts the v1 ctx.authInfo shape', () => {
  assert.equal(orgIdOf({ authInfo: { organizationId: 'org_2' } }), 'org_2');
});

test('orgIdOf throws when no organisation is present', () => {
  assert.throws(() => orgIdOf({ http: { authInfo: {} } }), /not associated with an organisation/);
  assert.throws(() => orgIdOf(undefined), /not associated/);
});
