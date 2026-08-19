'use client';

import { useActionState, useState, useTransition } from 'react';
import { saveNotificationsAction, sendTestNotificationAction } from '@/app/actions/settings';

export function NotificationForm({
  initial,
}: {
  initial: {
    emailEnabled: boolean;
    emailTo: string | null;
    slackEnabled: boolean;
    /** Masked; the real value never reaches the browser. */
    slackWebhookMasked: string | null;
  };
}) {
  const [state, action, pending] = useActionState(saveNotificationsAction, null);
  const [testing, startTest] = useTransition();
  const [testResult, setTestResult] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      <form action={action} className="space-y-3">
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-[12px]">
            <input type="checkbox" name="emailEnabled" defaultChecked={initial.emailEnabled} />
            Email on sweep completion or failure
          </label>
          <input
            name="emailTo"
            defaultValue={initial.emailTo ?? ''}
            placeholder="you@company.com, someone@company.com"
            className="w-full max-w-md rounded-[5px] border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-[12px]"
          />
        </div>

        <div className="space-y-2">
          <label className="flex items-center gap-2 text-[12px]">
            <input type="checkbox" name="slackEnabled" defaultChecked={initial.slackEnabled} />
            Slack on sweep completion or failure
          </label>
          <input
            name="slackWebhookUrl"
            defaultValue={initial.slackWebhookMasked ?? ''}
            placeholder="https://hooks.slack.com/services/..."
            className="w-full max-w-md rounded-[5px] border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 font-mono text-[11px]"
          />
        </div>

        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={pending}
            className="rounded-[5px] border border-[var(--border-strong)] px-3 py-1.5 text-[12px] font-medium hover:bg-[var(--surface-subtle)] disabled:opacity-50"
          >
            {pending ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            disabled={testing}
            onClick={() => startTest(async () => {
              const r = await sendTestNotificationAction();
              setTestResult(r.ok ? r.message : r.error);
            })}
            className="rounded-[5px] border border-[var(--border)] px-3 py-1.5 text-[12px] text-[var(--muted)] hover:bg-[var(--surface-subtle)] disabled:opacity-50"
          >
            {testing ? 'Sending…' : 'Send a test'}
          </button>
        </div>
      </form>

      {state?.ok === false && (
        <p role="alert" className="text-[11px]" style={{ color: 'var(--score-fail-text)' }}>{state.error}</p>
      )}
      {state?.ok && <p className="text-[11px]" style={{ color: 'var(--score-pass-text)' }}>{state.message}</p>}
      {testResult && <p className="text-[11px] text-[var(--muted)]">{testResult}</p>}

      <p className="text-[11px] text-[var(--muted)]">
        Only sweeps notify. An on-demand page or group run does not — a channel that
        pings on everything gets muted, which loses the alerts that mattered.
      </p>
    </div>
  );
}
