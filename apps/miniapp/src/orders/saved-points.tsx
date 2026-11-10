import type { SavedPointDto } from '@lummi/contracts';
import { fill, formatPhone } from '@lummi/i18n';
import { useState } from 'react';
import { usePrefs } from '../lib/prefs';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { AlertIcon, CheckIcon, PinIcon, TrashIcon } from '../ui/icons';
import { MetaLine } from '../ui/MetaLine';
import { Sheet, SheetDescription } from '../ui/Sheet';
import { Skeleton } from '../ui/Skeleton';
import { SectionTitle } from './parts';
import { useOrdersText, useRemoveSavedPoint, useSavedPoints } from './queries';

/** What still works first, in the server's order (the last used first); a point BTS hid, after. */
const offeredFirst = (list: SavedPointDto[]) =>
  [...list].sort((a, b) => Number(a.hidden) - Number(b.hidden));

/**
 * One saved pair (spec Changes 2026-11-11): the point's name in 600 and its address, then who
 * collects it («Dilnoza · +998 90 765 43 21»). A point BTS hid since says so in place of the
 * recipient, with the alert icon: it is shown, never offered. `brief` (checkout's picker): the
 * address stops at two lines.
 */
function PairText({ s, brief = false }: { s: SavedPointDto; brief?: boolean }) {
  const o = useOrdersText();
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className={`type-row font-semibold break-words ${s.hidden ? 'text-muted' : ''}`}>
        {s.point.name}
      </span>
      {brief ? (
        // enough to recognise it: the chosen point's card below shows the whole address
        <span className="type-small line-clamp-2 text-muted [overflow-wrap:anywhere]">
          {s.point.city} · {s.point.address}
        </span>
      ) : (
        <MetaLine
          className="type-small text-muted [overflow-wrap:anywhere]"
          parts={[s.point.city, s.point.address]}
        />
      )}
      {s.hidden ? (
        <span className="type-small mt-0.5 flex items-start gap-1.5 text-ink">
          <span className="mt-px shrink-0">
            <AlertIcon size={16} />
          </span>
          {o.saved.hidden}
        </span>
      ) : (
        // a long name wraps on its own and the phone takes the next line whole, no dot left behind
        <MetaLine
          className="type-small mt-0.5 text-ink [overflow-wrap:anywhere]"
          parts={[
            s.recipientName,
            <span className="whitespace-nowrap tabular-nums">{formatPhone(s.recipientPhone)}</span>,
          ]}
        />
      )}
    </span>
  );
}

/**
 * Checkout's «Мои пункты BTS», before the recipient and the point picker: one tap fills both. The
 * pair checkout started on (the server's default, the last used that BTS still offers) and any
 * pair whose point and recipient phone match the form rest on Sage Wash with a check, as the
 * picker marks the saved choice. A hidden point's row is disabled.
 */
