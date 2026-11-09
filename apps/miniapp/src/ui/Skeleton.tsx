/** A calm placeholder block. Size it with classes; `data-skeleton` lets screenshots wait for real content. */
export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      data-skeleton=""
      aria-hidden="true"
      className={`animate-[skeleton_1.4s_ease-in-out_infinite] rounded-btn bg-field ${className}`}
    />
  );
}
