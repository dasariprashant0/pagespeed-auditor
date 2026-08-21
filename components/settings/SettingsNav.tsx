import Link from 'next/link';

/**
 * Every section is shown to every role.
 *
 * Previously hidden per role ("hiding is presentation, not protection" --
 * every action still re-checks the capability server-side either way), but
 * that meant a viewer had no way to even SEE the current schedule, the
 * team list, or the site config -- only an admin could look. Visibility and
 * edit rights are different questions now: everyone can see every settings
 * screen; each page decides for itself whether its forms are editable for
 * this role (see the canEdit prop threaded through each one) or shown
 * disabled with a note about who can change it.
 */
export function SettingsNav({ active }: { active: string }) {
  const tabs = [
    { href: '/settings/profile', label: 'Profile' },
    { href: '/settings/team', label: 'Teammates' },
    { href: '/settings/site', label: 'Site' },
    { href: '/settings/automation', label: 'Automation' },
    { href: '/settings/notifications', label: 'Notifications' },
    { href: '/settings/database', label: 'Database' },
  ];

  return (
    <nav aria-label="Settings sections" className="mb-5 flex flex-wrap gap-1 border-b border-[var(--border)]">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t.href === active ? 'page' : undefined}
          className={`-mb-px border-b-2 px-3 py-2 text-[12px] ${
            t.href === active
              ? 'border-[var(--foreground)] font-medium'
              : 'border-transparent text-[var(--muted)] hover:text-[var(--foreground)]'
          }`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
