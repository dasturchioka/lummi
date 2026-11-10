'use client';

import type { AdminDiscoverySet } from '@lummi/contracts';
import { SET_SIZE } from '@lummi/contracts/constants';
import { formatMoney, type Language } from '@lummi/i18n';
import { Check } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PhotoUpload } from '@/components/catalog/photo-upload';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { Section } from '@/components/ui/section';
import { Select } from '@/components/ui/select';
import { browserApi } from '@/lib/api';
import type { AdminMessages } from '@/lib/i18n';
import { fill } from '@/lib/utils';

type Option = { id: number; name: string; hidden: boolean };

/** «Сохранено» with the Sage Ink check, beside the button that saved. */
function Saved({ text }: { text: string }) {
  return (
    <p role="status" className="flex items-center gap-1.5 text-xs font-medium">
      <Check className="size-3.5 text-sage-ink" strokeWidth={1.5} aria-hidden />
      {text}
    </p>
  );
}

/**
 * The Discovery set (ADR 0009): its own boxes on hand (owner and manager), and the owner's price
 * (the builder set costs the same), five fragrances in order and photo. Every change is audited by
 * the API with the old and the new value.
 *
 * From 1024 px: the stock over the photo on the left, the price and the composition on the right
 * (the longest card spans both rows, so neither left card is stretched). Phones: stock, price, photo.
 */
export function SetsManager({
  initial,
  options,
  owner,
  language,
  t,
}: {
  initial: AdminDiscoverySet;
  options: Option[];
  owner: boolean;
  language: Language;
  t: AdminMessages;
}) {
  const router = useRouter();
  const [priceSaved, setPriceSaved] = useState(false);
  const s = t.sets;
  const hidden = initial.composition.filter((c) => c.hidden);
  return (
    <>
      <PageHeader title={s.title} description={s.description} />
      {hidden.length > 0 && (
        <Notice title={s.hiddenWarning} className="mb-6">
          {hidden.map((c) => c.name).join(', ')}
        </Notice>
      )}
      <div className="grid items-start gap-6 lg:grid-cols-2 lg:grid-rows-[auto_1fr]">
        <StockCard set={initial} t={t} onSaved={() => router.refresh()} />
        <Section title={s.priceTitle} className="lg:row-span-2">
          {owner ? (
            <PriceForm
              key={`${initial.price}-${initial.composition.map((c) => c.id).join()}`}
              set={initial}
              options={options}
              language={language}
              saved={priceSaved}
              t={t}
              onEdit={() => setPriceSaved(false)}
              onSaved={() => {
                setPriceSaved(true);
                router.refresh();
              }}
            />
          ) : (
            <ReadOnly set={initial} language={language} t={t} />
          )}
        </Section>
        {owner && (
          <Section title={s.photoTitle}>
            <p className="-mt-2 text-small text-pretty text-muted-foreground">{s.photoHint}</p>
            <PhotoUpload
              slot="discovery"
              label={t.catalog.photo}
              url="/api/admin/sets/discovery/photo"
              hash={initial.photo}
              messages={t.catalog}
              onUploaded={() => router.refresh()}
            />
          </Section>
        )}
      </div>
    </>
  );
}

function StockCard({
  set,
  t,
  onSaved,
}: {
  set: AdminDiscoverySet;
  t: AdminMessages;
  onSaved: () => void;
}) {
  const s = t.sets;
  const [value, setValue] = useState(String(set.onHand));
  const [pending, setPending] = useState(false);
  const [state, setState] = useState<'idle' | 'saved' | 'error'>('idle');
  const valid = /^\d{1,7}$/.test(value);
  return (
    <Section title={s.stockTitle}>
      {/* what the shop can still sell, beside what open orders hold */}
      <dl className="-mt-1 grid grid-cols-2 gap-3 rounded-button bg-field px-4 py-3">
        <div>
          <dt className="text-small text-muted-foreground">{s.available}</dt>
          <dd
            className="mt-0.5 text-xl leading-tight font-semibold tabular-nums"
            data-testid="available"
          >
            {set.available}
          </dd>
        </div>
        <div>
          <dt className="text-small text-muted-foreground">{s.reserved}</dt>
          <dd className="mt-0.5 text-xl leading-tight font-semibold tabular-nums">
            {set.reserved}
          </dd>
        </div>
      </dl>
      <form
        className="grid gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!valid) return;
          setPending(true);
          setState('idle');
          const res = await browserApi.sets
            .setOnHand({ body: { onHand: Number(value) } })
            .catch(() => null);
          setPending(false);
          if (res?.status === 200) {
            setState('saved');
            onSaved();
          } else setState('error');
        }}
      >
        <Field id="set-on-hand" label={s.onHand} hint={s.onHandHint}>
          <Input
            inputMode="numeric"
            pattern="[0-9]+"
            autoComplete="off"
            enterKeyHint="done"
            className="tabular-nums"
            required
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setState('idle');
            }}
          />
        </Field>
        {state === 'error' && <Notice title={t.errors.generic} />}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button type="submit" loading={pending} disabled={!valid || Number(value) === set.onHand}>
            {s.saveOnHand}
          </Button>
          {state === 'saved' && <Saved text={s.saved} />}
        </div>
      </form>
    </Section>
  );
}

