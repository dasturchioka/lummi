import type { Bilingual, FragranceCard, VolumeCard } from '@lummi/contracts';
import { useState, type ReactNode } from 'react';
import { saleEndDate } from '../../lib/format';
import { photoSrcSet, photoUrl } from '../../lib/media';
import { usePrefs } from '../../lib/prefs';
import { openExternal } from '../../lib/share';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import {
  ArrowLeftIcon,
  BottleIcon,
  ClockIcon,
  LeafIcon,
  MoonIcon,
  ShareIcon,
  SunIcon,
  SunMoonIcon,
  WaveIcon,
} from '../../ui/icons';
import { Money } from '../../ui/Money';

const fill = (template: string, values: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (_m, k: string) => values[k] ?? '');

const TIME_ICON = {
  day: <SunIcon size={24} />,
  evening: <MoonIcon size={24} />,
  day_evening: <SunMoonIcon size={24} />,
  everyday: <SunIcon size={24} />,
} as const;

/** 92% Milk disc over the photo: back and share. The one overlay the system allows (DESIGN.md Elevation). */
const DISC =
  'grid size-10 place-items-center rounded-pill bg-ground/92 text-ink transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-95';

function Gallery({
  card,
  volume,
  onBack,
  onShare,
}: {
  card: FragranceCard;
  volume: VolumeCard | undefined;
  onBack: () => void;
  onShare: () => void;
}) {
  const { t } = usePrefs();
  const hash = volume?.photo ?? null;
  return (
    <div className="relative aspect-[3/4] overflow-hidden rounded-card bg-photo">
      {hash ? (
        <img
          // A new volume is a new image: it fades in over the Photo Blush placeholder.
          key={hash}
          src={photoUrl(hash, 800)}
          srcSet={photoSrcSet(hash)}
          sizes="(min-width: 520px) 488px, calc(100vw - 32px)"
          alt={card.name}
          width={1086}
          height={1448}
          decoding="async"
          fetchPriority="high"
          className="absolute inset-0 size-full animate-[fade-in_0.32s_cubic-bezier(0.16,1,0.3,1)] object-cover"
        />
      ) : (
        <div className="absolute inset-0 grid place-items-center text-faint">
          <BottleIcon size={56} />
        </div>
      )}
      <div className="absolute inset-x-3 top-3 flex items-center justify-between">
        <button type="button" aria-label={t.card.back} onClick={onBack} className={DISC}>
          <ArrowLeftIcon size={20} />
        </button>
        <button type="button" aria-label={t.card.share} onClick={onShare} className={DISC}>
          <ShareIcon size={20} />
        </button>
      </div>
    </div>
  );
}

/** Label divider (DESIGN.md Shapes): hairline, 4 px Sage diamond, hairline, 72 px wide. */
function LabelDivider() {
  return (
    <div aria-hidden="true" className="flex w-[72px] items-center gap-1.5 text-line-strong">
      <span className="h-px flex-1 bg-current" />
      <span className="size-1 rotate-45 bg-sage" />
      <span className="h-px flex-1 bg-current" />
    </div>
  );
}

function Badge({ card }: { card: FragranceCard }) {
  const { t } = usePrefs();
  // At most one badge; a hit outranks a novelty.
  if (card.isHit)
    return (
      <span className="type-label rounded-pill bg-sage px-2.5 py-0.5 text-[10px] text-[#2a2a2a]">
        {t.card.hit}
      </span>
    );
  if (card.isNew)
    return (
      <span className="type-label rounded-pill px-2.5 py-0.5 text-[10px] text-sage-ink shadow-[inset_0_0_0_1px_var(--c-sage)]">
        {t.card.isNew}
      </span>
    );
  return null;
}

function Trait({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <li className="flex min-w-0 flex-col items-center gap-1 px-1 text-center">
      <span className="text-ink">{icon}</span>
      <span className="text-[11px] leading-tight text-muted">{label}</span>
      <span className="text-[13px] leading-tight font-semibold text-balance text-ink">{value}</span>
    </li>
  );
}

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

