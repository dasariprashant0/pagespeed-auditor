import { Skeleton, SkeletonText, LoadingRegion } from '@/components/ui/Skeleton';

/**
 * What you see the instant you click, before the server answers.
 *
 * Without a file like this Next has no Suspense boundary at the route level, so
 * a click leaves the OLD page on screen with no acknowledgement at all — half a
 * second of nothing on the overview, three seconds on a big section. That dead
 * interval is what "the app doesn't feel smooth" actually was.
 *
 * The shape deliberately matches a real screen — header, then a wide block,
 * then rows — so the layout does not jump when the content lands.
 */
export default function DashLoading() {
  return (
    <LoadingRegion label="Loading">
      <div className="mb-6">
        <Skeleton className="mb-2 h-2.5 w-24" />
        <Skeleton className="h-7 w-64" />
        <Skeleton className="mt-2.5 h-3 w-80" />
      </div>

      <div className="panel mb-6 px-5 py-4">
        <div className="flex flex-wrap gap-x-8 gap-y-5">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex flex-col items-center gap-2">
              <Skeleton className="h-[68px] w-[68px] rounded-full" />
              <Skeleton className="h-2 w-14" />
            </div>
          ))}
        </div>
      </div>

      <Skeleton className="mb-6 h-[188px] w-full rounded-[var(--radius-lg)]" />

      <div className="panel-flush">
        {Array.from({ length: 8 }, (_, i) => (
          <div
            key={i}
            className="flex items-center gap-4 border-b border-[var(--border)] px-4 py-2.5 last:border-b-0"
          >
            <Skeleton className="h-2.5 flex-1" style={{ maxWidth: `${58 - (i % 4) * 9}%` }} />
            <Skeleton className="h-4 w-7 shrink-0 rounded-[var(--radius-sm)]" />
            <Skeleton className="h-4 w-7 shrink-0 rounded-[var(--radius-sm)]" />
            <Skeleton className="h-4 w-7 shrink-0 rounded-[var(--radius-sm)]" />
            <Skeleton className="h-4 w-7 shrink-0 rounded-[var(--radius-sm)]" />
          </div>
        ))}
      </div>
      <SkeletonText lines={0} />
    </LoadingRegion>
  );
}
