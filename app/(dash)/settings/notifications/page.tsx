import { can } from '@/lib/auth/roles';
import { PageHeader } from '@/components/ui/PageHeader';
import { prisma } from '@/lib/db';
import { requireSession } from '@/lib/http/auth-guard';
import { defaultSite, orgEmailRef } from '@/lib/services/tenant.service';
import { redirect } from 'next/navigation';
import { SettingsNav } from '@/components/settings/SettingsNav';
import { Section } from '@/components/settings/Section';
import { NotificationForm } from '@/components/settings/NotificationForm';
import { OrgEmailForm } from '@/components/settings/OrgEmailForm';
import { emailConfigProblem } from '@/lib/notify/email';

export const dynamic = 'force-dynamic';

/** Confirms a secret is set without disclosing it. */
function masked(v: string | null | undefined): string {
  if (!v) return 'not set';
  return v.length <= 12 ? '••••••••' : `${v.slice(0, 6)}${'•'.repeat(10)}${v.slice(-4)}`;
}

export default async function NotificationsSettingsPage() {
  // Visible to every role -- only automation:manage decides whether the
  // forms below actually accept input, the same capability that already
  // gated these two sections when they lived under Automation.
  const ctx = await requireSession();
  const canEdit = can(ctx.role, 'automation:manage');
  const site = await defaultSite(ctx.organizationId);
  if (!site) redirect('/');

  const [notif, orgEmail] = await Promise.all([
    prisma.notificationSetting.findUnique({ where: { siteId: site.id } }),
    orgEmailRef(ctx.organizationId),
  ]);

  // An organisation's own SMTP override (orgEmail.hasOverride) bypasses the
  // shared default entirely -- emailConfigProblem() only describes that
  // shared default, so it would wrongly report "not configured" for an
  // organisation that has already set its own mailbox.
  const emailProblem = orgEmail.hasOverride ? null : emailConfigProblem();
  const sentFromAddress = orgEmail.hasOverride
    ? orgEmail.user
    : process.env.EMAIL_TRANSPORT === 'resend' ? (process.env.EMAIL_FROM ?? null) : (process.env.SMTP_USER ?? null);

  return (
    <>
      <PageHeader crumbs={[{ label: 'Overview', href: '/' }, { label: 'Settings' }]} title="Notifications" subtitle="Who hears about it, and from where" />
      <SettingsNav active="/settings/notifications" />

      <div className="max-w-3xl space-y-3">
        <Section
          title="Email sending"
          hint={
            canEdit
              ? 'Your own mailbox for invitations and sweep notifications, instead of sharing the one everyone else on this deployment uses. Leave blank to keep using the shared default.'
              : 'Only an admin can change this.'
          }
        >
          <OrgEmailForm email={orgEmail} canEdit={canEdit} />
        </Section>

        <Section
          title="Notifications"
          hint={
            emailProblem
              ? `Both channels are off until you turn them on. Email cannot send yet: ${emailProblem} Slack needs none of that — a webhook URL alone works.`
              : `Both channels are off until you turn them on. Email is ready and will send via ${sentFromAddress ?? 'the shared default'}.`
          }
        >
          <NotificationForm
            sentFrom={sentFromAddress}
            appSender={!orgEmail.hasOverride && process.env.EMAIL_TRANSPORT === 'resend'}
            sharedDefault={!orgEmail.hasOverride}
            initial={{
              emailEnabled: notif?.emailEnabled ?? false,
              emailTo: notif?.emailTo ?? null,
              slackEnabled: notif?.slackEnabled ?? false,
              slackWebhookMasked: notif?.slackWebhookUrl ? masked(notif.slackWebhookUrl) : null,
            }}
            canEdit={canEdit}
          />
        </Section>
      </div>
    </>
  );
}
