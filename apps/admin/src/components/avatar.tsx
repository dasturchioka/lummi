'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';

/** First letters of the first two words that have one ("@dilnoza" -> "D", "Ж" -> "Ж"). */
export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w.match(/\p{L}/u)?.[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

/** Profile photos are square WebP renditions of one content hash (#67), served like product photos. */
export const avatarUrl = (hash: string, size: 96 | 192 | 384 = 96) =>
  `/api/media/public/avatar-${hash}-${size}.webp`;

/**
 * A person's photo in a circle, with their initial letters on Stone when there is none (or it
 * fails to load). Decorative: the name always sits beside it.
 */
export function Avatar({
  name,
  photo,
  className,
}: {
  name: string;
  photo: string | null;
  /** Size and type scale: `size-9 text-[13px]` by default. */
  className?: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const showPhoto = photo && failed !== photo;
  return (
    <span
      aria-hidden
      className={cn(
        'relative grid size-9 shrink-0 place-items-center overflow-hidden rounded-full bg-stone text-[13px] font-semibold',
        className,
      )}
    >
      {initialsOf(name)}
      {showPhoto ? (
        <img
          src={avatarUrl(photo)}
          srcSet={`${avatarUrl(photo, 96)} 1x, ${avatarUrl(photo, 192)} 2x, ${avatarUrl(photo, 384)} 4x`}
          alt=""
          onError={() => setFailed(photo)}
          className="absolute inset-0 size-full object-cover"
        />
      ) : null}
    </span>
  );
}
