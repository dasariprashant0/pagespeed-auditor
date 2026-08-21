/** Google's own multi-colour "G", inlined -- their brand guidelines ask for
 * the mark kept intact rather than recoloured, so this is the one icon in
 * the app that isn't drawn in the site's own palette on purpose. */
function GoogleG() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92a8.78 8.78 0 0 0 2.68-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.87-3.04.87-2.34 0-4.32-1.58-5.03-3.71H.96v2.33A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A8.59 8.59 0 0 0 9 0 9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
    </svg>
  );
}

/**
 * One entry point, `/api/auth/google?intent=...`, for all three places this
 * shows up -- the route itself decides what to do with the intent once
 * Google redirects back. A plain link, not a form/button with a client
 * handler: there's nothing to do client-side except navigate.
 */
export function GoogleButton({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      className="flex h-9 w-full items-center justify-center gap-2 rounded-[var(--radius)] border border-[var(--border-strong)] text-[13px] font-medium transition-colors hover:bg-[var(--surface-subtle)]"
    >
      <GoogleG />
      {label}
    </a>
  );
}
