import type { Language } from '@lummi/i18n';
import { botMessages } from '@lummi/i18n/bot';
import { ArrowUpRight, ImageIcon } from 'lucide-react';
import type { AdminMessages } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * How one language version lands in a customer's Telegram chat: the image above the text (sent as
 * a photo with a caption), the plain text (no formatting, as the bot sends it), and the link
 * button under the bubble with the bot's own label («Открыть» / «Ochish»). Drawn in the brand
 * tokens, not Telegram's colours: a Stone chat ground, a white bubble at most 20 rem wide (about
 * a phone's). A photo keeps its shape, as Telegram shows it. Pure rendering of what the composer
 * holds; nothing here talks to the server.
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
  const empty = text.trim() === '';
  return (
    <div
      lang={language}
      className={cn(
        // the panel's Stone scrollbar would vanish on the Stone ground: Faint Ink here
        'overflow-y-auto overscroll-contain rounded-button bg-stone p-3 [scrollbar-color:var(--ink-faint)_transparent] [scrollbar-width:thin]',
        className,
      )}
    >
      {/* a photo makes the bubble as wide as the photo, so the caption wraps under it */}
      <div className={cn('grid max-w-[min(100%,20rem)] gap-1', image ? 'w-full' : 'w-fit')}>
        <div className="overflow-hidden rounded-card rounded-bl-[4px] bg-card">
          {image === 'placeholder' ? (
            <div className="flex h-28 w-full flex-col items-center justify-center gap-1.5 bg-field px-4 text-center text-xs text-muted-foreground">
              <ImageIcon className="size-5" strokeWidth={1.5} aria-hidden />
              {b.image}
            </div>
          ) : image ? (
            <img
              src={image}
              alt=""
              decoding="async"
              className="block h-auto max-h-[30rem] w-full bg-field object-cover"
            />
          ) : null}
          <p
            className={cn(
              'px-3 py-2 text-[14px] leading-[1.4] whitespace-pre-wrap [overflow-wrap:anywhere]',
              empty && 'text-muted-foreground',
            )}
          >
            {empty ? b.previewEmpty : text}
          </p>
        </div>
        {button && (
          <div className="relative grid h-9 place-items-center rounded-button bg-card/70 px-6 text-[13.5px] font-semibold">
            {botMessages[language].bot.broadcastOpen}
            <ArrowUpRight
              className="absolute top-1 right-1 size-3"
              strokeWidth={1.75}
              aria-hidden
            />
          </div>
        )}
      </div>
    </div>
  );
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
