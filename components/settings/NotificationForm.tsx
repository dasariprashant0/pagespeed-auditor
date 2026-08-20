'use client';

import { useActionState, useState, useTransition } from 'react';
import { saveNotificationsAction, sendTestNotificationAction } from '@/app/actions/settings';
import { InfoTooltip } from '@/components/ui/InfoTooltip';

export function NotificationForm({
  initial,
  sentFrom,
  appSender = false,
}: {
  initial: {
    emailEnabled: boolean;
    emailTo: string | null;
    slackEnabled: boolean;
    /** Masked; the real value never reaches the browser. */
    slackWebhookMasked: string | null;
  };
  /** The sending mailbox, shown so it is not confused with the recipients. */
  sentFrom: string | null;
  /** True when sending as the app (verified domain) rather than a person's mailbox. */
  appSender?: boolean;
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
            Email when the automatic site check finishes or fails
          </label>
          <label className="block max-w-md">
            <span className="mb-1 flex items-center gap-1 text-[11px] text-[var(--muted)]">
              Send to
              <InfoTooltip text="Any email addresses, separated by commas. They don't need to belong to anyone with an account here." />
            </span>
            <input
              name="emailTo"
              defaultValue={initial.emailTo ?? ''}
              placeholder="you@company.com, teammate@company.com"
              className="w-full rounded-[5px] border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-[12px]"
            />
          </label>
          {sentFrom && (
            <p className="text-[11px] text-[var(--muted)]">
              Sent from <strong>{sentFrom}</strong>. Recipients above can be anyone, on any domain.
              {!appSender && (
                <>
                  {' '}That is a personal mailbox — to send as the app instead, from an address
                  like <code>pagespeed@yourdomain.com</code> that belongs to nobody in particular,
                  switch <code>EMAIL_TRANSPORT</code> to <code>resend</code>.
                </>
              )}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <label className="flex items-center gap-2 text-[12px]">
            <input type="checkbox" name="slackEnabled" defaultChecked={initial.slackEnabled} />
            Slack when the automatic site check finishes or fails
          </label>
          <label className="block max-w-md">
            <span className="mb-1 flex items-center gap-1 text-[11px] text-[var(--muted)]">
              Webhook URL
              <InfoTooltip text="In Slack: create an app at api.slack.com/apps, add an Incoming Webhook, and choose the channel it should post to — Slack gives you a URL to paste here." />
            </span>
            <input
              name="slackWebhookUrl"
              defaultValue={initial.slackWebhookMasked ?? ''}
              placeholder="https://hooks.slack.com/services/..."
              className="w-full rounded-[5px] border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 font-mono text-[11px]"
            />
          </label>
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
