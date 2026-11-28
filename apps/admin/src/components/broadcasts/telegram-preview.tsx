'use client';

import type { Language } from '@lummi/i18n';
import { adminMessages } from '@lummi/i18n/admin';
import { botMessages } from '@lummi/i18n/bot';
import { ArrowUpRight, ChevronLeft, ImageIcon, Mic, MoreVertical, Paperclip } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Monogram } from '@/components/logo';
import type { AdminMessages } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * How one language version lands in a customer's Telegram chat, drawn as Telegram draws it (the
 * owner asked for the real interface, 2026-11-28): the bot's header (the «L.» avatar on Stone,
 * «LUMMI.», «бот»), the default gradient wallpaper, an incoming bubble with the photo on top (sent
 * as a photo with a caption), the plain text (no formatting, as the bot sends it) and the time,
 * the URL button under the bubble with the bot's own label («Открыть» / «Ochish») and its ↗
 * mark, and the input bar. Telegram's own colours, light or night with the panel's theme
 * (`.tg-preview` in globals.css). Pure rendering of what the composer holds; nothing here talks
 * to the server.
 *
 * `image` is a local object URL, `'placeholder'` when a sent broadcast had one (the panel does not
 * keep its file), or null.
 */
export function TelegramPreview({
  text,
  image,
  button,
  language,
  t,
  className,
}: {
  text: string;
  image: string | 'placeholder' | null;
  button: boolean;
  language: Language;
  t: AdminMessages;
  className?: string;
}) {
  const b = t.broadcasts;
  // Telegram's own words follow the customer's language, like the message
  const chrome = adminMessages[language].admin.broadcasts;
  const empty = text.trim() === '';
  const time = useClientTime();
  return (
    <div
      lang={language}
      className={cn(
        'tg-preview flex min-h-[26rem] flex-col overflow-hidden rounded-card border border-border',
        className,
      )}
    >
      <div className="tg-header flex h-14 shrink-0 items-center gap-3 px-3">
        <ChevronLeft className="tg-accent size-6 shrink-0" strokeWidth={2} aria-hidden />
        <div className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--brand-stone)] text-[var(--brand-graphite)]">
          <Monogram className="h-3.5" />
        </div>
        <div className="min-w-0 leading-tight">
          <p className="truncate text-[15px] font-semibold">LUMMI.</p>
          <p className="tg-muted text-[13px]">{chrome.previewBot}</p>
        </div>
        <MoreVertical className="tg-muted ml-auto size-5 shrink-0" strokeWidth={2} aria-hidden />
      </div>

      {/* column-reverse keeps the chat scrolled to its newest message, as Telegram opens it */}
      <div className="tg-wallpaper flex min-h-0 flex-1 flex-col-reverse overflow-y-auto overscroll-contain px-2.5 pt-3 pb-2 [scrollbar-width:thin]">
        <div className="flex flex-col gap-1">
          <span className="tg-service mx-auto mb-1.5 rounded-full px-2.5 py-0.5 text-[13px] font-medium">
            {chrome.previewToday}
          </span>
          {/* a photo makes the bubble as wide as the photo, so the caption wraps under it */}
          <div className={cn('grid max-w-[min(88%,20rem)] gap-1', image ? 'w-full' : 'w-fit')}>
            <div className="tg-bubble overflow-hidden rounded-[16px] rounded-bl-[6px]">
              {image === 'placeholder' ? (
                <div className="tg-muted flex h-32 w-full flex-col items-center justify-center gap-1.5 bg-black/5 px-4 text-center text-xs">
                  <ImageIcon className="size-5" strokeWidth={1.5} aria-hidden />
                  {b.image}
                </div>
              ) : image ? (
                <img
                  src={image}
                  alt=""
                  decoding="async"
                  className="block h-auto max-h-[30rem] w-full object-cover"
                />
              ) : null}
              <p
                className={cn(
                  'relative px-2.5 pt-1.5 pb-1.5 text-[15px] leading-[1.35] whitespace-pre-wrap [overflow-wrap:anywhere]',
                  empty && 'tg-muted',
                )}
              >
                {empty ? b.previewEmpty : text}
                {/* room for the time on the last line, as Telegram leaves it */}
                <span className="inline-block w-11" aria-hidden />
                <span className="tg-time absolute right-2.5 bottom-1 text-[12px] tabular-nums">
                  {time}
                </span>
              </p>
            </div>
            {button && (
              <div className="tg-button relative grid h-10 place-items-center rounded-[12px] px-6 text-[14px] font-semibold">
                {botMessages[language].bot.broadcastOpen}
                <ArrowUpRight
                  className="absolute top-1 right-1 size-3.5"
                  strokeWidth={2.25}
                  aria-hidden
                />
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="tg-header flex h-12 shrink-0 items-center gap-3 px-3" aria-hidden>
        <Paperclip className="tg-muted size-5.5 shrink-0" strokeWidth={1.75} />
        <span className="tg-muted flex-1 truncate text-[15px]">{chrome.previewMessage}</span>
        <Mic className="tg-muted size-5.5 shrink-0" strokeWidth={1.75} />
      </div>
    </div>
  );
}

/** The time on the bubble: the viewer's clock, set after mount so the server render matches. */
function useClientTime(): string {
  const [time, setTime] = useState('12:00');
  useEffect(() => {
    const now = new Date();
    setTime(
      `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
    );
  }, []);
  return time;
}

/** RU / UZ for the preview, in the panel's segmented grammar (the sidebar language switch). */
export function PreviewLanguageSwitch({
  value,
  onChange,
  only,
  label,
}: {
  value: Language;
  onChange: (language: Language) => void;
  /** A one-language audience: the other version is not offered. */
  only?: Language | null;
  label: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex h-9 shrink-0 items-center rounded-full bg-field p-[3px]"
    >
      {(['ru', 'uz'] as const).map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          aria-pressed={value === l}
          disabled={!!only && only !== l}
          onClick={() => onChange(l)}
          className={cn(
            'h-full min-w-10 rounded-full px-2.5 text-xs tracking-wide uppercase transition-[color,background-color,transform] duration-150 ease-out active:scale-[0.96]',
            value === l
              ? 'bg-card font-semibold text-foreground'
              : 'font-medium text-muted-foreground hover:text-foreground disabled:opacity-50',
          )}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
