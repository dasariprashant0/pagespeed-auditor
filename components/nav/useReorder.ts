'use client';

import { useState, useTransition } from 'react';

/**
 * Drag-to-reorder with a keyboard path.
 *
 * Native HTML5 drag events rather than a library: the list is short, and a
 * drag-and-drop dependency is a lot of bundle for one interaction on a tool
 * that reports page weight.
 *
 * `move` exists because dragging alone is unusable with a keyboard or a screen
 * reader, and this list decides the order a 34-minute job runs in -- not a
 * decorative preference.
 */
export function useReorder<T extends { slug: string }>(
  initial: T[],
  save: (slugs: string[]) => Promise<{ ok: boolean; error?: string }>,
) {
  const [items, setItems] = useState(initial);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const persist = (next: T[]) => {
    const previous = items;
    setItems(next); // optimistic: dragging should feel immediate
    startSave(async () => {
      const r = await save(next.map((i) => i.slug));
      if (!r.ok) {
        // Snap back rather than leave the screen disagreeing with the database.
        setItems(previous);
        setError(r.error ?? 'Could not save that order.');
      } else {
        setError(null);
      }
    });
  };

  const reorder = (fromSlug: string, toSlug: string) => {
    if (fromSlug === toSlug) return;
    const from = items.findIndex((i) => i.slug === fromSlug);
    const to = items.findIndex((i) => i.slug === toSlug);
    if (from === -1 || to === -1) return;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    persist(next);
  };

  /** Keyboard equivalent: move one position up or down. */
  const move = (slug: string, delta: -1 | 1) => {
    const from = items.findIndex((i) => i.slug === slug);
    const to = from + delta;
    if (from === -1 || to < 0 || to >= items.length) return;
    const next = [...items];
    [next[from], next[to]] = [next[to], next[from]];
    persist(next);
  };

  return {
    items,
    setItems,
    dragging,
    over,
    saving,
    error,
    move,
    dragProps: (slug: string) => ({
      draggable: true,
      onDragStart: (e: React.DragEvent) => {
        setDragging(slug);
        e.dataTransfer.effectAllowed = 'move';
        // Firefox refuses to start a drag without data set.
        e.dataTransfer.setData('text/plain', slug);
      },
      onDragEnd: () => { setDragging(null); setOver(null); },
      onDragOver: (e: React.DragEvent) => { e.preventDefault(); setOver(slug); },
      onDragLeave: () => setOver((s) => (s === slug ? null : s)),
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        const from = e.dataTransfer.getData('text/plain') || dragging;
        if (from) reorder(from, slug);
        setDragging(null);
        setOver(null);
      },
    }),
  };
}
