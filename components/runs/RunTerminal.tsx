'use client';

import { useEffect, useRef, useState } from 'react';

interface RunLogEvent {
  ts: number;
  kind: 'start' | 'ok' | 'retry' | 'error';
  pageId: string;
  url: string;
  strategy: string;
  message?: string;
}

const COLOR: Record<RunLogEvent['kind'], string> = {
  start: 'var(--muted)',
  ok: 'var(--score-pass-text)',
  retry: 'var(--score-average-text)',
  error: 'var(--score-fail-text)',
};

const VERB: Record<RunLogEvent['kind'], string> = {
  start: 'auditing',
  ok: 'done',
  retry: 'retrying',
  error: 'failed',
};

function path(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname === '/' ? '/' : u.pathname.replace(/\/$/, '');
  } catch {
    return url;
  }
}

function clock(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/**
 * Read-only, live "what's running" view for one audit run.
 *
 * A small, short-lived Postgres table (RunLogEvent, see lib/opsState.ts) is
 * the source, deleted once the run finalizes -- this is a transient console,
 * not a second copy of the durable AuditResult record. Polling rather than a
 * stream, same reasoning as ActiveRunBar: the run executes elsewhere and
 * writes to shared state, so a stream would still just be polling that
 * state and re-emitting it.
 *
 * Collapsed by default and only polls while expanded, so a run nobody is
 * watching doesn't cost extra requests on every screen it happens to render on.
 */
export function RunTerminal({ runId, active }: { runId: string; active: boolean }) {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<RunLogEvent[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const controller = new AbortController();

    async function tick() {
      try {
        const res = await fetch(`/api/runs/${runId}/log`, { signal: controller.signal, cache: 'no-store' });
        if (res.ok && !cancelled) {
          const { events: next } = (await res.json()) as { events: RunLogEvent[] };
          setEvents(next);
        }
      } catch {
        // A missed poll just tries again next tick.
      }
    }

    tick();
    const id = active ? setInterval(tick, 2000) : undefined;
    return () => {
      cancelled = true;
      controller.abort();
      if (id) clearInterval(id);
    };
  }, [open, active, runId]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [events]);

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-[11px] text-[var(--muted)] hover:text-[var(--foreground)] hover:underline"
      >
        {open ? '▾ Hide live activity' : '▸ Show live activity'}
      </button>

      {open && (
        <div
          ref={scrollRef}
          className="thin-scroll mt-1.5 h-40 overflow-y-auto rounded-[6px] border border-[var(--border)] bg-[var(--chrome)] p-2 font-mono text-[11px] leading-relaxed"
        >
          {events.length === 0 ? (
            <p className="text-[var(--faint)]">Waiting for the first page to start…</p>
          ) : (
            events.map((e, i) => (
              <div key={`${e.pageId}-${e.ts}-${i}`} className="whitespace-pre-wrap break-all">
                <span className="text-[var(--faint)]">[{clock(e.ts)}]</span>{' '}
                <span style={{ color: COLOR[e.kind] }}>{VERB[e.kind]}</span>{' '}
                <span>{path(e.url)}</span>{' '}
                <span className="text-[var(--faint)]">· {e.strategy}</span>
                {e.message && <span className="text-[var(--faint)]"> — {e.message}</span>}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
