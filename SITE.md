# PageSpeed Auditor

> Watches how fast every page of zuddl.com is, and whether it is getting better or worse.

## What it does

Every page on the site gets tested through Google's PageSpeed Insights — the
same tool as [pagespeed.web.dev](https://pagespeed.web.dev), just run
automatically for all 747 pages instead of one at a time. Both mobile and
desktop. Every result is kept, so you can see whether a page improved after a
change or quietly got worse.

## Getting in

Open **http://localhost:3000** and sign in.

- Username: `admin`
- Password: whatever you set (change it any time with
  `npm run set-password -- 'a-new-password'`, then restart)

## The screens

**Overview** — a chart of the whole site at the top, then the problems
affecting the most pages, then every section as a card.

The chart has four views, and it remembers which one you last used:
- **Every page** — one bar per page, worst on the left. Hover for the page and
  its score; click to open its report. A long red shoulder means something is
  wrong across the site; a thin red tail means a handful of bad pages.
- **Spread** — how many pages land in each ten-point band.
- **By section** — section averages, weakest first. The dark tick on each bar
  is the worst page in that section, so a good average can't hide a bad page.
- **Load time vs score** — where slow loading is costing the score.

You can also switch which score it charts, or narrow it to one section.

Each section card shows an average score, the worst page in it, and a coloured
bar for how many pages are good / need work / poor. **Drag the cards to change
the order sections get tested in** — the same order appears in the sidebar, and
dragging in either place moves both. If you'd rather not drag, hover a card and
use the small ↑ ↓ buttons. "Reset to sitemap order" undoes all of it.

**A section** (click any card) — every page in it, with scores side by side.
Click a page to open its report.

**The sidebar** — every section, with a search box and a sort selector above
it. Sorting or searching switches dragging off, because it would be saving an
order you can't see.

**A page report** — what pagespeed.web.dev shows, plus history:
- Four scores with a coloured ring: red under 50, orange 50–89, green 90+
- A screenshot of how the page rendered
- **Field data** — real visitors' experience over the last 28 days. Quieter
  pages will say "not enough real-user data", which is normal, not an error.
- **Lab metrics** — the simulated test. LCP is how long the biggest thing takes
  to appear; CLS is how much the page jumps around while loading.
- What to fix, in order, with the actual files named
- **What to fix first** — press Generate for a written explanation. Press
  Regenerate and the old answer is kept, not replaced: "Earlier answers" lists
  the last ten so you can compare them.
- **Download .md** — a file written for a coding agent (Cursor, Claude, Codex)
  with the actual failing resources and measured savings. It asks whether you
  want the mobile measurement, the desktop one, or both in one file. Both is
  usually right: an agent that can see them side by side can tell a
  device-specific problem from a page-wide one.
- History charts showing whether each score is climbing or falling

**Settings → Automation** — whether the background worker is actually alive,
when the next check runs, the last ten checks, and the schedule and
notification settings. Section order lives on the Overview now, as dragging.

**While a check is running** — a progress bar appears at the top of every
screen with **Hold**, **Continue** and **Stop**.
- *Hold* stops new pages being sent. Pages already being measured finish, so a
  few more results will land after you press it. Nothing is lost, and Continue
  picks up where it stopped.
- *Stop* ends the run for good. Everything measured so far is kept — the run is
  recorded as stopped, not failed — but the rest is dropped and Google's quota
  isn't refunded, so it asks first.

## Things worth knowing

**Testing takes real time.** Each page takes about a minute for Google to
measure, and Google limits how fast we can ask. Testing the whole site is about
35 minutes. That is why there is no "test everything now" button — it would sit
there doing nothing visible for half an hour. Whole-site runs happen on a
schedule you set; individual pages and sections you can run any time.

**Some pages fail to load for the tester.** A few pages come back as "Lighthouse
could not measure this page". That is a genuine finding about the page, not a
broken tool — worth passing to whoever owns it.

**INP always shows a dash in Lab metrics.** That one can only be measured from
real visitors, never in a simulation. If the page has enough traffic it appears
under Field data instead.

## When something looks wrong

- **Scores did not update** — check the progress bar at the top; a run may still
  be going. It links to whatever is being tested.
- **Nothing happens when you press a button** — the background worker may not be
  running. Start it with `npm run worker`.
- **A page shows dashes everywhere** — it has not been tested yet. Press
  "Re-run this page".

## For whoever maintains it

Technical documentation is in `docs/`: `RESUME_HERE.md` to pick the work up,
`PLAN.md` for the design, `DECISIONS.md` for why it is built this way, and
`BUILD_LOG.md` for what happened along the way.
