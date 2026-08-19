/** Every empty state is designed rather than a bare spinner or a blank panel. */
export function EmptyState({
  title,
  body,
  action,
  tone = 'neutral',
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
  tone?: 'neutral' | 'good' | 'warn';
}) {
  const border =
    tone === 'good' ? 'var(--score-pass)' : tone === 'warn' ? 'var(--score-average)' : 'var(--border)';
  const bg =
    tone === 'good' ? 'var(--score-pass-tint)' : tone === 'warn' ? 'var(--score-average-tint)' : 'var(--surface)';

  return (
    <div
      className="rounded-[8px] border px-5 py-6 text-center"
      style={{ borderColor: border, background: bg }}
    >
      <div className="font-[family-name:var(--font-display)] text-[15px] font-medium">{title}</div>
      <p className="mx-auto mt-1.5 max-w-md text-[12px] leading-relaxed text-[var(--muted)]">{body}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
