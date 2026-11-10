import { useState } from 'react';
import { photoSrcSet, photoUrl } from '../lib/media';

/** A 3:4 bottle thumbnail on its Photo Blush slot, which stays when the photo is missing or fails. */
export function Thumb({ photo, className }: { photo: string | null; className: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <div
      aria-hidden="true"
      className={`${className} relative aspect-[3/4] shrink-0 overflow-hidden rounded-thumb bg-photo`}
    >
      {photo && !failed ? (
        <img
          src={photoUrl(photo, 400)}
          srcSet={photoSrcSet(photo)}
          sizes="64px"
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="absolute inset-0 size-full object-cover"
        />
      ) : null}
    </div>
  );
}
