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

export function emailIsConfigured(): boolean {
  return (process.env.EMAIL_TRANSPORT ?? 'none') === 'smtp' && Boolean(process.env.SMTP_HOST);
}

export async function sendEmail(
  to: string[],
  subject: string,
  html: string,
  text: string,
): Promise<EmailOutcome> {
  const transport = process.env.EMAIL_TRANSPORT ?? 'none';
  if (to.length === 0) return { sent: false, reason: 'No recipient address.' };

  if (transport === 'none') {
    // Logging is a legitimate dev mode, but returning success here is how the
    // UI came to report "Test sent" when nothing had been sent.
    logger.info({ to, subject, preview: text.slice(0, 200) }, 'email suppressed (EMAIL_TRANSPORT=none)');
    return {
      sent: false,
      reason:
        'EMAIL_TRANSPORT is "none", so the message was written to the log instead of sent. ' +
        'Set EMAIL_TRANSPORT=smtp plus SMTP_HOST/SMTP_USER/SMTP_PASS in .env and restart.',
    };
  }

  const host = process.env.SMTP_HOST;
  if (!host) return { sent: false, reason: 'EMAIL_TRANSPORT=smtp but SMTP_HOST is not set.' };

  const port = Number(process.env.SMTP_PORT ?? 587);
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });

  await transporter.sendMail({
    from: process.env.SMTP_FROM ?? 'PageSpeed Auditor <noreply@localhost>',
    to: to.join(', '),
    subject,
    text,
    html,
  });
  logger.info({ to, subject }, 'email sent');
  return { sent: true };
}
