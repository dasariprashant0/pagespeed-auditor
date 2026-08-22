'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateProfileAction, changePasswordAction } from '@/app/actions/members';
import { reopenChecklistAction } from '@/app/actions/onboarding';
import { InfoTooltip } from '@/components/ui/InfoTooltip';
import { PasswordInput } from '@/components/ui/PasswordInput';
import { ROLE_DESCRIPTION, ROLE_LABEL, type Role } from '@/lib/auth/roles';

type Result = { ok: true; message: string } | { ok: false; error: string } | null;

function Notice({ state }: { state: Result }) {
  if (!state) return null;
  return (
    <p
      role={state.ok ? undefined : 'alert'}
      className="text-[11px]"
      style={{ color: state.ok ? 'var(--score-pass-text)' : 'var(--score-fail-text)' }}
    >
      {state.ok ? state.message : state.error}
    </p>
  );
}

const input =
  'w-full max-w-sm rounded-[5px] border border-[var(--border)] bg-[var(--background)] px-2.5 py-1.5 text-[12px]';
const button =
  'rounded-[5px] border border-[var(--border-strong)] px-3 py-1.5 text-[12px] font-medium hover:bg-[var(--surface-subtle)] disabled:opacity-50';

export function ProfileForms({
  email,
  name,
  role,
  organizationName,
}: {
  email: string;
  name: string | null;
  role: Role;
  organizationName: string;
}) {
  const [profile, saveProfile, savingProfile] = useActionState<Result, FormData>(updateProfileAction, null);
  const [pw, savePw, savingPw] = useActionState<Result, FormData>(changePasswordAction, null);
  const [reopening, startReopen] = useTransition();
  const [reopened, setReopened] = useState(false);
  const router = useRouter();

  return (
    <div className="max-w-2xl space-y-3">
      <section className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-4">
        <h2 className="mb-3 font-[family-name:var(--font-display)] text-[13px] font-medium">Your details</h2>
        <form action={saveProfile} className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">Name</span>
            <input name="name" defaultValue={name ?? ''} className={input} />
          </label>
          <label className="block">
            <span className="mb-1 flex items-center gap-1 text-[11px] text-[var(--muted)]">
              Email
              <InfoTooltip text="This is also your sign-in — changing it changes what you type on the login page next time." />
            </span>
            <input name="email" type="email" defaultValue={email} className={input} />
          </label>
          <div className="flex items-center gap-3">
            <button type="submit" disabled={savingProfile} className={button}>
              {savingProfile ? 'Saving…' : 'Save'}
            </button>
            <Notice state={profile} />
          </div>
        </form>
      </section>

      <section className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-4">
        <h2 className="mb-3 font-[family-name:var(--font-display)] text-[13px] font-medium">Password</h2>
        <form action={savePw} className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">Current password</span>
            <PasswordInput name="currentPassword" autoComplete="current-password" className={input} />
          </label>
          <label className="block">
            <span className="mb-1 flex items-center gap-1 text-[11px] text-[var(--muted)]">
              New password
              <InfoTooltip text="At least 12 characters. Any characters are fine — length matters more than complexity rules." />
            </span>
            <PasswordInput name="newPassword" autoComplete="new-password" className={input} />
          </label>
          <div className="flex items-center gap-3">
            <button type="submit" disabled={savingPw} className={button}>
              {savingPw ? 'Changing…' : 'Change password'}
            </button>
            <Notice state={pw} />
          </div>
        </form>
      </section>

      <section className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-4">
        <h2 className="mb-2 font-[family-name:var(--font-display)] text-[13px] font-medium">Your access</h2>
        <p className="text-[12px]">
          <strong>{ROLE_LABEL[role]}</strong> in {organizationName}
        </p>
        <p className="mt-1 text-[11px] text-[var(--muted)]">{ROLE_DESCRIPTION[role]}</p>
        {role !== 'admin' && (
          <p className="mt-2 text-[11px] text-[var(--muted)]">Only an admin can change this.</p>
        )}
      </section>

      <section className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-4">
        <h2 className="mb-2 font-[family-name:var(--font-display)] text-[13px] font-medium">Onboarding</h2>
        <p className="text-[11px] text-[var(--muted)]">
          Brings back the getting-started checklist if you hid it earlier.
        </p>
        <div className="mt-2 flex items-center gap-3">
          <button
            type="button"
            disabled={reopening}
            onClick={() =>
              startReopen(async () => {
                await reopenChecklistAction();
                setReopened(true);
                router.refresh();
              })
            }
            className={button}
          >
            {reopening ? 'Bringing it back…' : 'Show onboarding again'}
          </button>
          {reopened && <span className="text-[11px]" style={{ color: 'var(--score-pass-text)' }}>Done — check the bottom-left corner.</span>}
        </div>
      </section>
    </div>
  );
}
