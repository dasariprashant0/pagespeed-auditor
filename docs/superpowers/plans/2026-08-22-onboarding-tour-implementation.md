# Per-user Onboarding Tour Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the org-wide `SetupChecklist` and the per-user-global `RoleTourBanner` with one per-membership onboarding system: a floating, dismissible checklist plus an opportunistic tooltip tour, both tracked per (user, organization) so an invited teammate, a role change, or a remove-then-re-add all get treated correctly — and un-gate the six pages that currently hard-redirect unprovisioned organizations to `/settings/database`, so a brand-new admin can look around (with realistic placeholder data) instead of being walled off from everything else.

**Architecture:** Onboarding progress moves onto `Membership` (already the natural per-user-per-org row, already hard-deleted on removal). A single generic `demoAware()` helper wraps each real tenant-data read with a canned fallback for unprovisioned organizations, so the six previously-gated pages lose their redirect logic instead of gaining more of it. A client-side `TourEngine`, fed a server-computed list of remaining step IDs, opportunistically anchors tooltips to `data-tour` attributes already present wherever a page renders.

**Tech Stack:** Same as the rest of the app — Next.js 16 App Router, Prisma 7 (central schema), React 19 (`useActionState`, Context for the tour), Tailwind v4 tokens already established in `app/globals.css`.

