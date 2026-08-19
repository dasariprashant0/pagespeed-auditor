import Link from 'next/link';
import type { OnboardingState } from '@/lib/services/onboarding.service';

/**
 * Getting-started checklist.
 *
 * Shown on the dashboard until setup is finished, then gone for good -- a
 * permanent banner reading "you're all set" is clutter. Steps are derived from
 * real data, so it cannot claim something is done when it is not.
 *
 * Only the next incomplete step gets a button. Five simultaneous calls to
 * action is not guidance.
 */
export function SetupChecklist({ state, canManage }: { state: OnboardingState; canManage: boolean }) {
  if (state.complete) return null;

  const next = state.steps.find((s) => !s.done);

  return (
    <section className="panel mb-6 overflow-hidden" aria-labelledby="setup-heading">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
        <div>
          <h2 id="setup-heading" className="title-md">Finish setting up</h2>
          <p className="mt-0.5 text-[11px] text-[var(--muted)]">
            {state.completedCount} of {state.steps.length} done
          </p>
        </div>
        <div className="flex items-center gap-1" aria-hidden="true">
          {state.steps.map((s) => (
            <span
              key={s.id}
              className="h-1.5 w-8 rounded-full"
              style={{ background: s.done ? 'var(--score-pass)' : 'var(--surface-sunken)' }}
            />
          ))}
        </div>
      </div>

      <ol className="divide-y divide-[var(--border)]">
        {state.steps.map((s) => {
          const isNext = s.id === next?.id;
          return (
            <li
              key={s.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5"
              style={{ background: isNext ? 'var(--surface-subtle)' : undefined }}
            >
              <span
                aria-hidden="true"
                className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold"
                style={{
                  background: s.done ? 'var(--score-pass)' : 'transparent',
                  border: s.done ? 'none' : '1.5px solid var(--border-strong)',
                  color: '#fff',
                }}
              >
                {s.done ? '✓' : ''}
              </span>

              <div className="min-w-0 flex-1">
                <div className={`text-[12.5px] ${s.done ? 'text-[var(--muted)] line-through' : 'font-medium'}`}>
                  {s.title}
                </div>
                {isNext && <div className="text-[11px] text-[var(--muted)]">{s.detail}</div>}
              </div>

              {isNext &&
                (canManage ? (
                  <Link
                    href={s.href}
                    className="rounded-[6px] bg-[var(--foreground)] px-2.5 py-1 text-[11px] font-medium text-[var(--background)]"
                  >
                    {s.cta}
                  </Link>
                ) : (
                  // A viewer cannot do any of this; pointing them at a button
                  // that will reject them is worse than saying who can.
                  <span className="text-[11px] text-[var(--muted)]">An admin needs to do this</span>
                ))}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
