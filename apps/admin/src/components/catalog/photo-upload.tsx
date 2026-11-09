'use client';

import { MAX_PHOTO_BYTES } from '@lummi/contracts';
import { Check, CircleAlert, ImageOff, ImagePlus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { AdminMessages } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { photoUrl } from './photo';

const TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * One volume's photo: the current 3:4 rendition (or the picked file) as a preview, and an upload
 * button. The file goes up as raw bytes; the server rechecks type, size and dimensions, so the
 * browser's checks here only save a round trip. The preview sits beside the controls when the
 * column has room (a phone, a tablet) and above them in the three-column desktop editor.
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
  const busy = state.kind === 'busy';
  return (
    <div className="grid gap-1.5" data-photo={ml}>
      <p className="text-[12.5px] font-medium text-muted-foreground">{c.photo}</p>
      {volumeId === null ? (
        <p className="text-xs text-pretty text-muted-foreground">{c.photoSaveFirst}</p>
      ) : (
        <div className="flex flex-col gap-3 @xs:flex-row @xs:items-start @xs:gap-4">
          {/* DESIGN.md photo: 3:4, clipped to 8 px; dimmed while the new one goes up */}
          <div
            className={cn(
              'grid aspect-[3/4] w-28 shrink-0 place-items-center overflow-hidden rounded-[8px] bg-field transition-opacity duration-200',
              busy && 'opacity-60',
            )}
          >
            {shown ? (
              <img src={shown} alt="" className="size-full object-cover" decoding="async" />
            ) : (
              <span className="grid justify-items-center gap-1.5 px-2 text-center text-xs text-muted-foreground">
                <ImageOff className="size-5" strokeWidth={1.5} aria-hidden />
                {c.noPhoto}
              </span>
            )}
          </div>
          <div className="grid min-w-0 content-start justify-items-start gap-2">
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
              loading={busy}
              onClick={() => input.current?.click()}
            >
              <ImagePlus strokeWidth={1.5} aria-hidden />
              {shown ? c.photoReplace : c.photoChoose}
            </Button>
            {state.text && !busy && (
              <p
                key={state.text}
                role={state.kind === 'error' ? 'alert' : 'status'}
                className="flex animate-[overlay-in_200ms_var(--ease-out)] items-start gap-1.5 text-xs leading-snug font-medium text-pretty"
              >
                {state.kind === 'error' ? (
                  <CircleAlert className="size-3.5 shrink-0" strokeWidth={1.5} aria-hidden />
                ) : (
                  <Check
                    className="size-3.5 shrink-0 text-sage-ink"
                    strokeWidth={1.5}
                    aria-hidden
                  />
                )}
                {state.text}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
