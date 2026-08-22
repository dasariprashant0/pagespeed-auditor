'use client';

import { useState, useTransition } from 'react';
import {
  generateRecommendationAction,
  recommendationHistoryAction,
} from '@/app/actions/recommendation';
import type { RecommendationVersion } from '@/lib/services/recommendation.service';
import type { PsiStrategy } from '@/lib/services/types';

/**
 * Generated on demand, not for every page after every sweep: 1,494 generations
 * per sweep would cost more than the audits and almost none would be read.
 *
 * Regenerating keeps the old answer. Someone regenerates when they doubt what
 * they got, and the comparison is the point -- so up to ten are kept per
 * measurement and reachable from the picker below.
 */
export function RecommendationPanel({
  pageId,
  strategy,
  initial,
  canGenerate = true,
  demoMode = false,
}: {
  pageId: string;
  strategy: PsiStrategy;
  initial: { content: string; model: string; generatedAt: string; version: number } | null;
  /**
   * Hiding is presentation, not protection -- generateRecommendationAction
   * re-checks recommendations:generate itself. Viewing an existing answer
   * and its history stays open to everyone with reports:read; only the
   * button that spends money on a new generation is gated.
   */
  canGenerate?: boolean;
  /** Sample data has no real page to analyze -- see docs/superpowers/specs/2026-08-22-onboarding-tour-design.md Global Constraints. */
  demoMode?: boolean;
}) {
  const [content, setContent] = useState(initial?.content ?? null);
  const [meta, setMeta] = useState(
    initial ? { model: initial.model, at: initial.generatedAt, version: initial.version } : null,
  );
  const [history, setHistory] = useState<RecommendationVersion[] | null>(null);
  const [viewing, setViewing] = useState<number | null>(initial?.version ?? null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const loadHistory = () =>
    start(async () => {
      const r = await recommendationHistoryAction({ pageId, strategy });
      if (r.ok) setHistory(r.versions);
    });

  const run = (force: boolean) =>
    start(async () => {
      setError(null);
      const r = await generateRecommendationAction({ pageId, strategy, force });
      if (r.ok) {
        setContent(r.content);
        setMeta({ model: r.model, at: r.generatedAt, version: r.version });
        setViewing(r.version);
        // The list the picker shows is now one behind.
        setHistory(null);
      } else {
        setError(r.error);
      }
    });

  const show = (v: RecommendationVersion) => {
    setContent(v.content);
    setMeta({ model: v.model, at: v.generatedAt, version: v.version });
    setViewing(v.version);
  };

  return (
    <section className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)]" aria-busy={pending} data-tour="recommendation-panel">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5">
        <h3 className="font-[family-name:var(--font-display)] text-[13px] font-medium">
          What to fix first
        </h3>
        <div className="flex items-center gap-2">
          {content && (
            <button
              type="button"
              onClick={() => (history ? setHistory(null) : loadHistory())}
              disabled={pending}
              className="text-[11px] text-[var(--muted)] hover:text-[var(--foreground)] disabled:opacity-50"
            >
              {history ? 'Hide earlier answers' : 'Earlier answers'}
            </button>
          )}
          {canGenerate && (
            <button
              type="button"
              onClick={() => run(Boolean(content))}
              disabled={pending || demoMode}
              title={demoMode ? 'This is sample data — connect your database in Settings to analyze a real page.' : undefined}
              className="rounded-[5px] border border-[var(--border-strong)] px-2.5 py-1 text-[12px] font-medium hover:bg-[var(--surface-subtle)] disabled:opacity-50"
            >
              {pending ? 'Thinking…' : content ? 'Regenerate' : 'Generate'}
            </button>
          )}
        </div>
      </div>

      {pending && !content && (
        <div className="space-y-2 border-t border-[var(--border)] px-3.5 py-3" aria-live="polite">
          <p className="text-[11px] text-[var(--muted)]">Reading the findings — usually 20–40 seconds.</p>
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-2.5 animate-pulse rounded bg-[var(--surface-sunken)]" style={{ width: `${90 - i * 18}%` }} />
          ))}
        </div>
      )}

      {error && (
        <p role="alert" className="border-t border-[var(--border)] px-3.5 py-3 text-[12px]" style={{ color: 'var(--score-fail-text)' }}>
          {error}
        </p>
      )}

      {history && (
        <ul className="border-t border-[var(--border)] bg-[var(--surface-subtle)] px-2 py-1.5">
          {history.length === 0 && (
            <li className="px-1.5 py-1 text-[11px] text-[var(--muted)]">Nothing saved yet.</li>
          )}
          {history.map((v, i) => (
            <li key={v.version}>
              <button
                type="button"
                onClick={() => show(v)}
                aria-current={viewing === v.version}
                className={`flex w-full items-baseline gap-2 rounded-[5px] px-1.5 py-1 text-left text-[11px] ${
                  viewing === v.version
                    ? 'bg-[var(--surface-sunken)] font-medium'
                    : 'text-[var(--muted)] hover:bg-[var(--surface-sunken)]'
                }`}
              >
                <span className="tnum">#{v.version}</span>
                <span>{new Date(v.generatedAt).toLocaleString()}</span>
                {i === 0 && <span className="text-[10px] text-[var(--faint)]">latest</span>}
                <span className="ml-auto shrink-0 text-[10px] text-[var(--faint)]">
                  {v.model}
                  {v.durationMs !== null && ` · ${(v.durationMs / 1000).toFixed(1)}s`}
                </span>
              </button>
            </li>
          ))}
          <li className="px-1.5 pt-1 text-[10px] text-[var(--faint)]">
            The last 10 are kept for each measurement.
          </li>
        </ul>
      )}

      {content && (
        <div className="border-t border-[var(--border)] px-3.5 py-3">
          {meta && history && viewing !== history[0]?.version && (
            <p className="mb-2.5 rounded-[5px] bg-[var(--surface-sunken)] px-2 py-1 text-[11px] text-[var(--muted)]">
              Showing an earlier answer (#{meta.version}). It reflects the same measurement, not a newer one.
            </p>
          )}
          <Prose text={content} />
          {meta && (
            <p className="mt-3 text-[10px] text-[var(--muted)]">
              #{meta.version} · {meta.model} · {new Date(meta.at).toLocaleString()} · kept until this page is
              re-audited
            </p>
          )}
        </div>
      )}

      {!content && !pending && !error && (
        <p className="border-t border-[var(--border)] px-3.5 py-3 text-[12px] text-[var(--muted)]">
          {demoMode
            ? 'This is sample data — connect your database in Settings to generate real advice.'
            : canGenerate
              ? 'Not generated yet. This reads the findings above and returns a prioritised fix list.'
              : 'Not generated yet.'}
        </p>
      )}
    </section>
  );
}

