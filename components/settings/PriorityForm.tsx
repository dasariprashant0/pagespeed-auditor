'use client';

import { useState, useTransition } from 'react';
import { setGroupPriorityAction } from '@/app/actions/groups';

/**
 * Sweep order.
 *
 * A full sweep is ~35 minutes, so when someone is watching a specific fix they
 * want those pages measured first rather than whenever the sitemap reaches
 * them. Anything not pinned keeps its sitemap position, which is why this is a
 * short pinned list rather than a full drag-reorder of 68 groups.
 */
export function PriorityForm({
  groups,
  initialPinned,
}: {
  groups: Array<{ slug: string; name: string; pageCount: number }>;
  initialPinned: string[];
}) {
  const [pinned, setPinned] = useState<string[]>(initialPinned);
  const [saving, startSave] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const byS = new Map(groups.map((g) => [g.slug, g]));
  const unpinned = groups.filter((g) => !pinned.includes(g.slug));

  const move = (i: number, d: -1 | 1) => {
    const next = [...pinned];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setPinned(next);
  };

  return (
    <div className="space-y-3">
      {pinned.length === 0 ? (
        <p className="text-[12px] text-[var(--muted)]">
          Nothing pinned — sweeps follow the sitemap&rsquo;s own order.
        </p>
      ) : (
        <ol className="max-w-md space-y-1">
          {pinned.map((slug, i) => (
            <li key={slug} className="flex items-center gap-2 rounded-[5px] border border-[var(--border)] px-2 py-1.5">
              <span className="tnum w-5 text-[11px] text-[var(--muted)]">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate text-[12px]">{byS.get(slug)?.name ?? slug}</span>
              <span className="tnum text-[11px] text-[var(--muted)]">{byS.get(slug)?.pageCount ?? 0}</span>
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0}
                aria-label={`Move ${byS.get(slug)?.name ?? slug} earlier`}
                className="px-1 text-[11px] disabled:opacity-30">↑</button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === pinned.length - 1}
                aria-label={`Move ${byS.get(slug)?.name ?? slug} later`}
                className="px-1 text-[11px] disabled:opacity-30">↓</button>
              <button type="button" onClick={() => setPinned(pinned.filter((s) => s !== slug))}
                aria-label={`Unpin ${byS.get(slug)?.name ?? slug}`}
                className="px-1 text-[11px] text-[var(--muted)]">✕</button>
            </li>
          ))}
        </ol>
      )}

      <label className="block max-w-md">
        <span className="mb-1 block text-[11px] text-[var(--muted)]">Pin a group to the front</span>
        <select
          value=""
          onChange={(e) => e.target.value && setPinned([...pinned, e.target.value])}
          className="w-full rounded-[5px] border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-[12px]"
        >
          <option value="">Choose a group…</option>
          {unpinned.map((g) => (
            <option key={g.slug} value={g.slug}>{g.name} ({g.pageCount})</option>
          ))}
        </select>
      </label>

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={() => startSave(async () => {
            const r = await setGroupPriorityAction(pinned);
            setMsg(r.ok ? 'Sweep order saved.' : r.error);
          })}
          className="rounded-[5px] border border-[var(--border-strong)] px-3 py-1.5 text-[12px] font-medium hover:bg-[var(--surface-subtle)] disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save order'}
        </button>
        {pinned.length > 0 && (
          <button type="button" onClick={() => setPinned([])}
            className="text-[11px] text-[var(--muted)] hover:underline">
            Clear all
          </button>
        )}
        {msg && <span className="text-[11px] text-[var(--muted)]">{msg}</span>}
      </div>
    </div>
  );
}
