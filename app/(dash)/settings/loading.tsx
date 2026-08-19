import { Skeleton, LoadingRegion } from '@/components/ui/Skeleton';

/** Settings screens are forms, not tables, so they get their own shape. */
export default function SettingsLoading() {
  return (
    <LoadingRegion label="Loading settings">
      <div className="mb-6">
        <Skeleton className="mb-2 h-2.5 w-32" />
        <Skeleton className="h-7 w-44" />
        <Skeleton className="mt-2.5 h-3 w-64" />
      </div>

      <div className="mb-5 flex gap-1.5">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-7 w-24 rounded-[var(--radius)]" />
        ))}
      </div>

      <div className="max-w-3xl space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="panel px-4 py-4">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="mt-2 h-2.5 w-72" />
            <div className="mt-4 space-y-2.5">
              <Skeleton className="h-8 w-full rounded-[var(--radius)]" />
              <Skeleton className="h-8 w-2/3 rounded-[var(--radius)]" />
            </div>
          </div>
        ))}
      </div>
    </LoadingRegion>
  );
}
