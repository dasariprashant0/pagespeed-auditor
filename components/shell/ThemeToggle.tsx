'use client';

import { useState, useSyncExternalStore } from 'react';

type Choice = 'system' | 'light' | 'dark';

const KEY = 'theme';
const NEXT: Record<Choice, Choice> = { system: 'light', light: 'dark', dark: 'system' };
const LABEL: Record<Choice, string> = { system: 'Theme: System', light: 'Theme: Light', dark: 'Theme: Dark' };

function apply(choice: Choice) {
  if (choice === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', choice);
}

// Nothing outside this component's own cycle() ever changes the stored
// value, so there is nothing external to subscribe to.
function subscribe(): () => void {
  return () => {};
}

let cache: { raw: string | null; value: Choice } = { raw: null, value: 'system' };

/** Must return a STABLE reference for an unchanged string, or React re-renders forever. */
function readStored(): Choice {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return 'system';
  }
  if (raw === cache.raw) return cache.value;
  cache = { raw, value: raw === 'light' || raw === 'dark' ? raw : 'system' };
  return cache.value;
}

/**
 * Cycles System -> Light -> Dark -> System.
 *
 * The switch on load is the inline script in app/layout.tsx, which runs
 * before paint so there is no flash. Reading the persisted choice through
 * useSyncExternalStore, rather than an effect, is what keeps the server
 * snapshot ('system') and the first client render in agreement -- the real
 * value applies on the very next render, with no setState-during-an-effect.
 */
export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const stored = useSyncExternalStore(subscribe, readStored, () => 'system' as Choice);
  const [override, setOverride] = useState<Choice | null>(null);
  const choice = override ?? stored;

  function cycle() {
    const next = NEXT[choice];
    setOverride(next);
    apply(next);
    try {
      if (next === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
    } catch {
      /* private browsing; the choice still holds for this session */
    }
  }

  return (
    <button
      type="button"
      onClick={cycle}
      className={
        compact
          ? 'text-[var(--muted)] hover:text-[var(--foreground)]'
          : 'w-full rounded-[var(--radius)] px-2 py-[5px] text-left text-[12px] text-[var(--muted)] transition-colors hover:bg-[var(--surface-sunken)] hover:text-[var(--foreground)]'
      }
    >
      {LABEL[choice]}
    </button>
  );
}
