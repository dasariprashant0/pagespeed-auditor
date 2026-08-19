'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * The .md download, with a device choice.
 *
 * Mobile and desktop are separate measurements of the same page, and which one
 * you want depends on what you are fixing -- so the button asks instead of
 * silently exporting whichever tab happened to be open.
 */
export function DownloadMarkdown({
  href,
  currentStrategy,
  label = 'Download .md',
  hint,
}: {
  /** Base URL without a strategy parameter; one is appended. */
  href: string;
  currentStrategy: 'mobile' | 'desktop';
  label?: string;
  hint?: string;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // Click-away and Escape. A menu you can only close by choosing something is
  // a trap on touch, where there is no hover to fall back on.
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  const sep = href.includes('?') ? '&' : '?';
  const other = currentStrategy === 'mobile' ? 'desktop' : 'mobile';

  const options = [
    { value: currentStrategy, label: currentStrategy === 'mobile' ? 'Mobile' : 'Desktop', note: 'what you are looking at' },
    { value: other, label: other === 'mobile' ? 'Mobile' : 'Desktop', note: 'the other measurement' },
    { value: 'both', label: 'Both, in one file', note: 'shows what is device-specific' },
  ] as const;

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        title={hint}
        className="flex items-center gap-1.5 rounded-[5px] border border-[var(--border)] px-2.5 py-1 text-[12px] text-[var(--muted)] transition-colors hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
      >
        {label}
        <span aria-hidden="true" className="text-[9px] opacity-60">▾</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-1 w-[15rem] overflow-hidden rounded-[8px] border border-[var(--border-strong)] bg-[var(--surface)] shadow-[var(--lift)]"
        >
          {options.map((o) => (
            <a
              key={o.value}
              role="menuitem"
              href={`${href}${sep}strategy=${o.value}`}
              download
              onClick={() => setOpen(false)}
              className="block px-3 py-2 text-[12px] hover:bg-[var(--surface-subtle)]"
            >
              <span className="font-medium">{o.label}</span>
              <span className="ml-1.5 text-[11px] text-[var(--faint)]">{o.note}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