export function SavedPointPicker({
  saved,
  isSelected,
  onPick,
}: {
  saved: SavedPointDto[];
  isSelected: (s: SavedPointDto) => boolean;
  onPick: (s: SavedPointDto) => void;
}) {
  const o = useOrdersText();
  return (
    <section className="flex flex-col gap-3.5" data-testid="saved-points">
      <SectionTitle flush>{o.checkout.savedTitle}</SectionTitle>
      <Card as="ul" className="divide-y divide-line overflow-hidden">
        {offeredFirst(saved).map((s) => {
          const selected = !s.hidden && isSelected(s);
          return (
            <li key={s.id}>
              <button
                type="button"
                disabled={s.hidden}
                aria-pressed={selected}
                data-testid="saved-point"
                onClick={() => onPick(s)}
                className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors duration-150 ${
                  selected ? 'bg-sage-wash' : s.hidden ? '' : 'hover:bg-field active:bg-field'
                }`}
              >
                <span className={`mt-0.5 shrink-0 ${s.hidden ? 'text-faint' : 'text-ink'}`}>
                  <PinIcon size={20} />
                </span>
                <PairText s={s} brief />
                <span
                  aria-hidden="true"
                  className={`mt-0.5 shrink-0 text-sage-ink transition-opacity duration-150 ${selected ? 'opacity-100' : 'opacity-0'}`}
                >
                  <CheckIcon size={20} />
                </span>
              </button>
            </li>
          );
        })}
      </Card>
    </section>
  );
}

/** A saved pair's row in the profile: the pair, and a bin that asks first. */
function SavedRow({ s, onRemove }: { s: SavedPointDto; onRemove: (s: SavedPointDto) => void }) {
  const o = useOrdersText();
  return (
    <li className="flex items-start gap-3 py-3 pr-1.5 pl-4">
      <span className={`mt-0.5 shrink-0 ${s.hidden ? 'text-faint' : 'text-ink'}`}>
        <PinIcon size={20} />
      </span>
      <PairText s={s} />
      <button
        type="button"
        aria-label={fill(o.saved.remove, { name: s.point.name })}
        aria-haspopup="dialog"
        data-testid="saved-point-remove"
        onClick={() => onRemove(s)}
        className="-my-1.5 grid size-11 shrink-0 place-items-center rounded-pill text-muted transition-[background-color,color,scale] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-field hover:text-ink active:scale-95 active:bg-field"
      >
        <TrashIcon size={20} />
      </button>
    </li>
  );
}

/**
 * «Удалить пункт?»: the pair it is about, then «Удалить» and «Оставить» (the cancel sheet's
 * pattern). It closes once the pair is gone; a failure says so in place.
 */
function RemoveSheet({
  pair,
  open,
  onOpenChange,
}: {
  pair: SavedPointDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = usePrefs();
  const o = useOrdersText();
  const remove = useRemoveSavedPoint();
  const [failed, setFailed] = useState(false);
  const confirm = () => {
    if (!pair) return;
    setFailed(false);
    remove.mutate(pair.id, {
      onSuccess: () => onOpenChange(false),
      onError: () => setFailed(true),
    });
  };
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) setFailed(false);
        onOpenChange(next);
      }}
      title={o.saved.removeTitle}
      ownDescription
      closeLabel={t.common.close}
    >
      <SheetDescription className="type-small pb-3 text-pretty text-muted">
        {o.saved.removeText}
      </SheetDescription>
      <div className="flex flex-col gap-2 pb-1" data-testid="saved-point-remove-sheet">
        {pair ? (
          <Card className="mb-2 flex items-start gap-3 px-4 py-3">
            <span className={`mt-0.5 shrink-0 ${pair.hidden ? 'text-faint' : 'text-ink'}`}>
              <PinIcon size={20} />
            </span>
            <PairText s={pair} />
          </Card>
        ) : null}
        {failed ? (
          <p role="alert" className="type-small mb-2 flex items-start gap-2 text-ink">
            <span className="mt-px shrink-0">
              <AlertIcon size={16} />
            </span>
            {o.saved.removeFailed}
          </p>
        ) : null}
        <Button
          block
          loading={remove.isPending}
          onClick={confirm}
          data-testid="saved-point-confirm"
        >
          {o.saved.removeConfirm}
        </Button>
        <Button block variant="secondary" onClick={() => onOpenChange(false)}>
          {o.saved.removeKeep}
        </Button>
      </div>
    </Sheet>
  );
}

/**
 * Profile → «Мои пункты BTS»: every saved pair (what still works first) with a bin that asks
 * before it forgets one. Forgetting one never touches an order (each keeps its own snapshot).
 * While the list loads, a row's shape holds its place; a failed load offers «Повторить»; nothing
 * saved yet says what will appear here, so the section never comes and goes under the thumb.
 */
export function SavedPointsSection() {
  const { t } = usePrefs();
  const o = useOrdersText();
  const query = useSavedPoints();
  const [asked, setAsked] = useState<SavedPointDto | null>(null);
  const [open, setOpen] = useState(false);
  const list = query.data ? offeredFirst(query.data) : [];
  return (
    <section className="mt-6 mb-3" aria-labelledby="saved-points-title" data-testid="saved-points">
      <h2 id="saved-points-title" className="type-section text-ink">
        {o.saved.title}
      </h2>
      {list.length > 0 ? (
        <p className="type-small mt-1 text-pretty text-muted">{o.saved.note}</p>
      ) : null}
      <div className="mt-3">
        {query.isPending ? (
          <Card className="flex items-start gap-3 px-4 py-3.5" aria-busy="true">
            <Skeleton className="size-5" rounded="pill" />
            <div className="flex-1 space-y-2 pt-0.5">
              <Skeleton className="h-3.5 w-32" />
              <Skeleton className="h-3 w-48" />
            </div>
          </Card>
        ) : query.isError && !query.data ? (
          <Card className="flex items-center gap-3 py-2 pr-2 pl-4">
            <span className="shrink-0 text-ink">
              <AlertIcon size={20} />
            </span>
            <p className="type-small min-w-0 flex-1 text-ink">{o.saved.loadFailed}</p>
            <Button
              size="sm"
              variant="secondary"
              loading={query.isFetching}
              onClick={() => void query.refetch()}
            >
              {t.common.retry}
            </Button>
          </Card>
        ) : list.length === 0 ? (
          <Card className="flex items-start gap-3 px-4 py-3.5" data-testid="saved-points-empty">
            <span className="mt-0.5 shrink-0 text-faint">
              <PinIcon size={20} />
            </span>
            <p className="type-small text-pretty text-muted">{o.saved.empty}</p>
          </Card>
        ) : (
          <Card as="ul" className="divide-y divide-line overflow-hidden">
            {list.map((s) => (
              <SavedRow
                key={s.id}
                s={s}
                onRemove={(pair) => {
                  setAsked(pair);
                  setOpen(true);
                }}
              />
            ))}
          </Card>
        )}
      </div>
      <RemoveSheet pair={asked} open={open} onOpenChange={setOpen} />
    </section>
  );
}
