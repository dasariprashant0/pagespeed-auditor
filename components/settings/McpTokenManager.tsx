'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createMcpTokenAction, revokeMcpTokenAction, type CreateTokenResult } from '@/app/actions/mcpTokens';

export interface TokenRow {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export function McpTokenManager({
  endpoint,
  tokens,
  canEdit,
}: {
  endpoint: string;
  tokens: TokenRow[];
  /** developer:access. Everyone sees the list; only this enables create/revoke. */
  canEdit: boolean;
}) {
  const [created, createAction, creating] = useActionState<CreateTokenResult | null, FormData>(createMcpTokenAction, null);
  const [busy, startBusy] = useTransition();
  const [rowError, setRowError] = useState<string | null>(null);
  const router = useRouter();

  const revoke = (id: string) =>
    startBusy(async () => {
      setRowError(null);
      const r = await revokeMcpTokenAction(id);
      if (!r.ok) setRowError(r.error ?? 'Could not revoke.');
      else router.refresh();
    });

  const command = created?.ok
    ? `claude mcp add --transport http pagespeed ${endpoint} --header "Authorization: Bearer ${created.token}"`
    : null;

  return (
    <div className="space-y-3">
      <section className="panel p-4">
        <h2 className="title-md">Create a token</h2>
        <p className="mb-3 mt-1 text-[11px] text-[var(--muted)]">
          {canEdit
            ? 'An agent with this token can read every report and queue audits for this organisation, but cannot change settings or people. The token is shown once.'
            : 'Only a developer or admin can create tokens.'}
        </p>

        <form action={createAction}>
          <fieldset disabled={!canEdit} className="flex flex-wrap items-end gap-2">
            <label className="min-w-[14rem] flex-1">
              <span className="eyebrow mb-1 block">Label</span>
              <input
                name="label" required maxLength={60} placeholder="Claude Code on my laptop"
                className="w-full rounded-[6px] border border-[var(--border)] bg-[var(--background)] px-2.5 py-1.5 text-[12px] disabled:opacity-50"
              />
            </label>
            <button
              type="submit" disabled={creating}
              className="rounded-[6px] border border-[var(--border-strong)] px-3 py-1.5 text-[12px] font-medium hover:bg-[var(--surface-subtle)] disabled:opacity-50"
            >
              {creating ? 'Creating…' : 'Create token'}
            </button>
          </fieldset>
        </form>

        {created && !created.ok && (
          <p role="alert" className="mt-2 text-[11px]" style={{ color: 'var(--score-fail-text)' }}>{created.error}</p>
        )}
        {created?.ok && command && (
          <div className="mt-3 space-y-2 rounded-[6px] bg-[var(--surface-subtle)] p-2.5">
            <p className="text-[11px]" style={{ color: 'var(--score-pass-text)' }}>
              Copy it now. It will not be shown again.
            </p>
            <input
              readOnly value={created.token} aria-label="New token"
              onFocus={(e) => e.currentTarget.select()}
              className="w-full rounded-[5px] border border-[var(--border)] bg-[var(--background)] px-2 py-1 font-mono text-[10px]"
            />
            <p className="text-[11px] text-[var(--muted)]">To add it to Claude Code:</p>
            <textarea
              readOnly value={command} rows={3} aria-label="Claude Code command"
              onFocus={(e) => e.currentTarget.select()}
              className="w-full resize-none rounded-[5px] border border-[var(--border)] bg-[var(--background)] px-2 py-1 font-mono text-[10px]"
            />
          </div>
        )}

        <p className="mt-3 text-[11px] text-[var(--muted)]">
          Endpoint: <code className="font-mono">{endpoint}</code>. Send the token as{' '}
          <code className="font-mono">Authorization: Bearer …</code>.
        </p>
      </section>

      <section className="panel overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <h2 className="title-md">Active tokens</h2>
          <span className="eyebrow">{tokens.length}</span>
        </div>
        {rowError && (
          <p role="alert" className="px-4 pb-2 text-[11px]" style={{ color: 'var(--score-fail-text)' }}>{rowError}</p>
        )}
        {tokens.length === 0 ? (
          <p className="border-t border-[var(--border)] px-4 py-3 text-[12px] text-[var(--muted)]">No tokens yet.</p>
        ) : (
          <ul className="divide-y divide-[var(--border)] border-t border-[var(--border)]">
            {tokens.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <div className="truncate text-[12px] font-medium">{t.label}</div>
                  <div className="text-[11px] text-[var(--muted)]">
                    Created {new Date(t.createdAt).toLocaleDateString()} ·{' '}
                    {t.lastUsedAt ? `last used ${new Date(t.lastUsedAt).toLocaleString()}` : 'never used'}
                  </div>
                </div>
                {canEdit && (
                  <button
                    type="button" disabled={busy} onClick={() => revoke(t.id)}
                    className="shrink-0 rounded-[6px] border border-[var(--border)] px-2.5 py-1 text-[11px] hover:bg-[var(--surface-subtle)] disabled:opacity-50"
                  >
                    Revoke
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
