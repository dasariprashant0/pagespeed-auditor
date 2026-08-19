import { requireSession } from '@/lib/http/auth-guard';

/**
 * Defence in depth. proxy.ts already redirects unauthenticated requests, but it
 * is a UX layer, not the authorization boundary -- so every protected surface
 * re-checks. See docs/DECISIONS.md 2.9.
 */
export default async function DashLayout({ children }: { children: React.ReactNode }) {
  await requireSession();
  return <>{children}</>;
}
