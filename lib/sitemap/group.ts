/**
 * Grouping: first path segment after the domain, per spec section 6.
 *
 * Known limitation, flagged rather than solved: if the site ever adds /en/,
 * /fr/ language folders, this groups by language instead of content type.
 * Not a live problem today. See docs/DECISIONS.md section 4.
 */

export interface DerivedGroup {
  slug: string;
  name: string;
}

/**
 * Where the root URL lands.
 *
 * "Home" rather than "General": there is exactly one page with no path segment
 * and it is the homepage, so naming it after a catch-all misdescribes it.
 */
export const ROOT_GROUP: DerivedGroup = { slug: 'home', name: 'Home' };

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** "case-studies" -> "Case Studies" */
export function titleCase(slug: string): string {
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function deriveGroup(pathname: string): DerivedGroup {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) return ROOT_GROUP;

  let first: string;
  try {
    first = decodeURIComponent(segments[0]);
  } catch {
    first = segments[0];
  }

  const slug = slugify(first);
  // A segment that slugifies to nothing (e.g. "%20") isn't a usable group.
  if (!slug) return ROOT_GROUP;

  return { slug, name: titleCase(slug) };
}
