# Build Log — Internal PageSpeed Auditor

> **Purpose of this file.** A running, tool-agnostic record of what has been built,
> what is in progress, and what comes next — so this work can be picked up by any
> agent or person (Claude Code, Antigravity, Codex, or a human) without replaying
> the original conversation.
>
> **Read `docs/PLAN.md` first.** It is the approved build plan and the source of
> truth for architecture, schema, and verification steps. `docs/SPEC.md` is the
> original brief it was derived from, and `docs/DECISIONS.md` records why each
> direction was chosen and what was rejected. This file only tracks *state*:
> what is done and what is not.
>
> Nothing needed to continue this work lives outside the repo.
>
> **Keep this updated.** Append to the Session Log at the bottom after every
> meaningful change. Do not rewrite history in it.
>
> **Earlier history archived.** This file used to open with a project
> description, milestone table, and "decisions settled" list frozen as of
> 20 Aug 2026 — all superseded by later work and by `CLAUDE.md`/
> `docs/DECISIONS.md`/`docs/IMPLEMENTATION_PLAN.md`, which are now the
> current-facts source instead. That content, plus the 19-20 Aug 2026
> session log entries (M0 through the Vercel/Workflow migration), moved to
> `docs/archive/BUILD_LOG-2026-08-19-20.md` on 22 Aug 2026 during a docs
> cleanup pass — nothing was deleted, only relocated, so a context-limited
> agent doesn't have to read 1,400 lines of settled history to find out
> what's happening now.

---

## Session log

Append newest entries at the bottom. One line per meaningful change.

## 21 Aug 2026 — forgot-password was leaking the reset link, and a per-org SMTP override

Asked to make forgot-password "send a real reset email, not devUrl."
Checked production live via Playwright before touching anything: submitting
a real account's email on `/forgot` returned the message "Email is not set
up on this install, so the link is here instead:" followed by a **live,
valid password-reset token, directly in the page response** — production's
shared `EMAIL_TRANSPORT` was never actually set to `smtp`, and separately
`SMTP_PASS` had never been added to production at all (`vercel env ls
production` showed `SMTP_HOST`/`SMTP_USER`/`SMTP_PORT`/`SMTP_FROM`/
`EMAIL_TRANSPORT` present, `SMTP_PASS` and `RESEND_API_KEY` both absent).
This is a real account-takeover exposure, not just a UX rough edge: anyone
who knows or guesses a registered email can currently get handed that
account's password-reset link with no mailbox access at all.

Then asked to make the email transport "configurable per tenant, like the
PSI key" — full reasoning and what was deliberately excluded (password
resets) in `docs/DECISIONS.md` §14. Summary: `Organization` gained
`smtpHost`/`smtpPort`/`smtpUser`/`smtpPass`/`smtpFrom` (migration
`20260820184009_org_smtp_override`), `lib/services/tenant.service.ts`
gained `emailConfigForOrg`/`orgEmailRef`, `lib/notify/email.ts`'s
`sendEmail` takes an optional `SmtpOverride` and gained
`verifySmtpConnection` (nodemailer's `transporter.verify()`, the SMTP
equivalent of `updatePsiKeyAction`'s probe to Google), and a new "Email
sending" section on Settings → Automation
(`components/settings/OrgEmailForm.tsx`, `updateOrgEmailAction`) lets an
admin save their own mailbox with the same verify-before-save and
masked-password-on-redisplay pattern the PSI key form already uses.
`inviteMemberAction` and `dispatchSweepNotification` now resolve and pass
the org's override; `requestResetAction` (password reset) intentionally
does not.

While verifying the new override path for real (a one-off script against
the mailbox already named in local `.env`, deleted after use), found that
`SMTP_PASS` is empty in **local** `.env` too, not just production — only
`SMTP_HOST`/`SMTP_USER`/`SMTP_PORT`/`SMTP_FROM` were ever actually filled
in anywhere. The actual missing-password fix in production is still
pending on the user adding a real value via `vercel env add SMTP_PASS
production` themselves, deliberately kept out of this session's hands so
the password is never typed into this chat.

Verified: `npx tsc --noEmit`, `npm run lint`, `npm test` (138/138), `npm
run build` all clean.

## 21 Aug 2026 (later) — role-gated controls: frontend showed them, backend crashed instead of rejecting them

Reported as "settings screens write everyone can see it but not everyone
can edit them... can't [be stopped] from frontend and backend." Audited
every mutating Server Action's permission check plus every place a
capability-gated control is rendered, rather than guessing at one
component.

**Two distinct, compounding gaps, both systemic:**

1. **Frontend**: `RunAuditButton` (page and group reports) and
   `RunControls`/`ActiveRunBar` (the global Hold/Continue/Stop bar,
   mounted for every signed-in screen via `app/(dash)/layout.tsx`) and
   `RecommendationPanel`'s Generate/Regenerate button were all rendered
   unconditionally, with no role check anywhere in the component tree.
   A viewer (who has `reports:read` only) would see every one of these
   and be able to click them. Group-reorder (`GroupRail`, `SectionGrid`)
   turned out to already be correctly gated via a `canReorder` prop
   threaded from `layout.tsx`'s `can(ctx.role, 'groups:manage')` — that
   existing pattern is what the fix below extends to the other controls,
   not a new invention.

2. **Backend**: almost every action's `requireCapability(...)` call sat
   **outside** its function's `try/catch` — `queueAuditAction`,
   `retryFailedAction` (`app/actions/audits.ts`), `controlRunAction`
   (`app/actions/runControl.ts`), `generateRecommendationAction`
   (`app/actions/recommendation.ts`), all three of `app/actions/groups.ts`,
   and all four of `app/actions/settings.ts` had this shape. A rejected
   `ForbiddenError` therefore threw **uncaught** out of the Server Action
   instead of resolving to `{ok:false, error}` — which a Server Action
   client call turns into an opaque rejected promise, not the friendly
   inline message every other action in the codebase already shows. Data
   safety was never at risk (the rejection did stop the action), but a
   viewer who clicked one of the buttons from (1) would have hit a raw
   crash instead of a clean "your role does not allow this" message.
   `settings.ts`'s four actions are only reachable through a page that is
   itself admin-gated already, so their exposure was defense-in-depth
   only; the rest were genuinely reachable by an unprivileged role through
   normal navigation.

**Fix.** Backend: moved every `requireCapability`/`requireRunAccess`/
`requirePageAccess` call inside the function's `try` block (adding one
where none existed), so `ForbiddenError`'s own message — already a clean,
safe, user-facing string ("Your role does not allow this (audits:run).")
— surfaces the same way every other rejection in these files already
does. Frontend: added `canRunAudits` (threaded `layout.tsx` → `AppShell`
→ `ActiveRunBar` → `RunControls`, exactly mirroring the existing
`canReorder` wiring) and `canGenerate` on `RecommendationPanel`, and
wrapped both `RunAuditButton` call sites (`p/[pageId]`, `g/[slug]`) in a
`can(ctx.role, 'audits:run')` check. Viewing an existing recommendation
and its history stays open to every role with `reports:read`; only the
button that spends money generating a new one is hidden.