function VolumeTiles({
  volumes,
  selected,
  onSelect,
}: {
  volumes: VolumeCard[];
  selected: number;
  onSelect: (ml: number) => void;
}) {
  const { t } = usePrefs();
  return (
    <div role="radiogroup" aria-label={t.card.volume} className="grid grid-cols-3 gap-2">
      {volumes.map((v) => {
        const isSelected = v.ml === selected;
        const soldOut = v.available === 0;
        return (
          <button
            key={v.ml}
            type="button"
            role="radio"
            aria-checked={isSelected}
            data-sold-out={soldOut || undefined}
            onClick={() => onSelect(v.ml)}
            className={`flex min-h-[64px] flex-col items-center justify-center gap-0.5 rounded-btn px-1 py-2 transition-[background-color,color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97] ${
              isSelected
                ? 'bg-btn text-btn-ink'
                : soldOut
                  ? 'bg-transparent text-faint shadow-[inset_0_0_0_1px_var(--c-line)]'
                  : 'bg-card text-ink shadow-[inset_0_0_0_1px_var(--c-line-strong)]'
            }`}
          >
            <span className="text-[15px] leading-none font-semibold">
              {v.ml} {t.card.ml}
            </span>
            {soldOut ? (
              <span className="text-[11px] leading-tight">{t.card.soldOut}</span>
            ) : (
              <>
                <Money amount={v.effectivePrice} className="!text-[12.5px] !font-medium" />
                {v.salePrice !== null ? (
                  <s className="type-small !text-[11px] whitespace-nowrap opacity-70">
                    <Money amount={v.price} className="!text-[11px] !font-normal" />
                  </s>
                ) : null}
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Price of the chosen volume: Uzum-style markdown (ADR 0008), no timer, sold out said plainly. */
function PriceLine({ volume }: { volume: VolumeCard }) {
  const { t, language } = usePrefs();
  const soldOut = volume.available === 0;
  const until =
    volume.saleEndsAt !== null
      ? fill(t.card.saleUntil, { date: saleEndDate(volume.saleEndsAt, language) })
      : null;
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <Money amount={volume.effectivePrice} size="amount" />
      {volume.salePrice !== null ? (
        <>
          <s className="text-muted">
            <Money amount={volume.price} />
          </s>
          <span className="type-count rounded-pill bg-sage-wash px-2 py-1 text-[11px] text-sage-ink">
            −{volume.salePercent}%
          </span>
          {until ? <span className="type-small whitespace-nowrap text-muted">{until}</span> : null}
        </>
      ) : null}
      <span
        className={`type-small basis-full ${soldOut ? 'text-muted' : 'text-sage-ink'}`}
        data-availability={soldOut ? 'sold-out' : 'in-stock'}
      >
        {soldOut ? t.card.unavailable : t.card.inStock}
      </span>
    </div>
  );
}

function Pyramid({ card }: { card: FragranceCard }) {
  const { t, language } = usePrefs();
  const names = (l: Bilingual[]) => l.map((n) => n[language]).join(', ');
  const rows = (['top', 'heart', 'base'] as const).filter((k) => card.notes[k].length > 0);
  if (rows.length === 0) return null;
  return (
    <Card className="divide-y divide-line px-4">
      {rows.map((k) => (
        <div key={k} className="flex gap-4 py-3">
          <span className="type-small w-[72px] shrink-0 text-muted">{t.card.notes[k]}</span>
          <span className="type-body min-w-0 flex-1 [overflow-wrap:anywhere]">
            {names(card.notes[k])}
          </span>
        </div>
      ))}
    </Card>
  );
}

/**
 * The fragrance card (approved variant 2 with the icon row from variant 1). The reviews block, the
 * favourite heart and the cart dock arrive with their own tickets and slot in where DESIGN.md puts them.
 */
export function FragranceView({
  card,
  onBack,
  onShare,
}: {
  card: FragranceCard;
  onBack: () => void;
  onShare: () => void;
}) {
  const { t, language } = usePrefs();
  // Start on the smallest volume that can be bought; all sold out -> the smallest one.
  const [ml, setMl] = useState(
    () => (card.volumes.find((v) => v.available > 0) ?? card.volumes[0])?.ml,
  );
  const volume = card.volumes.find((v) => v.ml === ml) ?? card.volumes[0];
  const keyNotes = card.keyNotes[language].join(' · ');
  const attribution = fill(t.card.basedOn, { brand: card.brand });

  return (
    <article className="flex flex-col gap-6 pt-3">
      <Gallery card={card} volume={volume} onBack={onBack} onShare={onShare} />

      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Badge card={card} />
          <span className="type-label text-muted">
            {t.card.type[card.type]}
            {card.family ? ` · ${card.family[language]}` : ''}
          </span>
        </div>
        <p className="type-label text-muted [overflow-wrap:anywhere]">{attribution}</p>
        <h1 className="type-name text-[24px] [overflow-wrap:anywhere]">{card.name}</h1>
        <LabelDivider />
        <p className="type-body text-muted">{keyNotes}</p>
      </header>

      <section className="flex flex-col gap-3">
        <p className="type-body">{card.description[language]}</p>
        <p className="type-body">
          <span className="font-semibold">{t.card.whenToWear}: </span>
          {card.whenToWear[language]}
        </p>
      </section>

      <Traits card={card} />

      {volume ? (
        <section className="flex flex-col gap-3">
          <VolumeTiles
            volumes={card.volumes}
            selected={volume.ml}
            onSelect={(next) => setMl(next as VolumeCard['ml'])}
          />
          <PriceLine volume={volume} />
        </section>
      ) : null}

      <Pyramid card={card} />

      {card.uzumUrl ? (
        <Button variant="secondary" block onClick={() => openExternal(card.uzumUrl as string)}>
          {t.card.uzum}
        </Button>
      ) : null}

      <p className="type-small rounded-btn bg-field px-4 py-3 text-muted">{t.card.disclaimer}</p>
    </article>
  );
}
