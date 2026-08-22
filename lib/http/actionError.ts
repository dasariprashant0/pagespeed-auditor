import { NotProvisionedError } from '../errors.ts';
import { ForbiddenError } from './auth-guard.ts';

/**
 * A safe, user-facing message for an error caught in a Server Action.
 *
 * `NotProvisionedError`'s own message embeds a raw organizationId -- meant
 * for logs, not a real customer's error banner (`Organization
 * cmt0h7c0k0000dqw6maqodx2k has not connected a database yet`). Every other
 * known-safe error type this app throws deliberately (ForbiddenError, and
 * any generic Error) already carries a message written for a person to
 * read, and keeps passing straight through -- this only intercepts the one
 * type whose message was never meant to be shown as-is.
 */
export function friendlyErrorMessage(e: unknown, fallback: string): string {
  if (e instanceof NotProvisionedError) {
    return 'This organisation has not connected a database yet. An admin can connect one in Settings → Database.';
  }
  if (e instanceof ForbiddenError) return e.message;
  return e instanceof Error ? e.message : fallback;
}
