import type { AuditItemDTO } from '@/lib/services/types';

/**
 * Native <details>/<summary>, nested one level: section, then each audit.
 *
 * Chosen over button + aria-expanded for free keyboard operation, working
 * without JS, and — the reason that actually matters here — Chrome's
 * find-in-page searches inside collapsed content, which is how someone hunts
 * for an audit id across forty sections.
 */
export function AuditSection({
  title,
  items,
  defaultOpen = false,
  emptyLabel,
}: {
  title: string;
  items: AuditItemDTO[];
  defaultOpen?: boolean;
  emptyLabel: string;
}) {
  return (
    <details open={defaultOpen} className="overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--surface)]">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3.5 py-2.5 [&::-webkit-details-marker]:hidden">
        <h3 className="font-[family-name:var(--font-display)] text-[13px] font-medium">{title}</h3>
        <span className="tnum shrink-0 rounded-full bg-[var(--surface-sunken)] px-2 py-0.5 text-[11px] text-[var(--muted)]">
          {items.length}
        </span>
      </summary>

      {items.length === 0 ? (
        <p className="border-t border-[var(--border)] px-3.5 py-3 text-[12px] text-[var(--muted)]">{emptyLabel}</p>
      ) : (
        <ul className="divide-y divide-[var(--border)] border-t border-[var(--border)]">
          {items.map((a) => (
            <li key={a.auditId}>
              <AuditItem item={a} />
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

function fmtMs(v: number | null) {
  return v === null ? null : v < 1000 ? `${Math.round(v)} ms` : `${(v / 1000).toFixed(1)} s`;
}
function fmtBytes(v: number | null) {
  return v === null ? null : v < 1024 ? `${v} B` : v < 1048576 ? `${Math.round(v / 1024)} KiB` : `${(v / 1048576).toFixed(1)} MiB`;
}

function AuditItem({ item: a }: { item: AuditItemDTO }) {
  const bits = [fmtMs(a.savingsMs), fmtBytes(a.savingsBytes), a.displayValue].filter(Boolean);
  const hasBody = Boolean(a.description) || Boolean(a.details);

  const header = (
    <div className="flex items-start justify-between gap-3">
      <span className="min-w-0 text-[12.5px]">{a.title}</span>
      {bits.length > 0 && (
        <span className="shrink-0 text-[11px] text-[var(--muted)]">{bits.join(' · ')}</span>
      )}
    </div>
  );

  // An audit with nothing to expand should not look expandable.
  if (!hasBody) return <div className="px-3.5 py-2.5">{header}</div>;

  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-start gap-2 px-3.5 py-2.5 hover:bg-[var(--surface-subtle)] [&::-webkit-details-marker]:hidden">
        <span
          aria-hidden="true"
          className="mt-0.5 shrink-0 text-[10px] text-[var(--muted)] transition-transform group-open:rotate-90"
        >
          ▶
        </span>
        <div className="min-w-0 flex-1">{header}</div>
      </summary>

      <div className="space-y-3 border-t border-[var(--border)] bg-[var(--surface-subtle)] px-3.5 py-3">
        {a.description && <Markdownish text={a.description} />}
        {a.details && <DetailTable table={a.details} />}
      </div>
    </details>
  );
}

/**
 * Lighthouse descriptions are markdown with inline links and code spans.
 * Rendering them as raw text leaves visible `[text](url)` noise, and pulling in
 * a markdown library for two constructs is not worth the bundle — so those two
 * are handled directly and everything else stays literal text.
 */
function Markdownish({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  const re = /\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;

  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[1]) {
      parts.push(
        <a key={i++} href={m[2]} target="_blank" rel="noreferrer" className="underline hover:no-underline">
          {m[1]}
        </a>,
      );
    } else {
      parts.push(
        <code key={i++} className="rounded bg-[var(--surface-sunken)] px-1 py-0.5 text-[11px]">
          {m[3]}
        </code>,
      );
    }
    last = re.lastIndex;
  }
  if (last < text.length) parts.push(text.slice(last));

  return <p className="text-[12px] leading-relaxed text-[var(--muted)]">{parts}</p>;
}

function DetailTable({ table }: { table: NonNullable<AuditItemDTO['details']> }) {
  const numeric = new Set(['bytes', 'ms', 'timespanMs', 'numeric']);

  return (
    <div>
      <div className="-mx-1 overflow-x-auto">
        <table className="w-full min-w-[420px] border-collapse text-[11.5px]">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wide text-[var(--muted)]">
              {table.headings.map((h) => (
                <th
                  key={h.key}
                  scope="col"
                  className={`border-b border-[var(--border)] px-2 py-1.5 font-medium ${
                    numeric.has(h.type) ? 'text-right' : ''
                  }`}
                >
                  {h.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {table.rows.map((row, ri) => (
              <tr key={ri}>
                {table.headings.map((h) => (
                  <td
                    key={h.key}
                    className={`max-w-[26rem] truncate px-2 py-1.5 align-top ${
                      numeric.has(h.type) ? 'tnum text-right' : ''
                    }`}
                    title={row[h.key]}
                  >
                    {row[h.key] || '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {table.truncated && (
        // Saying so beats implying the list is complete when pruning cut it.
        <p className="mt-1.5 text-[10px] text-[var(--muted)]">
          Showing the first {table.rows.length} rows — the full list is in the PSI report.
        </p>
      )}
    </div>
  );
}
