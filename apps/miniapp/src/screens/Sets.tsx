import type { Builder, DiscoverySet, FragranceListItem } from '@lummi/contracts';
import { SET_SIZE } from '@lummi/contracts/constants';
import { fill, plural } from '@lummi/i18n';
import { useRouter } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useAddBuilder, useAddDiscovery, useBuilder, useDiscoverySet } from '../sets/queries';
import { goBackOrCatalog, useOpenFragrance } from '../lib/navigation';
import { photoSrcSet, photoUrl } from '../lib/media';
import { usePrefs } from '../lib/prefs';
import { hapticSuccess } from '../lib/telegram';
import { Button } from '../ui/Button';
import { DockNote } from '../ui/DockNote';
import { NameLockup } from '../ui/NameLockup';
import { DISC, EASE_OUT } from '../ui/photoDisc';
import { ArrowLeftIcon, BoxIcon, CheckIcon, ChevronIcon } from '../ui/icons';
import { Money } from '../ui/Money';
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

function Loading() {
  return (
    <Screen tabBar={false} dock={<Skeleton className="h-12 w-full" />}>
      <div className="flex flex-col pt-3 pb-7" aria-busy="true">
        <div aria-hidden="true" className="aspect-[3/4] w-full rounded-card bg-photo" />
        <Skeleton className="mt-5 h-3 w-24" />
        <Skeleton className="mt-3 h-7 w-48" />
        <Skeleton className="mt-4 h-3.5 w-full" />
        <Skeleton className="mt-8 h-16 w-full" />
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
  onOpen = () => undefined,
}: {
  set: DiscoverySet;
  adding?: boolean;
  note?: string;
  onBack?: () => void;
  onAdd?: () => void;
  onOpen?: (slug: string) => void;
}) {
  const { t, language } = usePrefs();
  const ready = set.fragrances.length === SET_SIZE;
  return (
    <Screen
      tabBar={false}
      dock={
        <div className="relative">
          <DockNote text={note} />
          {!ready ? (
            <Button block disabled>
              {t.sets.notReady}
            </Button>
          ) : set.soldOut ? (
            <Button block disabled data-availability="sold-out">
              {t.sets.soldOut}
            </Button>
          ) : (
            <Button block loading={adding} onClick={onAdd}>
              <span className="flex items-center gap-1.5">
                {t.sets.toCart}
                <span aria-hidden="true" className="opacity-60">
                  ·
                </span>
                <Money amount={set.price} />
              </span>
            </Button>
          )}
        </div>
      }
    >
      <article className="flex flex-col pt-3 pb-7">
        <div className="relative aspect-[3/4] overflow-hidden rounded-card bg-photo">
          <SetPhoto hash={set.photo} sizes="(min-width: 520px) 488px, 100vw" eager />
          <div className="absolute inset-x-3 top-3 flex items-center justify-between">
            <button type="button" aria-label={t.card.back} onClick={onBack} className={DISC}>
              <ArrowLeftIcon size={20} />
            </button>
          </div>
        </div>

        <header className="mt-5 flex flex-col">
          <p className="type-label text-muted">{t.home.discoveryLabel}</p>
          <h1 className="type-name-lg mt-1 text-balance text-ink [overflow-wrap:anywhere]">
            {t.sets.discoveryTitle}
          </h1>
          <p className="type-body mt-2 text-muted">{t.sets.discoveryLead}</p>
          <p className="mt-3">
            <Money amount={set.price} size="amount" />
          </p>
        </header>

        {ready ? (
          <section className="mt-7" aria-labelledby="inside">
            <h2 id="inside" className="type-label text-muted">
              {t.sets.inside}
            </h2>
            <ul className="mt-2 divide-y divide-line overflow-hidden rounded-card bg-card">
              {set.fragrances.map((f, i) => (
                <li key={f.slug ?? `hidden-${i}`}>
                  {f.slug === null ? (
                    // hidden from the catalog: the box still holds it, but there is no card to open
                    <div className="flex min-h-14 w-full items-center gap-3 px-4 py-2.5">
                      <span className="min-w-0 flex-1">
                        <NameLockup brand={f.brand} name={f.name} />
                      </span>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onOpen(f.slug as string)}
                      className="flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left transition-colors duration-150 active:bg-field"
                    >
                      <span className="min-w-0 flex-1">
                        <NameLockup brand={f.brand} name={f.name} />
                        <span className="type-small mt-0.5 block text-muted">
                          {t.sets.from} · {f.keyNotes[language].slice(0, 3).join(' · ')}
                        </span>
                      </span>
                      <span className="shrink-0 text-muted" aria-hidden="true">
                        <ChevronIcon size={16} />
                      </span>
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <p className="type-small mt-6 text-muted">{t.card.disclaimer}</p>
      </article>
    </Screen>
  );
}

/** `/sets/discovery`, also the target of the `set_discovery` deep link. */
export function DiscoverySetScreen() {
  const router = useRouter();
  const open = useOpenFragrance();
  const { t } = usePrefs();
  const query = useDiscoverySet();
  const add = useAddDiscovery();
  const [note, setNote] = useNote();
  if (query.isError && !query.data)
    return (
      <Screen tabBar={false}>
        <ErrorState fill retrying={query.isFetching} onRetry={() => void query.refetch()} />
      </Screen>
    );
  if (!query.data) return <Loading />;
  return (
    <DiscoverySetView
      set={query.data}
      adding={add.isPending}
      note={note}
      onBack={() => goBackOrCatalog(router)}
      onOpen={open}
      onAdd={() =>
        add.mutate(undefined, {
          onSuccess: () => {
            hapticSuccess();
            setNote(t.sets.added);
          },
          onError: () => setNote(t.sets.failed),
        })
      }
    />
  );
}

/** A selectable fragrance row of the builder: the bottle, the lockup, a round check. */
function PickRow({
  item,
  chosen,
  full,
  onToggle,
}: {
  item: FragranceListItem;
  chosen: boolean;
  /** Five are chosen: only the chosen ones can still be toggled. */
  full: boolean;
  onToggle: (slug: string) => void;
}) {
  const { t, language } = usePrefs();
  const locked = full && !chosen;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={chosen}
      aria-label={fill(chosen ? t.sets.unpick : t.sets.pick, { name: item.name })}
      aria-disabled={locked || undefined}
      data-testid="pick"
      data-chosen={chosen}
      onClick={() => {
        if (!locked) onToggle(item.slug);
      }}
      className={`flex min-h-[72px] w-full items-center gap-3 px-3 py-2.5 text-left transition-[background-color,opacity] duration-150 active:bg-field ${locked ? 'opacity-50' : ''}`}
    >
      <span
        aria-hidden="true"
        className="relative aspect-[3/4] w-11 shrink-0 overflow-hidden rounded-thumb bg-photo"
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
      <span className="min-w-0 flex-1">
        <NameLockup brand={item.brand} name={item.name} />
        <span className="type-small mt-0.5 block text-muted">
          {item.keyNotes[language].slice(0, 3).join(' · ')}
        </span>
      </span>
      <span
        aria-hidden="true"
        className={`grid size-6 shrink-0 place-items-center rounded-pill transition-[background-color,box-shadow,color] duration-150 ${
          chosen ? 'bg-btn text-btn-ink' : 'shadow-[inset_0_0_0_1px_var(--c-line-strong)]'
        }`}
      >
        {chosen ? <CheckIcon size={14} /> : null}
      </span>
    </button>
  );
}

/** What the builder shows for one server builder; the fixtures render it too. */
export function BuilderView({
  builder,
  picked,
  adding = false,
  note,
  failed = false,
  onBack = () => undefined,
  onToggle = () => undefined,
  onAdd = () => undefined,
}: {
  builder: Builder;
  picked: string[];
  adding?: boolean;
  note?: string;
  /** The add did not go through (network or server error): say so and offer «Повторить». */
  failed?: boolean;
  onBack?: () => void;
  onToggle?: (slug: string) => void;
  onAdd?: () => void;
}) {
  const { t, language } = usePrefs();
  const left = SET_SIZE - picked.length;
  const full = left === 0;
  return (
    <Screen
      tabBar={false}
      dock={
        <div className="relative">
          <DockNote text={note} />
          {failed ? (
            <div
              role="alert"
              className="mb-2 flex items-center justify-between gap-3"
              data-testid="add-failed"
            >
              <p className="type-small text-pretty text-ink">{t.sets.failed}</p>
              <Button variant="secondary" size="sm" className="shrink-0" onClick={onAdd}>
                {t.common.retry}
              </Button>
            </div>
          ) : null}
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="type-small text-ink" data-testid="chosen">
              {fill(t.sets.chosen, { n: String(picked.length), size: String(SET_SIZE) })}
            </p>
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={SET_SIZE}
              aria-valuenow={picked.length}
              className="flex gap-1"
            >
              {Array.from({ length: SET_SIZE }, (_, i) => (
                <span
                  key={i}
                  className={`h-0.5 w-6 rounded-[2px] transition-colors duration-200 ${i < picked.length ? 'bg-sage' : 'bg-line'}`}
                />
              ))}
            </div>
          </div>
          <Button block disabled={!full} loading={adding} onClick={onAdd}>
            {full ? (
              <span className="flex items-center gap-1.5">
                {t.sets.toCart}
                <span aria-hidden="true" className="opacity-60">
                  ·
                </span>
                <Money amount={builder.price} />
              </span>
            ) : (
              plural(language, left, t.sets.pickMore)
            )}
          </Button>
        </div>
      }
    >
      <header className="flex items-start gap-3 pt-5 pb-4">
        <button
          type="button"
          aria-label={t.card.back}
          onClick={onBack}
          className={`relative grid size-10 shrink-0 place-items-center rounded-pill bg-card text-ink transition-transform duration-150 ${EASE_OUT} after:absolute after:-inset-1 active:scale-95`}
        >
          <ArrowLeftIcon size={20} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="type-title text-ink [overflow-wrap:anywhere]">{t.sets.builderTitle}</h1>
          <p className="type-body mt-2 text-muted">{t.sets.builderLead}</p>
          <p className="mt-2">
            <Money amount={builder.price} />
          </p>
        </div>
      </header>
      {builder.options.length === 0 ? (
        <EmptyState icon={<BoxIcon size={28} />} title={t.sets.empty} text={t.sets.emptyText} />
      ) : (
        <ul
          aria-label={t.sets.builderTitle}
          className="divide-y divide-line overflow-hidden rounded-card bg-card"
        >
          {builder.options.map((o) => (
            <li key={o.slug}>
              <PickRow item={o} chosen={picked.includes(o.slug)} full={full} onToggle={onToggle} />
            </li>
          ))}
        </ul>
      )}
      <div className="h-4" />
    </Screen>
  );
}

/** `/sets/builder`, also the target of the `builder` deep link. */
export function BuilderScreen() {
  const router = useRouter();
  const { t } = usePrefs();
  const query = useBuilder();
  const add = useAddBuilder();
  const [picked, setPicked] = useState<string[]>([]);
  const [note, setNote] = useNote();
  const [failed, setFailed] = useState(false);

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
  if (!query.data) return <Loading />;
  return (
    <BuilderView
      builder={query.data}
      picked={picked}
      adding={add.isPending}
      note={note}
      failed={failed}
      onBack={() => goBackOrCatalog(router)}
      onToggle={(slug) =>
        setPicked((p) => (p.includes(slug) ? p.filter((s) => s !== slug) : [...p, slug]))
      }
      onAdd={() => {
        setFailed(false);
        add.mutate(picked, {
          onSuccess: () => {
            hapticSuccess();
            setPicked([]);
            setNote(t.sets.added);
          },
          // 409: a chosen 10 ml ran out (the list re-reads itself); anything else is retryable
          onError: (e) =>
            e instanceof Error && e.message === 'HTTP 409'
              ? setNote(t.sets.unavailable)
              : setFailed(true),
        });
      }}
    />
  );
}
