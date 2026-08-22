'use client';

import { useActionState, useState } from 'react';
import { neonConnectionAction, d1ConnectionAction, type ProvisionResult } from '@/app/actions/provisioning';
import { InfoTooltip } from '@/components/ui/InfoTooltip';
import { PasswordInput } from '@/components/ui/PasswordInput';
import type { ProvisionRef } from '@/lib/services/org.service';

const input =
  'w-full rounded-[6px] border border-[var(--border)] bg-[var(--background)] px-2.5 py-1.5 text-[12px] font-mono focus:border-[var(--border-strong)] disabled:opacity-50';
const button =
  'rounded-[6px] border border-[var(--border-strong)] px-3 py-1.5 text-[12px] font-medium transition-colors hover:bg-[var(--surface-subtle)] disabled:opacity-50';
const buttonGhost =
  'rounded-[6px] border border-[var(--border)] px-3 py-1.5 text-[12px] font-medium text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--score-fail-text)] disabled:opacity-50';

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

function ResultLine({ state }: { state: ProvisionResult | null }) {
  if (!state) return null;
  if (state.ok) return <p role="status" className="text-[11px]" style={{ color: 'var(--score-pass-text)' }}>{state.message}</p>;
  return <p role="alert" className="text-[11px]" style={{ color: 'var(--score-fail-text)' }}>{state.error}</p>;
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

type Intent = 'test' | 'save' | 'clear';

const INTENT_LABEL: Record<Intent, string> = { test: 'Test', save: 'Save', clear: 'Clear' };
const INTENT_PENDING_LABEL: Record<Intent, string> = { test: 'Testing…', save: 'Saving…', clear: 'Disconnecting…' };

/** Confirms before a formAction actually submits -- Clear disconnects a live database, not a cosmetic reset. */
function confirmClear(e: React.MouseEvent<HTMLButtonElement>, what: string) {
  if (!confirm(`Disconnect ${what}? This app will stop using it until you reconnect — your actual database and its data are never touched.`)) {
    e.preventDefault();
  }
}

/** Test / Save / Clear as one submit each, sharing one intent-dispatched action so there is exactly one result to show. */
function IntentButtons({
  pending,
  activeIntent,
  showClear,
  clearLabel,
  onClearClick,
}: {
  pending: boolean;
  activeIntent: Intent | null;
  showClear: boolean;
  clearLabel: string;
  onClearClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  const label = (intent: Intent) => (pending && activeIntent === intent ? INTENT_PENDING_LABEL[intent] : INTENT_LABEL[intent]);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="submit" name="intent" value="test" disabled={pending} className={buttonGhost}>
        {label('test')}
      </button>
      <button type="submit" name="intent" value="save" disabled={pending} className={button}>
        {label('save')}
      </button>
      {showClear && (
        <button
          type="submit"
          name="intent"
          value="clear"
          disabled={pending}
          onClick={onClearClick}
          className={buttonGhost}
          title={clearLabel}
        >
          {label('clear')}
        </button>
      )}
    </div>
  );
}

function NeonPanel({ provision, canEdit }: { provision: ProvisionRef; canEdit: boolean }) {
  const [state, action, pending] = useActionState<ProvisionResult | null, FormData>(neonConnectionAction, null);
  const [activeIntent, setActiveIntent] = useState<Intent | null>(null);

  return (
    <form
      action={action}
      className="space-y-3"
      data-tour="neon-connection-form"
      onSubmit={(e) => {
        const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
        setActiveIntent((submitter?.value as Intent) ?? null);
      }}
    >
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

        <IntentButtons
          pending={pending}
          activeIntent={activeIntent}
          showClear={provision.hasNeonUrl}
          clearLabel="Disconnect this Neon database"
          onClearClick={(e) => confirmClear(e, 'the Neon database')}
        />
        <ResultLine state={state} />
      </fieldset>

      {!canEdit && <p className="text-[11px] text-[var(--muted)]">Only an admin can change this.</p>}
    </form>
  );
}

function D1Panel({ provision, canEdit }: { provision: ProvisionRef; canEdit: boolean }) {
  const [state, action, pending] = useActionState<ProvisionResult | null, FormData>(d1ConnectionAction, null);
  const [activeIntent, setActiveIntent] = useState<Intent | null>(null);

  return (
    <form
      action={action}
      className="space-y-3"
      onSubmit={(e) => {
        const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
        setActiveIntent((submitter?.value as Intent) ?? null);
      }}
    >
      <div className="flex items-center gap-2 text-[12px]">
        <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ background: provision.hasD1Credentials ? 'var(--score-pass-text)' : 'var(--muted)' }} />
        <span style={{ color: provision.hasD1Credentials ? 'var(--score-pass-text)' : 'var(--muted)' }}>
          {provision.hasD1Credentials ? 'Connected' : 'Not connected yet'}
        </span>
      </div>

      <fieldset disabled={!canEdit} className="space-y-3">
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

        <IntentButtons
          pending={pending}
          activeIntent={activeIntent}
          showClear={provision.hasD1Credentials}
          clearLabel="Disconnect this D1 database"
          onClearClick={(e) => confirmClear(e, 'the D1 database')}
        />
        <ResultLine state={state} />
      </fieldset>

      {!canEdit && <p className="text-[11px] text-[var(--muted)]">Only an admin can change this.</p>}
    </form>
  );
}

export function DatabaseConnectionForm({ provision, canEdit }: { provision: ProvisionRef; canEdit: boolean }) {
  return (
    <div className="space-y-5">
      <div>
        <h3 className="eyebrow mb-2">Neon Postgres</h3>
        <NeonPanel provision={provision} canEdit={canEdit} />
      </div>
      <div className="border-t border-[var(--border)] pt-4">
        <h3 className="eyebrow mb-2">Cloudflare D1</h3>
        <D1Panel provision={provision} canEdit={canEdit} />
      </div>
    </div>
  );
}
