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
  const transport = process.env.EMAIL_TRANSPORT ?? 'none';
  if (transport === 'resend') {
    if (!process.env.RESEND_API_KEY) {
      return 'RESEND_API_KEY is not set. Create a key at resend.com, verify your domain, then run: npm run env -- RESEND_API_KEY re_xxx';
    }
    if (!process.env.EMAIL_FROM) {
      return 'EMAIL_FROM is not set. Use an address on your verified domain, e.g. "PageSpeed Auditor <pagespeed@zuddl.com>".';
    }
    return null;
  }

  if (transport !== 'smtp') {
    return 'Email is not configured, so messages are written to the log instead of sent. Set EMAIL_TRANSPORT to "resend" (sends as the app from your own domain) or "smtp" (sends from one person\'s mailbox).';
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
  if (to.length === 0) return { sent: false, reason: 'No recipient address.' };

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
