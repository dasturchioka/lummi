import type { Bilingual, FragranceCard, UpgradeRightPrice, VolumeCard } from '@lummi/contracts';
import { fill, formatCalendarDate } from '@lummi/i18n';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { keepNumberWithWord } from '../../lib/format';
import { photoSrcSet, photoUrl } from '../../lib/media';
import { photoHeight } from '../../lib/photo-widths';
import { useDiscountsText } from '../../discounts/queries';
import { volumesText } from '../../discounts/volumes';
import { usePrefs } from '../../lib/prefs';
import { FragranceBadge } from '../../ui/Badge';
import { BuyPair } from '../../ui/BuyPair';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { DockNote } from '../../ui/DockNote';
import { LabelDivider } from '../../ui/LabelDivider';
import { DISC } from '../../ui/photoDisc';
import {
  ArrowLeftIcon,
  BottleIcon,
  ClockIcon,
  LeafIcon,
  MoonIcon,
  SunIcon,
  SunMoonIcon,
  WaveIcon,
} from '../../ui/icons';
import { PhotoActions, UzumButton } from '../../ui/ProductActions';
import { Screen } from '../../ui/Screen';
import { StepUpRow, VolumeStatus, VolumeTiles } from '../../ui/VolumeTiles';

const TIME_ICON = {
  day: <SunIcon size={24} />,
  evening: <MoonIcon size={24} />,
  day_evening: <SunMoonIcon size={24} />,
  everyday: <SunIcon size={24} />,
} as const;

/** The gallery is the full column: 488 px at most (520 minus the gutters). */
const PHOTO_SIZES = '(min-width: 520px) 488px, calc(100vw - 32px)';

/**
 * The photo of the chosen volume. Choosing another volume cross-fades: the new photo fades in over
 * the one it replaces (0.32 s, DESIGN.md Volume selector) instead of flashing the placeholder. Once
 * the first photo is in, the other volumes' photos load quietly, so a switch is instant.
 */
function Gallery({
  card,
  hash,
  onBack,
  onShare,
}: {
  card: FragranceCard;
  hash: string | null;
  onBack: () => void;
  onShare: () => void;
}) {
  const { t } = usePrefs();
  const [shown, setShown] = useState(hash);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  /** The photo being replaced: it stays under the new one until that has faded in. */
  const [leaving, setLeaving] = useState<string | null>(null);
  if (hash !== shown) {
    setLeaving(ready && !failed ? shown : leaving);
    setShown(hash);
    setReady(false);
    setFailed(false);
  }

  const prefetched = useRef(false);
  useEffect(() => {
    if (!ready || prefetched.current) return;
    prefetched.current = true;
    for (const v of card.volumes) {
      if (!v.photo || v.photo === hash) continue;
      const img = new Image();
      img.decoding = 'async';
      img.sizes = PHOTO_SIZES; // before srcset, so the browser picks the same candidate as the gallery
      img.srcset = photoSrcSet(v.photo);
    }
  }, [ready, hash, card.volumes]);

  // The first photo paints as it arrives; a replacement waits until it is decoded, then fades in.
  const hidden = failed || (leaving !== null && !ready);
  return (
    <div
      className="relative aspect-[3/4] overflow-hidden rounded-card bg-photo"
      // Screenshots wait for the photo, as they wait for skeletons.
      data-skeleton={shown && !ready && !failed ? '' : undefined}
    >
      <div className="absolute inset-0 grid place-items-center text-faint" aria-hidden="true">
        <BottleIcon size={56} />
      </div>
      {leaving ? (
        <img
          key={`leaving-${leaving}`}
          src={photoUrl(leaving, 800)}
          srcSet={photoSrcSet(leaving)}
          sizes={PHOTO_SIZES}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 size-full object-cover"
        />
      ) : null}
      {shown ? (
        <img
          key={shown}
          src={photoUrl(shown, 800)}
          srcSet={photoSrcSet(shown)}
          sizes={PHOTO_SIZES}
          alt={card.name}
          width={800}
          height={photoHeight(800)}
          decoding="async"
          fetchPriority="high"
          onLoad={() => setReady(true)}
          onError={() => {
            setFailed(true);
            setLeaving(null);
          }}
          onTransitionEnd={() => setLeaving(null)}
          className={`absolute inset-0 size-full object-cover transition-opacity duration-[320ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${
            hidden ? 'opacity-0' : 'opacity-100'
          }`}
        />
      ) : null}
      <div className="absolute inset-x-3 top-3 flex items-start justify-between">
        <button type="button" aria-label={t.card.back} onClick={onBack} className={DISC}>
          <ArrowLeftIcon size={20} />
        </button>
        <PhotoActions favourite={card.slug} name={card.name} onShare={onShare} />
      </div>
    </div>
  );
}

