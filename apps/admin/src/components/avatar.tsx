'use client';

import type { PROFILE_PHOTO_SIZES } from '@lummi/contracts';
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

/**
 * Profile photos are personal data (#67): square WebP renditions served by the API itself (the
 * panel's `/api` proxy), never by the media host.
 */
export const profilePhotoUrl = (key: string, size: (typeof PROFILE_PHOTO_SIZES)[number] = 96) =>
  `/api/profile-photos/${key}-${size}.webp`;

/**
 * A person's profile photo in a circle, with their initial letters on Stone when there is none (or it
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
          src={profilePhotoUrl(photo)}
          srcSet={`${profilePhotoUrl(photo, 96)} 1x, ${profilePhotoUrl(photo, 192)} 2x, ${profilePhotoUrl(photo, 384)} 4x`}
          alt=""
          onError={() => setFailed(photo)}
          className="absolute inset-0 size-full object-cover"
        />
      ) : null}
    </span>
  );
}
