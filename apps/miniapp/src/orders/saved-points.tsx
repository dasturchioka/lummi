import type { SavedPointDto } from '@lummi/contracts';
import { fill, formatPhone } from '@lummi/i18n';
import { useState } from 'react';
import { Card } from '../ui/Card';
import { AlertIcon, CheckIcon, PinIcon, Spinner, TrashIcon } from '../ui/icons';
import { MetaLine } from '../ui/MetaLine';
import { SectionTitle } from './parts';
import { useOrdersText, useRemoveSavedPoint, useSavedPoints } from './queries';

/**
 * One saved pair (spec Changes 2026-11-11): the point's name in 600 and its address, then who
 * collects it («Dilnoza · +998 90 765 43 21»). A point BTS hid since says so in place of the
 * recipient, with the alert icon: it is shown, never offered.
 */
function PairText({ s }: { s: SavedPointDto }) {
  const o = useOrdersText();
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className={`type-row font-semibold break-words ${s.hidden ? 'text-muted' : ''}`}>
        {s.point.name}
      </span>
      <MetaLine
        className="type-small text-muted [overflow-wrap:anywhere]"
        parts={[s.point.city, s.point.address]}
      />
      {s.hidden ? (
        <span className="type-small mt-0.5 flex items-start gap-1.5 text-ink">
          <span className="mt-px shrink-0">
            <AlertIcon size={16} />
          </span>
          {o.saved.hidden}
        </span>
      ) : (
        <span className="type-small mt-0.5 text-ink [overflow-wrap:anywhere]">
          {s.recipientName}
          <span className="text-muted"> · </span>
          <span className="whitespace-nowrap tabular-nums">{formatPhone(s.recipientPhone)}</span>
        </span>
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
        {saved.map((s) => {
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
                <PairText s={s} />
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

/**
 * Profile → «Мои пункты BTS»: every saved pair with a bin to forget it. Forgetting one never
 * touches an order (each keeps its own snapshot). Nothing saved yet, no section.
 */
export function SavedPointsSection() {
  const o = useOrdersText();
  const query = useSavedPoints();
  const remove = useRemoveSavedPoint();
  const [failed, setFailed] = useState(false);
  const list = query.data ?? [];
  if (list.length === 0) return null;
  return (
    <section className="mt-6 mb-3" aria-labelledby="saved-points-title" data-testid="saved-points">
      <h2 id="saved-points-title" className="type-section text-ink">
        {o.saved.title}
      </h2>
      <p className="type-small mt-1 mb-3 text-pretty text-muted">{o.saved.note}</p>
      <Card as="ul" className="divide-y divide-line overflow-hidden">
        {list.map((s) => {
          const busy = remove.isPending && remove.variables === s.id;
          return (
            <li key={s.id} className="flex items-start gap-3 py-3 pr-1.5 pl-4">
              <span className={`mt-0.5 shrink-0 ${s.hidden ? 'text-faint' : 'text-ink'}`}>
                <PinIcon size={20} />
              </span>
              <PairText s={s} />
              <button
                type="button"
                aria-label={fill(o.saved.remove, { name: s.point.name })}
                data-testid="saved-point-remove"
                disabled={remove.isPending}
                onClick={() => {
                  setFailed(false);
                  remove.mutate(s.id, { onError: () => setFailed(true) });
                }}
                className="-my-1.5 grid size-11 shrink-0 place-items-center rounded-pill text-muted transition-[background-color,color,transform] duration-150 hover:bg-field hover:text-ink active:scale-95 active:bg-field"
              >
                {busy ? <Spinner size={18} /> : <TrashIcon size={20} />}
              </button>
            </li>
          );
        })}
      </Card>
      {failed ? (
        <p role="alert" className="type-small mt-2 flex items-center gap-2 text-ink">
          <AlertIcon size={16} />
          {o.saved.removeFailed}
        </p>
      ) : null}
    </section>
  );
}
