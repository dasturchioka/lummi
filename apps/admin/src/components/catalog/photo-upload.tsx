'use client';

import { MAX_PHOTO_BYTES } from '@lummi/contracts';
import { ImagePlus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { AdminMessages } from '@/lib/i18n';
import { photoUrl } from './photo';

const TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * One volume's photo: the current 3:4 rendition (or the picked file) as a preview, and an upload
 * button. The file goes up as raw bytes; the server rechecks type, size and dimensions, so the
 * browser's checks here only save a round trip.
 */
export function PhotoUpload({
  ml,
  volumeId,
  hash,
  onUploaded,
  t,
}: {
  ml: number;
  volumeId: number | null;
  hash: string | null;
  onUploaded: (hash: string) => void;
  t: AdminMessages;
}) {
  const c = t.catalog;
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [state, setState] = useState<{ kind: 'idle' | 'busy' | 'ok' | 'error'; text?: string }>({
    kind: 'idle',
  });
  useEffect(() => () => (preview ? URL.revokeObjectURL(preview) : undefined), [preview]);

  const pick = async (file: File | undefined) => {
    if (!file || volumeId === null) return;
    if (!TYPES.includes(file.type)) return setState({ kind: 'error', text: c.photoBadType });
    if (file.size > MAX_PHOTO_BYTES) return setState({ kind: 'error', text: c.photoTooBig });
    setPreview(URL.createObjectURL(file));
    setState({ kind: 'busy', text: c.photoUploading });
    const res = await fetch(`/api/admin/volumes/${volumeId}/photo`, {
      method: 'PUT',
      headers: { 'content-type': file.type },
      body: file,
    }).catch(() => null);
    if (res?.ok) {
      const body = (await res.json()) as { photo: string };
      onUploaded(body.photo);
      setState({ kind: 'ok', text: c.photoUploaded });
    } else {
      setPreview(null);
      setState({
        kind: 'error',
        text:
          res?.status === 413
            ? c.photoTooBig
            : res?.status === 415
              ? c.photoBadType
              : res?.status === 422
                ? c.photoTooSmall
                : c.photoFailed,
      });
    }
  };

  const shown = preview ?? (hash ? photoUrl(hash, 400) : null);
  return (
    <div className="grid gap-2" data-photo={ml}>
      <p className="text-[12.5px] font-medium text-muted-foreground">{c.photo}</p>
      {volumeId === null ? (
        <p className="text-xs text-muted-foreground">{c.photoSaveFirst}</p>
      ) : (
        <>
          <div className="grid aspect-[3/4] w-32 place-items-center overflow-hidden rounded-button bg-field text-xs text-muted-foreground">
            {shown ? (
              <img src={shown} alt="" className="size-full object-cover" />
            ) : (
              c.noPhoto
            )}
          </div>
          <input
            ref={input}
            type="file"
            accept={TYPES.join(',')}
            className="sr-only"
            tabIndex={-1}
            aria-label={`${c.photo} ${ml} ${c.ml}`}
            onChange={(e) => {
              void pick(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-fit"
            loading={state.kind === 'busy'}
            onClick={() => input.current?.click()}
          >
            <ImagePlus strokeWidth={1.5} aria-hidden />
            {shown ? c.photoReplace : c.photoChoose}
          </Button>
          <p className="text-xs text-muted-foreground">{c.photoHint}</p>
          {state.text && state.kind !== 'busy' && (
            <p role={state.kind === 'error' ? 'alert' : 'status'} className="text-xs font-medium">
              {state.text}
            </p>
          )}
        </>
      )}
    </div>
  );
}
