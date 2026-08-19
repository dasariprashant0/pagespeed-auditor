import type { RunEnvironmentDTO } from '@/lib/services/types';

/**
 * The conditions the numbers were produced under.
 *
 * PSI prints this under every report for a reason: a mobile score is a score
 * under 4x CPU slowdown and a throttled connection, and comparing it to a
 * desktop number without knowing that is meaningless.
 */
export function RunConditions({ env, strategy }: { env: RunEnvironmentDTO; strategy: string }) {
  const rows = [
    ['Device', env.device ?? (strategy === 'mobile' ? 'Emulated mobile' : 'Emulated desktop')],
    ['Network', env.networkThrottling],
    ['CPU', env.cpuThrottling],
    ['Lighthouse', env.lighthouseVersion],
    ['Captured', env.fetchedAt ? new Date(env.fetchedAt).toLocaleString() : null],
  ].filter(([, v]) => v) as Array<[string, string]>;

  if (rows.length === 0) return null;

  return (
    <details className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)]">
      <summary className="cursor-pointer list-none px-3.5 py-2 text-[11px] text-[var(--muted)] [&::-webkit-details-marker]:hidden">
        Run conditions — how these numbers were produced
      </summary>
      <dl className="grid gap-x-4 gap-y-1 border-t border-[var(--border)] px-3.5 py-3 text-[11px] sm:grid-cols-2">
        {rows.map(([k, v]) => (
          <div key={k} className="flex gap-2">
            <dt className="w-20 shrink-0 text-[var(--muted)]">{k}</dt>
            <dd className="min-w-0 break-words">{v}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
