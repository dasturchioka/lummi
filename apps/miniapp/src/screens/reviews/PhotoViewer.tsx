import { reviewsMessages } from '@lummi/i18n/reviews';
import { fill } from '@lummi/i18n';
import { useEffect, useRef, useState } from 'react';
import { API_BASE } from '../../lib/api';
import { showBackButton } from '../../lib/back-button';
import { usePrefs } from '../../lib/prefs';
import { CloseIcon } from '../../ui/icons';

/**
 * The full-screen viewer of one review's photos (#41): swipe between them, close with Telegram's
 * back button, Escape or the close control. Loaded on the first tap, so the first screen and the
 * card never carry it.
 */
export default function PhotoViewer({
  keys,
  start,
  onClose,
}: {
  keys: string[];
  start: number;
  onClose: () => void;
}) {
  const { language } = usePrefs();
  const t = reviewsMessages[language].reviews;
  const track = useRef<HTMLUListElement>(null);
  const [index, setIndex] = useState(start);

  useEffect(() => showBackButton(true, onClose), [onClose]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  // open on the tapped photo
  useEffect(() => {
    const el = track.current;
    if (el) el.scrollLeft = start * el.clientWidth;
  }, [start]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t.title}
      data-testid="photo-viewer"
      className="fixed inset-0 z-50 flex flex-col bg-black/92 text-white"
    >
      <div className="flex items-center justify-between px-4 pt-[max(env(safe-area-inset-top),12px)] pb-2">
        <span className="type-small tabular-nums">
          {fill(t.photoOf, { n: String(index + 1), total: String(keys.length) })}
        </span>
        <button
          type="button"
          aria-label={t.close}
          onClick={onClose}
          className="grid size-10 place-items-center rounded-full bg-white/12"
        >
          <CloseIcon size={20} />
        </button>
      </div>
      <ul
        ref={track}
        onScroll={(e) =>
          setIndex(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))
        }
        className="flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {keys.map((key) => (
          <li key={key} className="grid w-full shrink-0 snap-center place-items-center p-4">
            <img
              src={`${API_BASE}/reviews/photos/${key}.jpg`}
              alt={t.photoAlt}
              className="max-h-full max-w-full object-contain"
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