/**
 * The label lockup (DESIGN.md Label Lockup Rule), as the brandbook's product name block: attribution
 * caps, the italic name, the divider, one muted meta line (the badge inline at its start, then the
 * type and the family), then the key notes.
 */
function Lockup({ card }: { card: FragranceCard }) {
  const { t, language } = usePrefs();
  return (
    <header className="flex flex-col">
      <p className="type-label text-muted [overflow-wrap:anywhere]">
        {fill(t.card.basedOn, { brand: card.brand })}
      </p>
      <h1 className="type-name-lg mt-1 text-balance text-ink [overflow-wrap:anywhere]">
        {card.name}
      </h1>
      <LabelDivider />
      <p className="type-small mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-muted">
        <FragranceBadge isHit={card.isHit} isNew={card.isNew} />
        <span>
          <span className="tracking-[0.04em] uppercase">{t.card.type[card.type]}</span>
          {card.family ? ` · ${card.family[language]}` : null}
        </span>
      </p>
      {card.keyNotes[language].length > 0 ? (
        <p className="type-body mt-1.5 text-muted">{card.keyNotes[language].join(' · ')}</p>
      ) : null}
    </header>
  );
}

function Trait({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <li className="flex min-w-0 flex-col items-center px-0.5 text-center">
      <span className="mb-2 text-ink">{icon}</span>
      <span className="type-caption text-muted">{label}</span>
      <span className="type-value mt-0.5 text-balance text-ink">{keepNumberWithWord(value)}</span>
    </li>
  );
}

/** The characteristics icon row (approved, from variant 1): four equal columns between hairlines. */
function Traits({ card }: { card: FragranceCard }) {
  const { t, language } = usePrefs();
  return (
    <ul className="grid grid-cols-4 gap-1 border-y border-line py-4">
      <Trait
        icon={<ClockIcon size={24} />}
        label={t.card.traits.longevity}
        value={card.longevity[language]}
      />
      <Trait
        icon={<WaveIcon size={24} />}
        label={t.card.traits.sillage}
        value={t.card.sillage[card.sillage]}
      />
      <Trait
        icon={<LeafIcon size={24} />}
        label={t.card.traits.season}
        value={t.card.season[card.season]}
      />
      <Trait
        icon={TIME_ICON[card.timeOfDay]}
        label={t.card.traits.time}
        value={t.card.time[card.timeOfDay]}
      />
    </ul>
  );
}

/** The notes pyramid (top / heart / base); an empty level is left out, and with it no card at all. */
function Pyramid({ card }: { card: FragranceCard }) {
  const { t, language } = usePrefs();
  const names = (l: Bilingual[]) => l.map((n) => n[language]).join(', ');
  const rows = (['top', 'heart', 'base'] as const).filter((k) => card.notes[k].length > 0);
  if (rows.length === 0) return null;
  return (
    <Card as="dl" className="mt-7 divide-y divide-line px-4">
      {rows.map((k) => (
        <div key={k} className="flex items-baseline gap-4 py-3">
          <dt className="type-body w-18 shrink-0 text-muted">{t.card.notes[k]}</dt>
          <dd className="type-body min-w-0 flex-1 [overflow-wrap:anywhere]">
            {names(card.notes[k])}
          </dd>
        </div>
      ))}
    </Card>
  );
}

/**
 * The customer's upgrade right on the chosen volume (TZ §3.4: «цена со скидкой + Скидка за набор»;
 * mockup 09): a Sage Wash block under the stock line, the discount on the left and its last day on
 * the right, then what it covers. The price itself is on the tile and in the dock; the cart
 * applies the right by itself.
 */
function RightDeal({ right, fullSizeMl }: { right: UpgradeRightPrice; fullSizeMl: number[] }) {
  const { language } = usePrefs();
  const d = useDiscountsText();
  const day = formatCalendarDate(right.lastDay, language);
  return (
    <div
      data-testid="right-deal"
      className="type-small flex flex-col gap-0.5 rounded-btn bg-sage-wash px-3.5 py-2.5 text-sage-ink"
    >
      <p className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="font-semibold">
          {fill(d.cardDeal[right.source], { percent: String(right.percent) })}
        </span>
        <span className="whitespace-nowrap">{fill(d.until, { date: day })}</span>
      </p>
      <p className="text-pretty">
        {fill(d.cardDealTerms, { volumes: volumesText(fullSizeMl, d.volumesOr) })}
      </p>
    </div>
  );
}

/**
 * The dock (approved comp): «В корзину · <price>» and «Купить сейчас» for the chosen volume
 * (`BuyPair`); a sold-out volume turns it into one disabled button with the reason.
 */
