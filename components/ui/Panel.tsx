/**
 * The one card. A titled region with an optional hint and a right-hand slot.
 *
 * Settings had three separate local `Panel`/`Section` helpers with different
 * padding, different heading sizes and different hint placement, so the four
 * settings screens did not look like the same product.
 */
export function Panel({
  title,
  hint,
  actions,
  flush,
  className = '',
  children,
}: {
  title?: React.ReactNode;
  hint?: React.ReactNode;
  actions?: React.ReactNode;
  /** Content runs edge to edge -- for tables and lists that own their padding. */
  flush?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`panel-flush ${className}`}>
      {(title || actions) && (
        <header
          className={`flex flex-wrap items-start justify-between gap-x-4 gap-y-1.5 px-4 pt-3.5 ${
            hint ? 'pb-2' : 'pb-3.5'
          }`}
        >
          <div className="min-w-0">
            {title && <h2 className="title-md">{title}</h2>}
            {hint && <p className="mt-1 max-w-xl text-[11.5px] leading-relaxed text-[var(--muted)]">{hint}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={flush ? 'border-t border-[var(--border)]' : 'px-4 pb-4'}>{children}</div>
    </section>
  );
}
