import nodemailer from 'nodemailer';
import { logger } from '../logger.ts';

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
  if ((process.env.EMAIL_TRANSPORT ?? 'none') !== 'smtp') {
    return 'EMAIL_TRANSPORT is not "smtp", so messages are written to the log instead of sent.';
  }
  if (!process.env.SMTP_HOST) return 'SMTP_HOST is not set.';
  if (!process.env.SMTP_USER) return 'SMTP_USER is not set.';
  if (!process.env.SMTP_PASS) {
    return 'SMTP_PASS is empty — paste a Google App Password from myaccount.google.com/apppasswords into .env and restart. Your normal password will not work over SMTP.';
  }
  return null;
}

export function emailIsConfigured(): boolean {
  return emailConfigProblem() === null;
}

export async function sendEmail(
  to: string[],
  subject: string,
  html: string,
  text: string,
): Promise<EmailOutcome> {
  const transport = process.env.EMAIL_TRANSPORT ?? 'none';
  if (to.length === 0) return { sent: false, reason: 'No recipient address.' };

  if (transport !== 'smtp') {
    // Logging is a legitimate dev mode, but returning success here is how the
    // UI came to report "Test sent" when nothing had been sent.
    logger.info({ to, subject, preview: text.slice(0, 200) }, 'email suppressed (EMAIL_TRANSPORT=none)');
    return { sent: false, reason: emailConfigProblem() ?? 'Email is not configured.' };
  }

  const problem = emailConfigProblem();
  if (problem) return { sent: false, reason: problem };
  const host = process.env.SMTP_HOST!;

  const port = Number(process.env.SMTP_PORT ?? 587);
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });

  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM ?? 'PageSpeed Auditor <noreply@localhost>',
      to: to.join(', '),
      subject,
      text,
      html,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error({ to, err: msg }, 'smtp send failed');
    // Gmail's auth rejection is cryptic; name the usual cause.
    const hint = /invalid login|username and password|BadCredentials|534|535/i.test(msg)
      ? ' — Gmail rejected the credentials. SMTP_PASS must be a 16-character App Password (no spaces), not your account password, and 2-Step Verification must be on.'
      : '';
    return { sent: false, reason: `SMTP error: ${msg}${hint}` };
  }

  logger.info({ to, subject }, 'email sent');
  return { sent: true };
}