function Dock({
  volume,
  right,
  adding = false,
  note,
  onAddToCart,
  onBuyNow,
}: {
  volume: VolumeCard | undefined;
  /** The customer's right on this volume: the dock shows its price, the regular one struck (#38). */
  right?: UpgradeRightPrice;
  adding?: boolean;
  /** A brief line above the buttons («Осталось 3»). */
  note?: string;
  onAddToCart?: (ml: VolumeCard['ml']) => void;
  onBuyNow?: (ml: VolumeCard['ml']) => void;
}) {
  const { t } = usePrefs();
  if (volume === undefined || volume.available === 0)
    return (
      <Button block disabled data-availability="sold-out">
        {t.card.unavailable}
      </Button>
    );
  return (
    <div className="relative">
      <DockNote text={note} />
      <BuyPair
        toCart={t.card.toCart}
        price={right?.price ?? volume.effectivePrice}
        was={right ? volume.price : undefined}
        adding={adding}
        onAdd={() => onAddToCart?.(volume.ml)}
        onBuyNow={() => onBuyNow?.(volume.ml)}
      />
    </div>
  );
}

/**
 * The fragrance card (approved variant 2 with the icon row from variant 1), with its dock. The
 * favourite heart (#45) and the reviews block under the notes (#41) slot in where DESIGN.md puts them.
 */
export function FragranceView({
  card,
  onBack,
  onShare,
  adding,
  note,
  onAddToCart,
  onBuyNow,
  reviews,
  footer,
}: {
  card: FragranceCard;
  onBack: () => void;
  onShare: () => void;
  adding?: boolean;
  note?: string;
  onAddToCart?: (ml: VolumeCard['ml']) => void;
  onBuyNow?: (ml: VolumeCard['ml']) => void;
  /** Under the notes pyramid: the reviews block (#41), which loads on its own. */
  reviews?: ReactNode;
  /** After the Uzum button: «Похожие ароматы», which loads on its own. */
  footer?: ReactNode;
}) {
  const { t, language } = usePrefs();
  // Start on the smallest volume that can be bought; all sold out -> the smallest one.
  const [ml, setMl] = useState(
    () => (card.volumes.find((v) => v.available > 0) ?? card.volumes[0])?.ml,
  );
  const volume = card.volumes.find((v) => v.ml === ml) ?? card.volumes[0];
  const rightPrices = Object.fromEntries(card.upgradeRightPrices.map((r) => [r.ml, r.price]));
  const right =
    volume && volume.available > 0
      ? card.upgradeRightPrices.find((r) => r.ml === volume.ml)
      : undefined;
  // the server offers a step-up only from a volume that can be bought, and none where the
  // customer's right prices either volume (#57); the guard keeps a stale answer honest
  const stepUp =
    volume && volume.available > 0 ? card.stepUps.find((u) => u.fromMl === volume.ml) : undefined;
  const [focusTick, setFocusTick] = useState(0);

  return (
    <Screen
      tabBar={false}
      dock={
        <Dock
          volume={volume}
          right={right}
          adding={adding}
          note={note}
          onAddToCart={onAddToCart}
          onBuyNow={onBuyNow}
        />
      }
    >
      <article className="flex flex-col pt-3 pb-7">
        <Gallery card={card} hash={volume?.photo ?? null} onBack={onBack} onShare={onShare} />

        <div className="mt-5">
          <Lockup card={card} />
        </div>

        <section className="mt-5 flex flex-col gap-2">
          <p className="type-body text-ink">{card.description[language]}</p>
          <p className="type-body text-muted">
            <span className="font-semibold text-ink">{t.card.whenToWear}:</span>{' '}
            {card.whenToWear[language]}
          </p>
          <p className="type-small text-muted">{t.card.disclaimer}</p>
        </section>

        <div className="mt-6">
          <Traits card={card} />
        </div>

        {volume ? (
          <section className="mt-6 flex flex-col gap-3">
            <VolumeTiles
              volumes={card.volumes}
              rightPrices={rightPrices}
              selected={volume.ml}
              onSelect={setMl}
              focusTick={focusTick}
            />
            <VolumeStatus volume={volume} showCount={card.showAvailableCount} />
            {right ? <RightDeal right={right} fullSizeMl={card.fullSizeMl} /> : null}
            {stepUp ? (
              <StepUpRow
                stepUp={stepUp}
                onChoose={(to) => {
                  setMl(to);
                  setFocusTick((n) => n + 1);
                }}
              />
            ) : null}
          </section>
        ) : null}

        <Pyramid card={card} />
        {reviews}

        <UzumButton url={card.uzumUrl} />
        {footer}
      </article>
    </Screen>
  );
}
