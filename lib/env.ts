import { z } from 'zod';

/**
 * Parsed once, frozen, and thrown on at boot. Both the web process and the
 * worker should refuse to start rather than fail mid-sweep at 2 a.m.
 *
 * NEVER import this from a client component, and never prefix any of these
 * with NEXT_PUBLIC_ -- Next inlines process.env.* into the client bundle,
 * which would ship PSI_API_KEY and SESSION_SECRET to the browser.
 *
 * NEVER import this from proxy.ts either -- that runs on the Edge runtime and
 * this module pulls in Node built-ins. Read process.env directly there.
 */

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : v === '1' || v.toLowerCase() === 'true'));

const int = (def: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : Number(v)))
    .pipe(z.number().int().positive());

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_URL: z.string().url().default('http://localhost:3000'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  /** How many pages a sweep processes per batch -- see lib/workflows/auditRun.ts. */
  WORKER_CONCURRENCY: int(20),
  PSI_RATE_MAX: int(3),
  PSI_RATE_WINDOW_MS: int(4000),
  STALE_RUN_HOURS: int(12),

  /** Verifies /api/cron/schedule-tick requests actually came from Vercel Cron (or an equivalent external pinger). */
  CRON_SECRET: z.string().default(''),

  PSI_API_KEY: z.string().default(''),
  PSI_TIMEOUT_MS: int(90_000),
  PSI_MAX_ATTEMPTS: int(5),
  PSI_FAKE: bool(false),

  SITE_NAME: z.string().default('Company Site'),
  SITE_BASE_URL: z.string().url().optional(),
  SITE_SITEMAP_URL: z.string().url().optional(),
  SYNC_GROUP_PAGE_LIMIT: int(15),

  SESSION_SECRET: z.string().default(''),

  /**
   * Encrypts secrets too sensitive for a plain column -- see
   * lib/crypto/secretBox.ts. 64 hex chars (`openssl rand -hex 32`), the
   * same generation convention as SESSION_SECRET. Defaults to '' the same
   * way SESSION_SECRET does: lib/env.ts can't enforce length here since
   * the field must stay optional for anything that doesn't touch
   * encrypted secrets (tests, `next build` before this is set), so
   * secretBox.ts itself checks the length on first real use.
   */
  SECRET_BOX_KEY: z.string().default(''),

  /// Optional: "Continue with Google" alongside password sign-in, never
  /// instead of it. Empty means the button simply doesn't render -- see
  /// lib/auth/google.ts. From a Google Cloud OAuth 2.0 Client ID
  /// ("Web application" type); GOOGLE_CLIENT_SECRET must never reach the
  /// browser, unlike the client id, which is fine to be public.
  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  SESSION_TTL_DAYS: int(30),

  /**
   * Audit results kept per page and strategy. Ten is roughly two months of
   * weekly checks. A run's results, markdown and recommendation are kept and
   * removed together -- a report you can open but whose evidence was deleted is
   * worse than one that has plainly aged out.
   */
  RESULT_RETAIN_RUNS: int(10),

  /**
   * Where the pruned Lighthouse JSON actually lives -- see lib/blob.ts and
   * docs/DECISIONS.md §18. A Cloudflare D1 database, called over its plain
   * HTTP query API (no Workers runtime involved), because Vercel Blob's
   * free "Advanced Operations" allowance (2,000/month) is smaller than a
   * single full sweep of this site, and Cloudflare R2 -- the obvious
   * like-for-like replacement -- requires a card to enable even on its free
   * tier. D1's free tier does not.
   */
  CLOUDFLARE_ACCOUNT_ID: z.string().default(''),
  CLOUDFLARE_D1_DATABASE_ID: z.string().default(''),
  CLOUDFLARE_API_TOKEN: z.string().default(''),
});

export type Env = z.infer<typeof schema>;

function load(): Env {
  const parsed = schema.safeParse(process.env);

  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }

  return Object.freeze(parsed.data);
}

let cached: Env | undefined;

export function getEnv(): Env {
  cached ??= load();
  return cached;
}

/** Sustained requests/second the limiter allows. Purely derived; used in logs and tests. */
export function targetRequestsPerSecond(e = getEnv()): number {
  return (e.PSI_RATE_MAX / e.PSI_RATE_WINDOW_MS) * 1000;
}
