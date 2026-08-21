import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { can, ROLES, ROLE_ORDER, type Capability } from '../lib/auth/roles.ts';

describe('role capabilities', () => {
  test('a viewer can only read', () => {
    assert.ok(can('viewer', 'reports:read'));
    for (const c of ['audits:run', 'groups:manage', 'site:manage', 'members:manage'] as Capability[]) {
      assert.equal(can('viewer', c), false, `viewer must not have ${c}`);
    }
  });

  test('an editor can act but not administer', () => {
    assert.ok(can('editor', 'audits:run'));
    assert.ok(can('editor', 'groups:manage'));
    assert.equal(can('editor', 'site:manage'), false);
    assert.equal(can('editor', 'members:manage'), false);
    assert.equal(can('editor', 'developer:access'), false);
  });

  test('a developer adds machine access but not people or billing-adjacent powers', () => {
    assert.ok(can('developer', 'developer:access'));
    assert.equal(can('developer', 'members:manage'), false);
    assert.equal(can('developer', 'site:manage'), false, 'the PSI key stays admin-only');
  });

  test('only an admin manages the key, the team, the schedule and the org\'s own databases', () => {
    for (const c of ['site:manage', 'members:manage', 'automation:manage', 'org:provision'] as Capability[]) {
      assert.ok(can('admin', c));
      for (const r of ROLES.filter((x) => x !== 'admin')) {
        assert.equal(can(r, c), false, `${r} must not have ${c}`);
      }
    }
  });

  test('privilege only accumulates going up the order', () => {
    // Every capability a lower role has, the next one up must also have --
    // otherwise "promoting" someone could quietly take something away.
    const all = new Set<Capability>(ROLES.flatMap((r) => (['reports:read','audits:run','recommendations:generate','groups:manage','developer:access','site:manage','members:manage','automation:manage','org:provision'] as Capability[]).filter((c) => can(r, c))));
    for (let i = 1; i < ROLE_ORDER.length; i++) {
      for (const c of all) {
        if (can(ROLE_ORDER[i - 1], c)) {
          assert.ok(can(ROLE_ORDER[i], c), `${ROLE_ORDER[i]} lost ${c} that ${ROLE_ORDER[i - 1]} has`);
        }
      }
    }
  });
});
