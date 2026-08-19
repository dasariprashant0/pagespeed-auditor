'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { BAND_ARC, BAND_TEXT, scoreBand } from '@/components/score/scoreBucket';

/**
 * The wire shape, deliberately columnar and terse.
 *
 * Every field name is repeated once per page, and this site has ~1,500 of them
 * in both the HTML and the RSC payload. `{ performance: 84 }` spelled out 1,500
 * times is 40 KB of the word "performance" on the page that reports page
 * weight. Section names are interned for the same reason.
 */
export interface ChartData {
  /** Section names and slugs, referenced by index from each page's `g`. */
  sections: Array<[name: string, slug: string]>;
  /** [pageId, path, sectionIndex, perf, a11y, bestPractices, seo, lcpMs] */
  pages: Array<[string, string, number, number | null, number | null, number | null, number | null, number | null]>;
}

interface ChartPage {
  id: string;
  path: string;
  group: string;
  groupSlug: string;
  scores: {
    performance: number | null;
    accessibility: number | null;
    bestPractices: number | null;
    seo: number | null;
  };
  lcp: number | null;
}

type ChartKind = 'spectrum' | 'histogram' | 'sections' | 'scatter';
type MetricKey = 'performance' | 'accessibility' | 'bestPractices' | 'seo';

const CHARTS: Array<{ value: ChartKind; label: string; hint: string }> = [
  { value: 'spectrum', label: 'Every page', hint: 'One bar per page, worst on the left' },
  { value: 'histogram', label: 'Spread', hint: 'How many pages land in each ten-point band' },
  { value: 'sections', label: 'By section', hint: 'Section averages, weakest first' },
  { value: 'scatter', label: 'Load time vs score', hint: 'Where slow loading is costing the score' },
];

const METRICS: Array<{ value: MetricKey; label: string }> = [
  { value: 'performance', label: 'Performance' },
  { value: 'accessibility', label: 'Accessibility' },
  { value: 'bestPractices', label: 'Best practices' },
  { value: 'seo', label: 'SEO' },
];

const PREF_KEY = 'psa.overview.chart';

interface Prefs { kind: ChartKind; metric: MetricKey }

/** Nothing else writes the key, so there is no change to subscribe to. */
function subscribeToPrefs(): () => void {
  return () => {};
}

let cache: { raw: string | null; value: Prefs | null } = { raw: null, value: null };

/**
 * Must return a STABLE reference for an unchanged string, or React re-renders
 * forever. Hence the one-entry cache.
 */
function readPrefs(): Prefs | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(PREF_KEY);
  } catch {
    return null;
  }
  if (raw === cache.raw) return cache.value;

  let value: Prefs | null = null;
  try {
    const parsed = JSON.parse(raw ?? 'null');
    if (parsed && CHARTS.some((c) => c.value === parsed.kind) && METRICS.some((m) => m.value === parsed.metric)) {
      value = { kind: parsed.kind, metric: parsed.metric };
    }
  } catch { /* a corrupt preference is not worth surfacing */ }

  cache = { raw, value };
  return value;
}

/**
 * The overview's chart panel.
 *
 * Hand-rolled SVG rather than a charting library: this tool reports page
 * weight, so shipping ~100 KB of Recharts to draw bars would be embarrassing on
 * its own audit. Four views over the same rows, and the choice is remembered
 * per browser -- the person who cares about the spread does not want the
 * spectrum every morning.
 */
