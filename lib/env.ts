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
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
  // Namespaces every Redis key this app still uses -- the PSI rate limiter's
  // token bucket and the scheduler heartbeat. No longer a BullMQ queue prefix
  // (the name predates that removal; not worth a Vercel env var rename).
  QUEUE_PREFIX: z.string().default('psa'),

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

  AUTH_USERNAME: z.string().default('admin'),

  /**
   * A bcrypt hash is full of `$`, and Next loads .env through dotenv-expand,
   * which reads `$2b` and `$12` as variable references and expands them to
   * nothing -- a 60-character hash arrives as 29 and login fails with no
   * useful error. Plain `dotenv` (the worker and scripts) does no expansion.
   *
   * So the hash is stored escaped as `\$2b\$12\$...`, which dotenv-expand
   * unescapes for us, and this transform unescapes it for everyone else. Both
   * paths end up with the same value. `npm run set-password` writes the
   * escaped form; an unescaped hash pasted by hand still works under plain
   * dotenv and is repaired here for Next.
   */
  AUTH_PASSWORD_HASH: z
    .string()
    .default('')
    .transform((v) => v.replace(/\\\$/g, '$')),
  SESSION_SECRET: z.string().default(''),
  SESSION_TTL_DAYS: int(30),

  /**
   * Audit results kept per page and strategy. Ten is roughly two months of
   * weekly checks. A run's results, markdown and recommendation are kept and
   * removed together -- a report you can open but whose evidence was deleted is
   * worse than one that has plainly aged out.
   */
  RESULT_RETAIN_RUNS: int(10),
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