/** The manager's view: the price and the five in the order the customer sees them. */
function ReadOnly({
  set,
  language,
  t,
}: {
  set: AdminDiscoverySet;
  language: Language;
  t: AdminMessages;
}) {
  const s = t.sets;
  return (
    <div className="grid gap-4">
      <div>
        <p className="text-small text-muted-foreground">{s.price}</p>
        <p className="mt-0.5 text-xl leading-tight font-semibold tabular-nums">
          {formatMoney(set.price, language)}
        </p>
      </div>
      <div>
        <p className="text-small text-muted-foreground">{s.composition}</p>
        <ol className="mt-1.5 divide-y divide-border">
          {set.composition.map((c, i) => (
            <li key={c.id} className="flex items-baseline gap-3 py-2.5">
              <span className="w-4 shrink-0 text-small font-semibold text-muted-foreground tabular-nums">
                {i + 1}
              </span>
              <span className="min-w-0 break-words">{c.name}</span>
              {c.hidden && (
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                  {t.catalog.hidden}
                </span>
              )}
            </li>
          ))}
        </ol>
      </div>
      {set.composition.length < SET_SIZE && <Notice title={s.notForSale} />}
      <p className="text-xs text-muted-foreground">{s.priceOnly}</p>
    </div>
  );
}

function PriceForm({
  set,
  options,
  language,
  saved,
  t,
  onEdit,
  onSaved,
}: {
  set: AdminDiscoverySet;
  options: Option[];
  language: Language;
  /** The last save went through (the page re-reads; this survives the form's remount). */
  saved: boolean;
  t: AdminMessages;
  onEdit: () => void;
  onSaved: () => void;
}) {
  const s = t.sets;
  const [price, setPrice] = useState(String(set.price));
  const [picks, setPicks] = useState<string[]>(() =>
    Array.from({ length: SET_SIZE }, (_, i) => String(set.composition[i]?.id ?? '')),
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chosen = picks.filter(Boolean);
  const duplicate = new Set(chosen).size !== chosen.length;
  const complete = chosen.length === SET_SIZE;
  const validPrice = /^\d{1,9}$/.test(price);
  const sorted = [...options].sort((a, b) => a.name.localeCompare(b.name));
  const byId = new Map(options.map((o) => [String(o.id), o]));
  // the typed price read back with its thousands («1250000» -> «1 250 000 сум»), as the volume form does
  const readout =
    validPrice && Number(price) >= 1000 ? formatMoney(Number(price), language) : undefined;
  return (
    <form
      className="grid gap-5"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!validPrice || !complete || duplicate) return;
        setPending(true);
        setError(null);
        const res = await browserApi.sets
          .update({ body: { price: Number(price), composition: picks.map(Number) } })
          .catch(() => null);
        setPending(false);
        if (res?.status === 200) onSaved();
        else
          setError(
            res?.status === 403
              ? t.errors.forbidden
              : res?.status === 422
                ? s.invalidComposition
                : s.failed,
          );
      }}
    >
      {set.isPlaceholder && <Notice title={s.placeholderPrice} />}
      <Field
        id="set-price"
        label={s.price}
        hint={s.priceHint}
        aside={
          readout && (
            <span className="text-small font-medium text-foreground tabular-nums">{readout}</span>
          )
        }
      >
        <Input
          inputMode="numeric"
          pattern="[0-9]+"
          autoComplete="off"
          enterKeyHint="done"
          className="tabular-nums"
          required
          value={price}
          onChange={(e) => {
            setPrice(e.target.value);
            onEdit();
          }}
        />
      </Field>
      <fieldset className="grid gap-2">
        <legend className="text-[12.5px] font-medium text-muted-foreground">{s.composition}</legend>
        <p className="-mt-0.5 mb-1 text-xs text-pretty text-muted-foreground">
          {s.compositionHint}
        </p>
        <ol className="grid gap-2">
          {picks.map((value, i) => {
            const repeated = Boolean(value) && picks.indexOf(value) !== i;
            const isHidden = byId.get(value)?.hidden ?? false;
            const id = `set-pick-${i}`;
            const note = repeated ? s.duplicate : isHidden ? s.hiddenPick : null;
            return (
              <li key={i} className="grid grid-cols-[1.25rem_minmax(0,1fr)] items-start gap-x-2">
                {/* the order the customer sees, so the number is the row's label */}
                <span
                  aria-hidden
                  className="mt-[13px] text-small font-semibold text-muted-foreground tabular-nums"
                >
                  {i + 1}
                </span>
                <div className="grid gap-1.5">
                  <label htmlFor={id} className="sr-only">
                    {fill(s.position, { n: String(i + 1) })}
                  </label>
                  <Select
                    id={id}
                    value={value}
                    aria-invalid={repeated || undefined}
                    aria-describedby={note ? `${id}-note` : undefined}
                    onChange={(e) => {
                      setPicks((p) => p.map((v, j) => (j === i ? e.target.value : v)));
                      onEdit();
                    }}
                  >
                    <option value="">{s.choose}</option>
                    {sorted.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.hidden ? `${t.catalog.hidden} · ${o.name}` : o.name}
                      </option>
                    ))}
                  </Select>
                  {note && (
                    <p
                      id={`${id}-note`}
                      className={`text-xs leading-snug ${repeated ? 'font-medium text-foreground' : 'text-muted-foreground'}`}
                    >
                      {note}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </fieldset>
      {!complete && <p className="text-xs text-muted-foreground">{s.incomplete}</p>}
      {error && <Notice title={error} />}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button type="submit" loading={pending} disabled={!validPrice || !complete || duplicate}>
          {s.save}
        </Button>
        {saved && !error && <Saved text={s.saved} />}
      </div>
    </form>
  );
}
