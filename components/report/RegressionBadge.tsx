import type { Regression } from '@/lib/services/regression.service';

/**
 * Uses --accent as a tinted border rather than a solid fill, deliberately: a
 * solid red badge sitting next to PSI's red score band would read as another
 * failing score rather than as a change over time.
 */
export function RegressionBadge({ regressions }: { regressions: Regression[] }) {
  if (regressions.length === 0) return null;

  return (
    <ul className="space-y-1.5">
      {regressions.map((r, i) => {
        const critical = r.severity === 'critical';
        return (
          <li
            key={`${r.metric}-${i}`}
            className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-[5px] border px-2.5 py-1.5 text-[11.5px]"
            style={{
              borderColor: critical ? 'var(--score-fail)' : 'var(--score-average)',
              background: critical ? 'var(--score-fail-tint)' : 'var(--score-average-tint)',
            }}
          >
            <strong style={{ color: critical ? 'var(--score-fail-text)' : 'var(--score-average-text)' }}>
              {r.label}
            </strong>
            <span className="tnum">
              {r.from} → {r.to}
              {r.delta !== null && ` (${r.delta})`}
            </span>
            <span className="text-[10px] text-[var(--muted)]">
              {r.kind === 'single-run-drop'
                ? 'large single-run drop'
                : r.kind === 'sustained-drop'
                  ? 'sustained across two audits'
                  : 'moved into a worse band and stayed'}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
