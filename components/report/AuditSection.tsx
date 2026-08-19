import type { AuditItemDTO } from '@/lib/services/types';

/**
 * Native <details>/<summary> rather than a button + aria-expanded div.
 *
 * Free keyboard operation and state announcement, works with JS disabled, and —
 * the reason that actually matters here — Chrome's find-in-page can search
 * inside collapsed content, which is how people hunt for an audit id across
 * forty sections.
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
  const fmtMs = (v: number | null) => (v === null ? null : v < 1000 ? `${Math.round(v)} ms` : `${(v / 1000).toFixed(1)} s`);
  const fmtBytes = (v: number | null) =>
    v === null ? null : v < 1024 ? `${v} B` : v < 1048576 ? `${Math.round(v / 1024)} KiB` : `${(v / 1048576).toFixed(1)} MiB`;

  return (
    <details open={defaultOpen} className="overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--surface)]">
      <summary className="flex cursor-pointer list-none items-center justify-between px-3.5 py-2.5 [&::-webkit-details-marker]:hidden">
        <h3 className="font-[family-name:var(--font-display)] text-[13px] font-medium">{title}</h3>
        <span className="tnum rounded-full bg-[var(--surface-sunken)] px-2 py-0.5 text-[11px] text-[var(--muted)]">
          {items.length}
        </span>
      </summary>

      {items.length === 0 ? (
        <p className="border-t border-[var(--border)] px-3.5 py-3 text-[12px] text-[var(--muted)]">
          {emptyLabel}
        </p>
      ) : (
        <ul className="divide-y divide-[var(--border)] border-t border-[var(--border)]">
          {items.map((a) => {
            const bits = [fmtMs(a.savingsMs), fmtBytes(a.savingsBytes), a.displayValue].filter(Boolean);
            return (
              <li key={a.auditId} className="px-3.5 py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <span className="text-[12.5px]">{a.title}</span>
                  {bits.length > 0 && (
                    <span className="shrink-0 text-[11px] text-[var(--muted)]">{bits.join(' · ')}</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </details>
  );
}
