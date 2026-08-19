/**
 * Loading placeholders that match the shape of what is coming.
 *
 * Deliberately not a spinner. A spinner says "wait"; a skeleton in the right
 * shape says "the table is arriving and it will have these columns", which is
 * the difference between a page that feels fast and one that feels stuck.
 */
export function Skeleton({ className = '', style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`skeleton ${className}`} style={style} aria-hidden="true" />;
}

/** Text lines of decreasing width, the way a paragraph actually looks. */
export function SkeletonText({ lines = 3, className = '' }: { lines?: number; className?: string }) {
  return (
    <div className={`space-y-1.5 ${className}`} aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className="h-2.5" style={{ width: `${94 - i * 13}%` }} />
      ))}
    </div>
  );
}

/**
 * Wraps a loading region so screen readers are told once, rather than being
 * read a wall of decorative boxes.
 */
export function LoadingRegion({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="animate-fade">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}
