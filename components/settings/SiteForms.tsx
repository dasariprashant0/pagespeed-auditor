'use client';

import { useActionState, useState } from 'react';
import { createSiteAction, updateSiteAction, updatePsiKeyAction } from '@/app/actions/site';
import { InfoTooltip } from '@/components/ui/InfoTooltip';
import type { SiteRef } from '@/lib/services/tenant.service';

type Result = { ok: true; message: string } | { ok: false; error: string } | null;

const input =
  'w-full rounded-[6px] border border-[var(--border)] bg-[var(--background)] px-2.5 py-1.5 text-[12px] focus:border-[var(--border-strong)]';
const button =
  'rounded-[6px] border border-[var(--border-strong)] px-3 py-1.5 text-[12px] font-medium transition-colors hover:bg-[var(--surface-subtle)] disabled:opacity-50';

function Notice({ state }: { state: Result }) {
  if (!state) return null;
  return (
    <p role={state.ok ? 'status' : 'alert'} className="text-[11px]"
      style={{ color: state.ok ? 'var(--score-pass-text)' : 'var(--score-fail-text)' }}>
      {state.ok ? state.message : state.error}
    </p>
  );
}

function Labelled({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="eyebrow mb-1 flex items-center gap-1">
        {label}
        {hint && <InfoTooltip text={hint} />}
      </span>
      {children}
    </label>
  );
}

export function AddSiteForm() {
  const [state, action, pending] = useActionState<Result, FormData>(createSiteAction, null);
  return (
    <form action={action} className="space-y-3">
      <Labelled label="Name"><input name="name" placeholder="Marketing site" className={input} /></Labelled>
      <Labelled label="Website address" hint="The homepage. Pages on other domains are ignored.">
        <input name="baseUrl" placeholder="https://example.com" className={input} />
      </Labelled>
      <Labelled label="Sitemap address" hint="Usually /sitemap.xml. A sitemap index is followed automatically.">
        <input name="sitemapUrl" placeholder="https://example.com/sitemap.xml" className={input} />
      </Labelled>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className={button}>{pending ? 'Adding…' : 'Add site'}</button>
        <Notice state={state} />
      </div>
    </form>
  );
}

export function EditSiteForm({ site }: { site: SiteRef }) {
  const [state, action, pending] = useActionState<Result, FormData>(updateSiteAction, null);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="siteId" value={site.id} />
      <Labelled label="Name"><input name="name" defaultValue={site.name} className={input} /></Labelled>
      <Labelled label="Website address"><input name="baseUrl" defaultValue={site.baseUrl} className={input} /></Labelled>
      <Labelled label="Sitemap address" hint="Changing this? Re-ingest afterwards so pages match.">
        <input name="sitemapUrl" defaultValue={site.sitemapUrl} className={input} />
      </Labelled>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className={button}>{pending ? 'Saving…' : 'Save'}</button>
        <Notice state={state} />
      </div>
    </form>
  );
}

export function PsiKeyForm({ site }: { site: SiteRef }) {
  const [state, action, pending] = useActionState<Result, FormData>(updatePsiKeyAction, null);
  const [touched, setTouched] = useState(false);

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="siteId" value={site.id} />
      <Labelled
        label="Google PageSpeed API key"
        hint="Checked against Google when you save, so a wrong key fails here rather than silently on every page of the next run."
      >
        <input
          name="psiApiKey"
          type={touched ? 'text' : 'password'}
          // The real key is never sent to the browser. An untouched field keeps
          // the stored value rather than overwriting it with these dots.
          defaultValue={site.hasPsiKey ? '••••••••••••' : ''}
          placeholder="AIza…"
          onFocus={() => setTouched(true)}
          className={`${input} font-mono`}
        />
      </Labelled>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={button}>
          {pending ? 'Checking with Google…' : 'Save key'}
        </button>
        <a
          href="https://developers.google.com/speed/docs/insights/v5/get-started"
          target="_blank" rel="noreferrer"
          className="text-[11px] text-[var(--muted)] underline-offset-2 hover:underline"
        >
          How to get one
        </a>
        <Notice state={state} />
      </div>
      {!site.hasPsiKey && (
        <p className="text-[11px]" style={{ color: 'var(--score-average-text)' }}>
          No key yet — audits cannot run until one is saved. It is free, and each organisation
          uses its own so you are not sharing anyone else&rsquo;s quota.
        </p>
      )}
    </form>
  );
}