**Noted, not fixed:** `components/settings/PriorityForm.tsx` turned out
to be dead code — nothing imports or renders it, anywhere. Left alone;
out of scope for this pass, and removing unused code wasn't what was
asked.

Verified: `npx tsc --noEmit`, `npm run lint`, `npm test` (138/138), `npm
run build` all clean.

## 21 Aug 2026 (later still) — a live run stuck retrying the same page forever, because of the Blob key's own determinism

Caught live, mid-run, from the terminal feature's own log: one page
(`/blog/upcoming-trends-and-tech-in-the-virtual-events-industry`, mobile)
retrying repeatedly with `Vercel Blob: This blob already exists, use
allowOverwrite: true...`, backing off 26s then 59s between attempts.

**Root cause.** `storeRawJson` (`lib/blob.ts`) uploads to a path keyed
deterministically by `(runId, pageId, strategy)` — deliberate, per
`docs/DECISIONS.md` §13, so the pathname exists before the DB row does.
But that determinism cuts the other way on a retry: if the Blob upload
itself succeeds and something AFTER it throws (the `$transaction` in
`recordAuditResult`, any transient error), the whole step retries from
the top — and the retry's own `put()` call hits the exact same pathname,
which Vercel Blob refuses to silently overwrite by default. The step's
retry logic then retries THAT error too, except this one can never
resolve on its own: every subsequent attempt re-uploads to the same
already-occupied key and fails the same way, burning every retry
attempt on an error that has nothing to do with PSI or the real audit.
`PSI_MAX_ATTEMPTS` eventually exhausts and the page falls through to
this session's earlier `RETRIES_EXHAUSTED` error-row fix — so it isn't
an infinite hang, but it wastes every retry attempt and delays that page
for no real reason.

**Fix.** Added `allowOverwrite: true` to the `put()` call. Safe and
correct here specifically because the key is scoped to one run: a retry
that reaches this line again is re-uploading the SAME page's freshly
re-fetched PSI result for the SAME run, and the latest attempt's bytes
are exactly what should win. This isn't the accepted-tradeoff orphaned
object §13 already reasoned about (a rolled-back transaction leaving one
harmless stray blob) — it's a distinct failure mode that reasoning didn't
cover, where the retry mechanism and the upload's own determinism fight
each other.

Verified: `npx tsc --noEmit`, `npm run lint`, `npm test` (138/138) clean.
Shipped urgently, mid-incident, rather than batched with anything else,
since the live run was actively burning retries on it while this was
being written.

## 21 Aug 2026 (later still) — eye-toggle on every confidential field; settings tabs visible but read-only per role

Two related requests: "can I get an eye option wherever we're filling
confidential stuff" and, separately, "every role can see all the
settings tabs but not edit them" -- reversing this session's own earlier
decision to hide Team/Site/Automation entirely from non-admins.

**Eye toggle.** New `components/ui/PasswordInput.tsx` -- a drop-in
replacement for `<input type="password">` with an eye/eye-off button that
toggles visibility, tracking its own state rather than needing the field
to stay focused. Replaces the "reveal on focus, hide on blur" pattern
`PsiKeyForm`/`OrgEmailForm` had, and the plain unmasked `type="password"`
in `AuthCard`'s shared `Field` (login, signup, reset, accept-invite) and
`ProfileForms`' password-change fields. Motivated directly by the SMTP
port/host mix-up earlier today -- being able to actually check what got
typed, after typing it, would have caught that immediately instead of
several rounds of guessing from error messages alone.

**Settings visibility reversed.** `SettingsNav` no longer filters tabs by
`can(role, ...)` -- all four (Profile, Team, Site, Automation) show for
every role now. Each of the three admin-only pages (`team`, `site`,
`automation`) changed from `requireCapability(X)` (which threw
`ForbiddenError` before the page ever rendered) to `requireSession()` +
computing `const canEdit = can(ctx.role, X)`, threaded down to every form
on the page. Every form wraps its actual controls in
`<fieldset disabled={!canEdit}>` -- one native HTML mechanism that
disables every nested input/select/button in one shot, rather than
threading a disabled prop into each field individually -- and shows a
plain-text "Only an admin can change this" note when `!canEdit`.
Touched: `TeamManager` (invite form, per-row role/remove, revoke-invite),
`SiteForms` (add/edit site, PSI key), `IngestButton`, `ScheduleForm`,
`NotificationForm`, `OrgEmailForm`. `AutomationStatus`/`RunHistoryList`
already worked this way (`canDelete`/`canRetry` props tied to their own
specific capabilities) and needed no change.

Backend is unchanged and was already correct going into this: every
action still calls `requireCapability` and rejects cleanly (see the
"role-gated controls" entry above this same day) -- this pass only
changes what renders, never what's accepted.

**Also fixed along the way, found while reading these same files:**
- `AcceptInviteForm`'s read-only, pre-filled email field showed an
  "optional" badge, because `AuthCard`'s `Field` showed it for any
  `required={false}` field regardless of whether it was also `readOnly`.
  "Optional" means "you may leave this blank" -- meaningless on a field
  that's locked to one value and can never be blank. Fixed to
  `!required && !readOnly`.
- Explained, not a bug: a teammate accepting an invite wasn't asked for a
  name/password because `hasAccount` (an existing `User` row for that
  email) was already true -- a `User` is a global identity shared across
  every `Organization` it holds `Membership` in, so someone who already
  has a login elsewhere is only ever asked to join, not to set a second,
  separate password for the same email address.

Verified: `npx tsc --noEmit`, `npm run lint`, `npm test` (138/138), `npm
run build` all clean.

## 21 Aug 2026 (later still) — Upstash exhausted for real; Redis removed from the app entirely

Reported live: "You have reached the maximum monthly request limit
(500,000) for your database" -- hit by exactly two full sweeps, and the
same day Vercel Blob separately hit its own 2,000-advanced-operations
cap. Fixing the rate limiter's polling interval (already done, same day,
in `lib/psi/rateLimiter.ts`'s own history) prevents this from recurring,
but doesn't undo an already-exhausted monthly quota, and Upstash allows
only one database per account -- there was no "spin up a fresh free
one" option. Asked directly, twice, to think about this from first
principles rather than reach for another provider: full reasoning in
`docs/DECISIONS.md` §16. Summary: Redis's only real justification was
BullMQ's blocking commands, BullMQ left months ago (§11), and nothing
that remained -- a token bucket, a heartbeat timestamp, a live log --
ever needed a request-metered service instead of the Postgres this app
already depends on unconditionally.

