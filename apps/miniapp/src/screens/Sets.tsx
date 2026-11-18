import type { Builder, DiscoverySet, FragranceListItem } from '@lummi/contracts';
import {
  DISCOVERY_FAVOURITE,
  DISCOVERY_SETS,
  SET_SIZE,
  type DiscoveryVialMl,
} from '@lummi/contracts/constants';
import { buyNowParam } from '@lummi/contracts/buy-now';
import { fill, plural } from '@lummi/i18n';
import { useRouter, useSearch } from '@tanstack/react-router';
import { useEffect, useState, type ReactNode } from 'react';
import {
  SetUnavailableError,
  useAddBuilder,
  useAddDiscovery,
  useBuilder,
  useSetsText,
} from '../sets/actions';
import { useDiscoverySet } from '../sets/queries';
import { goBackOrCatalog, useOpenFragrance } from '../lib/navigation';
import { photoSrcSet, photoUrl } from '../lib/media';
import { usePrefs } from '../lib/prefs';
import { shareDiscovery } from '../lib/share';
import { hapticSuccess } from '../lib/telegram';
import { Button } from '../ui/Button';
import { BuyPair } from '../ui/BuyPair';
import { DockNote } from '../ui/DockNote';
import { LabelDivider } from '../ui/LabelDivider';
import { NameLockup } from '../ui/NameLockup';
import { DISC, EASE_OUT } from '../ui/photoDisc';
import { AlertIcon, ArrowLeftIcon, BoxIcon, CheckIcon, ChevronIcon, PlusIcon } from '../ui/icons';
import { Money } from '../ui/Money';
import { ReviewsBlock } from './reviews/ReviewsBlock';
import { PhotoActions, UzumButton } from '../ui/ProductActions';
import { Screen } from '../ui/Screen';
import { SetPhoto } from '../ui/SetPhoto';
import { Skeleton } from '../ui/Skeleton';
import { EmptyState, ErrorState } from '../ui/States';

/** A status line that rises above the dock for a moment and never moves the buttons. */
function useNote(): [string | undefined, (n: string) => void] {
  const [note, setNote] = useState<string | undefined>();
  useEffect(() => {
    if (!note) return;
    const id = setTimeout(() => setNote(undefined), 2500);
    return () => clearTimeout(id);
  }, [note]);
  return [note, setNote];
}

/** The Discovery set's shape while it loads: the photo slot in Photo Blush, the name block, the list. */
function DiscoveryLoading() {
  return (
    <Screen tabBar={false} dock={<Skeleton className="h-12 w-full" />}>
      <div className="flex flex-col pt-3 pb-7" aria-busy="true">
        <div aria-hidden="true" className="aspect-[3/4] w-full rounded-card bg-photo" />
        <Skeleton className="mt-5 h-3 w-16" />
        <Skeleton className="mt-2.5 h-6 w-40" />
        <Skeleton className="mt-4 h-3.5 w-56" />
        <Skeleton className="mt-3 h-4 w-24" />
        <Skeleton rounded="card" className="mt-8 h-[310px] w-full" />
      </div>
    </Screen>
  );
}

/** The builder's shape while it loads: the title, the set box, the first rows. */
function BuilderLoading() {
  return (
    <Screen tabBar={false} dock={<Skeleton className="h-12 w-full" />}>
      <div className="flex flex-col pt-5" aria-busy="true">
        <div className="flex items-start gap-3">
          <Skeleton rounded="pill" className="size-10 shrink-0" />
          <div className="min-w-0 flex-1 pt-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="mt-3 h-3.5 w-full" />
            <Skeleton className="mt-2 h-3.5 w-3/4" />
          </div>
        </div>
        <Skeleton rounded="card" className="mt-5 h-[224px] w-full" />
        <Skeleton rounded="card" className="mt-3 h-[288px] w-full" />
      </div>
    </Screen>
  );
}