export function OverviewCharts({ data, strategy }: { data: ChartData; strategy: string }) {
  const pages = useMemo<ChartPage[]>(
    () =>
      data.pages.map(([id, path, g, performance, accessibility, bestPractices, seo, lcp]) => ({
        id,
        path,
        group: data.sections[g]?.[0] ?? '—',
        groupSlug: data.sections[g]?.[1] ?? '',
        scores: { performance, accessibility, bestPractices, seo },
        lcp,
      })),
    [data],
  );

  // localStorage read through useSyncExternalStore rather than an effect: the
  // server snapshot is null, so the first client render matches the HTML and
  // the saved choice is applied on the very next one -- no flash of the default
  // chart, and no setState during an effect.
  const saved = useSyncExternalStore(subscribeToPrefs, readPrefs, () => null);
  const [chosen, setChosen] = useState<Partial<Prefs> | null>(null);

  const kind: ChartKind = chosen?.kind ?? saved?.kind ?? 'spectrum';
  const metric: MetricKey = chosen?.metric ?? saved?.metric ?? 'performance';
  const [section, setSection] = useState<string>('');

  const choose = (next: Partial<Prefs>) => {
    const merged = { kind, metric, ...next };
    setChosen(merged);
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify(merged));
    } catch { /* private browsing; the choice still holds for this session */ }
  };

  const sections = useMemo(
    () => [...new Set(pages.map((p) => p.group))].sort((a, b) => a.localeCompare(b)),
    [pages],
  );

  const rows = useMemo(
    () => (section ? pages.filter((p) => p.group === section) : pages),
    [pages, section],
  );

  const measured = useMemo(
    () => rows.filter((p) => p.scores[metric] !== null),
    [rows, metric],
  );

  const active = CHARTS.find((c) => c.value === kind)!;

  return (
    <div className="panel overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-[var(--border)] px-3.5 py-2.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div role="tablist" aria-label="Chart" className="flex rounded-[6px] border border-[var(--border)] p-0.5">
            {CHARTS.map((c) => (
              <button
                key={c.value}
                role="tab"
                type="button"
                aria-selected={kind === c.value}
                title={c.hint}
                onClick={() => choose({ kind: c.value })}
                className={`rounded-[4px] px-2 py-1 text-[11px] transition-colors ${
                  kind === c.value
                    ? 'bg-[var(--surface-sunken)] font-medium'
                    : 'text-[var(--muted)] hover:text-[var(--foreground)]'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>

          {kind !== 'scatter' && (
            <select
              value={metric}
              onChange={(e) => choose({ metric: e.target.value as MetricKey })}
              aria-label="Score to chart"
              className="rounded-[6px] border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[11px] focus:outline-none"
            >
              {METRICS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          )}

          {sections.length > 1 && (
            <select
              value={section}
              onChange={(e) => setSection(e.target.value)}
              aria-label="Limit to one section"
              className="max-w-[11rem] rounded-[6px] border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[11px] text-[var(--muted)] focus:outline-none"
            >
              <option value="">All sections</option>
              {sections.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          )}
        </div>

        <p className="text-[11px] text-[var(--faint)]">{active.hint}</p>
      </div>

      {measured.length === 0 ? (
        <p className="px-3.5 py-8 text-center text-[12px] text-[var(--muted)]">
          Nothing measured here yet.
        </p>
      ) : kind === 'spectrum' ? (
        <Spectrum rows={measured} metric={metric} strategy={strategy} />
      ) : kind === 'histogram' ? (
        <Histogram rows={measured} metric={metric} />
      ) : kind === 'sections' ? (
        <SectionBars rows={measured} metric={metric} />
      ) : (
        <Scatter rows={rows} strategy={strategy} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function useHover() {
  const [hover, setHover] = useState<{ x: number; y: number; lines: string[] } | null>(null);
  return { hover, setHover };
}

function Tooltip({ hover, width }: { hover: { x: number; y: number; lines: string[] }; width: number }) {
  // Flip the card before it runs off the right edge rather than letting the
  // panel scroll horizontally.
  const flip = hover.x > width * 0.6;
  return (
    <div
      className="pointer-events-none absolute z-10 max-w-[16rem] rounded-[6px] border border-[var(--border-strong)] bg-[var(--surface)] px-2 py-1.5 text-[11px] shadow-[var(--lift)]"
      style={{
        left: flip ? undefined : `${(hover.x / width) * 100}%`,
        right: flip ? `${100 - (hover.x / width) * 100}%` : undefined,
        top: hover.y,
        transform: flip ? 'translate(-8px, -100%)' : 'translate(8px, -100%)',
      }}
    >
      {hover.lines.map((l, i) => (
        <div key={i} className={i === 0 ? 'truncate font-medium' : 'text-[var(--muted)]'}>{l}</div>
      ))}
    </div>
  );
}

/** Every page as one bar, worst to best. */
function Spectrum({ rows, metric, strategy }: { rows: ChartPage[]; metric: MetricKey; strategy: string }) {
  const router = useRouter();
  const { hover, setHover } = useHover();
  const sorted = useMemo(
    () => [...rows].sort((a, b) => a.scores[metric]! - b.scores[metric]!),
    [rows, metric],
  );

  const H = 150;
  const W = 1000;
  const w = W / sorted.length;
  const median = sorted[Math.floor(sorted.length / 2)].scores[metric]!;
  const medianX = (Math.floor(sorted.length / 2) / sorted.length) * W;

  const counts = { fail: 0, average: 0, pass: 0 };
  for (const p of sorted) counts[scoreBand(p.scores[metric])!]++;

  return (
    <div className="relative">
      {/* The axis is drawn, not implied. Without it the empty upper half of a
          site that scores 30-70 reads as a rendering fault rather than as the
          headroom it actually is. */}
      <div className="pointer-events-none absolute inset-0 z-[1]">
        {[100, 90, 50].map((v) => (
          <div
            key={v}
            className="absolute left-0 right-0 flex items-center"
            style={{ top: `${(1 - v / 100) * H}px` }}
          >
            {/* Labels sit at the LEFT, where the trace is always at its
                lowest — putting them on the right dropped the "50" chip on top
                of the bars, which read as a floating artefact. */}
            <span className="tnum shrink-0 pl-3 pr-1.5 text-[9.5px] text-[var(--faint)]">
              {v === 90 ? '90 good' : v}
            </span>
            <span
              className="flex-1 border-t"
              style={{
                borderColor: v === 100 ? 'var(--border)' : 'var(--border-strong)',
                borderTopStyle: v === 100 ? 'solid' : 'dashed',
                opacity: v === 100 ? 1 : 0.5,
              }}
            />
          </div>
        ))}
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="relative block w-full cursor-pointer"
        style={{ height: H }}
        role="img"
        aria-label={`${sorted.length} pages: ${counts.fail} poor, ${counts.average} needs work, ${counts.pass} good. Median ${median}.`}
        onMouseLeave={() => setHover(null)}
      >
        {sorted.map((p, i) => {
          const v = p.scores[metric]!;
          const h = Math.max(2, (v / 100) * H);
          return (
            <rect
              key={p.id}
              x={i * w}
              y={H - h}
              width={Math.max(w - 0.5, 0.6)}
              height={h}
              fill={BAND_ARC[scoreBand(v)!]}
              opacity={hover && hover.lines[0] !== p.path ? 0.4 : 0.92}
              onMouseEnter={() =>
                setHover({
                  x: i * w + w / 2,
                  y: H - h,
                  lines: [p.path, `${v} · ${p.group}`, 'Click to open the report'],
                })
              }
              onClick={() => router.push(`/p/${p.id}?strategy=${strategy}`)}
            />
          );
        })}
      </svg>

      {/* The median marker sits above the bars with a label, so it reads as an
          annotation rather than as a stray line someone forgot to remove. */}
      <div
        className="pointer-events-none absolute top-0 z-[2] flex flex-col items-center"
        style={{ left: `${(medianX / W) * 100}%`, height: H }}
      >
        <span className="h-full w-px bg-[var(--foreground)] opacity-25" />
        <span className="absolute -top-0.5 whitespace-nowrap rounded-[3px] bg-[var(--foreground)] px-1.5 py-px text-[9.5px] font-medium text-[var(--background)]">
          median {median}
        </span>
      </div>

      {hover && <Tooltip hover={hover} width={W} />}

      <Legend
        counts={counts}
        trailing={<>{sorted.length} pages measured</>}
      />
    </div>
  );
}

/** How many pages sit in each ten-point band. */
function Histogram({ rows, metric }: { rows: ChartPage[]; metric: MetricKey }) {
  const { hover, setHover } = useHover();
  const buckets = useMemo(() => {
    const b = Array.from({ length: 10 }, (_, i) => ({ from: i * 10, to: i * 10 + 9, n: 0 }));
    for (const p of rows) {
      const v = p.scores[metric]!;
      b[Math.min(9, Math.floor(v / 10))].n++;
    }
    b[9].to = 100;
    return b;
  }, [rows, metric]);

  const max = Math.max(...buckets.map((b) => b.n), 1);
  const counts = { fail: 0, average: 0, pass: 0 };
  for (const p of rows) counts[scoreBand(p.scores[metric])!]++;

  return (
    <div className="relative">
      <div className="flex h-[132px] items-end gap-1 px-3.5 pt-3" onMouseLeave={() => setHover(null)}>
        {buckets.map((b, i) => {
          const band = scoreBand(b.from === 90 ? 90 : b.from)!;
          return (
            <div key={i} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1">
              <span className="tnum text-[10px] text-[var(--muted)]">{b.n || ''}</span>
              <div
                className="w-full rounded-t-[3px] transition-opacity"
                style={{
                  height: `${(b.n / max) * 92}px`,
                  minHeight: b.n ? 2 : 0,
                  background: BAND_ARC[band],
                  opacity: hover && hover.lines[0] !== `${b.from}–${b.to}` ? 0.45 : 0.9,
                }}
                onMouseEnter={(e) =>
                  setHover({
                    x: e.currentTarget.getBoundingClientRect().left,
                    y: 100,
                    lines: [`${b.from}–${b.to}`, `${b.n} ${b.n === 1 ? 'page' : 'pages'}`],
                  })
                }
              />
              <span className="tnum text-[9px] text-[var(--faint)]">{b.from}</span>
            </div>
          );
        })}
      </div>
      <Legend counts={counts} trailing={<>{rows.length} pages</>} />
    </div>
  );
}

/** Section averages, weakest first — the triage order. */
function SectionBars({ rows, metric }: { rows: ChartPage[]; metric: MetricKey }) {
  const router = useRouter();
  const stats = useMemo(() => {
    const by = new Map<string, { slug: string; total: number; n: number; worst: number }>();
    for (const p of rows) {
      const v = p.scores[metric]!;
      const s = by.get(p.group) ?? { slug: p.groupSlug, total: 0, n: 0, worst: 100 };
      s.total += v; s.n++; s.worst = Math.min(s.worst, v);
      by.set(p.group, s);
    }
    return [...by.entries()]
      .map(([name, s]) => ({ name, slug: s.slug, avg: Math.round(s.total / s.n), n: s.n, worst: s.worst }))
      .sort((a, b) => a.avg - b.avg)
      .slice(0, 18);
  }, [rows, metric]);

  return (
    <ul className="max-h-[340px] space-y-1 overflow-y-auto px-3.5 py-3">
      {stats.map((s) => (
        <li key={s.name}>
          <button
            type="button"
            onClick={() => router.push(`/g/${s.slug}`)}
            className="flex w-full items-center gap-2.5 rounded-[5px] px-1 py-1 text-left hover:bg-[var(--surface-subtle)]"
          >
            <span className="w-[9rem] shrink-0 truncate text-[11.5px]">{s.name}</span>
            <span className="relative h-[9px] min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--surface-sunken)]">
              <span
                className="absolute inset-y-0 left-0 rounded-full"
                style={{ width: `${s.avg}%`, background: BAND_ARC[scoreBand(s.avg)!] }}
              />
              {/* The worst page in the section, marked on the same bar: an
                  average alone hides the page that is actually on fire. */}
              <span
                className="absolute inset-y-0 w-[2px] bg-[var(--foreground)] opacity-40"
                style={{ left: `${s.worst}%` }}
                title={`worst page ${s.worst}`}
              />
            </span>
            <span className="tnum w-7 shrink-0 text-right text-[12px] font-medium"
              style={{ color: BAND_TEXT[scoreBand(s.avg)!] }}>{s.avg}</span>
            <span className="tnum w-8 shrink-0 text-right text-[10px] text-[var(--faint)]">{s.n}p</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Largest Contentful Paint against the performance score. */
function Scatter({ rows, strategy }: { rows: ChartPage[]; strategy: string }) {
  const router = useRouter();
  const { hover, setHover } = useHover();
  const pts = rows.filter((p) => p.lcp !== null && p.scores.performance !== null);

  if (pts.length === 0) {
    return <p className="px-3.5 py-8 text-center text-[12px] text-[var(--muted)]">No load-time data yet.</p>;
  }

  const H = 190, W = 1000, PAD = 26;
  // Clamp the axis so one 40-second outlier does not flatten every other page
  // into the left edge.
  const maxLcp = Math.min(12000, Math.max(4000, ...pts.map((p) => p.lcp!)));

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" style={{ height: H }}
        role="img" aria-label={`Load time against performance score for ${pts.length} pages`}
        onMouseLeave={() => setHover(null)}>
        {/* 2.5 s is Google's "good" LCP threshold; 90 is a passing score. The
            quiet quadrant lines say where a page needs to get to. */}
        <line x1={(2500 / maxLcp) * (W - PAD) + PAD} x2={(2500 / maxLcp) * (W - PAD) + PAD} y1={0} y2={H - PAD}
          stroke="var(--score-pass)" strokeWidth="1" strokeDasharray="3 4" opacity="0.5" vectorEffect="non-scaling-stroke" />
        <line x1={PAD} x2={W} y1={(1 - 90 / 100) * (H - PAD)} y2={(1 - 90 / 100) * (H - PAD)}
          stroke="var(--score-pass)" strokeWidth="1" strokeDasharray="3 4" opacity="0.5" vectorEffect="non-scaling-stroke" />

        {pts.map((p) => {
          const x = PAD + (Math.min(p.lcp!, maxLcp) / maxLcp) * (W - PAD);
          const y = (1 - p.scores.performance! / 100) * (H - PAD);
          return (
            <circle
              key={p.id}
              cx={x} cy={y} r={hover?.lines[0] === p.path ? 5 : 3.2}
              fill={BAND_ARC[scoreBand(p.scores.performance)!]}
              opacity={hover && hover.lines[0] !== p.path ? 0.3 : 0.7}
              className="cursor-pointer"
              onMouseEnter={() => setHover({
                x, y,
                lines: [p.path, `score ${p.scores.performance} · LCP ${(p.lcp! / 1000).toFixed(1)} s`, p.group],
              })}
              onClick={() => router.push(`/p/${p.id}?strategy=${strategy}`)}
            />
          );
        })}

        <text x={PAD} y={H - 8} className="fill-[var(--faint)]" style={{ fontSize: 10 }}>0 s</text>
        <text x={W - 4} y={H - 8} textAnchor="end" className="fill-[var(--faint)]" style={{ fontSize: 10 }}>
          {(maxLcp / 1000).toFixed(0)} s load time
        </text>
        <text x={2} y={12} className="fill-[var(--faint)]" style={{ fontSize: 10 }}>100</text>
        <text x={2} y={H - PAD - 2} className="fill-[var(--faint)]" style={{ fontSize: 10 }}>0</text>
      </svg>

      {hover && <Tooltip hover={hover} width={W} />}

      <div className="border-t border-[var(--border)] px-3.5 py-2 text-[11px] text-[var(--muted)]">
        Pages in the top-left load fast and score well. Anything to the right of the green line takes
        longer than 2.5 seconds to show its main content.
      </div>
    </div>
  );
}

function Legend({
  counts,
  trailing,
}: {
  counts: { fail: number; average: number; pass: number };
  trailing?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-[var(--border)] px-3.5 py-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {([['fail', 'Poor'], ['average', 'Needs work'], ['pass', 'Good']] as const).map(([band, label]) => (
          <span key={band} className="flex items-center gap-1.5 text-[11px]">
            <span className="h-2 w-2 rounded-[2px]" style={{ background: BAND_ARC[band] }} aria-hidden="true" />
            <span className="tnum font-medium">{counts[band]}</span>
            <span className="text-[var(--muted)]">{label}</span>
          </span>
        ))}
      </div>
      {trailing && <span className="text-[11px] text-[var(--muted)]">{trailing}</span>}
    </div>
  );
}
