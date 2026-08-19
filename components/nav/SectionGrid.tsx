'use client';

import Link from 'next/link';
import { useReorder } from './useReorder';
import { reorderGroupsAction, resetGroupOrderAction } from '@/app/actions/groups';
import type { GroupSummaryDTO } from '@/lib/services/types';
import { useTransition } from 'react';

/**
 * The sections, in the order they will be checked.
 *
 * One list, not two: splitting large and small sections apart meant the order
 * you could see was not the order things actually ran in, which made dragging
 * meaningless. Small sections are just smaller cards in the same sequence.
 */
export function SectionGrid({
  groups,
  canReorder,
}: {
  groups: GroupSummaryDTO[];
  canReorder: boolean;
}) {
  const { items, dragging, over, saving, error, move, dragProps } = useReorder(groups, reorderGroupsAction);
  const [resetting, startReset] = useTransition();

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="eyebrow">
          {canReorder ? 'Sections — drag to change the order they are checked in' : 'Sections'}
        </h2>
        <div className="flex items-center gap-3">
          {saving && <span className="text-[10px] text-[var(--faint)]">Saving…</span>}
          {error && <span role="alert" className="text-[10px]" style={{ color: 'var(--score-fail-text)' }}>{error}</span>}
          {canReorder && (
            <button
              type="button"
              disabled={resetting}
              onClick={() => startReset(async () => { await resetGroupOrderAction(); })}
              className="text-[10px] text-[var(--muted)] hover:underline disabled:opacity-50"
            >
              Reset to sitemap order
            </button>
          )}
        </div>
      </div>

      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((g, i) => (
          <li
            key={g.slug}
            {...(canReorder ? dragProps(g.slug) : {})}
            className={`min-w-0 transition-opacity ${dragging === g.slug ? 'opacity-40' : ''}`}
            style={
              over === g.slug && dragging !== g.slug
                ? { outline: '2px solid var(--info)', outlineOffset: 2, borderRadius: 10 }
                : undefined
            }
          >
            <SectionCard
              group={g}
              position={i + 1}
              canReorder={canReorder}
              isFirst={i === 0}
              isLast={i === items.length - 1}
              onMove={(d) => move(g.slug, d)}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function SectionCard({
  group: g,
  position,
  canReorder,
  isFirst,
  isLast,
  onMove,
}: {
  group: GroupSummaryDTO;
  position: number;
  canReorder: boolean;
  isFirst: boolean;
  isLast: boolean;
  onMove: (d: -1 | 1) => void;
}) {
  const total = Math.max(
    1,
    g.distribution.pass + g.distribution.average + g.distribution.fail + g.distribution.unaudited,
  );
  const seg = (n: number) => `${(n / total) * 100}%`;

  return (
    <div className="panel panel-interactive group relative h-full min-w-0 p-4">
      {canReorder && (
        // Keyboard equivalent for the drag. The order decides what a 34-minute
        // job measures first, so it cannot be mouse-only.
        <div className="absolute right-2 top-2 flex gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <button
            type="button" onClick={() => onMove(-1)} disabled={isFirst}
            aria-label={`Move ${g.name} earlier`}
            className="rounded px-1 text-[10px] text-[var(--muted)] hover:bg-[var(--surface-sunken)] disabled:opacity-25"
          >↑</button>
          <button
            type="button" onClick={() => onMove(1)} disabled={isLast}
            aria-label={`Move ${g.name} later`}
            className="rounded px-1 text-[10px] text-[var(--muted)] hover:bg-[var(--surface-sunken)] disabled:opacity-25"
          >↓</button>
        </div>
      )}

      <Link href={`/g/${g.slug}`} className="block">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-1.5">
              <span className="tnum text-[10px] text-[var(--faint)]">{position}</span>
              <span className="title-md truncate">{g.name}</span>
            </div>
            <div className="mt-1 text-[11px] text-[var(--muted)]">
              {g.pageCount} {g.pageCount === 1 ? 'page' : 'pages'}
              {g.auditedCount < g.pageCount && ` · ${g.auditedCount} measured`}
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div
              className="metric text-[28px]"
              style={{ color: g.aggregate.performance === null ? 'var(--faint)' : undefined }}
            >
              {g.aggregate.performance ?? '—'}
            </div>
            <div className="eyebrow mt-0.5">avg</div>
          </div>
        </div>

        <div
          className="mt-3.5 flex h-1 overflow-hidden rounded-full bg-[var(--surface-sunken)]"
          role="img"
          aria-label={`${g.distribution.pass} good, ${g.distribution.average} needs improvement, ${g.distribution.fail} poor, ${g.distribution.unaudited} not measured`}
        >
          <div style={{ width: seg(g.distribution.pass), background: 'var(--score-pass)' }} />
          <div style={{ width: seg(g.distribution.average), background: 'var(--score-average)' }} />
          <div style={{ width: seg(g.distribution.fail), background: 'var(--score-fail)' }} />
        </div>

        {g.worstPerformance !== null && (
          <div className="mt-2.5 flex items-baseline gap-1.5 text-[11px] text-[var(--muted)]">
            <span>worst</span>
            <span className="tnum font-medium" style={{ color: 'var(--score-fail-text)' }}>
              {g.worstPerformance}
            </span>
          </div>
        )}
      </Link>
    </div>
  );
}
