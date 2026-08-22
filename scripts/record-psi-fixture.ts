/**
 * Records real PSI responses as test fixtures.
 *
 * M1's whole point is that the extraction field paths are asserted against
 * responses we actually observed, not against the documented contract. Run this
 * once, commit the output, and every later change is testable offline for free.
 *
 *   npx tsx scripts/record-psi-fixture.ts
 *
 * Targets are deliberately public, third-party URLs -- no company data leaves
 * the machine here.
 */
import 'dotenv/config';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const KEY = process.env.PSI_API_KEY;
if (!KEY) throw new Error('PSI_API_KEY is not set (Prisma-style .env, not .env.local)');

const OUT = 'test/fixtures/psi';
const CATEGORIES = ['PERFORMANCE', 'ACCESSIBILITY', 'BEST_PRACTICES', 'SEO'];

interface Target {
  name: string;
  url: string;
  strategy: 'mobile' | 'desktop';
  /** What this fixture is supposed to prove. */
  proves: string;
}

const TARGETS: Target[] = [
  {
    name: 'mobile-field-full',
    url: 'https://www.wikipedia.org/',
    strategy: 'mobile',
    proves: 'high-traffic URL with full CrUX field data',
  },
  {
    name: 'desktop-basic',
    url: 'https://example.com/',
    strategy: 'desktop',
    proves: 'desktop strategy; minimal page',
  },
  {
    name: 'mobile-no-field',
    url: 'https://www.iana.org/help/example-domains',
    strategy: 'mobile',
    // Turned out to have real page-level field data when this was recorded --
    // see mobile-origin-fallback below for the case this name originally
    // wanted. Kept (and kept its name) since other tests already use it for
    // its actual content (the CLS-percentile scaling assertions).
    proves: 'low-traffic URL -> loadingExperience absent or origin_fallback',
  },
  {
    name: 'mobile-origin-fallback',
    url: 'https://httpbin.org/anything/psi-fixture-probe',
    strategy: 'mobile',
    // The one still missing per docs/RESUME_HERE.md as of 20 Aug 2026: this
    // specific page doesn't get enough real Chrome traffic for its OWN CrUX
    // entry, but httpbin.org's origin overall does -- loadingExperience.
    // origin_fallback: true. Found by probing several public reference
    // domains (Wikipedia, MDN, RFC editor, IANA, w3.org) on 22 Aug 2026;
    // most of those turned out to have real page-level data of their own.
    // The other missing case -- loadingExperience absent entirely, meaning
    // even the ORIGIN doesn't qualify -- was not reproduced against any
    // public domain tried; every reasonably well-known reference domain
    // has at least origin-level CrUX volume. That path stays covered only
    // by the hand-built {} case in test/extract.test.ts.
    proves: 'origin_fallback: true (page has no CrUX entry of its own, origin does)',
  },
  {
    name: 'mobile-runtime-error',
    url: 'https://httpstat.us/500',
    strategy: 'mobile',
    proves: 'lighthouseResult.runtimeError set -> permanent content error',
  },
];

function buildUrl(t: Target): string {
  const u = new URL('https://www.googleapis.com/pagespeedonline/v5/runPagespeed');
  u.searchParams.set('url', t.url);
  u.searchParams.set('strategy', t.strategy);
  // Four REPEATED params. Comma-joining silently returns Performance only.
  for (const c of CATEGORIES) u.searchParams.append('category', c);
  u.searchParams.set('key', KEY!);
  return u.toString();
}

async function main() {
  mkdirSync(OUT, { recursive: true });

  for (const [i, t] of TARGETS.entries()) {
    // Stay under the sustained rate even for a handful of calls.
    if (i > 0) await sleep(2000);

    process.stdout.write(`[${i + 1}/${TARGETS.length}] ${t.name} (${t.strategy}) ${t.url}\n`);
    const started = Date.now();

    const res = await fetch(buildUrl(t), { signal: AbortSignal.timeout(120_000) });
    const elapsed = Date.now() - started;
    const text = await res.text();

    if (!res.ok) {
      // A non-200 is itself worth capturing for the client's error-classification tests.
      writeFileSync(`${OUT}/${t.name}.error.json`, text);
      console.log(`   HTTP ${res.status} in ${elapsed}ms -> saved as .error.json`);
      continue;
    }

    writeFileSync(`${OUT}/${t.name}.json`, text);
    const j = JSON.parse(text);
    const le = j.loadingExperience;
    console.log(
      `   HTTP 200 in ${elapsed}ms | ${(text.length / 1024).toFixed(0)} KB | ` +
        `field=${le?.metrics ? (le.origin_fallback ? 'origin_fallback' : 'page') : 'none'} | ` +
        `runtimeError=${j.lighthouseResult?.runtimeError?.code ?? '-'}`,
    );
  }

  console.log('\nDone. Fixtures in', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
