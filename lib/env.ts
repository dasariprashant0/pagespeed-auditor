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
  QUEUE_PREFIX: z.string().default('psa'),

  WORKER_CONCURRENCY: int(20),
  PSI_RATE_MAX: int(3),
  PSI_RATE_WINDOW_MS: int(4000),
  QUEUE_LOCK_DURATION_MS: int(120_000),
  STALE_RUN_HOURS: int(12),

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

export type Env = z.infer<typeof schema> & {
  /** Queue lock must exceed the HTTP timeout or in-flight jobs get re-delivered. */
  readonly queueLockExceedsTimeout: boolean;
};

function load(): Env {
  const parsed = schema.safeParse(process.env);

  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }

  const e = parsed.data;

  // Not a style preference -- a lock shorter than the request timeout causes
  // BullMQ to mark still-running jobs as stalled and re-deliver them, which
  // silently doubles PSI quota burn. Fail loudly instead.
  if (e.QUEUE_LOCK_DURATION_MS <= e.PSI_TIMEOUT_MS) {
    throw new Error(
      `QUEUE_LOCK_DURATION_MS (${e.QUEUE_LOCK_DURATION_MS}) must exceed PSI_TIMEOUT_MS ` +
        `(${e.PSI_TIMEOUT_MS}), or in-flight PSI jobs are marked stalled and run twice.`,
    );
  }

  return Object.freeze({ ...e, queueLockExceedsTimeout: true });
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
