'use client';

import { usePathname } from 'next/navigation';
import { useMemo, useState } from 'react';
import { NavLink } from '@/components/shell/NavLink';
import { useReorder } from '@/components/nav/useReorder';
import { reorderGroupsAction } from '@/app/actions/groups';
import { BAND_ARC, scoreBand } from '@/components/score/scoreBucket';

export interface RailGroup {
  slug: string;
  name: string;
  pageCount: number;
  /** Latest average performance, so the rail can be sorted by it. */
  score: number | null;
}

type Sort = 'custom' | 'worst' | 'best' | 'name' | 'pages';

const SORTS: Array<{ value: Sort; label: string }> = [
  { value: 'custom', label: 'Your order' },
  { value: 'worst', label: 'Worst first' },
  { value: 'best', label: 'Best first' },
  { value: 'pages', label: 'Most pages' },
  { value: 'name', label: 'A–Z' },
];

/**
 * The section list.
 *
 * Search and sort sit above it because 68 sections is past the point where
 * scanning works. Dragging is only offered under "Your order" -- reordering a
 * list that is sorted by score would save an order you cannot see, and the next
 * page load would appear to have thrown the change away.
 */
export function GroupRail({
  groups,
  canReorder,
  variant = 'rail',
}: {
  groups: RailGroup[];
  canReorder: boolean;
  variant?: 'rail' | 'compact';
}) {
  // Read from the URL rather than a prop: the shell lives in the layout and
  // does not re-render on navigation, which is exactly why the rail keeps its
  // scroll position and its search text. The trade is that "which section am
  // I on" has to come from the client.
  const pathname = usePathname();
  const activeSlug = pathname.startsWith('/g/') ? decodeURIComponent(pathname.slice(3)) : undefined;
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>('custom');
  const { items, dragging, over, saving, move, dragProps } = useReorder(groups, reorderGroupsAction);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = needle
      ? items.filter((g) => g.name.toLowerCase().includes(needle) || g.slug.includes(needle))
      : items;
    if (sort === 'custom') return filtered;
    const copy = [...filtered];
    // Unmeasured sections sort last under either score order -- a null is not
    // a zero, and burying them under "worst first" would be a lie.
    const byScore = (dir: 1 | -1) => (a: RailGroup, b: RailGroup) => {
      if (a.score === null && b.score === null) return a.name.localeCompare(b.name);
      if (a.score === null) return 1;
      if (b.score === null) return -1;
      return (a.score - b.score) * dir;
    };
    if (sort === 'worst') copy.sort(byScore(1));
    if (sort === 'best') copy.sort(byScore(-1));
    if (sort === 'pages') copy.sort((a, b) => b.pageCount - a.pageCount);
    if (sort === 'name') copy.sort((a, b) => a.name.localeCompare(b.name));
    return copy;
  }, [items, q, sort]);

  // Dragging is meaningless while a sort or a filter is hiding the real order.
  const draggable = canReorder && sort === 'custom' && q.trim() === '';

  return (
    <div
      className={
        variant === 'rail'
          // min-h-0 is what lets a flex child actually shrink and scroll;
          // without it the list grows and pushes the rail past the viewport.
          ? 'flex min-h-0 flex-1 flex-col'
          : 'px-3 pb-3'
      }
    >
      <div className={`mb-2 shrink-0 space-y-1.5 ${variant === 'rail' ? 'px-1' : ''}`}>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search sections"
          aria-label="Search sections"
          className="w-full rounded-[6px] border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-[12px] placeholder:text-[var(--faint)] focus:border-[var(--border-strong)] focus:outline-none"
        />
        <div className="flex items-center gap-1.5">
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            aria-label="Sort sections"
            className="min-w-0 flex-1 rounded-[6px] border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-[11px] text-[var(--muted)] focus:outline-none"
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          {saving && <span className="shrink-0 text-[10px] text-[var(--faint)]">Saving…</span>}
        </div>
      </div>

      {shown.length === 0 ? (
        <p className={`text-[11px] text-[var(--faint)] ${variant === 'rail' ? 'px-2 py-3' : 'py-2'}`}>
          Nothing matches “{q}”.
        </p>
      ) : (
        <ul
          className={
            variant === 'rail'
              ? 'thin-scroll -mr-1 min-h-0 flex-1 space-y-px overflow-y-auto pr-1'
              : 'grid grid-cols-2 gap-1 sm:grid-cols-3'
          }
        >
          {shown.map((g, i) => (
            <li
              key={g.slug}
              // Grid/flex children need this or a long section name pushes the
              // whole rail past the viewport on a narrow screen.
              {...(draggable ? dragProps(g.slug) : {})}
              className={`min-w-0 ${dragging === g.slug ? 'opacity-40' : ''}`}
              style={
                over === g.slug && dragging !== g.slug
                  ? { boxShadow: 'inset 0 2px 0 var(--info)' }
                  : undefined
              }
            >
              <div className="group/row relative flex items-center">
                <NavLink
                  href={`/g/${g.slug}`}
                  aria-current={g.slug === activeSlug ? 'page' : undefined}
                  className={`flex min-w-0 flex-1 items-center justify-between gap-2 rounded-[var(--radius)] px-2 py-[5px] text-[12px] transition-colors ${
                    g.slug === activeSlug
                      ? 'bg-[var(--surface-sunken)] font-medium text-[var(--foreground)]'
                      : 'text-[var(--muted)] hover:bg-[var(--surface-sunken)] hover:text-[var(--foreground)]'
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    {/* Always the mobile average, on every screen, including
                        while the report you are reading is set to desktop.
                        Mobile is what search ranking uses, so it is the one
                        number worth carrying in the furniture -- see
                        docs/DECISIONS.md 2.6. The title says so, because a
                        coloured dot that silently means one strategy is
                        exactly the kind of thing that reads as a bug. */}
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      title={
                        g.score === null
                          ? `${g.name}: not measured yet`
                          : `${g.name}: ${g.score} average on mobile`
                      }
                      style={{
                        background: g.score === null
                          ? 'var(--score-none)'
                          : BAND_ARC[scoreBand(g.score)!],
                      }}
                      aria-hidden="true"
                    />
                    <span className="truncate">{g.name}</span>
                  </span>
                  <span className="tnum shrink-0 text-[10px] text-[var(--faint)]">{g.pageCount}</span>
                </NavLink>

                {draggable && (
                  // Keyboard path for the same reorder. Drag-only would put the
                  // sweep order out of reach without a mouse.
                  <span className="absolute right-0 flex bg-[var(--surface-sunken)] opacity-0 focus-within:opacity-100 group-hover/row:opacity-100">
                    <button
                      type="button" onClick={() => move(g.slug, -1)} disabled={i === 0}
                      aria-label={`Move ${g.name} up`}
                      className="px-1 text-[10px] text-[var(--muted)] hover:text-[var(--foreground)] disabled:opacity-25"
                    >↑</button>
                    <button
                      type="button" onClick={() => move(g.slug, 1)} disabled={i === shown.length - 1}
                      aria-label={`Move ${g.name} down`}
                      className="px-1 text-[10px] text-[var(--muted)] hover:text-[var(--foreground)] disabled:opacity-25"
                    >↓</button>
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
