const ROUNDED = {
  thumb: 'rounded-thumb',
  photo: 'rounded-photo',
  btn: 'rounded-btn',
  card: 'rounded-card',
  pill: 'rounded-pill',
} as const;

/**
 * A calm placeholder block. Size it with classes and pick the radius of what it stands for
 * (`rounded`, a 10 px control by default); `data-skeleton` lets screenshots wait for real content.
 */
export function Skeleton({
  className = '',
  rounded = 'btn',
}: {
  className?: string;
  rounded?: keyof typeof ROUNDED;
}) {
  return (
    <div
      data-skeleton=""
      aria-hidden="true"
      className={`animate-[skeleton_1.4s_ease-in-out_infinite] bg-field ${ROUNDED[rounded]} ${className}`}
    />
  );
}
