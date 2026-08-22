import type { Capability } from '../auth/roles.ts';

/**
 * The tour step catalog -- see docs/superpowers/specs/2026-08-22-onboarding-tour-design.md
 * section B. A first meaningful set covering the primary flows; content for
 * the rest of the app grows this list without any further schema change.
 */
export interface TourStep {
  id: string;
  route: string;
  targetSelector: string;
  title: string;
  body: string;
  requiredCapability: Capability | null;
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'overview-sections',
    route: '/',
    targetSelector: 'section-grid',
    title: 'Every section, in sweep order',
    body: 'Each card is one part of your site. Drag to reorder — this is the order the next full sweep measures things in.',
    requiredCapability: null,
  },
  {
    id: 'overview-charts',
    route: '/',
    targetSelector: 'overview-charts',
    title: "Your site's shape, not just one number",
    body: 'Switch views to see the ten-point spread, section averages, or load time against score.',
    requiredCapability: null,
  },
  {
    id: 'group-run-audit',
    route: '/g/[slug]',
    targetSelector: 'run-audit-button',
    title: 'Measure a section on demand',
    body: "Don't wait for the weekly sweep — check a section right after you ship a fix.",
    requiredCapability: 'audits:run',
  },
  {
    id: 'report-recommendation',
    route: '/p/[pageId]',
    targetSelector: 'recommendation-panel',
    title: 'Ask what to fix first',
    body: 'Generates a specific, evidence-based answer from this exact report — not generic PageSpeed advice.',
    requiredCapability: 'recommendations:generate',
  },
  {
    id: 'settings-team',
    route: '/settings/team',
    targetSelector: 'invite-form',
    title: 'Bring your team in',
    body: 'Invite by email, pick a role — viewer, editor, developer, or admin — and revoke access any time.',
    requiredCapability: 'members:manage',
  },
  {
    id: 'settings-automation',
    route: '/settings/automation',
    targetSelector: 'schedule-form',
    title: 'Turn scores into a trend',
    body: 'A weekly sweep is what makes "did this get better" answerable instead of a one-off snapshot.',
    requiredCapability: 'automation:manage',
  },
  {
    id: 'settings-database',
    route: '/settings/database',
    targetSelector: 'neon-connection-form',
    title: 'Your own database, your own quota',
    body: "Free to create on Neon and Cloudflare D1, and this organisation's usage is never on our bill.",
    requiredCapability: 'org:provision',
  },
];
