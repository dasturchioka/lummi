'use client';

import { MAX_PHOTO_BYTES, staffSchema, type StaffDto } from '@lummi/contracts';
import { Camera, Send, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { Avatar } from '@/components/avatar';
import { Button } from '@/components/ui/button';
import type { AdminMessages } from '@/lib/i18n';

const TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * «Фото» on the member's own profile (#67): upload, the Telegram photo (through the bot, only when
 * their Telegram is linked) or remove. The routes work on the signed-in member only.
 */
export function ProfilePhoto({ member, t }: { member: StaffDto; t: AdminMessages }) {
  const p = t.profile;
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState(member.photo);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);

  async function send(init: RequestInit, path = '', doneText: string = p.photoSaved) {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(`/api/admin/me/photo${path}`, init);
      if (res.ok) {
        const next = staffSchema.parse(await res.json());
        setPhoto(next.photo);
        setNote({ text: next.photo ? doneText : p.photoRemoved, error: false });
        router.refresh();
        return;
      }
      const reason =
        res.status === 413
          ? p.photoTooBig
          : res.status === 415 || res.status === 422
            ? p.photoBadType
            : res.status === 404
              ? p.photoNoTelegram
              : p.photoFailed;
      setNote({ text: reason, error: true });
    } catch {
      setNote({ text: p.photoFailed, error: true });
    } finally {
      setBusy(false);
    }
  }

  function pick(file: File) {
    if (file.size > MAX_PHOTO_BYTES) return setNote({ text: p.photoTooBig, error: true });
    if (!TYPES.includes(file.type)) return setNote({ text: p.photoBadType, error: true });
    void send({ method: 'PUT', headers: { 'content-type': file.type }, body: file });
  }

  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-4">
        <Avatar name={member.name} photo={photo} className="size-16 text-lg" />
        <p className="text-sm text-pretty text-muted-foreground">{p.photoHint}</p>
      </div>
      <input
        ref={input}
        type="file"
        accept={TYPES.join(',')}
        hidden
        aria-label={p.photoUpload}
        data-testid="profile-photo-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) pick(file);
        }}
      />
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={busy} onClick={() => input.current?.click()}>
          <Camera strokeWidth={1.5} aria-hidden />
          {p.photoUpload}
        </Button>
        {member.telegramId !== null && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void send({ method: 'POST' }, '/telegram')}
          >
            <Send strokeWidth={1.5} aria-hidden />
            {p.photoTelegram}
          </Button>
        )}
        {photo && (
          <Button variant="ghost" disabled={busy} onClick={() => void send({ method: 'DELETE' })}>
            <Trash2 strokeWidth={1.5} aria-hidden />
            {p.photoRemove}
          </Button>
        )}
      </div>
      <p
        role="status"
        aria-live="polite"
        className={note?.error ? 'text-sm font-medium' : 'text-sm text-muted-foreground'}
      >
        {note?.text}
      </p>
    </div>
  );
}
