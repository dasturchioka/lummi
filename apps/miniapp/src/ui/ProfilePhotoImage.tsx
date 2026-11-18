import { useState } from 'react';
import { profilePhotoSrcSet, profilePhotoUrl } from '../lib/media';

/**
 * The customer's profile photo over a disc's own fallback (the «L.» monogram): the parent is the
 * disc (`relative overflow-hidden rounded-pill`) and renders the monogram; the photo covers it
 * once loaded, and a photo that fails leaves the monogram showing. Renders nothing without a photo.
 */
export function ProfilePhotoImage({
  photo,
  sizes,
}: {
  photo: string | null | undefined;
  sizes: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  if (!photo || failed === photo) return null;
  return (
    <img
      src={profilePhotoUrl(photo, 96)}
      srcSet={profilePhotoSrcSet(photo)}
      sizes={sizes}
      alt=""
      decoding="async"
      onError={() => setFailed(photo)}
      className="absolute inset-0 size-full object-cover"
    />
  );
}
