import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getEnv } from '@/lib/env';
import { getSession } from '@/lib/http/session';
import { safeNextPath } from '@/lib/http/auth-guard';
import { LoginForm } from '@/components/auth/LoginForm';

export const metadata: Metadata = {
  title: 'Sign in — PageSpeed Auditor',
  robots: { index: false, follow: false },
};

/**
 * Server Component shell; the form itself is the only client island, because
 * useActionState needs one. /login is excluded from the proxy matcher (it
 * would otherwise redirect to itself), so the already-signed-in check lives
 * here.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const params = await searchParams;
  const raw = Array.isArray(params.next) ? params.next[0] : params.next;
  const next = safeNextPath(raw);

  if (await getSession()) redirect(next);

  const siteName = getEnv().SITE_NAME;

  return (
    <div className="w-full max-w-sm">
      <header className="mb-6">
        <h1 className="font-[family-name:var(--font-display)] text-xl font-medium tracking-tight">
          PageSpeed Auditor
        </h1>
        <p className="mt-1 text-[13px] text-muted">{siteName}</p>
      </header>

      <div className="border border-foreground/12 p-5">
        <LoginForm next={next} />
      </div>

      <p className="mt-4 text-[12px] leading-relaxed text-muted">
        Shared credentials. Ask whoever set this up, or read the Auth section of the README.
      </p>
    </div>
  );
}
