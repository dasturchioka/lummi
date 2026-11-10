import { useState } from 'react';
import { photoSrcSet, photoUrl } from '../lib/media';
import { BoxIcon } from './icons';

/** The customer's Discovery box photo (materials/photos), cropped to the box, 420 px wide WebP. */
export const BOX_PHOTO = '/home/discovery-set.webp';

/**
 * The Discovery set's photo: the owner's upload (a 3:4 WebP set by content hash) or, until there
 * is one, the box photo shipped with the app. Fills its parent, which owns the size and the
 * Photo Blush ground.
 */
export function SetPhoto({
  hash,
  sizes,
  eager = false,
}: {
  hash: string | null;
  sizes: string;
  eager?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const own = hash && !failed;
  return (
    <img
      src={own ? photoUrl(hash, 800) : BOX_PHOTO}
      srcSet={own ? photoSrcSet(hash) : undefined}
      sizes={sizes}
      alt=""
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      onError={() => setFailed(true)}
      className="absolute inset-0 size-full object-cover"
    />
  );
}

/** A set with no photo of its own (a builder set): the box icon on the Photo Blush ground. */
export function SetPhotoEmpty() {
  return (
    <div className="absolute inset-0 grid place-items-center text-faint" aria-hidden="true">
      <BoxIcon size={28} />
    </div>
  );
}
