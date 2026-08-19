'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ingestSitemapAction } from '@/app/actions/site';

/**
 * Re-reads the sitemap.
 *
 * Reports what actually changed rather than a bare success: on a large site the
 * useful answer is "12 new, 3 no longer listed", not "done".
 */
export function IngestButton({ siteId, pageCount }: { siteId: string; pageCount: number }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setMsg(null); setError(null);
            const r = await ingestSitemapAction(siteId);
            if (r.ok) { setMsg(r.message); router.refresh(); } else setError(r.error);
          })
        }
        className="rounded-[6px] border border-[var(--border-strong)] px-3 py-1.5 text-[12px] font-medium transition-colors hover:bg-[var(--surface-subtle)] disabled:opacity-50"
      >
        {pending ? 'Reading sitemap…' : pageCount > 0 ? 'Re-read sitemap' : 'Read sitemap'}
      </button>
      {msg && <span className="text-[11px]" style={{ color: 'var(--score-pass-text)' }}>{msg}</span>}
      {error && <span role="alert" className="text-[11px]" style={{ color: 'var(--score-fail-text)' }}>{error}</span>}
    </div>
  );
}