/** Minimal markdown: headings, bullets, bold and code. Not worth a dependency. */
function Prose({ text }: { text: string }) {
  return (
    <div className="space-y-1.5 text-[12.5px] leading-relaxed">
      {text.split('\n').map((line, i) => {
        const t = line.trim();
        if (!t) return null;
        if (t.startsWith('###') || t.startsWith('##')) {
          return <h4 key={i} className="pt-1.5 font-[family-name:var(--font-display)] text-[12.5px] font-semibold">{t.replace(/^#+\s*/, '')}</h4>;
        }
        if (/^[-*]\s/.test(t)) {
          return <p key={i} className="flex gap-2 pl-1"><span aria-hidden="true" className="text-[var(--muted)]">•</span><span>{inline(t.replace(/^[-*]\s/, ''))}</span></p>;
        }
        if (/^\d+\.\s/.test(t)) {
          return <p key={i} className="pl-1">{inline(t)}</p>;
        }
        return <p key={i}>{inline(t)}</p>;
      })}
    </div>
  );
}

function inline(s: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) parts.push(s.slice(last, m.index));
    if (m[1]) parts.push(<strong key={k++}>{m[1]}</strong>);
    else parts.push(<code key={k++} className="rounded bg-[var(--surface-sunken)] px-1 py-0.5 text-[11px]">{m[2]}</code>);
    last = re.lastIndex;
  }
  if (last < s.length) parts.push(s.slice(last));
  return parts;
}