**What moved.** Three new tables (`RateLimitBucket`, `KeyValue`,
`RunLogEvent`) replace `lib/redis.ts` (deleted) with a new
`lib/opsState.ts`. The PSI rate limiter's atomic check-and-increment
becomes `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` instead of a
Lua script -- same guarantee, verified directly (30 concurrent
`tryAcquire()` calls against a fresh bucket granted exactly 3, every
time, not just in theory). The scheduler heartbeat and live run log
became a row and a small table respectively; the run log is now deleted
outright when a run finalizes rather than TTL'd. `lib/auth/rate-limit.ts`
already had a memory-only fallback for whenever Redis was slow -- once
Redis stopped existing, that fallback simply became the only behaviour,
nothing to port. Five standalone scripts
(`canary`/`queue-audit`/`throughput-dryrun`/`audit-group`/
`verify-audit-path`) that constructed their own `PsiRateLimiter` directly
against the old `{ redis, keyPrefix }` shape were updated to `{ db, key }`.
`ioredis` is no longer a dependency; `REDIS_URL`/`QUEUE_PREFIX` no longer
exist; the local `docker-compose.dev.yml` no longer runs a redis
container.

**Verified with real load, not just unit tests.** `npm run
throughput-dryrun` -- the same real-Postgres/real-limiter/fake-PSI gate
this project has used since before Redis was ever removed to validate
the ~0.75 req/s assumption every duration estimate rests on -- read 0.911
req/s at `JOBS=60` and failed its own tolerance check. Investigated
rather than waved off: traced to the script's "steady state" sample being
only 12 data points at that size (confirmed separately that 30 fully
concurrent acquisitions still granted exactly 3, ruling out an actual
race). At `JOBS=200`, steady-state measured 0.755 req/s against a 0.750
target -- PASS.

Also fixed along the way: `passwordHash` on `User` had already gone
nullable (`String?`) for the in-progress "Continue with Google" work
started earlier the same day, and `changePasswordAction` had not yet
been updated for that -- a real TypeScript error, unrelated to Redis,
caught by `tsc` while verifying this change. Fixed to fail safely (not
crash) for an account with no password set yet, with an honest message
rather than a generic wrong-password one.

Verified: `npx tsc --noEmit`, `npm run lint`, `npm test` (141/141 --
three new tests for the Postgres-backed rate limiter), `npm run build`,
and the real throughput dry-run above, all clean.

## 21 Aug 2026 (later still) — Google sign-in finished: accept-invite wired, env documented

Closed out the one piece left half-done from earlier: login and signup
already had "Continue with Google," accept-invite didn't.
`AcceptInviteForm` now offers it too, only when `!hasAccount` (an
existing account just joins on "Join" with no extra credential either
way, the same as the password path already does -- the invite token
itself is what's authorising that, not a password or a Google session).
Also added `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` to `.env.example`,
undocumented until now. Full reasoning for the feature as a whole in
`docs/DECISIONS.md` §17.

Verified: `npx tsc --noEmit`, `npm run lint`, `npm test` (141/141), `npm
run build` all clean.

## 21 Aug 2026 (later still) — Copy pass: no more dev instructions leaking into the product

Ran a full read-only audit of every user-facing string in `app/` and
`components/` (page titles, empty states, error messages, tooltips,
form hints) against the standard of "reads like a real SaaS product,"
per the user's request. Overall verdict: the existing copy was already
unusually deliberate -- consistent voice, careful terminology, thoughtful
empty states across the ~45 files reviewed. The findings clustered on
one specific pattern rather than being spread everywhere.

**The pattern:** several settings screens told a real admin to edit
`.env`, run `npm run env -- KEY value`, or "restart" -- instructions
that only make sense to someone with codebase and deployment access,
not a customer's admin. Fixed by reframing all of them around what an
admin actually *can* do:
- `lib/notify/email.ts`'s `emailConfigProblem()` (surfaced in Settings →
  Automation) no longer names env vars or tells anyone to edit `.env`;
  it says the shared sender isn't finished setting up and points at
  "ask whoever manages hosting" or the org's own mailbox override,
  which is the one thing the viewer can actually do from here.
- `components/settings/NotificationForm.tsx`'s "personal mailbox"
  caveat had the same problem, plus a second bug: it fired even when
  an organisation had deliberately set its *own* mailbox above, where
  the caveat is simply wrong. Added a `sharedDefault` prop so it only
  shows for the deployment's shared default, not an intentional
  override.
- `components/settings/AutomationStatus.tsx`'s cron-health warning
  pointed at "Settings → Automation in the docs" -- i.e. this repo's
  markdown files, unreachable by a real customer, and also circular
  (that warning already lives on that exact page). Reworded to "ask
  whoever manages hosting."
- The automation page's "Configuration" section hint (`.env` /
  `npm run env` / restart) reworded to state the actual, honest fact:
  these are deployment-wide values an org admin cannot change from
  here at all, not a walkthrough of how to change them.

**Second, smaller finding:** `FailedPages.tsx` already had a proper
`EXPLAIN` map translating Lighthouse's `runtimeError` codes (`NO_FCP`,
`RETRIES_EXHAUSTED`, ...) into full sentences a non-engineer can read.
Two other places showing the same codes bypassed it and printed the
raw code verbatim: the per-page report's error empty-state, and the
run-history table's Perf column. Moved the map to
`lib/report/runtimeError.ts` (framework-free, per the repo's
`lib/report` rule) as `explainRuntimeError()`, and pointed all three
call sites at it. The run-history table cell is too narrow for a full
sentence, so it now shows a plain "Failed" with the explanation as a
hover `title` instead of the bare code.

Left two lower-severity items from the audit alone: `CWVGrid`'s bare
"No data" fallback (real inconsistency, but the tile is a few pixels
wide and a full sentence doesn't fit -- not worth the layout risk for
a nice-to-have), and the "stored in Vercel Blob" line on Settings →
Site (accurate, useful billing context for an admin, not an
instruction -- naming the vendor here is informational, not a leak).

Verified: `npx tsc --noEmit`, `npm run lint`, `npm test` (141/141),
`npm run build` all clean.

## 21 Aug 2026 (later still) — Confirmed the GitHub Actions sweep pinger, fixed two stale comments

This was actually already built earlier in this session (commit
`86f87fd`, before the Redis-removal work took over) -- checked
`gh run list --workflow=schedule-tick.yml` and it has been firing
successfully every 15-50 minutes (GitHub's schedule trigger is
best-effort) since it landed, hitting the real
`/api/cron/schedule-tick` with the `CRON_SECRET` repo secret. Nothing
new needed building.

Fixed two comments the Redis removal (see the earlier entry above)
left stale: `.github/workflows/schedule-tick.yml` referenced
`lib/redis.ts's CRON_INTERVAL_MS`, which no longer exists -- now
points at `lib/opsState.ts`, where that constant actually lives.
`app/api/cron/schedule-tick/route.ts`'s doc comment claimed "Triggered
by Vercel Cron every 15 minutes," which was never true even before
today -- `vercel.json` has always fired this once a day
(`0 2 * * *`, the Hobby-plan ceiling); the real 15-minute cadence has
always come from this GitHub Actions pinger, not Vercel Cron. Comment
now says so.

Verified: `npx tsc --noEmit`, `npm run lint`, `npm test` (141/141) all
clean.

## 21 Aug 2026 (later still) — Raw JSON moved off Vercel Blob to Cloudflare D1

