import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { usePrefs } from '../lib/prefs';
import { CardList, ListRow } from '../ui/Card';
import { CameraIcon, SendIcon, TrashIcon } from '../ui/icons';
import { Sheet } from '../ui/Sheet';
import { photoFromTelegram, removePhoto, uploadPhoto, type PhotoOutcome } from './photo-api';

/**
 * Tapping the profile circle (#67): «Загрузить фото», «Взять из Telegram» (only when Telegram gave
 * us a photo) and «Убрать фото» (only when there is one). The result replaces the saved customer,
 * so Profile and Home show the new photo at once. Loaded lazily with the first tap.
 */
export default function PhotoSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, customer } = usePrefs();
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const messages = {
    too_large: t.profile.photoTooLarge,
    bad_type: t.profile.photoBadType,
    no_telegram: t.profile.photoNoTelegram,
    failed: t.profile.photoFailed,
  } as const;

  async function run(job: () => Promise<PhotoOutcome>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await job();
    setBusy(false);
    if (res.ok) {
      queryClient.setQueryData(['me'], res.customer);
      onOpenChange(false);
    } else {
      setError(messages[res.reason]);
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t.profile.photoTitle}
      closeLabel={t.common.close}
    >
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        data-testid="photo-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void run(() => uploadPhoto(file));
        }}
      />
      <div className="flex flex-col gap-3 pb-1">
        <CardList>
          <ListRow
            leading={<CameraIcon size={20} />}
            label={t.profile.photoUpload}
            onClick={() => input.current?.click()}
          />
          {customer?.telegramPhoto ? (
            <ListRow
              leading={<SendIcon size={20} />}
              label={t.profile.photoTelegram}
              onClick={() => void run(photoFromTelegram)}
            />
          ) : null}
          {customer?.photo ? (
            <ListRow
              leading={<TrashIcon size={20} />}
              label={t.profile.photoRemove}
              onClick={() => void run(removePhoto)}
            />
          ) : null}
        </CardList>
        <p role="status" aria-live="polite" className="type-small min-h-5 text-muted">
          {busy ? t.profile.photoBusy : error}
        </p>
      </div>
    </Sheet>
  );
}
