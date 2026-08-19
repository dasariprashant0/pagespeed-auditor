/** Base for errors we raise deliberately, as opposed to bugs. */
export class AppError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
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
  constructor(
    message: string,
    readonly retryAfterMs?: number,
    cause?: unknown,
  ) {
    super(message, 'retryable', cause);
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
