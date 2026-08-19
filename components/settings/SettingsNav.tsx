import Link from 'next/link';
import { can, type Role } from '@/lib/auth/roles';

/**
 * Sections a person can actually use are the only ones shown.
 *
 * Hiding is presentation, not protection -- every action re-checks the
 * capability server-side -- but offering a viewer a "Team" tab that rejects
 * them on arrival is a worse experience than not offering it.
 */
export function SettingsNav({ role, active }: { role: Role; active: string }) {
  const tabs = [
    { href: '/settings/profile', label: 'Profile', show: true },
    { href: '/settings/team', label: 'Teammates', show: can(role, 'members:manage') },
    { href: '/settings/site', label: 'Site', show: can(role, 'site:manage') },
    { href: '/settings', label: 'Automation', show: can(role, 'automation:manage') },
  ].filter((t) => t.show);

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