The Vercel Blob quota incident from earlier today turned out not to be a
bug: Blob bills `put()` as an "Advanced Operation," free allowance
2,000/month, and this site's full sweeps (1,000-2,000 pages x
strategies, one `put()` each) use up the whole month in one or two
sweeps by design. The account had already hit that ceiling, twice, with
no way to buy past it without upgrading off Hobby.

Tried Cloudflare R2 first (the obvious like-for-like replacement) and
ruled it out for real, not on suspicion: enabling R2 requires a card on
file with no bypass, confirmed by actually trying it on two different
Cloudflare accounts. Compared four no-card alternatives (Backblaze B2,
Supabase Storage, staying on Neon Postgres permanently, Cloudflare D1)
and picked D1: no card gate (unlike R2, confirmed -- only R2 requires
billing info, not D1/KV/Workers), 5 GB free storage, 100k writes/day, 5M
reads/day, 2 MB max row size (pruned responses are 150-750 KB), and the
Cloudflare account needed for it was already sitting there authenticated
via `wrangler` from the aborted R2 attempt.

Built: a D1 database (`pagespeed-auditor-rawjson`, one table
`raw_json_blobs`), `lib/blob.ts` rewritten to call D1's HTTP query API
directly (no Workers runtime, just an authenticated `fetch()`) with the
exact same exported function signatures, so every call site
(`audit.service.ts`, `report.service.ts`, `retention.service.ts`) needed
no changes at all. Removed the now-unused `@vercel/blob` dependency and
its two env vars.

Real, non-obvious win: unlike Vercel Blob, this can be fully exercised
from local dev -- D1's HTTP API doesn't care who's calling it. Verified
the entire store/fetch/overwrite-on-retry/delete round trip against the
actual production D1 database before wiring it into the app, not just
against types. `test/blob.test.ts` also grew real unit tests (fake
`fetch`, 8 new cases) for logic that was previously untestable at all.

Full reasoning, and the four-way comparison, in `docs/DECISIONS.md` §18.
Left as an explicit follow-up, not bundled in: batching every page's
result at finalize time instead of writing once per page, which would
cut write volume by two to three orders of magnitude -- D1's allowance
makes it non-urgent, unlike it was on Blob.

Verified: `npx tsc --noEmit`, `npm run lint`, `npm test` (149/149,
including the new `blob.test.ts` cases), `npm run build` all clean, plus
the real D1 round trip described above. Production env vars
(`CLOUDFLARE_ACCOUNT_ID`/`CLOUDFLARE_D1_DATABASE_ID`/`CLOUDFLARE_API_TOKEN`)
not yet set on Vercel as of this entry -- next step.

(Follow-up, same day: all three env vars were set on Vercel production
and preview, the D1 database and its scoped API token were created and
verified against the real deployment, and a real deploy went out
successfully. That shared, app-owned D1 setup is itself now scheduled
for replacement -- see the per-tenant entry below.)

## 21 Aug 2026 (later still) -- Per-tenant Neon + D1: Phase 1 (prep)

The user, after seeing the shared D1 setup above actually working,
asked a bigger question: why should the app own the database (and the
cost/quota risk) for every tenant combined, when it already lets each
tenant bring its own PSI key and its own SMTP mailbox? Decided: this app
moves to a genuinely per-tenant model -- every organization brings and
provisions its **own** Neon Postgres database and its **own** Cloudflare
D1 database. The app becomes a pure interface: paste your credentials in
Settings, we provision your schema, and your usage is never on our
quota.

This is a large, multi-phase change (full plan at
`docs/DECISIONS.md` -- entry to follow once implementation completes;
in the meantime see the approved plan captured in this session). Three
decisions were confirmed with the user before any code was written: no
migration of existing audit history (start fresh once this ships), the
new credentials get real application-layer encryption (not plain
columns like the existing PSI key/SMTP password -- a leaked Neon
connection string is full read/write to a whole database, not "send
email as this mailbox"), and login needs a real "choose your
organization" step (`Membership` already supports one user belonging to
several orgs, but login today silently picks the oldest one -- with
per-tenant databases, picking wrong means opening the wrong database).

**Phase 1 (this entry), zero behavior change:**
- `lib/crypto/secretBox.ts` -- AES-256-GCM via Node's own `crypto` (no
  new dependency), keyed by a new `SECRET_BOX_KEY` env var (64 hex
  chars, same `openssl rand -hex 32` convention as `SESSION_SECRET`,
  but a distinct value -- never reuse one secret for two purposes).
  Envelope is one opaque string (`v1.<iv>.<tag>.<ciphertext>`), and
  every call binds a `context` string as GCM associated data, so a
  ciphertext copied into the wrong row/column fails to decrypt instead
  of silently "working" with someone else's secret.
- `SECRET_BOX_KEY` added to `lib/env.ts` and `.env.example`; a real key
  generated and set in local `.env` and (a different key) on Vercel
  production + preview.
- `NotProvisionedError` added to `lib/errors.ts`, for the tenant-client
  resolver landing in a later phase.
- `test/secretBox.test.ts`: round-trip, envelope-never-contains-plaintext,
  non-deterministic ciphertexts (fresh IV every call), wrong-context
  rejection, tampered-envelope rejection, garbage-input rejection.

Nothing in the app reads or writes these yet -- purely additive.

Verified: `npx tsc --noEmit`, `npm run lint`, `npm test` (157/157,
including 8 new `secretBox.test.ts` cases) all clean.

## 21 Aug 2026 (later still) -- Per-tenant Neon + D1: Phase 2 (login org-picker)

Fixed a real, pre-existing gap identified while planning the per-tenant
split: `Membership` genuinely supports one user belonging to more than
one organisation (`@@unique([userId, organizationId])`, both sides
arrays -- a real scenario, e.g. a consultant auditing several clients'
sites), but `login()`/`loginWithGoogle()`/`completePasswordReset()` all
silently picked the OLDEST membership via `findFirst`. Harmless while
every org shared one database; becomes a real correctness bug once orgs
get their own separate databases, since picking wrong then means opening
the wrong database, not just showing wrong data. Deliberately sequenced
*before* the schema split (see `docs/DECISIONS.md` §19) since it only
touches central-DB models and is worth having regardless.

Built: `lib/auth/pendingAuth.ts` (a short-lived signed JWT, same pattern
as `lib/auth/google.ts`'s OAuth state, reusing `SESSION_SECRET` rather
than adding a new one for something this short-lived) plus its
cookie-aware wrapper `lib/http/pendingAuth.ts`. `account.service.ts`'s
three login-adjacent functions now return a `'single' | 'choose'`
outcome instead of a bare context; `'choose'` sets the pending cookie
and redirects to a new `/login/organization` page
(`components/auth/OrganizationPicker.tsx` -- one button per org, in one
form, name/value pair on whichever gets clicked) instead of starting a
session. A new `selectOrganizationAction` re-verifies the chosen
membership against the DB before starting the real session -- it never
trusts a posted `organizationId` alone, reusing the existing
`contextFor()` that already does exactly this check. Signup and
accept-invite are untouched: both already resolve to exactly one
unambiguous org.

