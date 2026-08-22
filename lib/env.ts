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

/**
 * `z.enum([...]).default(x)` alone only substitutes `x` for a genuinely
 * ABSENT key -- an explicitly-set-but-empty one (`LOG_LEVEL=""`, which is
 * exactly how Vercel's dashboard stores a variable someone cleared without
 * deleting) still reaches z.enum() as `''`, which isn't one of the allowed
 * values, and fails the WHOLE schema.safeParse -- every getEnv() caller
 * throws, not just whatever feature happens to read that one field. Found
 * this exact state already live in this project's production env for both
 * LOG_LEVEL and EMAIL_TRANSPORT; fixed here rather than by editing the
 * Vercel var, since the code should not be one blank field away from every
 * page (including login) refusing to render.
 */
const enumDefault = <T extends readonly [string, ...string[]]>(values: T, def: T[number]) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : v))
    .pipe(z.enum(values));

const schema = z.object({
  NODE_ENV: enumDefault(['development', 'test', 'production'] as const, 'development'),
  APP_URL: z.string().url().default('http://localhost:3000'),
  LOG_LEVEL: enumDefault(['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const, 'info'),

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

  /**
   * The shared default sender, used when an organisation hasn't set its own
   * SMTP override -- see lib/notify/email.ts. These used to be read via
   * bare process.env in lib/notify/*, lib/ai/provider.ts, and a few Server
   * Components, which meant a typo (e.g. EMAIL_TRANSPORT=reesend) failed
   * silently at send time instead of loudly at boot, exactly the failure
   * mode this file exists to prevent everywhere else.
   */
  EMAIL_TRANSPORT: enumDefault(['none', 'resend', 'smtp'] as const, 'none'),
  RESEND_API_KEY: z.string().default(''),
  EMAIL_FROM: z.string().default(''),
  SMTP_HOST: z.string().default(''),
  SMTP_PORT: int(587),
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),
  SMTP_FROM: z.string().default(''),

  /** Optional: unset and signed into Claude Code, the CLI adapter runs on the subscription instead -- see lib/ai/provider.ts. */
  ANTHROPIC_API_KEY: z.string().default(''),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-5'),
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
