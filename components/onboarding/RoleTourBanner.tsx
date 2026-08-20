'use client';

import { useState } from 'react';
import { dismissRoleTourAction } from '@/app/actions/onboarding';
import { ROLE_LABEL, type Role } from '@/lib/auth/roles';

/** What each role can concretely do, in the tool's own terms rather than the abstract capability names. */
const POINTS: Record<Role, string[]> = {
  viewer: [
    'Browse every section and page — scores, history and evidence.',
    'Download the .md report for any page.',
  ],
  editor: [
    'Everything a viewer can do.',
    'Run a check on any page or section from the Overview page.',
    'Rename or merge sections, and reorder the sweep.',
  ],
  developer: [
    'Everything an editor can do.',
    'See the raw PageSpeed JSON behind any report.',
    'Generate an MCP token in Settings → Profile for agent access.',
  ],
  admin: [
    'Everything a developer can do.',
    'Manage the schedule, the Google API key and teammates — all under Settings.',
  ],
};

/**
 * "Here's what your role can do" — shown once per person, ever, then gone
 * for good. Dismissed locally the instant it's clicked; a failed background
 * save just means it shows once more another day, which isn't worth a
 * revert path over.
 */
export function RoleTourBanner({ role }: { role: Role }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <section className="panel mb-6 overflow-hidden" aria-labelledby="role-tour-heading">
      <div className="flex items-start justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <h2 id="role-tour-heading" className="title-md">
            You&apos;re signed in as {ROLE_LABEL[role]}
          </h2>
          <ul className="mt-2 space-y-1 text-[12px] text-[var(--muted)]">
            {POINTS[role].map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
        <button
          type="button"
          onClick={() => {
            setDismissed(true);
            dismissRoleTourAction();
          }}
          className="shrink-0 rounded-[6px] border border-[var(--border-strong)] px-2.5 py-1 text-[11px] font-medium hover:bg-[var(--surface-subtle)]"
        >
          Got it
        </button>
      </div>
    </section>
  );
}
