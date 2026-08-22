'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { queueAuditAction } from '@/app/actions/audits';
import { previewEstimateAction, type EstimatePreview } from '@/app/actions/estimate';
import { Button } from '@/components/ui/Button';
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
  hint,
  variant = 'secondary',
  demoMode = false,
}: {
  kind: 'page' | 'group';
  target: string;
  label?: string;
  strategies?: PsiStrategy[];
  /** Shown in the tooltip until the measured estimate arrives. */
  hint?: string;
  variant?: 'primary' | 'secondary';
  /** Sample data has nothing to re-measure -- see docs/superpowers/specs/2026-08-22-onboarding-tour-design.md Global Constraints. */
  demoMode?: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<EstimatePreview | null>(null);
  const router = useRouter();

  // Fetched on hover/focus rather than on mount: it is a DB query per button,
  // and a table of them would fire one each on every page load.
  const loadPreview = () => {
    if (preview || demoMode) return;
    previewEstimateAction({ kind, ref: target, strategyCount: strategies?.length ?? 2 })
      .then(setPreview)
      .catch(() => {});
  };

  return (
    <div className="flex items-center gap-2" data-tour="run-audit-button">
      <Button
        variant={variant}
        type="button"
        disabled={pending || demoMode}
        aria-busy={pending}
        onMouseEnter={loadPreview}
        onFocus={loadPreview}
        title={
          demoMode
            ? 'This is sample data — connect your database in Settings to measure a real site.'
            : preview
              ? `${preview.jobs} PSI calls, ${preview.eta}` +
                (preview.measured
                  ? ` — based on your last ${preview.sampleSize} audits (median ${preview.medianSeconds}s each)`
                  : ' — estimate, no measured history yet')
              : hint
        }
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await queueAuditAction({ kind, ref: target, strategies });
            if (!r.ok) setError(r.error);
            else router.refresh();
          })
        }
      >
        {pending ? 'Starting…' : (label ?? 'Measure again')}
      </Button>

      {preview && !pending && (
        <span className="text-[11px] text-[var(--muted)]">
          {preview.jobs} calls · {preview.eta}
          {!preview.measured && ' (estimated)'}
        </span>
      )}
      {error && (
        <span role="alert" className="text-[11px]" style={{ color: 'var(--score-fail-text)' }}>
          {error}
        </span>
      )}
    </div>
  );
}
