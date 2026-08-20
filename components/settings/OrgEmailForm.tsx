'use client';

import { useActionState, useState } from 'react';
import { updateOrgEmailAction } from '@/app/actions/site';
import type { OrgEmailRef } from '@/lib/services/tenant.service';

type Result = { ok: true; message: string } | { ok: false; error: string } | null;

const input =
  'w-full rounded-[6px] border border-[var(--border)] bg-[var(--background)] px-2.5 py-1.5 text-[12px] focus:border-[var(--border-strong)]';
const button =
  'rounded-[6px] border border-[var(--border-strong)] px-3 py-1.5 text-[12px] font-medium transition-colors hover:bg-[var(--surface-subtle)] disabled:opacity-50';

/**
 * Per-organisation SMTP override for invites and sweep notifications --
 * NOT for password resets, which stay on the shared default (see
 * Organization.smtp* in prisma/schema.prisma for why).
 */
export function OrgEmailForm({ email }: { email: OrgEmailRef }) {
  const [state, action, pending] = useActionState<Result, FormData>(updateOrgEmailAction, null);
  const [passTouched, setPassTouched] = useState(false);

  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="eyebrow mb-1 block">SMTP host</span>
          <input name="smtpHost" defaultValue={email.host ?? ''} placeholder="smtp.gmail.com" className={input} />
          <span className="mt-1 block text-[10px] text-[var(--faint)]">
            Your mail provider&rsquo;s SMTP address — <code>smtp.gmail.com</code> for Gmail or Google
            Workspace, <code>smtp.office365.com</code> for Microsoft 365, or check your provider&rsquo;s
            mail settings / &ldquo;SMTP relay&rdquo; page for anything else.
          </span>
        </label>
        <label className="block">
          <span className="eyebrow mb-1 block">Port</span>
          <input name="smtpPort" defaultValue={email.port ?? ''} placeholder="587" className={input} />
          <span className="mt-1 block text-[10px] text-[var(--faint)]">
            <code>587</code> almost always — that&rsquo;s the standard TLS port every major provider
            uses. Only use <code>465</code> if your provider specifically says SSL-only.
          </span>
        </label>
        <label className="block">
          <span className="eyebrow mb-1 block">Username</span>
          <input name="smtpUser" defaultValue={email.user ?? ''} placeholder="you@company.com" className={input} />
          <span className="mt-1 block text-[10px] text-[var(--faint)]">
            The full mailbox address that will send these emails, e.g. <code>you@company.com</code>.
            This is the same account the password below belongs to.
          </span>
        </label>
        <label className="block">
          <span className="eyebrow mb-1 block">Password</span>
          <input
            name="smtpPass"
            type={passTouched ? 'text' : 'password'}
            // The real password is never sent to the browser. An untouched
            // field keeps the stored value rather than overwriting it with dots.
            defaultValue={email.hasOverride ? '••••••••••••' : ''}
            placeholder="App Password"
            onFocus={() => setPassTouched(true)}
            className={`${input} font-mono`}
          />
          <span className="mt-1 block text-[10px] text-[var(--faint)]">
            Not your normal login password. For Gmail/Google Workspace: turn on 2-Step
            Verification, then generate one at{' '}
            <a
              href="https://myaccount.google.com/apppasswords"
              target="_blank" rel="noreferrer"
              className="underline underline-offset-2 hover:text-[var(--muted)]"
            >
              myaccount.google.com/apppasswords
            </a>
            . For Microsoft 365 it&rsquo;s called an &ldquo;app password&rdquo; too, under Security settings. Other
            providers usually call it an SMTP password or API key in their account settings.
          </span>
        </label>
      </div>
      <label className="block max-w-md">
        <span className="eyebrow mb-1 block">From (optional)</span>
        <input
          name="smtpFrom"
          defaultValue={email.from ?? ''}
          placeholder='PageSpeed Auditor <you@company.com>'
          className={input}
        />
        <span className="mt-1 block text-[10px] text-[var(--faint)]">
          How the sender name shows up in someone&rsquo;s inbox. Leave blank to just show the username
          above as the sender — most providers reject a &ldquo;from&rdquo; address that isn&rsquo;t the mailbox
          you&rsquo;re actually authenticating as.
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={button}>
          {pending ? 'Checking the connection…' : 'Save'}
        </button>
        {state?.ok === false && (
          <p role="alert" className="text-[11px]" style={{ color: 'var(--score-fail-text)' }}>{state.error}</p>
        )}
        {state?.ok && <p role="status" className="text-[11px]" style={{ color: 'var(--score-pass-text)' }}>{state.message}</p>}
      </div>

      <p className="text-[11px] text-[var(--muted)]">
        {email.hasOverride
          ? 'Invitations and sweep notifications send from this mailbox instead of the shared default. Clear every field and save to go back to it.'
          : 'Not set — invitations and sweep notifications send from the shared default mailbox. Fill this in to use your own instead.'}
        {' '}Password resets always use the shared default, since a reset is requested by email address alone,
        before any organisation is known.
      </p>
    </form>
  );
}
