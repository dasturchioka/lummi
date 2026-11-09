import { Skeleton } from './Skeleton';

/** The grid card's shape while the list loads: photo, lockup, price. */
export function GridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div aria-hidden="true" className="grid grid-cols-2 gap-2">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex flex-col rounded-card bg-card p-2 pb-3">
          <Skeleton className="aspect-[3/4] w-full" rounded="photo" />
          <div className="px-1 pt-2.5">
            <Skeleton className="h-2.5 w-3/4" rounded="pill" />
            <Skeleton className="mt-2 h-5 w-3/5" />
            <Skeleton className="mt-3 h-3 w-2/5" />
            <Skeleton className="mt-6 h-3.5 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}
