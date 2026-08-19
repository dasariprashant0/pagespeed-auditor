'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { queueAuditAction } from '@/app/actions/audits';
import type { PsiStrategy } from '@/lib/services/types';

/**
 * Queues an audit and hands off to the progress bar.
 *
 * Deliberately does not await the audit itself: at ~60 s per PSI call even one
 * page in both strategies is a two-minute wait, which no HTTP request should
 * hold open.
 */
export function RunAuditButton({
  kind,
  target,
  label,
  strategies,
}: {
  kind: 'page' | 'group';
  target: string;
  label?: string;
  strategies?: PsiStrategy[];
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        aria-busy={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await queueAuditAction({ kind, ref: target, strategies });
            if (!r.ok) setError(r.error);
            else router.refresh();
          })
        }
        className="rounded-[5px] border border-[var(--border-strong)] bg-[var(--surface)] px-2.5 py-1 text-[12px] font-medium hover:bg-[var(--surface-subtle)] disabled:opacity-50"
      >
        {pending ? 'Queueing…' : (label ?? 'Re-run audit')}
      </button>
      {error && (
        <span role="alert" className="text-[11px]" style={{ color: 'var(--score-fail-text)' }}>
          {error}
        </span>
      )}
    </div>
  );
}
