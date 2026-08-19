import { ButtonLink } from '@/components/ui/Button';

/**
 * Inside the shell, so there is always a way back.
 *
 * A page id or a section slug in the URL can be stale — a section can be
 * merged, a page dropped from the sitemap — and landing on the framework's
 * unstyled 404 with no navigation is a dead end.
 */
export default function DashNotFound() {
  return (
    <div className="mx-auto max-w-lg py-16 text-center animate-rise">
      <div className="eyebrow mb-2">Not here</div>
      <h1 className="title-lg">We couldn&rsquo;t find that</h1>
      <p className="mx-auto mt-2 max-w-md text-[12.5px] leading-relaxed text-[var(--muted)]">
        The page or section may have been merged, renamed, or dropped from your sitemap. Its
        measurements are still kept — nothing is deleted — so it may be under a different name now.
      </p>
      <div className="mt-5 flex items-center justify-center gap-2">
        <ButtonLink href="/" variant="primary">Back to overview</ButtonLink>
      </div>
    </div>
  );
}
