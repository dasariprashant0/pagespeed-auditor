import Link from 'next/link';
import { BrandTrace } from '@/components/auth/BrandTrace';

/**
 * The signed-out shell.
 *
 * Every unauthenticated screen — sign in, sign up, forgot, reset, invite —
 * renders inside this, so they cannot drift apart the way they had: the card
 * was rendering its OWN <main> inside this layout's <main>, giving two nested
 * mains and two competing centring contexts, which is what squeezed the sign-in
 * form down to about 180px wide.
 *
 * The left column exists because a bare form in an empty page tells a
 * first-time visitor nothing about what they are signing in to. It states the
 * one thing this tool does that pagespeed.web.dev cannot: every page at once.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <aside className="relative hidden flex-col overflow-hidden border-r border-[var(--border)] bg-[var(--chrome)] px-10 py-10 lg:flex xl:px-14">
        <Link href="/" className="inline-flex items-center gap-2.5 self-start rounded-[var(--radius)]">
          <Mark />
          <span className="title-sm">PageSpeed Auditor</span>
        </Link>

        <div className="my-auto max-w-md">
          <h2 className="title-xl leading-[1.15]">
            Every page of your site,
            <br />
            measured and kept.
          </h2>
          <p className="mt-3 text-[13px] leading-relaxed text-[var(--muted)]">
            PageSpeed Insights measures one page at a time. This measures all of them, on mobile
            and desktop, on a schedule — so you can see the shape of the problem instead of
            guessing which page to check next.
          </p>

          <div className="mt-8">
            <BrandTrace />
          </div>
        </div>

        <p className="text-[11px] text-[var(--faint)]">
          Scores come from Google&rsquo;s PageSpeed Insights API. Nothing is estimated.
        </p>
      </aside>

      <div className="flex flex-col items-center justify-center px-5 py-10 sm:px-10">
        {/* The mark travels to the top of the form column on narrow screens,
            where the left panel is not rendered at all. */}
        <Link href="/" className="mb-8 inline-flex w-full max-w-[24rem] items-center gap-2.5 lg:hidden">
          <Mark />
          <span className="title-sm">PageSpeed Auditor</span>
        </Link>
        <div className="w-full max-w-[22rem] sm:max-w-[24rem]">{children}</div>
      </div>
    </main>
  );
}

/**
 * The mark: three bars in Lighthouse's three band colours, ascending.
 *
 * It is the product in one glyph — a distribution of scores — and it uses the
 * only three colours this interface is allowed to saturate.
 */
function Mark() {
  return (
    <span
      aria-hidden="true"
      className="flex h-6 w-6 items-end gap-[2px] rounded-[5px] bg-[var(--surface)] p-[5px] shadow-[var(--shadow-raised)] ring-1 ring-[var(--border)]"
    >
      <span className="h-[35%] w-[3px] rounded-[1px]" style={{ background: 'var(--score-fail)' }} />
      <span className="h-[65%] w-[3px] rounded-[1px]" style={{ background: 'var(--score-average)' }} />
      <span className="h-full w-[3px] rounded-[1px]" style={{ background: 'var(--score-pass)' }} />
    </span>
  );
}