Verified directly against the real local Postgres (not just types): a
freshly seeded two-membership user gets `kind: 'choose'` with both
organisations correctly listed and roles intact;
`membershipsForUser()` (what the picker page renders) returns the same
list; `contextFor()` resolves each membership correctly and returns
`null` for an organisation the user does not belong to (the exact check
`selectOrganizationAction` depends on); a wrong password still fails
identically to before; a freshly seeded single-membership user still
signs straight in with zero extra clicks, unchanged from today's
behaviour. Browser-driven click-through was attempted but blocked by
unrelated tooling friction in this environment (screenshots rendered
the login page correctly; interactive actions timed out) -- the
service-layer verification above covers the actual logic that changed.

Also cleaned up while here: an orphaned `redis` container left over
from the Redis-removal work earlier this session
(`docker compose down --remove-orphans` && `up -d`; local Postgres data
and schema confirmed intact afterward via `prisma migrate status`).

Verified: `npx tsc --noEmit`, `npm run lint`, `npm test` (162/162,
including 5 new pending-auth-token cases in `test/auth.test.ts`), `npm
run build` all clean.

## 21 Aug 2026 (later still) -- Per-tenant Neon + D1: Phase 3 (schema split scaffolding)

Deviated from the approved plan's literal Phase 3 shape, deliberately,
for lower risk: the plan called for moving `prisma/schema.prisma` to
`prisma/central/schema.prisma` right away. Doing that now would strip
`Site`/`Page`/etc. out of the schema the running app actually generates
its client from -- breaking all ~32 existing call sites immediately,
not in the planned Phase 5 cutover. Instead: the new `Organization`
provisioning columns went onto the EXISTING, unmoved
`prisma/schema.prisma` (purely additive, zero risk), and
`prisma/tenant/schema.prisma` was built as an entirely new, separate,
not-yet-wired artifact. The actual `prisma/central/` rename is deferred
to Phase 5, bundled with the real cutover, where it's lower risk to do
once alongside everything else than twice.

Built:
- `Organization` gained `tenantDbUrlEnc`/`d1AccountIdEnc`/
  `d1DatabaseIdEnc`/`d1ApiTokenEnc` (all encrypted via
  `lib/crypto/secretBox.ts` from Phase 1, once something writes them)
  plus `provisionStatus`/`provisionError`/`provisionedAt`. One clean
  additive migration, applied and verified locally -- nothing reads or
  writes these columns yet.
- `prisma/tenant/schema.prisma` -- the 13 tenant-data models (`Site`
  through `RunLogEvent`), with `Site.organizationId` as a plain column,
  not a relation (Postgres foreign keys can't cross databases once
  `Organization` lives centrally; kept anyway as cheap defense-in-depth
  for `requireSiteAccess`'s existing filter). Its own
  `prisma/tenant/prisma.config.ts`, local-dev-only, needs a real
  temporary Postgres database (`TENANT_DEV_DATABASE_URL`, documented in
  `.env.example`) to author and verify migrations against -- never a
  live connection string.
- Its initial migration (`prisma/tenant/migrations/*_init`) was
  generated by the real Prisma CLI against a real throwaway local
  database, not hand-written -- confirmed all 13 tables, every index,
  and every foreign key came out correctly.
- `scripts/build-tenant-migrations.ts` -- precompiles that migration
  SQL into `lib/tenantDb/migrations.generated.ts`, a normally-`import`ed
  module, specifically to avoid the file-tracing risk already
  identified in the plan (a dynamic `fs.readFileSync` against
  `prisma/tenant/migrations/` at runtime would be pruned from the
  deployed Vercel function and silently 404 in production, even though
  it works in `next dev`).
- The generated Prisma clients this produces (`lib/generated/central`,
  `lib/generated/tenant`) are gitignored, same reason
  `node_modules/@prisma/client` already is -- regenerated by
  `prisma generate`, not committed.

**Verified for real, not just "it should work":** ran the exact
sequence the future provisioning action will run -- read
`TENANT_MIGRATIONS` from the generated module, opened a plain `pg`
client against a fresh throwaway database, applied every migration
inside one transaction, then inserted and read back a real `Site` row.
All 13 tables appeared, the insert succeeded. This is the real
mechanism the provisioning flow (a later phase) will use, exercised
end to end before anything depends on it.

Verified: `npx tsc --noEmit`, `npm test` (162/162, no new cases this
phase -- see the schema/migration verification above instead), `npm
run lint` initially spiked to 422 errors from the newly-generated
`lib/generated/` client files being linted directly (fixed in the very
next entry, same session, alongside an unrelated real bug it was found
next to).

## 21 Aug 2026 (later still) -- Real bug: a fully-failed run reported "completed"

Caught by the user testing the local dev server directly (no
`CLOUDFLARE_*` vars set locally, so every audit's raw-JSON storage
hit `PermanentError("Cloudflare D1 is not configured...")`): a run
where every single job permanently failed still finalized as
`completed`, `0/2`, with no error shown anywhere. Root-caused with
actual evidence (`lib/services/audit.service.ts`,
`lib/workflows/auditRun.ts`, `lib/services/run.service.ts` read
directly, not guessed at), two compounding bugs:

1. **`recordAuditResult` awaited `storeRawJson` before its own
   transaction, with nothing catching a throw.** A `PermanentError`
   from raw-JSON storage discarded an already-successful PSI
   measurement entirely -- the scores were real, the PSI quota to get
   them was spent, and none of it got written anywhere.
2. **`auditOnePageStep`'s `PermanentError` branch just returned.** No
   error row, no `completedJobs`/`failedJobs` increment -- the job
   silently vanished from the run's own counters. `finalizeRun()`'s
   completed-vs-failed test is `failedJobs >= totalJobs`; since
   `failedJobs` never moved off 0, a run where literally nothing
   succeeded read as "not everything failed" and reported `completed`.

Bug 2 is pre-existing -- the adjacent, correctly-written
exhausted-retries branch even explains, in its own comment, the exact
failure mode ("the page just vanished from the run's count") it was
written to prevent, for a different case. Bug 1 is new this session:
before `storeRawJson` (§18) could throw `PermanentError` at all, this
exact interaction couldn't happen. Together they turned a rare,
narrow edge case (a truly bad PSI key) into something that fires on
*every job* whenever raw-JSON storage is unavailable -- exactly what
local dev looks like without D1 configured, and exactly what the user
hit immediately.

**Fixed, both layers:**
- `recordAuditResult` now catches a `PermanentError` from storage,
  logs it, and still writes the real result with `rawJsonBlobKey:
  null` -- the measurement survives; only the raw evidence is
  unavailable. A `RetryableError` still propagates unchanged (the
  whole page correctly retries, same as before). Gained an injectable
  `storeRawJsonFn` parameter (default: the real one) so this is
  actually testable, matching the DI convention `retention.service.ts`
  already uses for `deleteBlobs`.
- `auditOnePageStep`'s `PermanentError` branch now records an error
  row and advances the counters, the same as the exhausted-retries
  branch beside it -- so `completedJobs`/`failedJobs` are always
  accurate regardless of *where* in the pipeline a permanent failure
  happens.
- `explainRuntimeError` (`lib/report/runtimeError.ts`) now recognizes
  that a `PermanentError`'s own `.message` is stored directly (not a
  fixed Lighthouse code) and returns it verbatim instead of wrapping
  it in "Lighthouse reported ..." -- new `isPageContentFailure()`
  distinguishes a genuine per-page Lighthouse finding from an
  operational/config failure. The per-page report's error empty-state
  (`app/(dash)/p/[pageId]/page.tsx`) uses it: an operational failure no
  longer gets told to the user as "a real finding about the page,"
  which was actively contradictory for something like a missing API
  key.

