import { Skeleton } from './Skeleton';

/**
 * One grid card's shape while its list loads: the 3:4 photo, the two-line attribution, the name,
 * the rule, the meta line, the notes and the price on the bottom edge, at the real card's
 * proportions, so the cards take the skeleton's place without the page jumping.
 */
export function CardSkeleton() {
  return (
    <div className="flex h-full flex-col rounded-card bg-card p-2 pb-3">
      <Skeleton className="aspect-[3/4] w-full" rounded="photo" />
      <div className="flex flex-1 flex-col px-1 pt-3">
        <Skeleton className="h-2.5 w-4/5" rounded="pill" />
        <Skeleton className="mt-2 h-2.5 w-1/2" rounded="pill" />
        <Skeleton className="mt-3 h-[18px] w-3/5" />
        <Skeleton className="mt-3.5 h-px w-[18px]" />
        <Skeleton className="mt-3 h-3 w-2/5" />
        <Skeleton className="mt-2.5 h-3 w-4/5" />
        <Skeleton className="mt-6 h-4 w-3/5" />
      </div>
    </div>
  );
}

/** The two-column grid while the list loads. */
export function GridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div aria-hidden="true" className="grid grid-cols-2 gap-2">
      {Array.from({ length: count }, (_, i) => (
        <CardSkeleton key={i} />
      ))}
    </div>
  );
}
