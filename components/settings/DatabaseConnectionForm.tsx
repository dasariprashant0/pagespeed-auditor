'use client';

import { useActionState } from 'react';
import { provisionTenantAction, type ProvisionResult } from '@/app/actions/provisioning';
import { InfoTooltip } from '@/components/ui/InfoTooltip';
import { PasswordInput } from '@/components/ui/PasswordInput';
import type { ProvisionRef } from '@/lib/services/org.service';

const input =
  'w-full rounded-[6px] border border-[var(--border)] bg-[var(--background)] px-2.5 py-1.5 text-[12px] font-mono focus:border-[var(--border-strong)] disabled:opacity-50';
const button =
  'rounded-[6px] border border-[var(--border-strong)] px-3 py-1.5 text-[12px] font-medium transition-colors hover:bg-[var(--surface-subtle)] disabled:opacity-50';

const NEON_HINT = (
  <>
    From your own Neon project (<code>neon.tech</code>) — the pooled
    connection string, and it must point at a fresh, empty database:
    nothing that already has tables in it.
  </>
);

const D1_ACCOUNT_HINT = (
  <>
    Your Cloudflare account ID — <code>wrangler whoami</code>, or the
    dashboard URL at <code>dash.cloudflare.com/&lt;account-id&gt;/...</code>.
  </>
);

const D1_DATABASE_HINT = (
  <>
    The D1 database&rsquo;s own ID — <code>wrangler d1 create &lt;name&gt;</code>{' '}
    prints it, or <code>wrangler d1 list</code>.
  </>
);

const D1_TOKEN_HINT = (
  <>
    dash.cloudflare.com/profile/api-tokens → Create Token → Custom Token →
    permission <code>D1: Edit</code>, scoped to this account. Not the{' '}
    <code>wrangler login</code> session token — that one is short-lived and
    tied to a CLI session, not meant to be pasted anywhere.
  </>
);

function Field({ label, hint, children }: { label: string; hint: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="eyebrow mb-1 flex items-center gap-1">
        {label}
        <InfoTooltip text={hint} />
      </span>
      {children}
    </label>
  );
}

const STATUS_LABEL: Record<ProvisionRef['status'], string> = {
  unprovisioned: 'Not connected yet',
  provisioning: 'Connecting… (refresh in a moment)',
  ready: 'Connected',
  failed: 'Failed to connect',
};

const STATUS_COLOR: Record<ProvisionRef['status'], string> = {
  unprovisioned: 'var(--muted)',
  provisioning: 'var(--score-average-text)',
  ready: 'var(--score-pass-text)',
  failed: 'var(--score-fail-text)',
};

export function DatabaseConnectionForm({ provision, canEdit }: { provision: ProvisionRef; canEdit: boolean }) {
  const [state, action, pending] = useActionState<ProvisionResult | null, FormData>(provisionTenantAction, null);

  return (
    <form action={action} className="space-y-3">
      <div className="flex items-center gap-2 text-[12px]">
        <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ background: STATUS_COLOR[provision.status] }} />
        <span style={{ color: STATUS_COLOR[provision.status] }}>{STATUS_LABEL[provision.status]}</span>
        {provision.provisionedAt && (
          <span className="text-[var(--faint)]">— since {new Date(provision.provisionedAt).toLocaleString()}</span>
        )}
      </div>
      {provision.status === 'failed' && provision.error && (
        <p role="alert" className="text-[11px]" style={{ color: 'var(--score-fail-text)' }}>{provision.error}</p>
      )}

      <fieldset disabled={!canEdit} className="space-y-3">
        <Field label="Neon connection string" hint={NEON_HINT}>
          <PasswordInput
            name="tenantDbUrl"
            defaultValue={provision.hasNeonUrl ? '••••••••••••' : ''}
            placeholder="postgresql://user:pass@host/db?sslmode=require"
            className={input}
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="D1 account ID" hint={D1_ACCOUNT_HINT}>
            <PasswordInput
              name="d1AccountId"
              defaultValue={provision.hasD1Credentials ? '••••••••••••' : ''}
              placeholder="account id"
              className={input}
            />
          </Field>
          <Field label="D1 database ID" hint={D1_DATABASE_HINT}>
            <PasswordInput
              name="d1DatabaseId"
              defaultValue={provision.hasD1Credentials ? '••••••••••••' : ''}
              placeholder="database id"
              className={input}
            />
          </Field>
          <Field label="D1 API token" hint={D1_TOKEN_HINT}>
            <PasswordInput
              name="d1ApiToken"
              defaultValue={provision.hasD1Credentials ? '••••••••••••' : ''}
              placeholder="API token"
              className={input}
            />
          </Field>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={pending} className={button}>
            {pending ? 'Connecting…' : 'Save'}
          </button>
          {state?.ok === false && (
            <p role="alert" className="text-[11px]" style={{ color: 'var(--score-fail-text)' }}>{state.error}</p>
          )}
          {state?.ok && <p role="status" className="text-[11px]" style={{ color: 'var(--score-pass-text)' }}>{state.message}</p>}
        </div>
      </fieldset>

      {!canEdit && <p className="text-[11px] text-[var(--muted)]">Only an admin can change this.</p>}
    </form>
  );
}