Also fixed while in the area, unrelated to the bug but found along the
way: `eslint.config.mjs` still listed the deleted `lib/queue/**` in the
framework-free-zone rule, and the generated Prisma clients under the
new `lib/generated/` (Phase 3, above) were being linted directly
(1000+ spurious errors on minified generated code) since nothing
ignored that path yet -- both fixed, and the framework-free probe
re-verified to still fail on a deliberate bad import.

Verified: `npx tsc --noEmit`, `npm run lint` (back to the normal 0
errors / 2 pre-existing warnings), `npm test` (172/172, including 10
new cases across `test/audit.service.test.ts` and
`test/runtimeError.test.ts`), `npm run build` all clean.

## 21 Aug 2026 (later still) -- Signup copy overclaimed multi-site support that doesn't exist

The user asked directly, having read the signup page: "we can't have
multiple websites right?" Checked, not assumed:
`app/(dash)/settings/site/page.tsx` hardcodes `sites[0]` and only ever
renders the "add a site" form when the organisation has zero sites --
once one exists, there is no UI path to add a second, ever, even
though `Organization.sites` is technically a one-to-many in the
schema. This app supports exactly one site per organisation in
practice. `SignupForm.tsx`'s organisation-name field hint said "You can
track several sites under it" -- actively wrong, not just optimistic.
Reworded to "You'll add the one site you're measuring next." No other
copy made the same claim.

## 21 Aug 2026 (later still) -- Settings reorganized: Notifications split out of Automation

Requested directly: "Automation" carried scheduling AND email/notification
config, which didn't read as one thing, and the read-only "Configuration"
block at the bottom belonged somewhere else entirely.

- New **Notifications** tab (`/settings/notifications`): "Email sending"
  (`OrgEmailForm`) and "Notifications" (`NotificationForm`), moved
  verbatim out of Automation along with all their data-fetching
  (`orgEmailRef`, `emailConfigProblem`, the `notif` query). Gated by the
  same `automation:manage` capability that already governed them --
  no new capability invented for a page split.
- **Automation** now holds only `AutomationStatus` (scheduler health,
  recent runs) and the schedule form -- matches its name again.
- **Configuration** moved into the **Site** tab, trimmed rather than
  copied verbatim: dropped `Site`/`Base URL`/`Sitemap`/`Pages
  tracked`/`PSI API key` rows since the Site tab already shows every one
  of those via `EditSiteForm`/`PsiKeyForm`/the `Pages` panel a few
  inches above -- keeping them would've been the exact kind of
  redundant-copy problem this session's earlier copy audit went looking
  for. What's left (pages-tested-at-once, Google rate limit, typical
  time per page, email status) isn't shown anywhere else on that page.
- Extracted the `Section` component (was private to
  `automation/page.tsx`) into `components/settings/Section.tsx` so
  Notifications could reuse it instead of duplicating eight lines.
- Fixed two `revalidatePath('/settings/automation')` calls in
  `updateOrgEmailAction` (`app/actions/site.ts`) that would have
  revalidated the wrong, now-unrelated page -- both now revalidate
  `/settings/notifications` (where the form lives) and `/settings/site`
  (whose new Configuration panel shows the same override status).

Verified: `npx tsc --noEmit`, `npm run lint`, `npm test` (172/172), `npm
run build` all clean -- `/settings/notifications` present as a real
route. Browser click-through was attempted but hit the same preview-tool
session/cookie friction as earlier this session (a login succeeded per
the network log, but a subsequent navigate landed back on `/login`);
asked the user to confirm visually themselves rather than keep fighting
the tool.

## 21 Aug 2026 (later still) -- Per-tenant Neon + D1: Phase 4 (resolver + provisioning UI)

The actual thing an admin now clicks through: a new **Database** settings
tab where an organisation pastes its own Neon connection string and its
own Cloudflare D1 credentials, and the app provisions and remembers them.

Built:
- `lib/db/tenant.ts` -- `getTenantPrisma(organizationId)` (cached per org,
  re-validated against the decrypted connection string on every call, so
  a rotated credential just swaps the pool; bounded to 20 entries) and
  `withTenantPrisma(organizationId, fn)` (the escape hatch for code that
  fans out across many orgs in one invocation, e.g. the cron tick --
  opens, uses, and closes without touching the shared cache). Not called
  from anywhere yet -- lands ahead of the Phase 5 cutover that actually
  threads it through every call site.
- `requireTenantPrisma(ctx)` in `lib/http/auth-guard.ts` -- same idea,
  redirecting an unprovisioned org to `/settings/database` instead of
  throwing `NotProvisionedError` raw. Also unused until Phase 5.
- `lib/blob.ts`'s three exports gained an **optional** `D1Credentials`
  parameter, falling back to the existing env-configured shared D1 when
  omitted -- deliberately backward-compatible rather than a breaking
  change, given the run-status bug fixed earlier this session lives in
  this exact file. Every existing call site keeps working completely
  unchanged; only new code needs to pass real per-org credentials. The
  env fallback is a transitional bridge, not the end state -- decision
  §19.4 is still every org brings its own, no shared tier, and removing
  `CLOUDFLARE_*` is Phase 6's job once nothing needs the fallback anymore.
- `lib/services/org.service.ts` (new, separate from `tenant.service.ts`
  on purpose -- this is central-database data, an org's own connection
  details, not the tenant data `tenant.service.ts` resolves access to):
  `provisionRefFor` (presence-only DTO for the settings UI) and
  `d1CredentialsForOrg` (decrypts, server-only).
- `'org:provision'` capability (`lib/auth/roles.ts`, admin-only) and the
  new Settings → Database tab: `app/(dash)/settings/database/page.tsx`,
  `components/settings/DatabaseConnectionForm.tsx` (four `PasswordInput`
  fields, the same dot-placeholder/untouched-field convention every other
  secret form in this app already uses), and `app/actions/provisioning.ts`
  (`provisionTenantAction`) -- a thin Server Action wrapper, the same
  shape `app/actions/site.ts` already is, around the actual logic in
  `lib/tenantDb/provision.ts` (`validateNeonUrl`, `validateD1Credentials`,
  `runTenantMigrations`) -- factored out specifically so that logic is
  testable without a Next.js request context, matching this app's
  existing service-layer convention.
