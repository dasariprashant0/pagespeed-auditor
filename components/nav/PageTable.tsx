'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ScorePill } from '@/components/score/ScorePill';
import { Button } from '@/components/ui/Button';
import { RunAuditButton } from '@/components/runs/RunAuditButton';
import type { PsiStrategy } from '@/lib/services/types';

/**
 * The pages in a section.
 *
 * Three problems this replaces:
 *
 * 1. Every row was rendered server-side, so /g/blog shipped 4.3 MB of HTML for
 *    324 pages and took four and a half seconds to open. Rows now arrive as a
 *    compact tuple array (~40 KB for the same section) and only the visible
 *    page of them is put in the DOM.
 * 2. There was no way to sort or filter, on the one screen where you go
 *    specifically to ask "which of these 324 pages is worst".
 * 3. The path cell used `direction: rtl` to clip the head of long URLs, which
 *    reorders the slashes in a Latin string — `/blog/a-long-name/` came out
 *    with its separators in the wrong places. Paths are now split into a quiet
 *    parent and an emphasised last segment, which is the part that differs.
 */
export type PageRow = [
  id: string,
  path: string,
  url: string,
  perf: number | null,
  a11y: number | null,
  bp: number | null,
  seo: number | null,
  lcp: number | null,
  cls: number | null,
  hasError: 0 | 1,
];

type SortKey = 'order' | 'path' | 'perf' | 'a11y' | 'bp' | 'seo' | 'lcp' | 'cls';

const PER_PAGE = 50;

const COLUMNS: Array<{ key: SortKey; label: string; full: string; index: number }> = [
  { key: 'perf', label: 'Perf', full: 'Performance', index: 3 },
  { key: 'a11y', label: 'A11y', full: 'Accessibility', index: 4 },
  { key: 'bp', label: 'BP', full: 'Best practices', index: 5 },
  { key: 'seo', label: 'SEO', full: 'SEO', index: 6 },
];

function splitPath(path: string): { parent: string; leaf: string } {
  const trimmed = path.replace(/\/$/, '');
  if (trimmed === '' || trimmed === '/') return { parent: '', leaf: '/' };
  const cut = trimmed.lastIndexOf('/');
  return { parent: trimmed.slice(0, cut + 1), leaf: trimmed.slice(cut + 1) };
}

const fmtMs = (v: number | null) =>
  v === null ? '—' : v < 1000 ? `${Math.round(v)} ms` : `${(v / 1000).toFixed(1)} s`;

/**
 * Google's own Core Web Vitals thresholds, not ours to invent: LCP good under
 * 2.5s and poor over 4s; CLS good under 0.1 and poor over 0.25.
 *
 * Without this a 12-second LCP was rendered in the same grey as a 1-second one,
 * so the column you scan for disasters gave no signal at all.
 */
function cwvColor(kind: 'lcp' | 'cls', v: number | null): string | undefined {
  if (v === null) return undefined;
  const [good, poor] = kind === 'lcp' ? [2500, 4000] : [0.1, 0.25];
  if (v <= good) return 'var(--score-pass-text)';
  if (v <= poor) return 'var(--score-average-text)';
  return 'var(--score-fail-text)';
}

