# PageSpeed Auditor

> Watches how fast every page of zuddl.com is, and whether it is getting better or worse.

## What it does

Every page on the site gets tested through Google's PageSpeed Insights — the
same tool as [pagespeed.web.dev](https://pagespeed.web.dev), just run
automatically for all 747 pages instead of one at a time. Both phone and
desktop. Every result is kept, so you can see whether a page improved after a
change or quietly got worse.

## Getting in

Open **http://localhost:3000** and sign in.

- Username: `admin`
- Password: whatever you set (change it any time with
  `npm run set-password -- 'a-new-password'`, then restart)

## The screens

**Overview** — every section of the site as a card, in the order your sitemap
lists them. Each shows an average score, the worst page in it, and a coloured
bar for how many pages are good / need work / poor. Above that, "Top issues"
lists the problems affecting the most pages, which is usually where one fix
helps dozens of pages at once.

**A section** (click any card) — every page in it, with scores side by side.
Click a page to open its report.

**A page report** — what pagespeed.web.dev shows, plus history:
- Four scores with a coloured ring: red under 50, orange 50–89, green 90+
- A screenshot of how the page rendered
- **Field data** — real visitors' experience over the last 28 days. Quieter
  pages will say "not enough real-user data", which is normal, not an error.
- **Lab metrics** — the simulated test. LCP is how long the biggest thing takes
  to appear; CLS is how much the page jumps around while loading.
- What to fix, in order, with the actual files named
- **What to fix first** — press Generate for a written explanation
- History charts showing whether each score is climbing or falling

**Settings** — when the automatic check runs, who gets told, and which sections
get tested first.

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