- The two halves (Neon, D1) validate and persist independently: rotating
  the D1 token doesn't force re-pasting the Neon URL. Neon persists first
  (migrating is the slower, more failure-prone half); `provisionStatus`
  goes to `'provisioning'` before migrations run, so a mid-migration
  crash reads as visibly stuck rather than silently fine.

**Verified for real, not just "it should work":** `validateD1Credentials`
got real unit tests (fake fetch). `validateNeonUrl`/`runTenantMigrations`
-- which need a live Postgres and so aren't part of the standard suite,
same convention `test/blob.test.ts` already established for D1 -- were
run directly against real throwaway local databases: a fresh empty
database passes; a database with a pre-existing `Site` table is rejected
with the exact message the UI shows, *unless* the org is already
`'ready'` (the re-save case), where the check is correctly bypassed; an
unreachable connection string returns a clean message, never a throw;
migrations really do create all 13 tables against a fresh database, a
real row inserts and reads back, and re-running them against an
already-migrated database fails cleanly with `relation "Site" already
exists` -- the exact failure path `provisionTenantAction` catches to set
`provisionStatus: 'failed'`.

Browser click-through of the actual form was not attempted this phase,
given the tooling friction hit twice already this session -- ask the
user to try Settings → Database directly.

Verified: `npx tsc --noEmit`, `npm run lint`, `npm test` (176/176,
including 3 new `validateD1Credentials` cases), `npm run build` all
clean -- `/settings/database` present as a real route.

## 21 Aug 2026 (later still) -- Per-tenant Neon + D1: the D1 table-creation gap, fixed

New session, per `docs/PER_TENANT_ARCHITECTURE.md`'s "real gap" note left
at the end of Phase 4: `validateD1Credentials` only ran `SELECT 1`, which
a genuinely empty brand-new D1 database passes with no tables at all. No
per-tenant D1 database would ever have gotten the `raw_json_blobs` table
`lib/blob.ts` actually reads and writes -- the exact table the shared D1
database (§18) got once, by hand.

Fixed with `ensureD1Schema(accountId, databaseId, apiToken)` in
`lib/tenantDb/provision.ts` -- the same
`raw_json_blobs(pathname TEXT PRIMARY KEY, body TEXT, created_at INTEGER)`
`CREATE TABLE IF NOT EXISTS`, called from `app/actions/provisioning.ts`
right after `validateD1Credentials` passes and before the D1 credential
fields are persisted. `IF NOT EXISTS` means a credential rotation against
an already-provisioned org re-runs this harmlessly rather than erroring.

Three new tests in `test/provision.test.ts`, mirroring the existing
`validateD1Credentials` cases (success, a Cloudflare-side rejection, a
network failure) plus asserting the actual SQL sent. Verified:
`npx tsc --noEmit` clean, `npm run lint` 0 errors, `npm test` 179/179.

Next: Phase 5 -- the actual cutover. `lib/db.ts`'s `prisma` export is
still named `prisma`, not yet renamed to `centralPrisma` (docs/DECISIONS.md
§19's "deliberately breaking rename" forcing function), and nothing
outside the provisioning UI itself calls `getTenantPrisma`/
`withTenantPrisma` yet -- every real audit, page, Server Action, and
Workflow step still reads and writes the one shared database and shared
D1. Not started this entry; see the plan for how it's being sequenced.

## 22 Aug 2026 -- Per-tenant Neon + D1 Phase 5 cutover, plus the final whole-branch review's fixes

The actual cutover: 11 tasks plus one supplemental (task 11b), per
`docs/superpowers/plans/2026-08-21-per-tenant-phase5-cutover.md` --
`lib/db/tenant.ts`'s `getTenantPrisma`/`withTenantPrisma` and
`lib/http/auth-guard.ts`'s `requireTenantPrisma`, built in Phase 4 and
unused until now, threaded through every remaining call site: every
Server Action, every `(dash)` page, every API route, the MCP server's
bearer-token resolution, the audit Workflow (`lib/workflows/auditRun.ts`),
and the dev/ops scripts under `scripts/`. `tenant.service.ts`'s
`defaultSite` and the `require*Access` functions now resolve each org's
own tenant client internally and throw `NotProvisionedError` for any
organisation whose `provisionStatus` isn't `'ready'` -- which, since
every new signup defaults to `'unprovisioned'`, is the normal state for
a brand new organisation, not an edge case.

A final whole-branch review caught that this last point had not actually
been handled end to end. Fixed in this same session, in order:

1. **Critical**: `app/(dash)/layout.tsx` unconditionally called
   `defaultSite`/`listGroupsWithAggregates`, which now throw for an
   unprovisioned org. Since this layout wraps every `(dash)` page --
   including `/settings/database`, the only page that can provision an
   org -- every new signup was locked out of the one page that would fix
   their situation, and `app/(dash)/error.tsx` cannot catch its own
   segment's layout errors (Next.js semantics). Fixed by wrapping the
   two calls in a `try`/`catch` for `NotProvisionedError` and degrading
   to the existing "no site configured yet" shape (`site = null`,
   `groups = []`) instead of crashing or redirecting -- redirecting from
   this layout to `/settings/database` would loop, since that page is
   also wrapped by it.
2. Six pages (`app/(dash)/page.tsx`, `g/[slug]`, `p/[pageId]`, and the
   automation/site/notifications settings pages) and four API routes
   (`api/runs/active`, `api/reports/bulk`, `api/runs/[runId]/log`,
   `api/runs/[runId]/progress`) called tenant-data functions directly
   and had no handling for `NotProvisionedError`. Pages now catch it at
   their first tenant-touching call and redirect to
   `/settings/database`; the API routes return `{ error:
   'not_provisioned' }` at HTTP 409, matching each route's existing
   structured-JSON-error shape.
3. Added `app/error.tsx` as a root-level error boundary backstop --
   there was no `error.tsx`/`global-error.tsx` above `app/(dash)/`, so a
   crash in that layout (or anything outside `(dash)`) fell through to a
   blank framework error page.

Two more Important findings, both in verification scripts:

4. `scripts/verify-tenant-isolation.ts` -- the repo's only automated
   cross-tenant isolation check -- created two fake organisations in the
   single shared central database and asserted isolation via
   `tenant.service.ts`'s `require*Access` functions. Post-cutover, both
   fake orgs are unprovisioned, so every call throws
   `NotProvisionedError`, and the script's own `mustRefuse()` helper
   treats any thrown error as a PASS -- every cross-tenant assertion was
   reporting PASS for a config error, not a real isolation result.
   Rewritten to require two real, throwaway tenant database connection
   strings (`TENANT_DEV_DATABASE_URL_A`/`_B`), run real tenant migrations
   against each via `lib/tenantDb/provision.ts`'s `runTenantMigrations`,
   and create two real central `Organization` rows whose
   `tenantDbUrlEnc` (via `lib/crypto/secretBox.ts`'s envelope encryption,
   same as production provisioning) actually points at those two
   databases -- so `getTenantPrisma` resolves the two fake orgs to two
   genuinely separate databases, and a direct query against org B's own
   client for an id that only exists in org A's database proves the
   isolation is structural, not a `WHERE` clause. Verified locally
   end-to-end against two throwaway Postgres databases, including that
   cleanup and re-runs work.
5. `scripts/throughput-dryrun.ts` still constructed a `@prisma/client`
   `PrismaClient` connected via `DATABASE_URL` to call
   `prisma.rateLimitBucket.deleteMany(...)`, but `RateLimitBucket` lives
   in the tenant schema now. Same mechanical fix already applied to 6
   other scripts: import from `lib/generated/tenant/index.js`, connect
   via `TENANT_DEV_DATABASE_URL`. Verified locally against a throwaway
   tenant database.

New tests proving the plumbing this migration depends on actually works,
where nothing previously asserted it: `recordAuditResult`
(`test/audit.service.test.ts`) and `pruneSiteHistory`
(`test/retention.test.ts`) each get a test confirming a real `D1Credentials`
argument is threaded through to the injected storage/delete callback
rather than silently falling back to env-derived credentials. The cron
route's per-org isolation (one org's tenant database being unreachable
must not stop the tick from reaching the rest) wasn't practical to test
against `app/api/cron/schedule-tick/route.ts` directly -- its imports go
through the `@/` path alias that only Next's bundler and tsc resolve, and
it pulls in `centralPrisma`/`withTenantPrisma`/several services with no
injection points -- so the per-org `try`/`catch` loop was pulled out into
`lib/cron/orgLoop.ts` (`forEachOrgIsolated`) as a small,
behavior-preserving extraction, and `test/orgLoop.test.ts` exercises it
directly.

