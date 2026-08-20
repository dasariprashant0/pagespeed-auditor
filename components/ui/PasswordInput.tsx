'use client';

import { useState, type InputHTMLAttributes } from 'react';

/** Open eye -- shown when the value is hidden, i.e. "click to reveal." */
function EyeIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"
        stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

/** Eye with a slash -- shown when the value is revealed, i.e. "click to hide." */
function EyeOffIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 3l18 18M10.6 5.2C11.05 5.07 11.51 5 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.5 6.6C4 8.3 2 12 2 12s1.6 3.2 4.7 5.3A11.6 11.6 0 0 0 12 19c.86 0 1.67-.1 2.42-.28M9.9 9.9a3 3 0 0 0 4.2 4.2"
        stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * A password/secret input with an eye toggle to check what's actually in
 * it before submitting -- wherever confidential values get typed (login,
 * signup, the PSI key, the SMTP password), not just one form. Masking by
 * default is still the right call (someone looking over a shoulder, or a
 * screen-recording), but there was no way to actually verify what got
 * typed short of retyping it blind, which is exactly what led to a wrong
 * port number sitting unnoticed in a masked field earlier.
 *
 * Drop-in for `<input type="password">`: takes the same props, manages its
 * own reveal state, and never itself changes the value -- only whether it's
 * legible.
 */
export function PasswordInput({
  className = '',
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input {...props} type={visible ? 'text' : 'password'} className={`${className} pr-8`} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Hide value' : 'Show value'}
        aria-pressed={visible}
        className="absolute inset-y-0 right-0 flex w-8 items-center justify-center text-[var(--muted)] transition-colors hover:text-[var(--foreground)]"
      >
        {visible ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </div>
  );
}
