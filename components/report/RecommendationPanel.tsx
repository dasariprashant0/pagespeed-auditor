'use client';

import { useState, useTransition } from 'react';
import { generateRecommendationAction } from '@/app/actions/recommendation';
import type { PsiStrategy } from '@/lib/services/types';

/**
 * Generated on demand, not for every page after every sweep: 1,494 generations
 * per sweep would cost more than the audits and almost none would be read.
 */
export function RecommendationPanel({
  pageId,
  strategy,
  initial,
}: {
  pageId: string;
  strategy: PsiStrategy;
  initial: { content: string; model: string; generatedAt: string } | null;
}) {
  const [content, setContent] = useState(initial?.content ?? null);
  const [meta, setMeta] = useState(initial ? { model: initial.model, at: initial.generatedAt } : null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const run = (force: boolean) =>
    start(async () => {
      setError(null);
      const r = await generateRecommendationAction({ pageId, strategy, force });
      if (r.ok) {
        setContent(r.content);
        setMeta({ model: r.model, at: new Date().toISOString() });
      } else {
        setError(r.error);
      }
    });

  return (
    <section className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)]" aria-busy={pending}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5">
        <h3 className="font-[family-name:var(--font-display)] text-[13px] font-medium">
          What to fix first
        </h3>
        <button
          type="button"
          onClick={() => run(Boolean(content))}
          disabled={pending}
          className="rounded-[5px] border border-[var(--border-strong)] px-2.5 py-1 text-[12px] font-medium hover:bg-[var(--surface-subtle)] disabled:opacity-50"
        >
          {pending ? 'Thinking…' : content ? 'Regenerate' : 'Generate'}
        </button>
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

      {content && (
        <div className="border-t border-[var(--border)] px-3.5 py-3">
          <Prose text={content} />
          {meta && (
            <p className="mt-3 text-[10px] text-[var(--muted)]">
              {meta.model} · {new Date(meta.at).toLocaleString()} · cached until this page is re-audited
            </p>
          )}
        </div>
      )}

      {!content && !pending && !error && (
        <p className="border-t border-[var(--border)] px-3.5 py-3 text-[12px] text-[var(--muted)]">
          Not generated yet. This reads the findings above and returns a prioritised fix list.
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