Also: three trivial cleanups (a dead `lib/db.ts` entry in
`eslint.config.mjs`'s framework-free-zone file list -- verified the rule
still fires by planting a deliberate bad import and reverting it; a stale
comment on `app/api/cron/schedule-tick/route.ts` overclaiming that
`withTenantPrisma` is used for the whole route when only
`reconcileStaleRuns` actually goes through it; a comment on
`lib/workflows/auditRun.ts` explaining why `organizationId` is the last
parameter there against the rest of the file's convention; and a stale
`lib/db.ts` reference in a `lib/db/tenant.ts` comment, updated to
`lib/db/central.ts`).

Verified: `npx tsc --noEmit` 0 errors, `npm run lint` 0 errors, `npm test`
all 183 tests passing, including the new ones added in this pass. `npm
run build` was not re-verified end-to-end in this pass (needs a real
`DATABASE_URL` wired through Vercel's own build per the `vercel env pull`
gotcha) -- `npx prisma generate` was confirmed clean for both schemas
instead.

**Still outstanding before this migration is fully done, independent of
anything above:**

- A manual production check that zero audit runs are in-flight before
  this deploys. The Workflow signature change earlier in this migration
  cannot resume old in-flight runs across the deploy boundary.
- Real end-to-end verification against a provisioned organisation on an
  actual Vercel **preview** deployment, not just `next dev` -- this
  repo's Workflow SDK has a known-flaky local dev transport (steps queued
  but never executing), so `next dev` alone does not prove the Workflow
  changes in this migration actually work.

## 22 Aug 2026 (later) -- Per-membership onboarding tour, all 7 tasks

Live preview testing of Phase 5 surfaced that onboarding had quietly
disappeared: the Phase 5 fix above (degrading `(dash)/layout.tsx` to
"no site configured" for an unprovisioned org) meant a brand-new org saw
an empty dashboard with nothing showing it around, and the redirect on
the six gated pages meant `/settings/database` was the only reachable
screen. Redesigned onboarding from scratch per
`docs/superpowers/specs/2026-08-22-onboarding-tour-design.md`, executed
as a 7-task plan
(`docs/superpowers/plans/2026-08-22-onboarding-tour-implementation.md`),
inline in this session:

1. Schema: replaced `User.roleTourSeenAt` (one flag, whole app) with
   `Membership.tourStepsSeen: String[]` and
   `Membership.checklistDismissedAt` -- per-membership, not per-user, so
   a removed-then-re-added teammate or a role change surfaces onboarding
   correctly instead of it being permanently marked seen on the user row.
2. `lib/onboarding/tourSteps.ts` / `tourProgress.ts`: a capability-gated
   tour catalog (7 steps covering the whole app, not just database
   setup) and `remainingTourSteps(role, seen)` -- a step reappears the
   moment a role gains the capability it needs, without replaying steps
   already seen at a lower role.
3. Server Actions (`app/actions/onboarding.ts`): mark-step-seen,
   skip-all, dismiss/reopen the checklist.
4. `TourProvider`/`TourEngine`/`TourTooltip`: opportunistic client-side
   tooltip rendering keyed off `data-tour="..."` attributes and route
   matching, Next/Complete style.
5. `data-tour` attributes added to the real target elements. Found and
   removed one planned step (`report-raw-json`) that pointed at a
   capability (`developer:access`) with no actual UI anywhere in the
   app -- a real "don't tour a feature that doesn't exist" catch.
6. `FloatingChecklist`: the bottom-left, dismissible widget replacing
   the old dashboard-embedded `SetupChecklist` panel, reopenable from
   Settings → Profile.
7. **Demo-aware data for unprovisioned organizations.** The six pages
   that used to redirect to `/settings/database` (dashboard, group,
   page report, and the automation/site/notifications settings pages)
   now render against realistic canned fixture data
   (`lib/onboarding/demoData.ts`) via a generic
   `demoAware<T>(real, demo)` wrapper (`lib/onboarding/demoTenant.ts`)
   that catches `NotProvisionedError` and falls back transparently --
   "we can't restrict the flow to /database unnecessarily" was the
   explicit ask. Three of the six pages read tenant data through raw
   `getTenantPrisma` queries rather than named service functions, which
   the spec's rough sketch hadn't anticipated; handled with small
   purpose-built bundled wrappers rather than a fake Prisma client.
   `RunAuditButton` and `RecommendationPanel` take a `demoMode` prop
   that disables the action with an explanatory tooltip -- a fully
   interactive simulated audit pipeline was scoped out as materially
   larger, separate work and confirmed with the user before building
   the rest of this task on that assumption. Every other mutating form
   (add/edit site, PSI key, schedule, ...) is left wired to its real
   Server Action; submitting one against a demo org already surfaces
   the friendly `NotProvisionedError` message from the earlier
   `lib/http/actionError.ts` fix rather than a raw error, so no further
   gating was needed there.

Before writing the plan, walked the whole app as a PM/tester/customer
per the user's explicit ask ("if I deploy in the real world I don't
want to be embarrassed") and found two real issues, both fixed as part
of this plan rather than filed for later.

Verified per task and again at the end: `npx tsc --noEmit` clean,
`npm run lint` 0 errors, `npm test` 189/189 passing, and a real `npm run
build` against a disposable local Postgres applying all 12 central
migrations cleanly. Not yet verified: a live Vercel preview walkthrough
of the tour and demo-mode pages by an actual browser session -- the
same `next dev` Workflow-transport caveat from the Phase 5 entry above
applies, and demo mode in particular has never been clicked through by
a human.