export function PageTable({
  rows,
  strategy,
  canSelect = false,
  demoMode = false,
}: {
  rows: PageRow[];
  strategy: PsiStrategy;
  /** Adds select-all + per-row checkboxes and a "Measure selected" button. */
  canSelect?: boolean;
  demoMode?: boolean;
}) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortKey>('order');
  const [desc, setDesc] = useState(false);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    // Substring, not exact -- and checked against the full URL too, not just
    // the path, so pasting part of a URL (with domain) still finds the row.
    const needle = q.trim().toLowerCase();
    const base = needle
      ? rows.filter((r) => r[1].toLowerCase().includes(needle) || r[2].toLowerCase().includes(needle))
      : rows;
    if (sort === 'order') return base;

    const idx = sort === 'path' ? 1 : sort === 'lcp' ? 7 : sort === 'cls' ? 8
      : COLUMNS.find((c) => c.key === sort)!.index;

    return [...base].sort((a, b) => {
      const av = a[idx], bv = b[idx];
      // Unmeasured pages sort last in either direction. A missing score is not
      // a zero, and burying them under "worst first" would be a lie.
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      const cmp = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return desc ? -cmp : cmp;
    });
  }, [rows, q, sort, desc]);

  // Selection is keyed by id, not by page, so it survives paging and search --
  // checking a page on page 1, then filtering to check five more, keeps all six.
  const filteredIds = useMemo(() => filtered.map((r) => r[0]), [filtered]);
  const allSelected = filteredIds.length > 0 && filteredIds.every((id) => selected.has(id));

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllSelected() {
    setSelected(allSelected ? new Set() : new Set(filteredIds));
  }

  const pageCount = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const current = Math.min(page, pageCount - 1);
  const visible = filtered.slice(current * PER_PAGE, current * PER_PAGE + PER_PAGE);

  const toggle = (key: SortKey) => {
    setPage(0);
    if (sort === key) {
      // order -> worst first -> best first -> back to the sitemap's order
      if (!desc) setDesc(true);
      else { setSort('order'); setDesc(false); }
    } else {
      setSort(key);
      setDesc(false);
    }
  };

  const ariaSort = (key: SortKey) =>
    sort !== key ? 'none' : desc ? 'descending' : 'ascending';

  return (
    <div className="panel-flush">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5">
        {canSelect && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px]">
            <span className="text-[var(--muted)]">{selected.size} selected</span>
            {/* Remounts on every selection change: RunAuditButton caches its
                hover-estimate preview for the lifetime of the component, and
                that cache would otherwise show a stale job count once the
                selection changes after the first hover. */}
            <RunAuditButton
              key={[...selected].join(',')}
              kind="pages"
              target={[...selected].join(',')}
              label={selected.size > 0 ? `Measure ${selected.size} selected` : 'Measure selected'}
              hint="Both mobile and desktop."
              demoMode={demoMode}
              disabled={selected.size === 0}
            />
          </div>
        )}

        {/* Pushed to the right regardless of whether the selection controls
            beside it are there -- ml-auto rather than justify-between so it
            doesn't jump to the left edge when canSelect is off. */}
        <div className="ml-auto flex items-center gap-x-4 gap-y-2">
          <input
            type="search"
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(0); }}
            placeholder="Search by path or URL"
            aria-label="Search pages by path or URL"
            className="w-full flex-1 rounded-[var(--radius)] border border-[var(--border-strong)] bg-[var(--surface)] px-2.5 py-1.5 text-[12px] transition-[border-color,box-shadow] duration-[var(--t-fast)] placeholder:text-[var(--faint)] focus:border-[var(--info)] focus:shadow-[0_0_0_3px_var(--info-tint)] focus:outline-none max-w-[28rem]"
          />
          <p className="shrink-0 text-[11px] text-[var(--muted)]" aria-live="polite">
            {filtered.length === rows.length
              ? `${rows.length} ${rows.length === 1 ? 'page' : 'pages'}`
              : `${filtered.length} of ${rows.length}`}
            {sort !== 'order' && <span className="text-[var(--faint)]"> · sorted</span>}
          </p>
        </div>
      </div>

      {/* The table keeps a real minimum width and scrolls sideways on a narrow
          screen. Letting it squeeze instead left the Page column a few
          characters wide, which is the one column you actually read. */}
      <div className="thin-scroll overflow-x-auto border-t border-[var(--border)] pr-2">
        <table className="w-full min-w-[46rem] border-collapse bg-[var(--surface)] text-[12px]">
          <caption className="sr-only">
            Pages in this section with their latest {strategy} scores. Column headings sort.
          </caption>
          <thead>
            <tr className="border-b border-[var(--border)] text-left">
              {canSelect && (
                <th scope="col" className="w-8 px-2 py-2 pl-3">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAllSelected}
                    aria-label="Select all"
                  />
                </th>
              )}
              <th scope="col" aria-sort={ariaSort('path')} className="min-w-[17rem] px-3 py-2">
                <SortButton active={sort === 'path'} desc={desc} onClick={() => toggle('path')}>
                  Page
                </SortButton>
              </th>
              {COLUMNS.map((c) => (
                <th key={c.key} scope="col" aria-sort={ariaSort(c.key)} className="w-[64px] px-2 py-2 text-right">
                  <SortButton active={sort === c.key} desc={desc} onClick={() => toggle(c.key)} title={c.full} right>
                    {c.label}
                  </SortButton>
                </th>
              ))}
              <th scope="col" aria-sort={ariaSort('lcp')} className="w-[78px] px-2 py-2 text-right">
                <SortButton active={sort === 'lcp'} desc={desc} onClick={() => toggle('lcp')} title="Largest Contentful Paint" right>
                  LCP
                </SortButton>
              </th>
              <th scope="col" aria-sort={ariaSort('cls')} className="w-[64px] px-2 py-2 text-right">
                <SortButton active={sort === 'cls'} desc={desc} onClick={() => toggle('cls')} title="Cumulative Layout Shift" right>
                  CLS
                </SortButton>
              </th>
            </tr>
          </thead>

          <tbody className="divide-y divide-[var(--border)]">
            {visible.map(([id, path, url, perf, a11y, bp, seo, lcp, cls, hasError]) => {
              const { parent, leaf } = splitPath(path);
              return (
                <tr key={id} className="group transition-colors hover:bg-[var(--surface-subtle)]">
                  {canSelect && (
                    <td className="px-2 py-2 pl-3">
                      <input
                        type="checkbox"
                        checked={selected.has(id)}
                        onChange={() => toggleSelected(id)}
                        aria-label={`Select ${path}`}
                      />
                    </td>
                  )}
                  <th scope="row" className="min-w-[17rem] max-w-[28rem] px-3 py-2 text-left font-normal">
                    <Link href={`/p/${id}?strategy=${strategy}`} className="block min-w-0" title={url}>
                      {parent && (
                        <span className="block truncate text-[10.5px] leading-tight text-[var(--faint)]">
                          {parent}
                        </span>
                      )}
                      <span className="block truncate text-[12px] leading-snug group-hover:underline">
                        {leaf}
                      </span>
                    </Link>
                    {hasError === 1 && (
                      <span className="text-[10px]" style={{ color: 'var(--score-fail-text)' }}>
                        could not be measured
                      </span>
                    )}
                  </th>
                  <td className="px-2 py-2 text-right"><ScorePill score={perf} title="Performance" /></td>
                  <td className="px-2 py-2 text-right"><ScorePill score={a11y} title="Accessibility" /></td>
                  <td className="px-2 py-2 text-right"><ScorePill score={bp} title="Best practices" /></td>
                  <td className="px-2 py-2 text-right"><ScorePill score={seo} title="SEO" /></td>
                  <td className="tnum px-2 py-2 text-right pr-5" style={{ color: cwvColor('lcp', lcp) ?? 'var(--muted)' }}>
                    {fmtMs(lcp)}
                  </td>
                  <td className="tnum px-2 py-2 text-right pr-5" style={{ color: cwvColor('cls', cls) ?? 'var(--muted)' }}>
                    {cls === null ? '—' : cls.toFixed(2)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {filtered.length === 0 && (
        <p className="px-3 py-8 text-center text-[12px] text-[var(--muted)]">
          No page here matches &ldquo;{q}&rdquo;.
        </p>
      )}

      {pageCount > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] px-3 py-2.5">
          <p className="text-[11px] text-[var(--muted)]">
            {current * PER_PAGE + 1}–{Math.min((current + 1) * PER_PAGE, filtered.length)} of{' '}
            {filtered.length}
          </p>
          <div className="flex items-center gap-1.5">
            <Button size="sm" onClick={() => setPage(current - 1)} disabled={current === 0}>
              Previous
            </Button>
            <span className="tnum px-1 text-[11px] text-[var(--muted)]">
              {current + 1} / {pageCount}
            </span>
            <Button size="sm" onClick={() => setPage(current + 1)} disabled={current >= pageCount - 1}>
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function SortButton({
  children,
  active,
  desc,
  onClick,
  title,
  right,
}: {
  children: React.ReactNode;
  active: boolean;
  desc: boolean;
  onClick: () => void;
  title?: string;
  right?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`inline-flex items-center gap-1 rounded-[3px] text-[10px] font-semibold uppercase tracking-[0.07em] transition-colors ${
        right ? 'justify-end' : ''
      } ${active ? 'text-[var(--foreground)]' : 'text-[var(--faint)] hover:text-[var(--muted)]'}`}
    >
      {children}
      {/* The caret is only rendered when the column is actually sorting, so a
          row of carets does not imply every column is active. */}
      <span aria-hidden="true" className={active ? '' : 'opacity-0'}>
        {desc ? '↓' : '↑'}
      </span>
    </button>
  );
}
