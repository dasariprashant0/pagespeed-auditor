import Link from 'next/link';
import type { PsiStrategy } from '@/lib/services/types';

/**
 * Mobile / desktop, as links rather than buttons.
 *
 * Links keep the choice in the URL, so it survives a refresh, can be shared,
 * and renders on the server -- no client island, no flash of the wrong
 * strategy. This was copy-pasted into three screens with three different
 * paddings before it lived here.
 */
export function StrategyTabs({ active, basePath }: { active: PsiStrategy; basePath: string }) {
  const sep = basePath.includes('?') ? '&' : '?';
  return (
    <div
      role="tablist"
      aria-label="Measured as"
      className="flex rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-0.5 shadow-[var(--shadow-raised)]"
    >
      {(['mobile', 'desktop'] as const).map((s) => (
        <Link
          key={s}
          role="tab"
          aria-selected={s === active}
          href={`${basePath}${sep}strategy=${s}`}
          className={`rounded-[var(--radius-sm)] px-2.5 py-1 text-[12px] transition-colors duration-[var(--t-fast)] ${
            s === active
              ? 'bg-[var(--surface-sunken)] font-medium text-[var(--foreground)]'
              : 'text-[var(--muted)] hover:text-[var(--foreground)]'
          }`}
        >
          {s === 'mobile' ? 'Mobile' : 'Desktop'}
        </Link>
      ))}
    </div>
  );
}