**Spec:** `docs/superpowers/specs/2026-08-22-onboarding-tour-design.md` — read it first; this plan implements it section by section (A→G below map to the spec's A→F plus the demo-data discovery made while planning, noted in Task 7).

## Global Constraints

- **No behavior change to anyone already past onboarding.** A membership whose `tourStepsSeen` already covers every currently-applicable step must render identically to today — this is additive plumbing, not a redesign of any existing page's real-data rendering path.
- **`Membership.tourStepsSeen`/`checklistDismissedAt` only ever grow/reset via the mechanisms in the spec** (seen-on-dismiss, hard-delete-on-remove) — no other code may write these fields.
- **Demo-mode fallback must only ever trigger on `NotProvisionedError`**, never on a genuine, unexpected failure — `demoAware()`'s catch must re-throw anything else.
- **Every settings/action mutation still requires its real capability** (`org:provision`, `automation:manage`, etc.) exactly as today; onboarding-dismissal actions require only `requireSession()` (spec, section B).
- **Framework-free zone unchanged**: nothing new under `lib/services/`, `lib/psi/`, `lib/report/`, `lib/sitemap/` may import `next/*`/`react`/`server-only`. New onboarding logic in `lib/onboarding/` is NOT in that list and may use them where needed (the tour catalog itself is pure data; wrapper functions that call `redirect`-free service functions stay framework-free too, by construction).
- **Verify before claiming**: `npx tsc --noEmit && npm run lint && npm test` after every task, quoted output, not asserted.
- **Out of scope for this plan, deliberately** (per the spec's own phasing note): the simulated *interactive* audit run in demo mode (a fake progress animation + canned result reveal). This plan's demo mode is realistic but **not yet clickable for that one action** — the "Measure all" / "Run audit" buttons on group and page-report pages should be disabled with an explanatory tooltip while in demo mode (Task 7), not wired to a fake pipeline. That's real, separate engineering work sized into its own follow-up plan once this ships and is verified.

---

### Task 1: Schema change — retire the per-user global role tour, add per-membership onboarding fields

**Files:**
- Modify: `prisma/central/schema.prisma`
- Create: a new migration under `prisma/central/migrations/`
- Modify: `lib/services/account.service.ts` (remove `hasSeenRoleTour`/`roleTourSeenAt`, remove `markRoleTourSeen`)
- Modify: `app/actions/onboarding.ts` (remove `dismissRoleTourAction` — replaced in Task 3)
- Delete: `components/onboarding/RoleTourBanner.tsx`
- Modify: `app/(dash)/page.tsx` (remove both `RoleTourBanner` render sites and the `hasSeenRoleTour` check — the checklist/tour replacing it lands in Tasks 4-6; for this task, just remove the dead code cleanly)

**Interfaces:**
- Produces: `Membership.tourStepsSeen: string[]` (default `[]`), `Membership.checklistDismissedAt: DateTime?`. `SessionContext` (account.service.ts) drops the `hasSeenRoleTour` field entirely.

- [ ] **Step 1: Schema fields**
  ```prisma
  // prisma/central/schema.prisma -- Membership model
  model Membership {
    id             String       @id @default(cuid())
    userId         String
    user           User         @relation(fields: [userId], references: [id], onDelete: Cascade)
    organizationId String
    organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
    role           String       @default("viewer")
    createdAt      DateTime     @default(now())
    tourStepsSeen        String[]  @default([])
    checklistDismissedAt DateTime?

    @@unique([userId, organizationId])
    @@index([organizationId])
  }
  ```
  Remove `roleTourSeenAt DateTime?` from `User`.

- [ ] **Step 2: Migration**
  ```bash
  npx prisma migrate dev --name membership_onboarding_fields
  ```
  (Needs a real local Postgres — this repo's own convention, `docker-compose.dev.yml`'s `pagespeed-auditor-postgres-1` container, already has one; run against a throwaway database or the existing dev one per the repo's usual `db:migrate` flow. If no local Postgres is reachable in the environment executing this task, hand-author the migration SQL following the exact shape Prisma would generate — `ALTER TABLE "Membership" ADD COLUMN "tourStepsSeen" TEXT[] NOT NULL DEFAULT '{}'; ALTER TABLE "Membership" ADD COLUMN "checklistDismissedAt" TIMESTAMP(3); ALTER TABLE "User" DROP COLUMN "roleTourSeenAt";` — and verify it applies cleanly against a real throwaway database before this task is considered done, the same way earlier phases in this project have verified schema changes for real rather than trusting the generated SQL blind.)

- [ ] **Step 3: `lib/services/account.service.ts`**
  ```ts
  // was:
  export interface SessionContext {
    userId: string;
    email: string;
    name: string | null;
    organizationId: string;
    organizationName: string;
    role: Role;
    /** Whether the "here's what your role can do" banner has been dismissed. */
    hasSeenRoleTour: boolean;
  }
  // now:
  export interface SessionContext {
    userId: string;
    email: string;
    name: string | null;
    organizationId: string;
    organizationName: string;
    role: Role;
  }
  ```
  Remove the `hasSeenRoleTour: user.roleTourSeenAt !== null` line from all three call sites that build a `SessionContext` (`login`, `loginWithGoogle`, `contextFor` — grep the file for `hasSeenRoleTour` to find all three; also drop `roleTourSeenAt` from each of their `select` clauses). Delete the `markRoleTourSeen` function entirely.

- [ ] **Step 4: `app/actions/onboarding.ts`**

  Delete the file's current content (`dismissRoleTourAction`) — Task 3 rewrites this file with the new actions. For this task, it's fine to leave the file empty with just `'use server';` as a placeholder, since Task 3 lands immediately after in the same implementation pass; if this task is reviewed on its own before Task 3, note that any import of `dismissRoleTourAction` elsewhere (there's exactly one: `components/onboarding/RoleTourBanner.tsx`, deleted in this same task) is why removing this now doesn't break the build.

- [ ] **Step 5: Delete `components/onboarding/RoleTourBanner.tsx`**

- [ ] **Step 6: `app/(dash)/page.tsx`**

  Remove both `{!ctx.hasSeenRoleTour && <RoleTourBanner role={ctx.role} />}` render sites and the `import { RoleTourBanner } from '@/components/onboarding/RoleTourBanner';` line. Leave everything else in this file untouched — Tasks 4-6 will add the new floating widget elsewhere (mounted once in the layout, not per-page), so this page needs no replacement render for what it's losing.

- [ ] **Step 7: Verify and commit**
  ```bash
  npx tsc --noEmit && npm run lint && npm test
  ```
  Expect new compile errors anywhere else `hasSeenRoleTour`/`markRoleTourSeen`/`RoleTourBanner`/`dismissRoleTourAction` were referenced (there shouldn't be any beyond what this task already touched — if there are, that's a real file this plan's research missed; fix it as part of this task).
  ```bash
  git add prisma/central/schema.prisma prisma/central/migrations lib/services/account.service.ts app/actions/onboarding.ts "app/(dash)/page.tsx"
  git rm components/onboarding/RoleTourBanner.tsx
  git commit -m "onboarding: retire per-user-global role tour, add per-membership onboarding fields"
  ```

---

### Task 2: Tour step catalog and progress computation

**Files:**
- Create: `lib/onboarding/tourSteps.ts`
- Create: `lib/onboarding/tourProgress.ts`
- Create: `test/tourProgress.test.ts`

**Interfaces:**
- Produces:
  - `interface TourStep { id: string; route: string; targetSelector: string; title: string; body: string; requiredCapability: Capability | null }`
  - `export const TOUR_STEPS: TourStep[]`
  - `remainingTourSteps(role: Role, seen: string[]): TourStep[]` — pure function: every step in `TOUR_STEPS` whose `requiredCapability` is `null` or satisfied by `role` (via `can()` from `lib/auth/roles.ts`), minus anything already in `seen`.

- [ ] **Step 1: The catalog**

  A first meaningful set, per the spec's explicit phasing note (full coverage of every UI element is future content work, not this task). Every role sees the first two; the rest are role-gated to match what that role can actually do, matching `RoleTourBanner`'s retired content:

  ```ts
  // lib/onboarding/tourSteps.ts
  import type { Capability } from '../auth/roles.ts';

  export interface TourStep {
    id: string;
    route: string;
    targetSelector: string;
    title: string;
    body: string;
    requiredCapability: Capability | null;
  }

  export const TOUR_STEPS: TourStep[] = [
    {
      id: 'overview-sections',
      route: '/',
      targetSelector: 'section-grid',
      title: 'Every section, in sweep order',
      body: 'Each card is one part of your site. Drag to reorder — this is the order the next full sweep measures things in.',
      requiredCapability: null,
    },
    {
      id: 'overview-charts',
      route: '/',
      targetSelector: 'overview-charts',
      title: "Your site's shape, not just one number",
      body: 'Switch views to see the ten-point spread, section averages, or load time against score.',
      requiredCapability: null,
    },
    {
      id: 'group-run-audit',
      route: '/g/[slug]',
      targetSelector: 'run-audit-button',
      title: 'Measure a section on demand',
      body: "Don't wait for the weekly sweep — check a section right after you ship a fix.",
      requiredCapability: 'audits:run',
    },
    {
      id: 'report-recommendation',
      route: '/p/[pageId]',
      targetSelector: 'recommendation-panel',
      title: 'Ask what to fix first',
      body: 'Generates a specific, evidence-based answer from this exact report — not generic PageSpeed advice.',
      requiredCapability: 'recommendations:generate',
    },
    {
      id: 'report-raw-json',
      route: '/p/[pageId]',
      targetSelector: 'raw-json-toggle',
      title: 'The real PageSpeed JSON',
      body: "Everything this report is built from, if you'd rather read the source than the summary.",
      requiredCapability: 'developer:raw_json',
    },
    {
      id: 'settings-team',
      route: '/settings/team',
      targetSelector: 'invite-form',
      title: 'Bring your team in',
      body: 'Invite by email, pick a role — viewer, editor, developer, or admin — and revoke access any time.',
      requiredCapability: 'members:manage',
    },
    {
      id: 'settings-automation',
      route: '/settings/automation',
      targetSelector: 'schedule-form',
      title: 'Turn scores into a trend',
      body: 'A weekly sweep is what makes "did this get better" answerable instead of a one-off snapshot.',
      requiredCapability: 'automation:manage',
    },
    {
      id: 'settings-database',
      route: '/settings/database',
      targetSelector: 'neon-connection-form',
      title: 'Your own database, your own quota',
      body: "Free to create on Neon and Cloudflare D1, and this organisation's usage is never on our bill.",
      requiredCapability: 'org:provision',
    },
  ];
  ```
  (Check `lib/auth/roles.ts`'s actual `Capability` union for the exact literal names — `developer:raw_json`/`recommendations:generate`/`automation:manage`/`members:manage`/`org:provision`/`audits:run` are used elsewhere in this codebase already; confirm each spelling against the real file rather than trusting this list blind, since a typo'd capability string silently makes a step never show for anyone.)

- [ ] **Step 2: `remainingTourSteps`**
  ```ts
  // lib/onboarding/tourProgress.ts
  import { can, type Role } from '../auth/roles.ts';
  import { TOUR_STEPS, type TourStep } from './tourSteps.ts';

  export function remainingTourSteps(role: Role, seen: string[]): TourStep[] {
    const seenSet = new Set(seen);
    return TOUR_STEPS.filter(
      (step) => (step.requiredCapability === null || can(role, step.requiredCapability)) && !seenSet.has(step.id),
    );
  }

  /** Every step CURRENTLY applicable to this role, seen or not -- what "skip the whole tour" marks seen in one write. */
  export function applicableTourStepIds(role: Role): string[] {
    return TOUR_STEPS.filter((step) => step.requiredCapability === null || can(role, step.requiredCapability)).map((s) => s.id);
  }
  ```

- [ ] **Step 3: Tests**

  `test/tourProgress.test.ts`, following this repo's plain `node --test` convention (no fixtures needed — pure functions over the real catalog):
  ```ts
  import { test, describe } from 'node:test';
  import assert from 'node:assert/strict';
  import { remainingTourSteps, applicableTourStepIds } from '../lib/onboarding/tourProgress.ts';
  import { TOUR_STEPS } from '../lib/onboarding/tourSteps.ts';

  describe('remainingTourSteps', () => {
    test('a brand-new viewer sees every viewer-visible step', () => {
      const remaining = remainingTourSteps('viewer', []);
      assert.ok(remaining.some((s) => s.id === 'overview-sections'));
      assert.ok(!remaining.some((s) => s.id === 'settings-database')); // admin-only
    });

    test('a step already in seen[] does not reappear', () => {
      const remaining = remainingTourSteps('admin', ['overview-sections']);
      assert.ok(!remaining.some((s) => s.id === 'overview-sections'));
    });

    test('promoting a viewer to admin surfaces admin-only steps without needing seen[] reset', () => {
      const seenAsViewer = TOUR_STEPS.filter((s) => s.requiredCapability === null).map((s) => s.id);
      const remaining = remainingTourSteps('admin', seenAsViewer);
      assert.ok(remaining.some((s) => s.id === 'settings-database'));
      assert.ok(!remaining.some((s) => seenAsViewer.includes(s.id)));
    });

    test('a demoted role does not re-show a step already seen under a higher role', () => {
      const remaining = remainingTourSteps('viewer', ['settings-database']);
      assert.ok(!remaining.some((s) => s.id === 'settings-database'));
    });
  });

  describe('applicableTourStepIds', () => {
    test('only returns ids this role can currently reach', () => {
      const ids = applicableTourStepIds('viewer');
      assert.ok(!ids.includes('settings-database'));
    });
  });
  ```

- [ ] **Step 4: Verify and commit**
  ```bash
  npx tsc --noEmit && npm run lint && npm test
  git add lib/onboarding/tourSteps.ts lib/onboarding/tourProgress.ts test/tourProgress.test.ts
  git commit -m "onboarding: tour step catalog and per-role remaining-steps computation"
  ```

---

### Task 3: Server Actions for the tour and checklist

**Files:**
- Modify: `app/actions/onboarding.ts` (real content, replacing Task 1's placeholder)

**Interfaces:**
- Produces: `markTourStepSeenAction(stepId: string): Promise<void>`, `skipTourAction(): Promise<void>`, `dismissChecklistAction(): Promise<void>`, `reopenChecklistAction(): Promise<void>`.

- [ ] **Step 1: Implement**
  ```ts
  'use server';

  import { revalidatePath } from 'next/cache';
  import { requireSession } from '@/lib/http/auth-guard';
  import { centralPrisma } from '@/lib/db/central';
  import { applicableTourStepIds } from '@/lib/onboarding/tourProgress';

  /**
   * Every one of these requires only a session, not a specific capability --
   * dismissing your own onboarding view is not an org-admin action, per
   * docs/superpowers/specs/2026-08-22-onboarding-tour-design.md section B.
   */

  /** Idempotent: a duplicate id in the array changes nothing observable, since remainingTourSteps() dedupes via a Set. */
  export async function markTourStepSeenAction(stepId: string): Promise<void> {
    const ctx = await requireSession();
    await centralPrisma.membership.updateMany({
      where: { userId: ctx.userId, organizationId: ctx.organizationId },
      data: { tourStepsSeen: { push: stepId } },
    });
  }

  /** Marks every CURRENTLY applicable step seen in one write -- not the whole catalog, so a later role change still surfaces what it newly unlocks. */
  export async function skipTourAction(): Promise<void> {
    const ctx = await requireSession();
    await centralPrisma.membership.updateMany({
      where: { userId: ctx.userId, organizationId: ctx.organizationId },
      data: { tourStepsSeen: applicableTourStepIds(ctx.role) },
    });
    revalidatePath('/', 'layout');
  }

  export async function dismissChecklistAction(): Promise<void> {
    const ctx = await requireSession();
    await centralPrisma.membership.updateMany({
      where: { userId: ctx.userId, organizationId: ctx.organizationId },
      data: { checklistDismissedAt: new Date() },
    });
    revalidatePath('/', 'layout');
  }

  export async function reopenChecklistAction(): Promise<void> {
    const ctx = await requireSession();
    await centralPrisma.membership.updateMany({
      where: { userId: ctx.userId, organizationId: ctx.organizationId },
      data: { checklistDismissedAt: null },
    });
    revalidatePath('/', 'layout');
  }
  ```
  Note: `updateMany` (not `update`) because `Membership` has no natural single-field unique key exposed here other than its own `id`, which `ctx` doesn't carry — `where: { userId, organizationId }` matches the `@@unique([userId, organizationId])` constraint's two fields directly and is exactly the pattern several other files in this codebase already use for the same reason (e.g. `app/actions/members.ts`'s `changeRoleAction`). `tourStepsSeen: { push: stepId }` is Prisma's atomic array-append — confirm this exact syntax against the installed Prisma version's scalar-list update API before relying on it; if unavailable, fall back to a read-modify-write (`findUnique` the current array, dedupe-append client-side, `update` with the full new array) inside a transaction.

- [ ] **Step 2: Verify and commit**
  ```bash
  npx tsc --noEmit && npm run lint && npm test
  git add app/actions/onboarding.ts
  git commit -m "onboarding: server actions for marking tour steps seen, skip, dismiss/reopen checklist"
  ```

---

### Task 4: `TourEngine` — the opportunistic client-side tooltip renderer

**Files:**
- Create: `components/onboarding/TourProvider.tsx`
- Create: `components/onboarding/TourEngine.tsx`
- Create: `components/onboarding/TourTooltip.tsx`

**Interfaces:**
- Consumes: `remainingTourSteps` output (an array of `TourStep`, computed server-side and passed as a prop from the layout in Task 6), `markTourStepSeenAction`/`skipTourAction` from Task 3.
- Produces: `<TourProvider steps={TourStep[]}>` (context provider, wraps `<AppShell>`), `<TourEngine />` (mounted once inside the provider, renders nothing itself besides the active tooltip).

- [ ] **Step 1: `TourProvider` — client context holding the remaining-steps list and exposing dismiss/skip**
  ```tsx
  'use client';
  import { createContext, useContext, useState, useCallback } from 'react';
  import { markTourStepSeenAction, skipTourAction } from '@/app/actions/onboarding';
  import type { TourStep } from '@/lib/onboarding/tourSteps';

  interface TourContextValue {
    remaining: TourStep[];
    dismissStep: (stepId: string) => void;
    skipAll: () => void;
  }

  const TourContext = createContext<TourContextValue | null>(null);

  export function useTour(): TourContextValue | null {
    return useContext(TourContext);
  }

  export function TourProvider({ steps, children }: { steps: TourStep[]; children: React.ReactNode }) {
    const [remaining, setRemaining] = useState(steps);

    const dismissStep = useCallback((stepId: string) => {
      setRemaining((prev) => prev.filter((s) => s.id !== stepId));
      markTourStepSeenAction(stepId); // fire-and-forget: a failed background save just means it can show once more later, not worth blocking the UI over
    }, []);

    const skipAll = useCallback(() => {
      setRemaining([]);
      skipTourAction();
    }, []);

    return <TourContext.Provider value={{ remaining, dismissStep, skipAll }}>{children}</TourContext.Provider>;
  }
  ```

- [ ] **Step 2: `TourEngine` — finds the first remaining step whose target exists on the current route, renders its tooltip**
  ```tsx
  'use client';
  import { useEffect, useState } from 'react';
  import { usePathname } from 'next/navigation';
  import { useTour } from './TourProvider';
  import { TourTooltip } from './TourTooltip';
  import type { TourStep } from '@/lib/onboarding/tourSteps';

  /** '/g/[slug]' matches '/g/blog', etc. -- one dynamic segment per bracket pair, same shape every route in this app already uses. */
  function routeMatches(pattern: string, pathname: string): boolean {
    const patternParts = pattern.split('/');
    const pathParts = pathname.split('/');
    if (patternParts.length !== pathParts.length) return false;
    return patternParts.every((part, i) => part.startsWith('[') || part === pathParts[i]);
  }

  export function TourEngine() {
    const tour = useTour();
    const pathname = usePathname();
    const [active, setActive] = useState<{ step: TourStep; el: Element } | null>(null);

    useEffect(() => {
      if (!tour) return;
      const candidate = tour.remaining.find((s) => routeMatches(s.route, pathname));
      if (!candidate) {
        setActive(null);
        return;
      }
      const el = document.querySelector(`[data-tour="${candidate.id}"]`);
      setActive(el ? { step: candidate, el } : null);
      // Re-checks on every remaining-list change and on route change; a target
      // that hasn't rendered yet (still streaming) simply shows nothing this
      // pass rather than erroring or retrying aggressively -- the next
      // navigation or remaining-list update re-runs this effect.
    }, [tour?.remaining, pathname]);

    if (!tour || !active) return null;
    return (
      <TourTooltip
        step={active.step}
        anchor={active.el}
        onNext={() => tour.dismissStep(active.step.id)}
      />
    );
  }
  ```

- [ ] **Step 3: `TourTooltip` — positioned popover, accessible**
  ```tsx
  'use client';
  import { useEffect, useState } from 'react';
  import type { TourStep } from '@/lib/onboarding/tourSteps';

  export function TourTooltip({ step, anchor, onNext }: { step: TourStep; anchor: Element; onNext: () => void }) {
    const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

    useEffect(() => {
      const rect = anchor.getBoundingClientRect();
      setPos({ top: rect.bottom + window.scrollY + 8, left: rect.left + window.scrollX });
    }, [anchor]);

    useEffect(() => {
      function onKey(e: KeyboardEvent) {
        if (e.key === 'Escape') onNext();
      }
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, [onNext]);

    if (!pos) return null;

    return (
      <div
        role="dialog"
        aria-live="polite"
        aria-label={step.title}
        className="panel fixed z-50 w-72 p-3 shadow-lg"
        style={{ top: pos.top, left: pos.left }}
      >
        <h3 className="title-sm">{step.title}</h3>
        <p className="mt-1 text-[12px] text-[var(--muted)]">{step.body}</p>
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={onNext}
            className="rounded-[6px] border border-[var(--border-strong)] px-3 py-1.5 text-[12px] font-medium hover:bg-[var(--surface-subtle)]"
          >
            Got it
          </button>
        </div>
      </div>
    );
  }
  ```
  ("Got it" serves as both Next and Skip-this-one per the spec's Skip semantics note — there is no separate button, since dismissing one tooltip always means the same thing: mark this step seen, move to whatever's next. A distinct "skip the whole tour" affordance belongs on the floating checklist widget, Task 6, not on individual tooltips.)

- [ ] **Step 4: Verify and commit** (no automated test for this task — it's DOM-positioning logic that needs a real browser; note this honestly rather than fabricate a jsdom test this repo has no existing convention for)
  ```bash
  npx tsc --noEmit && npm run lint && npm test
  git add components/onboarding/TourProvider.tsx components/onboarding/TourEngine.tsx components/onboarding/TourTooltip.tsx
  git commit -m "onboarding: opportunistic tour engine -- provider, DOM-anchored engine, tooltip"
  ```

---

### Task 5: `data-tour` attributes on the initial step targets

**Files:**
- Modify: `components/nav/SectionGrid.tsx` (or wherever the section grid's root renders — confirm exact file), `components/charts/OverviewCharts.tsx`, `components/runs/RunAuditButton.tsx`, `components/recommendation/RecommendationPanel.tsx` (confirm real name), the raw-JSON toggle component on the page report, `components/settings/TeamManager.tsx`'s invite form, `components/settings/ScheduleForm.tsx`, `components/settings/DatabaseConnectionForm.tsx`'s Neon panel.

**Interfaces:**
- Consumes: the `targetSelector` strings from Task 2's `TOUR_STEPS` catalog (`section-grid`, `overview-charts`, `run-audit-button`, `recommendation-panel`, `raw-json-toggle`, `invite-form`, `schedule-form`, `neon-connection-form`).

- [ ] **Step 1: Add one `data-tour="<id>"` attribute per target**

  For each of the 8 catalog entries, find the actual root element of the component it names (read the real file first — several of these component names in Task 2's catalog are best guesses at this plan-writing time, not confirmed against the live file tree) and add `data-tour="<matching-id>"` to its outermost rendered element. This is a one-line, additive change per file — do not restructure any of these components otherwise.

- [ ] **Step 2: Verify and commit**
  ```bash
  npx tsc --noEmit && npm run lint && npm test
  git add -A
  git commit -m "onboarding: data-tour anchors on the first 8 tour targets"
  ```

---

### Task 6: The floating checklist widget, and wiring the tour into the layout

**Files:**
- Create: `components/onboarding/FloatingChecklist.tsx`
- Modify: `app/(dash)/layout.tsx` (mount `TourProvider`/`TourEngine`/`FloatingChecklist`, compute and pass `remainingTourSteps`)
- Modify: `app/(dash)/settings/profile/page.tsx` (add a "Show onboarding" control calling `reopenChecklistAction`)

**Interfaces:**
- Consumes: `onboardingState()` (unchanged, `lib/services/onboarding.service.ts`), `remainingTourSteps()` (Task 2), `dismissChecklistAction`/`reopenChecklistAction` (Task 3).
- Produces: `<FloatingChecklist orgSteps={OnboardingState} tourAreas={{label, href}[]} dismissed={boolean} />`.

- [ ] **Step 1: `FloatingChecklist`**
  ```tsx
  'use client';
  import { useState } from 'react';
  import Link from 'next/link';
  import { dismissChecklistAction, skipTourAction } from '@/app/actions/onboarding';
  import type { OnboardingState } from '@/lib/services/onboarding.service';

  export function FloatingChecklist({
    orgSteps,
    tourAreaCount,
    initiallyDismissed,
  }: {
    orgSteps: OnboardingState;
    tourAreaCount: number;
    initiallyDismissed: boolean;
  }) {
    const [dismissed, setDismissed] = useState(initiallyDismissed);
    const [collapsed, setCollapsed] = useState(false); // mobile: icon-only
    if (dismissed) return null;
    if (orgSteps.complete && tourAreaCount === 0) return null;

    return (
      <div className="fixed bottom-4 left-4 z-40 max-w-[260px]">
        {collapsed ? (
          <button
            type="button"
            aria-label="Show onboarding checklist"
            onClick={() => setCollapsed(false)}
            className="panel flex h-10 w-10 items-center justify-center rounded-full text-[16px] sm:hidden"
          >
            ✓
          </button>
        ) : (
          <div className="panel p-3 shadow-lg">
            <div className="flex items-center justify-between gap-2">
              <span className="eyebrow">Getting set up</span>
              <button
                type="button"
                aria-label="Collapse"
                onClick={() => setCollapsed(true)}
                className="text-[11px] text-[var(--muted)] hover:text-[var(--foreground)] sm:hidden"
              >
                ‒
              </button>
            </div>
            <ol className="mt-2 space-y-1 text-[12px]">
              {orgSteps.steps.filter((s) => !s.done).map((s) => (
                <li key={s.id}>
                  <Link href={s.href} className="text-[var(--link)] hover:underline">{s.cta}</Link>
                </li>
              ))}
            </ol>
            {tourAreaCount > 0 && (
              <p className="mt-2 text-[11px] text-[var(--muted)]">{tourAreaCount} more area{tourAreaCount === 1 ? '' : 's'} to see — keep clicking around, tooltips will point them out.</p>
            )}
            <div className="mt-2 flex gap-3 text-[11px]">
              <button
                type="button"
                onClick={() => { setDismissed(true); dismissChecklistAction(); }}
                className="text-[var(--muted)] hover:text-[var(--foreground)]"
              >
                Hide
              </button>
              <button
                type="button"
                onClick={() => { setDismissed(true); skipTourAction(); }}
                className="text-[var(--muted)] hover:text-[var(--foreground)]"
              >
                Skip the tour
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }
  ```

- [ ] **Step 2: Wire into the layout**

  `app/(dash)/layout.tsx` already resolves `ctx`. Add, alongside the existing `defaultSite`/`listGroupsWithAggregates` calls (which Task 7 will make demo-aware — for THIS task, assume they still throw/redirect exactly as today, since Task 7 lands after):
  ```ts
  import { centralPrisma } from '@/lib/db/central';
  import { onboardingState } from '@/lib/services/onboarding.service';
  import { remainingTourSteps } from '@/lib/onboarding/tourProgress';
  import { TourProvider } from '@/components/onboarding/TourProvider';
  import { TourEngine } from '@/components/onboarding/TourEngine';
  import { FloatingChecklist } from '@/components/onboarding/FloatingChecklist';

  // ...inside DashLayout, after ctx is resolved:
  const membership = await centralPrisma.membership.findUnique({
    where: { userId_organizationId: { userId: ctx.userId, organizationId: ctx.organizationId } },
    select: { tourStepsSeen: true, checklistDismissedAt: true },
  });
  const remaining = remainingTourSteps(ctx.role, membership?.tourStepsSeen ?? []);
  const setup = await onboardingState(ctx.organizationId);
  ```
  Confirm the exact compound-unique-key field name Prisma generates for `@@unique([userId, organizationId])` (`userId_organizationId` is Prisma's default naming for an unnamed composite unique — verify against the generated client's types rather than assuming). Wrap the existing `<AppShell>` return with:
  ```tsx
  <TourProvider steps={remaining}>
    <AppShell ...>
      {children}
    </AppShell>
    <TourEngine />
    <FloatingChecklist
      orgSteps={setup}
      tourAreaCount={remaining.length}
      initiallyDismissed={membership?.checklistDismissedAt !== null && membership?.checklistDismissedAt !== undefined}
    />
  </TourProvider>
  ```

- [ ] **Step 3: "Show onboarding" in Settings → Profile**

  Read `app/(dash)/settings/profile/page.tsx` first to match its existing section style, then add a small section with a button calling `reopenChecklistAction` (a plain button wired the same way `TeamManager`'s other action buttons already are in this codebase — `useTransition` + `router.refresh()` on success, matching the established pattern rather than inventing a new one).

- [ ] **Step 4: Verify and commit**
  ```bash
  npx tsc --noEmit && npm run lint && npm test
  git add -A
  git commit -m "onboarding: floating checklist widget, wired into the dash layout and settings profile"
  ```

---

### Task 7: Demo-aware data for unprovisioned organizations; un-gate the six redirects

This is the task that grew in scope during planning (see the plan's own research above): three of the six currently-gated pages read tenant data via raw `getTenantPrisma` queries, not only named service functions, so a generic "fake Prisma client" would be its own large undertaking. Instead: one generic wrapper, plus a small number of purpose-built canned reads for the few raw-query cases.

**Files:**
- Create: `lib/onboarding/demoData.ts` (the canned fixture)
- Create: `lib/onboarding/demoTenant.ts` (the wrapper functions)
- Modify: `app/(dash)/layout.tsx`, `app/(dash)/page.tsx`, `app/(dash)/g/[slug]/page.tsx`, `app/(dash)/p/[pageId]/page.tsx`, `app/(dash)/settings/automation/page.tsx`, `app/(dash)/settings/site/page.tsx`, `app/(dash)/settings/notifications/page.tsx`

**Interfaces:**
- Produces: `demoAware<T>(real: () => Promise<T>, demo: T): Promise<T>`, plus one demo-aware wrapper per real function these pages call: `demoAwareDefaultSite`, `demoAwareRequireGroupAccess`, `demoAwareRequirePageAccess`, `demoAwareListGroupsWithAggregates`, `demoAwareListPagesInGroup`, `demoAwareGetPageReport`, `demoAwareRegressionsForPage`, `demoAwareGetSiteSummary`, `demoAwareGetTopIssues`, `demoAwareEstimateRun`, `demoAwareOnboardingState`, `demoAwareListSites`, `demoAwareScheduleAutomationData` (bundles the automation page's `schedule`/`recentRuns` raw reads), `demoAwareNotificationSetting`, `demoAwareHistoryOverview` (settings/site page's raw read — confirm its exact real signature in `lib/services/retention.service.ts` before wrapping).

- [ ] **Step 1: The canned fixture**
  ```ts
  // lib/onboarding/demoData.ts
  /**
   * What an unprovisioned organization sees instead of a real, empty (or
   * absent) database -- realistic enough that the tour has something to
   * point at, per docs/superpowers/specs/2026-08-22-onboarding-tour-design.md
   * section D. Never persisted anywhere; these are plain in-memory objects
   * shaped to match what the real service functions return, not real rows.
   */
  export const DEMO_SITE = {
    id: 'demo-site',
    name: 'sample-site.com',
    baseUrl: 'https://sample-site.com',
    sitemapUrl: 'https://sample-site.com/sitemap.xml',
    organizationId: 'demo',
    hasPsiKey: true,
  };

  export const DEMO_GROUPS = [
    { id: 'demo-group-home', slug: 'home', name: 'Home', pageCount: 1, auditedCount: 1, aggregate: { performance: 78, accessibility: 94, bestPractices: 88, seo: 96 }, worstPerformance: 78 },
    { id: 'demo-group-blog', slug: 'blog', name: 'Blog', pageCount: 12, auditedCount: 12, aggregate: { performance: 62, accessibility: 90, bestPractices: 85, seo: 91 }, worstPerformance: 41 },
    { id: 'demo-group-pricing', slug: 'pricing', name: 'Pricing', pageCount: 1, auditedCount: 1, aggregate: { performance: 88, accessibility: 97, bestPractices: 92, seo: 98 }, worstPerformance: 88 },
  ];

  export const DEMO_PAGES_BY_GROUP: Record<string, Array<{ id: string; path: string; url: string; scores: { performance: number | null; accessibility: number | null; bestPractices: number | null; seo: number | null }; lcp: number | null; cls: number | null; hasError: boolean }>> = {
    'demo-group-home': [{ id: 'demo-page-home', path: '/', url: 'https://sample-site.com/', scores: { performance: 78, accessibility: 94, bestPractices: 88, seo: 96 }, lcp: 2.1, cls: 0.04, hasError: false }],
    'demo-group-blog': Array.from({ length: 12 }, (_, i) => ({
      id: `demo-page-blog-${i}`,
      path: `/blog/post-${i + 1}`,
      url: `https://sample-site.com/blog/post-${i + 1}`,
      scores: { performance: 55 + (i % 4) * 8, accessibility: 88 + (i % 3), bestPractices: 82 + (i % 5), seo: 89 + (i % 4) },
      lcp: 2.4 + (i % 3) * 0.6,
      cls: 0.03 + (i % 4) * 0.01,
      hasError: i === 4,
    })),
    'demo-group-pricing': [{ id: 'demo-page-pricing', path: '/pricing', url: 'https://sample-site.com/pricing', scores: { performance: 88, accessibility: 97, bestPractices: 92, seo: 98 }, lcp: 1.6, cls: 0.01, hasError: false }],
  };

  export const DEMO_ONBOARDING_STATE = {
    complete: false,
    completedCount: 0,
    siteId: null,
    steps: [
      { id: 'site' as const, title: 'Add your website', detail: 'The address of the site and its sitemap.', done: false, href: '/settings/database', cta: 'Connect your database first' },
      { id: 'key' as const, title: 'Connect a Google API key', detail: 'Google does the measuring. The key is free and takes a minute to create.', done: false, href: '/settings/site', cta: 'Add key' },
      { id: 'pages' as const, title: 'Read the sitemap', detail: 'Finds every page and sorts them into sections automatically.', done: false, href: '/settings/site', cta: 'Read sitemap' },
      { id: 'firstAudit' as const, title: 'Measure something', detail: 'Test one section to see real scores before committing to the whole site.', done: false, href: '/', cta: 'Choose a section' },
      { id: 'schedule' as const, title: 'Set it to run on its own', detail: 'A weekly check is what turns scores into a trend.', done: false, href: '/settings', cta: 'Set a schedule' },
    ],
  };
  ```
  (The `site` step's `href` deliberately points at `/settings/database`, not `/settings/site` — connecting a database is the real first blocker for a genuinely new organization, structurally: `Site` rows live in the tenant database, so nothing else in this list is actually reachable until that's done. Confirm the exact shape of `OnboardingState`/`GroupSummaryDTO`/`PageListItemDTO`/etc. against their real type definitions in `lib/services/*.ts` before finalizing this file — several field names above are inferred from earlier reading in this session, not copied verbatim from the type definitions, and a mismatch here is a type error `tsc` will catch immediately, not a silent bug.)

- [ ] **Step 2: The generic wrapper**
  ```ts
  // lib/onboarding/demoTenant.ts
  import { NotProvisionedError } from '../errors.ts';

  export async function demoAware<T>(real: () => Promise<T>, demo: T): Promise<T> {
    try {
      return await real();
    } catch (e) {
      if (e instanceof NotProvisionedError) return demo;
      throw e;
    }
  }
  ```

- [ ] **Step 3: One wrapper per real function, in the same file**

  Each follows the identical shape — read the real function's exact signature from its actual source file first, then wrap it:
  ```ts
  import { defaultSite, requireGroupAccess, requirePageAccess, listSites } from '../services/tenant.service.ts';
  import { listGroupsWithAggregates, listPagesInGroup } from '../services/results.service.ts';
  import { getPageReport } from '../services/report.service.ts';
  import { regressionsForPage } from '../services/regression.service.ts';
  import { getSiteSummary } from '../services/site.service.ts';
  import { getTopIssues } from '../services/issues.service.ts';
  import { estimateRun } from '../services/estimate.service.ts';
  import { onboardingState } from '../services/onboarding.service.ts';
  import { DEMO_SITE, DEMO_GROUPS, DEMO_PAGES_BY_GROUP, DEMO_ONBOARDING_STATE } from './demoData.ts';

  export const demoAwareDefaultSite = (organizationId: string) =>
    demoAware(() => defaultSite(organizationId), DEMO_SITE);

  export const demoAwareListSites = (organizationId: string) =>
    demoAware(() => listSites(organizationId), [DEMO_SITE]);

  export const demoAwareOnboardingState = (organizationId: string) =>
    demoAware(() => onboardingState(organizationId), DEMO_ONBOARDING_STATE);

  export const demoAwareListGroupsWithAggregates = (organizationId: string, siteId: string, opts: Parameters<typeof listGroupsWithAggregates>[2]) =>
    demoAware(() => listGroupsWithAggregates(organizationId, siteId, opts), DEMO_GROUPS);

  export const demoAwareRequireGroupAccess = (organizationId: string, slug: string) =>
    demoAware(
      () => requireGroupAccess(organizationId, slug),
      DEMO_GROUPS.find((g) => g.slug === slug) ?? null,
    );
  // ... one more per remaining name in the Interfaces list above, same shape:
  // demoAwareRequirePageAccess, demoAwareListPagesInGroup, demoAwareGetPageReport,
  // demoAwareRegressionsForPage, demoAwareGetSiteSummary, demoAwareGetTopIssues,
  // demoAwareEstimateRun (demo value: { seconds: 0, measured: false }, since
  // there's nothing to actually schedule), demoAwareScheduleAutomationData
  // (demo value: { schedule: null, recentRuns: [] }), demoAwareNotificationSetting
  // (demo value: null), demoAwareHistoryOverview (confirm real shape first).
  ```
  **`requireGroupAccess`/`requirePageAccess` return non-nullable in the real signature but the demo fallback above can be `null` for an unmatched slug/id** (someone navigating to a fake `/g/nonexistent` in demo mode) — the calling page's existing `if (!group) notFound()` pattern already handles a `null`/falsy result today, so this composes correctly without the page needing new logic, as long as the wrapper's real return type allows it; if TypeScript disagrees, widen the wrapper's declared return type explicitly rather than casting past the error.

- [ ] **Step 4: Update the six pages/layout — swap imports, delete the redirect boilerplate**

  For each of the six files, the change is: change the import of whichever `tenant.service`/`results.service`/etc. functions it calls to the `demoTenant.ts` equivalents, and delete the `try { ... } catch (e) { if (e instanceof NotProvisionedError) redirect(...); throw e; }` wrapper entirely — the demo-aware function never throws `NotProvisionedError` in the first place, so the call sites become plain `await` again, same as before Phase 5's redirect fix existed. Example (`app/(dash)/g/[slug]/page.tsx`):
  ```ts
  // was:
  import { defaultSite, requireGroupAccess } from '@/lib/services/tenant.service';
  import { NotProvisionedError } from '@/lib/errors';
  import { listPagesInGroup } from '@/lib/services/results.service';
  // ...
  let site: Awaited<ReturnType<typeof defaultSite>>;
  try {
    site = await defaultSite(ctx.organizationId);
  } catch (e) {
    if (e instanceof NotProvisionedError) redirect('/settings/database');
    throw e;
  }
  if (!site) notFound();
  const group = await requireGroupAccess(ctx.organizationId, slug).catch(() => null);
  if (!group) notFound();
  const pages = await listPagesInGroup(ctx.organizationId, group.id, { strategy });

  // now:
  import { demoAwareDefaultSite, demoAwareRequireGroupAccess, demoAwareListPagesInGroup } from '@/lib/onboarding/demoTenant';
  // (NotProvisionedError import removed -- no longer caught here)
  // ...
  const site = await demoAwareDefaultSite(ctx.organizationId);
  if (!site) notFound();
  const group = await demoAwareRequireGroupAccess(ctx.organizationId, slug).catch(() => null);
  if (!group) notFound();
  const pages = await demoAwareListPagesInGroup(ctx.organizationId, group.id, { strategy });
  ```
  Apply the same shape (swap imports, delete the try/catch, `redirect` import removed if nothing else in the file still uses it) to the other five files, using each one's own actual real-function list from the Interfaces section above.

  **`RunAuditButton` and the recommendation-generation button must be disabled in demo mode** (per this plan's Global Constraints — the interactive simulated audit run is explicitly out of scope here). Pass a `demoMode={!provisionReady}` prop through from each page (a cheap boolean the page already has everything needed to compute: `site.id === DEMO_SITE.id`, or thread through a plain boolean the demo-aware `defaultSite` call's result implies) down to `RunAuditButton`/the recommendation trigger, and have those components render `disabled` with a `title`/tooltip explaining why ("Connect a real database in Settings → Database to run a real audit") rather than silently no-op-ing on click.

- [ ] **Step 5: Verify and commit**
  ```bash
  npx tsc --noEmit && npm run lint && npm test
  git add -A
  git commit -m "onboarding: demo-aware tenant data reads; un-gate the six pages, disable audit/recommendation actions in demo mode"
  ```

---

## Self-review notes

- **Task ordering**: 1→2→3 are independent of the UI (schema, pure catalog, actions) and could be parallelized; 4-5-6 depend on 2-3; 7 depends on 1 (schema) being live and can be built in parallel with 4-6 but its final page edits should land after 6 (so the layout already has `TourProvider`/`FloatingChecklist` wired before the pages it also touches are edited, avoiding two tasks touching the same files' unrelated regions back-to-back).
- **The plan's Task 7 grew during research** from the spec's rough sketch ("same components, fed fixture data") into a concrete wrapper-module design, once it became clear three pages read tenant data via raw Prisma queries rather than named service functions — flagged explicitly in Task 7's own header rather than silently absorbed, since it's a real complexity finding the spec didn't fully anticipate.
- **Explicitly deferred, not silently dropped**: the interactive simulated audit run (Global Constraints) — the "Run audit"/"Generate recommendation" buttons go inert-with-explanation in demo mode for this plan, not fake-functional. Flag this to whoever reviews this plan's execution: it's a real, deliberate scope cut from the spec's "fully interactive" choice, made because it surfaced as meaningfully larger, separate engineering work once Task 7's actual shape became clear — worth the user's explicit sign-off before execution, not just a plan-writer's unilateral call.
