import Link from 'next/link';
import type { PageListItemDTO, PsiStrategy } from '@/lib/services/types';
import { ScorePill } from '@/components/score/ScorePill';

/**
 * A real <table>, server-rendered in full even at 300+ rows.
 *
 * No virtualization and no pagination on purpose: the whole list is ~250 KB of
 * HTML, it streams fine, and it keeps Cmd-F working across every URL -- which
 * is how people actually find a page they half-remember.
 */
export function PageTable({ pages, strategy }: { pages: PageListItemDTO[]; strategy: PsiStrategy }) {
  const fmtMs = (v: number | null) => (v === null ? '—' : v < 1000 ? `${Math.round(v)}ms` : `${(v / 1000).toFixed(1)}s`);

  return (
    <div className="overflow-x-auto rounded-[8px] border border-[var(--border)]">
      <table className="w-full table-fixed border-collapse bg-[var(--surface)] text-[12px]">
        <caption className="sr-only">
          Pages in this group with their latest {strategy} scores
        </caption>
        <thead>
          <tr className="border-b border-[var(--border)] text-left text-[11px] uppercase tracking-wide text-[var(--muted)]">
            <th scope="col" className="w-auto px-3 py-2 font-medium">Page</th>
            <th scope="col" className="w-[62px] px-2 py-2 text-right font-medium">Perf</th>
            <th scope="col" className="w-[62px] px-2 py-2 text-right font-medium">A11y</th>
            <th scope="col" className="w-[62px] px-2 py-2 text-right font-medium">BP</th>
            <th scope="col" className="w-[62px] px-2 py-2 text-right font-medium">SEO</th>
            <th scope="col" className="w-[72px] px-2 py-2 text-right font-medium">LCP</th>
            <th scope="col" className="w-[62px] px-2 py-2 text-right font-medium">CLS</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]">
          {pages.map((p) => (
            <tr key={p.id} className="hover:bg-[var(--surface-subtle)]">
              <th scope="row" className="max-w-0 px-3 py-1.5 text-left font-normal">
                <Link
                  href={`/p/${p.id}?strategy=${strategy}`}
                  className="block hover:underline"
                  title={p.url}
                >
                  {/* These paths share long prefixes and differ at the end, so
                      clipping the head keeps the distinguishing part visible. */}
                  <span className="block truncate [direction:rtl] text-left">{p.path}</span>
                </Link>
                {p.hasError && (
                  <span className="text-[10px]" style={{ color: 'var(--score-fail-text)' }}>
                    last audit failed
                  </span>
                )}
              </th>
              <td className="px-2 py-1.5 text-right"><ScorePill score={p.scores.performance} title="Performance" /></td>
              <td className="px-2 py-1.5 text-right"><ScorePill score={p.scores.accessibility} title="Accessibility" /></td>
              <td className="px-2 py-1.5 text-right"><ScorePill score={p.scores.bestPractices} title="Best Practices" /></td>
              <td className="px-2 py-1.5 text-right"><ScorePill score={p.scores.seo} title="SEO" /></td>
              <td className="tnum px-2 py-1.5 text-right text-[var(--muted)]">{fmtMs(p.lcp)}</td>
              <td className="tnum px-2 py-1.5 text-right text-[var(--muted)]">
                {p.cls === null || p.cls === undefined ? '—' : p.cls.toFixed(2)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
