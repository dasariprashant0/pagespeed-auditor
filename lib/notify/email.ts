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
export async function sendEmail(to: string[], subject: string, html: string, text: string): Promise<void> {
  const transport = process.env.EMAIL_TRANSPORT ?? 'none';
  if (to.length === 0) return;

  if (transport === 'none') {
    logger.info({ to, subject, preview: text.slice(0, 200) }, 'email suppressed (EMAIL_TRANSPORT=none)');
    return;
  }

  const host = process.env.SMTP_HOST;
  if (!host) throw new Error('EMAIL_TRANSPORT=smtp but SMTP_HOST is not set');

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
}
