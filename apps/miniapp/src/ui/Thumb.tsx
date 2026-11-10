import { useState } from 'react';
import { photoSrcSet, photoUrl } from '../lib/media';
import { SetPhoto, SetPhotoEmpty } from './SetPhoto';

/**
 * A 3:4 bottle thumbnail on its Photo Blush slot, which stays when the photo is missing or fails.
 * `set`: a set line shows the Discovery box photo (or the owner's) or the box icon for a builder set.
 */
export function Thumb({
  photo,
  className,
  set,
}: {
  photo: string | null;
  className: string;
  set?: 'discovery' | 'builder';
}) {
  const [failed, setFailed] = useState(false);
  return (
    <div
      aria-hidden="true"
      className={`${className} relative aspect-[3/4] shrink-0 overflow-hidden rounded-thumb bg-photo`}
    >
      {set === 'discovery' ? <SetPhoto hash={photo} sizes="64px" /> : null}
      {set === 'builder' ? <SetPhotoEmpty /> : null}
      {!set && photo && !failed ? (
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
