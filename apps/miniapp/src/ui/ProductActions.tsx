import { openExternal } from '../lib/share';
import { usePrefs } from '../lib/prefs';
import { Button } from './Button';
import { HeartButton } from './HeartButton';
import { ExternalIcon, ShareIcon } from './icons';
import { DISC } from './photoDisc';

/**
 * The action column on a product photo: «Поделиться», the heart under it. One component for the
 * fragrance card and the Discovery set, so the two cannot drift (#54).
 */
export function PhotoActions({
  favourite,
  name,
  onShare,
}: {
  /** The heart's target: a fragrance slug or `DISCOVERY_FAVOURITE`. */
  favourite: string;
  name: string;
  onShare: () => void;
}) {
  const { t } = usePrefs();
  return (
    <div className="flex flex-col items-center gap-2">
      <button type="button" aria-label={t.card.share} onClick={onShare} className={DISC}>
        <ShareIcon size={20} />
      </button>
      <HeartButton target={favourite} name={name} place="disc" />
    </div>
  );
}

/** «Купить на Uzum» under a product's content; nothing without a link. */
export function UzumButton({ url }: { url: string | null }) {
  const { t } = usePrefs();
  if (!url) return null;
  return (
    <Button variant="secondary" block className="mt-7" onClick={() => openExternal(url)}>
      {t.card.uzum}
      <ExternalIcon size={16} />
    </Button>
  );
}
