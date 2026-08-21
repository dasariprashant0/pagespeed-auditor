/**
 * Shared by the Automation and Notifications settings pages -- split out of
 * automation/page.tsx once Notifications became its own tab, so both stay
 * visually identical without duplicating the same eight lines.
 */
export function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-4">
      <h2 className="font-[family-name:var(--font-display)] text-[13px] font-medium">{title}</h2>
      {hint && <p className="mb-3 mt-0.5 max-w-xl text-[11px] text-[var(--muted)]">{hint}</p>}
      {children}
    </section>
  );
}
