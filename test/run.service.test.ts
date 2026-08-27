import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatScopeLabel,
  parseScopeLabel,
  expandScope,
  scopeLink,
  type RunScope,
} from '../lib/services/run.service.ts';

describe('formatScopeLabel / parseScopeLabel round trip', () => {
  const cases: RunScope[] = [
    { kind: 'site', ref: null, strategies: ['mobile', 'desktop'] },
    { kind: 'group', ref: 'blog', strategies: ['mobile', 'desktop'] },
    { kind: 'group', ref: 'blog', strategies: ['mobile'] },
    { kind: 'page', ref: 'page-123', strategies: ['desktop'] },
    { kind: 'pages', ref: 'page-1,page-2,page-3', strategies: ['mobile', 'desktop'] },
    { kind: 'pages', ref: 'page-1', strategies: ['desktop'] },
    { kind: 'retry', ref: 'run-abc', strategies: ['mobile', 'desktop'] },
  ];

  for (const scope of cases) {
    test(`${scope.kind}:${scope.ref ?? ''} (${scope.strategies.join('+')})`, () => {
      const label = formatScopeLabel(scope);
      const parsed = parseScopeLabel(label);
      // 'retry' isn't reconstructed by parseScopeLabel (see the "anything
      // unrecognised falls back to site" comment on parseScopeLabel) -- that
      // is pre-existing, accepted behaviour, not something this test asserts
      // against for the new 'pages' kind.
      if (scope.kind === 'retry') {
        assert.deepEqual(parsed, { kind: 'site', ref: null, strategies: scope.strategies });
      } else {
        assert.deepEqual(parsed, scope);
      }
    });
  }

  test('a page id containing a comma-free cuid round-trips through the pages encoding', () => {
    const label = formatScopeLabel({ kind: 'pages', ref: 'clabc123,cldef456', strategies: ['mobile'] });
    assert.equal(label, 'pages:clabc123,cldef456 (mobile)');
    assert.deepEqual(parseScopeLabel(label), { kind: 'pages', ref: 'clabc123,cldef456', strategies: ['mobile'] });
  });

  test('an unrecognised label falls back to the whole site', () => {
    assert.deepEqual(parseScopeLabel('nonsense'), { kind: 'site', ref: null, strategies: ['mobile', 'desktop'] });
    assert.deepEqual(parseScopeLabel(null), { kind: 'site', ref: null, strategies: ['mobile', 'desktop'] });
  });
});

describe('expandScope', () => {
  /** Records the where clause it was called with, so a test can assert on it. */
  function fakePrisma(pages: Array<{ id: string; url: string }>) {
    const calls: Array<Record<string, unknown>> = [];
    const prisma = {
      page: {
        findMany: async ({ where }: { where: Record<string, unknown> }) => {
          calls.push(where);
          return pages.map((p) => ({ ...p, sitemapIndex: null, group: null }));
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    return { prisma, calls };
  }

  test('kind "pages" queries by id-in and expands both strategies', async () => {
    const { prisma, calls } = fakePrisma([
      { id: 'p1', url: 'https://example.com/a' },
      { id: 'p2', url: 'https://example.com/b' },
    ]);

    const pairs = await expandScope(prisma, 'site1', {
      kind: 'pages',
      ref: 'p1,p2',
      strategies: ['mobile', 'desktop'],
    });

    assert.deepEqual(calls[0], { id: { in: ['p1', 'p2'] } });
    assert.equal(pairs.length, 4);
    assert.deepEqual(
      pairs.map((p) => `${p.pageId}:${p.strategy}`).sort(),
      ['p1:desktop', 'p1:mobile', 'p2:desktop', 'p2:mobile'],
    );
  });

  test('kind "pages" with an empty ref queries with an empty id list rather than throwing', async () => {
    const { prisma, calls } = fakePrisma([]);
    const pairs = await expandScope(prisma, 'site1', { kind: 'pages', ref: null, strategies: ['mobile'] });
    assert.deepEqual(calls[0], { id: { in: [] } });
    assert.equal(pairs.length, 0);
  });
});

describe('scopeLink', () => {
  test('a "pages" scope names the count and has no single natural page to link to', () => {
    const label = formatScopeLabel({ kind: 'pages', ref: 'p1,p2,p3', strategies: ['mobile', 'desktop'] });
    assert.deepEqual(scopeLink(label, 'group'), { scopeHref: null, scopeName: '3 selected pages' });
  });

  test('a single-page "pages" scope uses the singular', () => {
    const label = formatScopeLabel({ kind: 'pages', ref: 'p1', strategies: ['mobile', 'desktop'] });
    assert.deepEqual(scopeLink(label, 'group'), { scopeHref: null, scopeName: '1 selected page' });
  });
});
