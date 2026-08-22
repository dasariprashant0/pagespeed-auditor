import { Resend } from 'resend';
import { logger } from '../logger.ts';
import { getEnv } from '../env.ts';
import type { EmailOutcome } from './email.ts';

/**
 * Sending as the application, not as a person.
 *
 * SMTP requires a real mailbox and its password, which means notifications go
 * out from somebody's personal account -- they break when that person leaves,
 * and replies land in their inbox. A transactional provider verifies the DOMAIN
 * instead, so mail sends from an address like pagespeed@zuddl.com that belongs
 * to nobody in particular. That is what makes it an app rather than a script
 * borrowing someone's credentials.
 */
export async function sendViaResend(
  to: string[],
  subject: string,
  html: string,
  text: string,
): Promise<EmailOutcome> {
  const env = getEnv();
  const key = env.RESEND_API_KEY;
  if (!key) return { sent: false, reason: 'RESEND_API_KEY is not set.' };

  const from = env.EMAIL_FROM;
  if (!from) {
    return {
      sent: false,
      reason: 'EMAIL_FROM is not set — use an address on a domain verified in Resend, e.g. "PageSpeed Auditor <pagespeed@zuddl.com>".',
    };
  }

  try {
    const { data, error } = await new Resend(key).emails.send({ from, to, subject, html, text });
    if (error) {
      // Domain verification is the failure every time on first setup.
      const hint = /domain|verif/i.test(error.message)
        ? ' — the sending domain is not verified in Resend yet. Add it under Domains and publish the DNS records it gives you.'
        : '';
      logger.error({ err: error.message }, 'resend send failed');
      return { sent: false, reason: `Resend: ${error.message}${hint}` };
    }
    logger.info({ to, id: data?.id }, 'email sent via resend');
    return { sent: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error({ err: msg }, 'resend threw');
    return { sent: false, reason: `Resend: ${msg}` };
  }
}