/** What the Discovery set screen shows for one server set; the fixtures render it too. */
export function DiscoverySetView({
  set,
  adding = false,
  note,
  onBack = () => undefined,
  onAdd = () => undefined,
  onBuyNow = () => undefined,
  onShare = () => undefined,
  onOpen = () => undefined,
  reviews,
}: {
  set: DiscoverySet;
  adding?: boolean;
  note?: string;
  onBack?: () => void;
  onAdd?: () => void;
  /** «Купить сейчас»: a checkout of this one set, the cart left as it is (#25). */
  onBuyNow?: () => void;
  /** «Поделиться»: the `set_discovery` link in Telegram's share sheet. */
  onShare?: () => void;
  onOpen?: (slug: string) => void;
  /** Under the composition: the reviews block (#41). */
  reviews?: ReactNode;
}) {
  const { t, language } = usePrefs();
  const s = useSetsText();
  const ready = set.fragrances.length === SET_SIZE;
  // each set's own name and lead (ADR 0042); the heart and the share link are the 5 × 10 ml
  // set's only for now (`extras`)
  const text = s.discovery[set.vialMl];
  const { extras } = DISCOVERY_SETS[set.vialMl];
  return (
    <Screen
      tabBar={false}
      dock={
        <div className="relative">
          <DockNote text={note} />
          {!ready ? (
            <Button block disabled>
              {s.notReady}
            </Button>
          ) : set.soldOut ? (
            <Button block disabled data-availability="sold-out">
              {s.soldOut}
            </Button>
          ) : (
            <BuyPair
              toCart={s.toCart}
              price={set.price}
              adding={adding}
              onAdd={onAdd}
              onBuyNow={onBuyNow}
            />
          )}
        </div>
      }
    >
      <article className="flex flex-col pt-3 pb-7">
        <div className="relative aspect-[3/4] overflow-hidden rounded-card bg-photo">
          <SetPhoto hash={set.photo} sizes="(min-width: 520px) 488px, 100vw" eager />
          <div className="absolute inset-x-3 top-3 flex items-start justify-between">
            <button type="button" aria-label={t.card.back} onClick={onBack} className={DISC}>
              <ArrowLeftIcon size={20} />
            </button>
            {extras ? (
              <PhotoActions favourite={DISCOVERY_FAVOURITE} name={text.title} onShare={onShare} />
            ) : null}
          </div>
        </div>

        {/* The set's name block, as the product page's (bb-08): caps label, italic name, divider. */}
        <header className="mt-5 flex flex-col">
          <p className="type-label text-muted">{t.home.discoveryLabel}</p>
          <h1 className="type-name-lg mt-1 text-balance text-ink [overflow-wrap:anywhere]">
            {text.title}
          </h1>
          <LabelDivider />
          <p className="type-body mt-3 text-pretty text-muted">{text.lead}</p>
          <p className="mt-2 text-ink">
            <Money amount={set.price} />
          </p>
        </header>

        {ready ? (
          <section className="mt-7" aria-labelledby="inside">
            <h2 id="inside" className="type-section text-ink">
              {s.inside}
            </h2>
            <ul className="mt-3 divide-y divide-line overflow-hidden rounded-card bg-card">
              {set.fragrances.map((f, i) => (
                <li key={f.slug ?? `hidden-${i}`}>
                  {f.slug === null ? (
                    // hidden from the catalog: the box still holds it, but there is no card to open
                    <div className="flex min-h-14 w-full items-center px-4 py-3">
                      <span className="min-w-0 flex-1">
                        <NameLockup brand={f.brand} name={f.name} />
                      </span>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onOpen(f.slug as string)}
                      className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-150 active:bg-field"
                    >
                      <span className="min-w-0 flex-1">
                        <NameLockup brand={f.brand} name={f.name} />
                        {f.keyNotes[language].length > 0 ? (
                          <span className="type-small mt-0.5 block text-pretty text-muted">
                            {f.keyNotes[language].slice(0, 3).join(' · ')}
                          </span>
                        ) : null}
                      </span>
                      <span className="-mr-1 shrink-0 text-muted" aria-hidden="true">
                        <ChevronIcon size={16} />
                      </span>
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {reviews}
        <UzumButton url={set.uzumUrl} />
        <p className="type-small mt-6 text-muted">{t.card.disclaimer}</p>
      </article>
    </Screen>
  );
}

/** `/sets/discovery`, also the target of the `set_discovery` deep link. */
export function DiscoverySetScreen() {
  return <DiscoveryScreenOf vialMl={10} />;
}

/** `/sets/discovery-5`: the 5 × 5 ml set (ADR 0042). */
export function Discovery5SetScreen() {
  return <DiscoveryScreenOf vialMl={5} />;
}

function DiscoveryScreenOf({ vialMl }: { vialMl: DiscoveryVialMl }) {
  const router = useRouter();
  const open = useOpenFragrance();
  const s = useSetsText();
  const query = useDiscoverySet(vialMl);
  const add = useAddDiscovery(vialMl);
  const [note, setNote] = useNote();
  if (query.isError && !query.data)
    return (
      <Screen tabBar={false}>
        <ErrorState fill retrying={query.isFetching} onRetry={() => void query.refetch()} />
      </Screen>
    );
  if (!query.data) return <DiscoveryLoading />;
  return (
    <DiscoverySetView
      set={query.data}
      adding={add.isPending}
      note={note}
      onBack={() => goBackOrCatalog(router)}
      onOpen={open}
      onShare={() => void shareDiscovery(s.discovery[vialMl].title)}
      reviews={DISCOVERY_SETS[vialMl].extras ? <ReviewsBlock target="discovery-set" /> : undefined}
      onBuyNow={() =>
        void router.navigate({
          to: '/checkout',
          search: { item: buyNowParam({ kind: 'discovery_set', vialMl }) },
        })
      }
      onAdd={() =>
        add.mutate(undefined, {
          onSuccess: () => {
            hapticSuccess();
            setNote(s.added);
          },
          onError: () => setNote(s.failed),
        })
      }
    />
  );
}

/**
 * A chosen fragrance in its compartment: the 10 ml photo cropped to the vial alone (x 38–62 %,
 * y 15–68 % of the 3:4 label; every bottle photo is shot on the same template), as the box holds it.
 */
const VIAL_CROP = 'absolute top-[-28.3%] left-[-158.3%] aspect-[3/4] w-[416.7%] max-w-none';

/**
 * The set box (DESIGN.md Set box): five vial compartments on the Milk Field tray, filled in the
 * order they were chosen; the next empty one has the ink outline. Under it the count and the
 * set's price, then the Sage thread, the one measure of how full the box is.
 */
function SetBox({ chosen, price }: { chosen: FragranceListItem[]; price: number }) {
  const s = useSetsText();
  const n = chosen.length;
  return (
    <section className="rounded-card bg-card px-4 pt-4 pb-3.5">
      <div aria-hidden="true" className="mx-auto flex w-fit gap-1.5 rounded-btn bg-field p-1.5">
        {Array.from({ length: SET_SIZE }, (_, i) => {
          const f = chosen[i];
          const look = f
            ? 'bg-photo'
            : i === n
              ? 'text-ink shadow-[inset_0_0_0_1.5px_var(--c-ink)]'
              : 'text-faint shadow-[inset_0_0_0_1px_var(--c-line-strong)]';
          return (
            <span
              key={f?.slug ?? `empty-${i}`}
              className={`relative grid aspect-[34/100] w-11 place-items-center overflow-hidden rounded-thumb transition-[box-shadow,color] duration-200 ${look}`}
            >
              {f ? (
                f.photo ? (
                  <img
                    src={photoUrl(f.photo, 400)}
                    alt=""
                    decoding="async"
                    className={`${VIAL_CROP} transition-[opacity,translate] duration-[250ms] ${EASE_OUT} starting:translate-y-1.5 starting:opacity-0`}
                  />
                ) : null
              ) : (
                <PlusIcon size={16} />
              )}
            </span>
          );
        })}
      </div>
      <div className="mt-4 flex items-baseline justify-between gap-3">
        <p className="type-small text-ink tabular-nums" data-testid="chosen">
          {fill(s.chosen, { n: String(n), size: String(SET_SIZE) })}
        </p>
        <Money amount={price} className="text-ink" />
      </div>
      <div
        role="progressbar"
        aria-label={s.builderTitle}
        aria-valuemin={0}
        aria-valuemax={SET_SIZE}
        aria-valuenow={n}
        className="mt-2.5 h-0.5 overflow-hidden rounded-[2px] bg-line"
      >
        <div
          className={`h-full origin-left rounded-[2px] bg-sage transition-transform duration-[400ms] ${EASE_OUT}`}
          style={{ transform: `scaleX(${n / SET_SIZE})` }}
        />
      </div>
    </section>
  );
}

/**
 * A selectable fragrance row of the builder: the bottle, the lockup, then the picker square (the
 * mockup's): a hairline «+» to add, Sage with a check once in the box.
 */
function PickRow({
  item,
  chosen,
  full,
  onToggle,
  onLocked,
}: {
  item: FragranceListItem;
  chosen: boolean;
  /** Five are chosen: only the chosen ones can still be toggled. */
  full: boolean;
  onToggle: (slug: string) => void;
  /** A tap on a row that cannot join a full box. */
  onLocked: () => void;
}) {
  const { language } = usePrefs();
  const s = useSetsText();
  const locked = full && !chosen;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={chosen}
      aria-label={fill(chosen ? s.unpick : s.pick, { name: item.name })}
      aria-disabled={locked || undefined}
      data-testid="pick"
      data-chosen={chosen}
      onClick={() => (locked ? onLocked() : onToggle(item.slug))}
      className="flex min-h-[72px] w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors duration-150 active:bg-field"
    >
      <span
        aria-hidden="true"
        className={`relative aspect-[3/4] w-11 shrink-0 overflow-hidden rounded-thumb bg-photo transition-opacity duration-200 ${locked ? 'opacity-50' : ''}`}
      >
        {item.photo ? (
          <img
            src={photoUrl(item.photo, 400)}
            srcSet={photoSrcSet(item.photo)}
            sizes="44px"
            alt=""
            loading="lazy"
            decoding="async"
            className="absolute inset-0 size-full object-cover"
          />
        ) : null}
      </span>
      <span
        className={`min-w-0 flex-1 transition-opacity duration-200 ${locked ? 'opacity-50' : ''}`}
      >
        <NameLockup brand={item.brand} name={item.name} />
        {item.keyNotes[language].length > 0 ? (
          <span className="type-small mt-0.5 block text-pretty text-muted">
            {item.keyNotes[language].slice(0, 3).join(' · ')}
          </span>
        ) : null}
      </span>
      <span
        aria-hidden="true"
        className={`grid size-7 shrink-0 place-items-center rounded-[8px] transition-[background-color,box-shadow,color,opacity] duration-150 ${
          chosen
            ? 'bg-sage text-on-sage'
            : `text-ink shadow-[inset_0_0_0_1px_var(--c-line-strong)] ${locked ? 'opacity-40' : ''}`
        }`}
      >
        {chosen ? (
          <span
            key="check"
            className={`grid transition-[scale,opacity] duration-200 ${EASE_OUT} starting:scale-75 starting:opacity-0`}
          >
            <CheckIcon size={16} />
          </span>
        ) : (
          <PlusIcon key="plus" size={16} />
        )}
      </span>
    </button>
  );
}

/** A problem with the last tap, said in the dock over the button (Graphite, never red). */
function DockAlert({ text, action }: { text: string; action?: ReactNode }) {
  return (
    <div
      role="alert"
      data-testid="dock-alert"
      className={`mb-2.5 flex items-center gap-2.5 transition-[opacity,translate] duration-200 ${EASE_OUT} starting:translate-y-1 starting:opacity-0`}
    >
      <span className="shrink-0 text-ink" aria-hidden="true">
        <AlertIcon size={18} />
      </span>
      <p className="type-small min-w-0 flex-1 text-pretty text-ink">{text}</p>
      {action}
    </div>
  );
}

/** What the builder shows for one server builder; the fixtures render it too. */
export function BuilderView({
  builder,
  picked,
  adding = false,
  note,
  failed = false,
  gone,
  onBack = () => undefined,
  onToggle = () => undefined,
  onFull = () => undefined,
  onAdd = () => undefined,
  onBuyNow = () => undefined,
}: {
  builder: Builder;
  picked: string[];
  adding?: boolean;
  note?: string;
  /** The add did not go through (network or server error): say so and offer «Повторить». */
  failed?: boolean;
  /** The 409: these chosen fragrances ran out of 10 ml (names; empty when they are not known). */
  gone?: string[];
  onBack?: () => void;
  onToggle?: (slug: string) => void;
  /** A tap on a fragrance while five are already chosen. */
  onFull?: () => void;
  onAdd?: () => void;
  /** «Купить сейчас» with the five chosen: a checkout of this one set, the cart left as it is (#25). */
  onBuyNow?: () => void;
}) {
  const { t, language } = usePrefs();
  const s = useSetsText();
  const left = SET_SIZE - picked.length;
  const full = left === 0;
  const chosen = picked
    .map((slug) => builder.options.find((o) => o.slug === slug))
    .filter((o): o is FragranceListItem => o !== undefined);
  return (
    <Screen
      tabBar={false}
      dock={
        <div className="relative">
          <DockNote text={note} />
          {failed ? (
            <DockAlert
              text={s.failed}
              action={
                <Button variant="secondary" size="sm" className="shrink-0" onClick={onAdd}>
                  {t.common.retry}
                </Button>
              }
            />
          ) : gone ? (
            <DockAlert
              text={
                gone.length > 0
                  ? fill(s.unavailableNamed, { names: gone.join(', ') })
                  : s.unavailable
              }
            />
          ) : null}
          {full ? (
            <BuyPair
              toCart={s.toCart}
              price={builder.price}
              adding={adding}
              onAdd={onAdd}
              onBuyNow={onBuyNow}
            />
          ) : (
            <Button block disabled>
              {plural(language, left, s.pickMore)}
            </Button>
          )}
        </div>
      }
    >
      <header className="flex items-start gap-3 pt-5 pb-5">
        <button
          type="button"
          aria-label={t.card.back}
          onClick={onBack}
          className={`relative grid size-10 shrink-0 place-items-center rounded-pill bg-card text-ink transition-transform duration-150 ${EASE_OUT} after:absolute after:-inset-1 active:scale-95`}
        >
          <ArrowLeftIcon size={20} />
        </button>
        <div className="min-w-0 flex-1 pt-1.5">
          <h1 className="type-title text-ink [overflow-wrap:anywhere]">{s.builderTitle}</h1>
          <p className="type-body mt-2 text-pretty text-muted">{s.builderLead}</p>
        </div>
      </header>
      {builder.options.length === 0 ? (
        <EmptyState icon={<BoxIcon size={28} />} title={s.empty} text={s.emptyText} />
      ) : (
        <>
          <SetBox chosen={chosen} price={builder.price} />
          <ul
            aria-label={s.builderTitle}
            className="mt-3 divide-y divide-line overflow-hidden rounded-card bg-card"
          >
            {builder.options.map((o) => (
              <li key={o.slug}>
                <PickRow
                  item={o}
                  chosen={picked.includes(o.slug)}
                  full={full}
                  onToggle={onToggle}
                  onLocked={onFull}
                />
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="h-4" />
    </Screen>
  );
}

/** `/sets/builder`, also the target of the `builder` deep link. */
export function BuilderScreen() {
  const router = useRouter();
  const s = useSetsText();
  const query = useBuilder();
  const add = useAddBuilder();
  const { pick } = useSearch({ strict: false }) as { pick?: string };
  const [picked, setPicked] = useState<string[]>(() =>
    pick ? pick.split(',').slice(0, SET_SIZE) : [],
  );
  const [note, setNote] = useNote();
  const [failed, setFailed] = useState(false);
  const [gone, setGone] = useState<string[] | undefined>();

  // a fragrance that ran out of 10 ml while it was chosen drops from the choice
  const options = query.data?.options;
  useEffect(() => {
    if (!options) return;
    const offered = new Set(options.map((o) => o.slug));
    setPicked((p) => (p.every((s) => offered.has(s)) ? p : p.filter((s) => offered.has(s))));
  }, [options]);

  if (query.isError && !query.data)
    return (
      <Screen tabBar={false}>
        <ErrorState fill retrying={query.isFetching} onRetry={() => void query.refetch()} />
      </Screen>
    );
  if (!query.data) return <BuilderLoading />;
  return (
    <BuilderView
      builder={query.data}
      picked={picked}
      adding={add.isPending}
      note={note}
      failed={failed}
      gone={gone}
      onBack={() => goBackOrCatalog(router)}
      onToggle={(slug) => {
        setGone(undefined);
        setPicked((p) => (p.includes(slug) ? p.filter((s) => s !== slug) : [...p, slug]));
      }}
      onFull={() => setNote(s.noMore)}
      onBuyNow={() =>
        void router.navigate({
          to: '/checkout',
          search: { item: buyNowParam({ kind: 'builder_set', slugs: picked }) },
        })
      }
      onAdd={() => {
        setFailed(false);
        setGone(undefined);
        add.mutate(picked, {
          onSuccess: () => {
            hapticSuccess();
            setPicked([]);
            setNote(s.added);
          },
          // 409: a chosen 10 ml ran out (the list re-reads itself and drops it); name it, so the
          // customer knows which one to replace. Anything else is retryable.
          onError: (e) => {
            if (!(e instanceof SetUnavailableError)) return setFailed(true);
            const names = e.slugs.flatMap((slug) => {
              const o = options?.find((x) => x.slug === slug);
              return o ? [o.name] : [];
            });
            setGone(names);
          },
        });
      }}
    />
  );
}
