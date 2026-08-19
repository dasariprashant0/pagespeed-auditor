/* eslint-disable @next/next/no-img-element */

/**
 * The final screenshot, as pagespeed.web.dev leads with.
 *
 * A plain <img> rather than next/image: the source is a data: URI already
 * embedded in the stored response, so there is nothing for the image optimizer
 * to fetch, resize or cache.
 */
export function Screenshot({ src, url }: { src: string; url: string }) {
  return (
    <figure className="shrink-0">
      <img
        src={src}
        alt={`Screenshot of ${url} as Lighthouse rendered it`}
        className="max-h-[200px] w-auto rounded-[6px] border border-[var(--border)]"
      />
      <figcaption className="mt-1 text-[10px] text-[var(--muted)]">Final render</figcaption>
    </figure>
  );
}
