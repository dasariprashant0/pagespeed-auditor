/**
 * Error types shared by the framework-free zone.
 *
 * NOTE: no TypeScript parameter properties (`constructor(private readonly x)`)
 * anywhere in this file. Node's native type-stripping is strip-only -- it
 * removes types without emitting code -- and a parameter property requires
 * emitting an assignment, so it throws ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX.
 * Since `node --test` and the bare worker both load this module, fields must be
 * declared and assigned explicitly.
 */

/** Base for errors we raise deliberately, as opposed to bugs. */
export class AppError extends Error {
  readonly code: string;
  readonly cause?: unknown;

  constructor(message: string, code: string, cause?: unknown) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.cause = cause;
  }
}

export class NotFoundError extends AppError {
  constructor(what: string) {
    super(`${what} not found`, 'not_found');
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 'validation');
  }
}

/** Worth another attempt: 429, 5xx, network, malformed body. */
export class RetryableError extends AppError {
  readonly retryAfterMs?: number;

  constructor(message: string, retryAfterMs?: number, cause?: unknown) {
    super(message, 'retryable', cause);
    this.retryAfterMs = retryAfterMs;
  }
}

/** Never worth retrying: bad URL, bad API key, 404. Burns attempts for nothing. */
export class PermanentError extends AppError {
  constructor(message: string, cause?: unknown) {
    super(message, 'permanent', cause);
  }
}

/** Prisma unique-constraint violation -- for us, almost always a replayed job. */
export function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    'code' in e &&
    (e as { code?: unknown }).code === 'P2002'
  );
}
