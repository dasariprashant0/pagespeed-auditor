import nodemailer from 'nodemailer';
import { logger } from '../logger.ts';
import { getEnv } from '../env.ts';

/**
 * SMTP rather than a hosted API on purpose: for roughly thirty emails a month,
 * reusing credentials the company already has beats onboarding a vendor with
 * domain verification and another key to rotate.
 *
 * EMAIL_TRANSPORT=none (the default) logs the rendered payload instead of
 * sending, which is also how this path is tested without a mail server.
 */
export type EmailOutcome =
  | { sent: true }
  /** Not an error, but the caller must NOT report this as delivered. */
  | { sent: false; reason: string };

/**
 * "Configured" means it can ACTUALLY send.
 *
 * Checking only the host would let the UI announce email is ready while
 * SMTP_PASS is blank, and then fail on authentication -- the same false
 * reassurance as reporting "Test sent" from log-only mode, just later and
 * harder to trace.
 */
export function emailConfigProblem(): string | null {
  const env = getEnv();
  if (env.EMAIL_TRANSPORT === 'resend') {
    if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
      return 'This deployment\'s shared sender isn\'t finished setting up — ask whoever manages hosting, or set your own mailbox above instead.';
    }
    return null;
  }

  if (env.EMAIL_TRANSPORT !== 'smtp') {
    return 'This deployment has no shared sender configured, so messages are written to the log instead of sent. Set your own mailbox above, or ask whoever manages hosting to configure one.';
  }
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS) {
    return 'This deployment\'s shared mailbox isn\'t finished setting up — ask whoever manages hosting, or set your own mailbox above instead.';
  }
  return null;
}

export function emailIsConfigured(): boolean {
  return emailConfigProblem() === null;
}

/**
 * Per-organisation SMTP override (Organization.smtp* in the schema) --
 * see docs/DECISIONS.md for why this exists and why password-reset emails
 * deliberately do NOT take one.
 */
export interface SmtpOverride {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}

function transporterFor(override?: SmtpOverride) {
  const env = getEnv();
  const host = override?.host ?? env.SMTP_HOST;
  const port = override?.port ?? env.SMTP_PORT;
  const user = override?.user ?? env.SMTP_USER;
  const pass = override?.pass ?? env.SMTP_PASS;
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: user ? { user, pass } : undefined,
  });
}

function gmailHint(msg: string): string {
  // Gmail's auth rejection is cryptic; name the usual cause. Bare "534"/"535"
  // used to be in this pattern too, matching Gmail's actual SMTP response
  // code -- but those same digits also show up incidentally in a plain
  // ETIMEDOUT's "host:port" (port 535 is a real, if wrong, port number), so a
  // bare network-connection failure was getting a false "Gmail rejected your
  // credentials" hint glued onto it. "Invalid login"/"Username and Password"
  // are the actual, specific phrases nodemailer/Gmail use for a real auth
  // rejection and don't have that collision.
  return /invalid login|username and password|BadCredentials/i.test(msg)
    ? ' — Gmail rejected the credentials. The password must be a 16-character App Password (no spaces), not the account password, and 2-Step Verification must be on for that account.'
    : '';
}

/**
 * Connects and authenticates without sending anything -- the SMTP
 * equivalent of updatePsiKeyAction's probe call to Google, so a wrong
 * password fails here, at save time, rather than silently on the next
 * invite or notification.
 */
export async function verifySmtpConnection(override: SmtpOverride): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await transporterFor(override).verify();
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `${msg}${gmailHint(msg)}` };
  }
}

export async function sendEmail(
  to: string[],
  subject: string,
  html: string,
  text: string,
  override?: SmtpOverride,
): Promise<EmailOutcome> {
  if (to.length === 0) return { sent: false, reason: 'No recipient address.' };

  // The shared default's own configuration is checked only when there is no
  // per-organisation override -- an override was already verified at save
  // time (see verifySmtpConnection), and the shared SMTP_* vars may be
  // deliberately unset for an organisation that always overrides.
  if (!override) {
    const problem = emailConfigProblem();
    if (problem) return { sent: false, reason: problem };
  }

  const transporter = transporterFor(override);
  // || not ?? -- SMTP_FROM's zod default is '' (unset), not undefined, same
  // reason as everywhere else in lib/env.ts that checks truthiness rather
  // than nullishness for an optional string field.
  const from = override?.from || getEnv().SMTP_FROM || 'PageSpeed Auditor <noreply@localhost>';

  try {
    await transporter.sendMail({ from, to: to.join(', '), subject, text, html });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error({ to, err: msg }, 'smtp send failed');
    return { sent: false, reason: `SMTP error: ${msg}${gmailHint(msg)}` };
  }

  logger.info({ to, subject }, 'email sent');
  return { sent: true };
}
