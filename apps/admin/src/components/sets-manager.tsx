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
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { Select } from '@/components/ui/select';
import { browserApi } from '@/lib/api';
import type { AdminMessages } from '@/lib/i18n';
import { fill } from '@/lib/utils';

type Option = { id: number; name: string; hidden: boolean };

/**
 * The Discovery set (ADR 0009): its own boxes on hand (owner and manager), and the owner's price
 * (the builder set costs the same), five fragrances in order and photo. Every change is audited by
 * the API with the old and the new value.
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
  const s = t.sets;
  return (
    <>
      <PageHeader title={s.title} description={s.description} />
      {initial.composition.some((c) => c.hidden) && (
        <Notice title={s.hiddenWarning} className="mb-6">
          {initial.composition
            .filter((c) => c.hidden)
            .map((c) => c.name)
            .join(', ')}
        </Notice>
      )}
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <StockCard set={initial} t={t} onSaved={() => router.refresh()} />
        <Card className="grid gap-5 p-5">
          <h2 className="text-base font-semibold">{s.priceTitle}</h2>
          {owner ? (
            <PriceForm
              key={`${initial.price}-${initial.composition.map((c) => c.id).join()}`}
              set={initial}
              options={options}
              t={t}
              onSaved={() => router.refresh()}
            />
          ) : (
            <ReadOnly set={initial} language={language} t={t} />
          )}
        </Card>
        {owner && (
          <Card className="grid gap-4 p-5">
            <h2 className="text-base font-semibold">{s.photoTitle}</h2>
            <p className="text-xs text-pretty text-muted-foreground">{s.photoHint}</p>
            <PhotoUpload
              uploadUrl="/api/admin/sets/discovery/photo"
              hash={initial.photo}
              t={t}
              onUploaded={() => router.refresh()}
            />
          </Card>
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
    <Card className="grid gap-4 p-5">
      <h2 className="text-base font-semibold">{s.stockTitle}</h2>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-[12.5px] text-muted-foreground">{s.reserved}</dt>
          <dd className="mt-0.5 font-semibold tabular-nums">{set.reserved}</dd>
        </div>
        <div>
          <dt className="text-[12.5px] text-muted-foreground">{s.available}</dt>
          <dd className="mt-0.5 font-semibold tabular-nums" data-testid="available">
            {set.available}
          </dd>
        </div>
      </dl>
      <form
        className="grid gap-3"
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
            required
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setState('idle');
            }}
          />
        </Field>
        {state === 'error' && <Notice title={t.errors.generic} />}
        <div className="flex items-center gap-3">
          <Button type="submit" loading={pending} disabled={!valid || Number(value) === set.onHand}>
            {s.saveOnHand}
          </Button>
          {state === 'saved' && (
            <p role="status" className="flex items-center gap-1.5 text-xs font-medium">
              <Check className="size-3.5 text-sage-ink" strokeWidth={1.5} aria-hidden />
              {s.saved}
            </p>
          )}
        </div>
      </form>
    </Card>
  );
}

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
    <div className="grid gap-3 text-sm">
      <p className="font-semibold tabular-nums">{formatMoney(set.price, language)}</p>
      <ol className="grid gap-1 text-muted-foreground">
        {set.composition.map((c, i) => (
          <li key={c.id}>
            {i + 1}. <span className="text-foreground">{c.name}</span>
          </li>
        ))}
      </ol>
      {set.composition.length < SET_SIZE && <p>{s.notForSale}</p>}
      <p className="text-xs text-muted-foreground">{s.priceOnly}</p>
    </div>
  );
}

function PriceForm({
  set,
  options,
  t,
  onSaved,
}: {
  set: AdminDiscoverySet;
  options: Option[];
  t: AdminMessages;
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
  return (
    <form
      className="grid gap-4"
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
      <Field id="set-price" label={s.price} hint={s.priceHint}>
        <Input
          inputMode="numeric"
          pattern="[0-9]+"
          autoComplete="off"
          required
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
      </Field>
      {set.isPlaceholder && (
        <p className="text-xs text-pretty text-muted-foreground">{s.placeholderPrice}</p>
      )}
      <fieldset className="grid gap-3">
        <legend className="text-[12.5px] font-medium text-muted-foreground">{s.composition}</legend>
        <p className="-mt-1 text-xs text-muted-foreground">{s.compositionHint}</p>
        {picks.map((value, i) => (
          <Field
            key={i}
            id={`set-pick-${i}`}
            label={fill(s.position, { n: String(i + 1) })}
            error={value && picks.indexOf(value) !== i ? s.duplicate : undefined}
          >
            <Select
              value={value}
              onChange={(e) => setPicks((p) => p.map((v, j) => (j === i ? e.target.value : v)))}
            >
              <option value="">{s.choose}</option>
              {sorted.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </Field>
        ))}
      </fieldset>
      {!complete && <p className="text-xs text-muted-foreground">{s.incomplete}</p>}
      {error && <Notice title={error} />}
      <div>
        <Button type="submit" loading={pending} disabled={!validPrice || !complete || duplicate}>
          {s.save}
        </Button>
      </div>
    </form>
  );
}
