'use client';

import { isUzumUrl, STOCK_REASON_MAX, type AdminDiscoverySet } from '@lummi/contracts';
import {
  DISCOVERY_VIAL_MLS,
  MAIN_SET_KEY,
  SET_SIZE,
  type DiscoveryVialMl,
} from '@lummi/contracts/constants';
import { formatMoney, type Language } from '@lummi/i18n';
import { Check, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PhotoUpload } from '@/components/catalog/photo-upload';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { Section } from '@/components/ui/section';
import { Select } from '@/components/ui/select';
import { browserApi } from '@/lib/api';
import type { AdminMessages } from '@/lib/i18n';
import { num } from '@/lib/setting-copy';
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
 * The Discovery sets (ADR 0009, 0042, 0044), one block each in the owner's order: its own boxes on
 * hand and a set assembly from concentrate (owner and manager), and the owner's name, price (the
 * builder set costs the main one's), on sale or not, five fragrances in order and photo. The owner
 * adds more sets («Добавить набор», `/sets/new`). Every change is audited by the API with the old
 * and the new value.
 *
 * From 1024 px: the stock and the assembly over the photo on the left, the price and the
 * composition on the right (the longest card spans the rows, so no left card is stretched).
 * Phones: stock, assembly, price, photo.
 */
export function SetsManager({
  sets,
  options,
  owner,
  language,
  t,
}: {
  sets: AdminDiscoverySet[];
  options: Option[];
  owner: boolean;
  language: Language;
  t: AdminMessages;
}) {
  const s = t.sets;
  const add = owner ? (
    <Button asChild className="max-sm:w-full">
      <Link href="/sets/new">
        <Plus strokeWidth={1.5} aria-hidden />
        {s.add}
      </Link>
    </Button>
  ) : null;
  return (
    <>
      <PageHeader title={s.title} description={s.description} actions={add} />
      <div className="grid gap-10 lg:gap-12">
        {sets.map((set) => (
          <SetBlock
            key={set.key}
            set={set}
            options={options}
            owner={owner}
            language={language}
            t={t}
          />
        ))}
      </div>
    </>
  );
}

function SetBlock({
  set,
  options,
  owner,
  language,
  t,
}: {
  set: AdminDiscoverySet;
  options: Option[];
  owner: boolean;
  language: Language;
  t: AdminMessages;
}) {
  const router = useRouter();
  const [priceSaved, setPriceSaved] = useState(false);
  const s = t.sets;
  const hidden = set.composition.filter((c) => c.hidden);
  const headingId = `set-${set.key}`;
  return (
    <section
      id={set.key}
      aria-labelledby={headingId}
      data-testid={`set-${set.key}`}
      className="scroll-mt-6"
    >
      <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id={headingId} className="font-name text-[24px] leading-[1.1] font-medium italic">
          {set.name[language]}
        </h2>
        <span className="text-small text-muted-foreground tabular-nums">
          {fill(s.setSub, { ml: String(set.vialMl) })}
        </span>
        {set.key === MAIN_SET_KEY && <Badge tone="sage">{s.mainTag}</Badge>}
        {set.hidden && <Badge>{s.hiddenTag}</Badge>}
      </div>
      {hidden.length > 0 && (
        <Notice title={s.hiddenWarning} className="mb-6">
          {hidden.map((c) => c.name).join(', ')}
        </Notice>
      )}
      <div className="grid items-start gap-6 lg:grid-cols-2 lg:grid-rows-[auto_auto_1fr]">
        <StockCard set={set} t={t} onSaved={() => router.refresh()} />
        <Section title={s.priceTitle} className="lg:row-span-3">
          {owner ? (
            <SetForm
              key={`${set.price}-${set.name.ru}-${set.name.uz}-${set.hidden}-${set.composition.map((c) => c.id).join()}`}
              set={set}
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
            <ReadOnly set={set} language={language} t={t} />
          )}
        </Section>
        <AssembleCard set={set} t={t} onAssembled={() => router.refresh()} />
        {owner && (
          <Section title={s.photoTitle}>
            <p className="-mt-2 text-small text-pretty text-muted-foreground">{s.photoHint}</p>
            <PhotoUpload
              slot={set.key}
              label={t.catalog.photo}
              url={`/api/admin/sets/discovery/photo?key=${set.key}`}
              hash={set.photo}
              messages={t.catalog}
              onUploaded={() => router.refresh()}
            />
          </Section>
        )}
      </div>
    </section>
  );
}

/**
 * A set assembly (ADR 0043): boxes packed from the free concentrate of the set's five, one fill of
 * the set's vial size from each per box, with a flacon per vial. The server takes the concentrate
 * and the flacons and adds the boxes, or names the fragrance whose free concentrate is short.
 */
function AssembleCard({
  set,
  t,
  onAssembled,
}: {
  set: AdminDiscoverySet;
  t: AdminMessages;
  onAssembled: () => void;
}) {
  const s = t.sets;
  const [value, setValue] = useState('');
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const quantity = Number(value);
  const valid = /^\d{1,5}$/.test(value) && quantity > 0;
  const complete = set.composition.length === SET_SIZE;
  const id = `set-${set.key}-assemble`;
  return (
    <Section title={s.assembleTitle}>
      <p className="-mt-2 text-small text-pretty text-muted-foreground">
        {fill(s.assembleHint, { ml: String(set.vialMl) })}
      </p>
      {!complete && <Notice title={s.notForSale} />}
      <form
        className="grid gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!valid || !complete) return;
          setPending(true);
          setResult(null);
          const res = await browserApi.warehouse
            .assembleSet({ params: { key: set.key }, body: { quantity } })
            .catch(() => null);
          setPending(false);
          if (res?.status === 201) {
            setValue('');
            setResult({
              ok: true,
              text: fill(s.assembled, {
                qty: String(quantity),
                ml: num(res.body.concentrateMl),
                flacons: num(res.body.flacons),
              }),
            });
            onAssembled();
          } else if (res?.status === 409 && res.body.code === 'concentrate_short')
            setResult({
              ok: false,
              text: fill(s.assembleShort, {
                name: res.body.fragrance ?? '',
                needed: num(res.body.neededMl ?? 0),
                balance: num(res.body.balanceMl ?? 0),
              }),
            });
          else setResult({ ok: false, text: t.errors.generic });
        }}
      >
        <Field id={id} label={s.assembleQuantity}>
          <Input
            inputMode="numeric"
            pattern="[0-9]+"
            autoComplete="off"
            enterKeyHint="done"
            className="tabular-nums"
            required
            disabled={!complete}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setResult(null);
            }}
          />
        </Field>
        {result && !result.ok && <Notice title={result.text} />}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button type="submit" loading={pending} disabled={!valid || !complete}>
            {s.assembleSubmit}
          </Button>
          {result?.ok && <Saved text={result.text} />}
        </div>
      </form>
    </Section>
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
  const st = t.stock;
  const [value, setValue] = useState(String(set.onHand));
  /** Why the count changed (#76): kept in the audit. */
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [state, setState] = useState<'idle' | 'saved' | 'error'>('idle');
  /** A save waiting on the editor: below the reserve (ask first) or somebody else changed the count (409). */
  const [ask, setAsk] = useState<
    { kind: 'below'; value: number } | { kind: 'changed'; value: number; current: number } | null
  >(null);
  const valid = /^\d{1,7}$/.test(value);

  /** Always compare-and-set against the count the editor was shown (or the one the 409 returned). */
  async function save(onHand: number, expected: number) {
    setPending(true);
    setState('idle');
    const res = await browserApi.sets
      .setOnHand({
        query: { key: set.key },
        body: { onHand, expected, reason: reason.trim() },
      })
      .catch(() => null);
    setPending(false);
    if (res?.status === 200) {
      setAsk(null);
      setReason('');
      setState('saved');
      onSaved();
    } else if (res?.status === 409 && res.body.current !== undefined) {
      setAsk({ kind: 'changed', value: onHand, current: res.body.current });
      onSaved();
    } else setState('error');
  }

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
      {set.belowReserve && <Notice title={st.belowNow} />}
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid || !reason.trim()) return;
          const next = Number(value);
          if (next < set.reserved) setAsk({ kind: 'below', value: next });
          else void save(next, set.onHand);
        }}
      >
        <Field id={`set-${set.key}-on-hand`} label={s.onHand} hint={s.onHandHint}>
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
              setAsk(null);
            }}
          />
        </Field>
        <Field id={`set-${set.key}-on-hand-reason`} label={st.reason}>
          <Input
            autoComplete="off"
            maxLength={STOCK_REASON_MAX}
            placeholder={st.reasonPlaceholder}
            required
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setState('idle');
            }}
          />
        </Field>
        {ask?.kind === 'below' && (
          <Notice
            title={fill(st.belowTitle, {
              onHand: String(ask.value),
              reserved: String(set.reserved),
            })}
          >
            {fill(st.belowText, { onHand: String(ask.value), reserved: String(set.reserved) })}
          </Notice>
        )}
        {ask?.kind === 'changed' && (
          <Notice title={fill(st.changedTitle, { current: String(ask.current) })}>
            {st.changedText}
          </Notice>
        )}
        {state === 'error' && <Notice title={t.errors.generic} />}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {ask?.kind === 'below' ? (
            <>
              <Button
                type="button"
                loading={pending}
                onClick={() => void save(ask.value, set.onHand)}
              >
                {st.belowConfirm}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => setAsk(null)}
              >
                {st.back}
              </Button>
            </>
          ) : ask?.kind === 'changed' ? (
            <>
              <Button
                type="button"
                loading={pending}
                onClick={() => void save(ask.value, ask.current)}
              >
                {fill(st.changedConfirm, {
                  value: String(ask.value),
                  current: String(ask.current),
                })}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => {
                  setValue(String(ask.current));
                  setAsk(null);
                }}
              >
                {st.cancel}
              </Button>
            </>
          ) : (
            <Button
              type="submit"
              loading={pending}
              disabled={!valid || Number(value) === set.onHand}
            >
              {s.saveOnHand}
            </Button>
          )}
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
      {set.uzumUrl && (
        <div>
          <p className="text-small text-muted-foreground">{s.uzumUrl}</p>
          <p className="mt-0.5 break-all">{set.uzumUrl}</p>
        </div>
      )}
      {set.composition.length < SET_SIZE && <Notice title={s.notForSale} />}
      <p className="text-xs text-muted-foreground">{s.priceOnly}</p>
    </div>
  );
}

/**
 * The owner's form for one set: its names, the ml of its vials (a new set only: fixed after),
 * whether the shop sells it (never off for the main set), price, Uzum link and five fragrances in
 * order. `set` null makes a new set (`POST /admin/sets`) and opens the list at it.
 */
export function SetForm({
  set,
  options,
  language,
  saved = false,
  t,
  onEdit,
  onSaved,
}: {
  set: AdminDiscoverySet | null;
  options: Option[];
  language: Language;
  /** The last save went through (the page re-reads; this survives the form's remount). */
  saved?: boolean;
  t: AdminMessages;
  onEdit?: () => void;
  onSaved?: () => void;
}) {
  const s = t.sets;
  const router = useRouter();
  const edited = () => onEdit?.();
  const main = set?.key === MAIN_SET_KEY;
  const base = set ? `set-${set.key}` : 'set-new';
  const [nameRu, setNameRu] = useState(set?.name.ru ?? '');
  const [nameUz, setNameUz] = useState(set?.name.uz ?? '');
  const [vialMl, setVialMl] = useState<DiscoveryVialMl>(set?.vialMl ?? 10);
  const [onSale, setOnSale] = useState(!(set?.hidden ?? false));
  const [price, setPrice] = useState(set ? String(set.price) : '');
  const [picks, setPicks] = useState<string[]>(() =>
    Array.from({ length: SET_SIZE }, (_, i) => String(set?.composition[i]?.id ?? '')),
  );
  const [uzumUrl, setUzumUrl] = useState(set?.uzumUrl ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const validUzum = isUzumUrl(uzumUrl);
  const validNames = nameRu.trim() !== '' && nameUz.trim() !== '';
  const chosen = picks.filter(Boolean);
  const duplicate = new Set(chosen).size !== chosen.length;
  const complete = chosen.length === SET_SIZE;
  const validPrice = /^\d{1,9}$/.test(price);
  const ready = validNames && validPrice && complete && !duplicate && validUzum;
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
        if (!ready) return;
        setPending(true);
        setError(null);
        const body = {
          name: { ru: nameRu.trim(), uz: nameUz.trim() },
          hidden: main ? false : !onSale,
          price: Number(price),
          uzumUrl: uzumUrl.trim(),
          composition: picks.map(Number),
        };
        if (set) {
          const res = await browserApi.sets
            .update({ query: { key: set.key }, body })
            .catch(() => null);
          setPending(false);
          if (res?.status === 200) onSaved?.();
          else
            setError(
              res?.status === 403
                ? t.errors.forbidden
                : res?.status === 422
                  ? s.invalidComposition
                  : s.failed,
            );
          return;
        }
        const res = await browserApi.sets.create({ body: { ...body, vialMl } }).catch(() => null);
        setPending(false);
        if (res?.status === 201) {
          router.push(`/sets#${res.body.key}`);
          router.refresh();
        } else
          setError(
            res?.status === 403
              ? t.errors.forbidden
              : res?.status === 422
                ? s.invalidComposition
                : s.createFailed,
          );
      }}
    >
      {set?.isPlaceholder && <Notice title={s.placeholderPrice} />}
      <div className="grid items-start gap-5 sm:grid-cols-2">
        <Field id={`${base}-name-ru`} label={s.nameRu} hint={s.nameHint}>
          <Input
            lang="ru"
            autoComplete="off"
            maxLength={60}
            required
            value={nameRu}
            onChange={(e) => {
              setNameRu(e.target.value);
              edited();
            }}
          />
        </Field>
        <Field id={`${base}-name-uz`} label={s.nameUz}>
          <Input
            lang="uz"
            autoComplete="off"
            maxLength={60}
            required
            value={nameUz}
            onChange={(e) => {
              setNameUz(e.target.value);
              edited();
            }}
          />
        </Field>
      </div>
      {!set && (
        <Field id={`${base}-vial`} label={s.vialMl} hint={s.vialHint}>
          <Select
            value={String(vialMl)}
            onChange={(e) => setVialMl(Number(e.target.value) as DiscoveryVialMl)}
          >
            {DISCOVERY_VIAL_MLS.map((ml) => (
              <option key={ml} value={ml}>
                {fill(s.vialOption, { ml: String(ml) })}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {main ? (
        <p className="text-xs text-pretty text-muted-foreground">{s.mainOnSale}</p>
      ) : (
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            className="mt-0.5 size-[18px] shrink-0 accent-graphite"
            checked={onSale}
            onChange={(e) => {
              setOnSale(e.target.checked);
              edited();
            }}
          />
          <span className="min-w-0">
            <span className="block font-medium">{s.onSale}</span>
            <span className="block text-[13px] text-pretty text-muted-foreground">
              {s.onSaleHint}
            </span>
          </span>
        </label>
      )}
      <Field
        id={`${base}-price`}
        label={s.price}
        hint={main ? s.priceHint.main : s.priceHint.other}
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
            edited();
          }}
        />
      </Field>
      <Field
        id={`${base}-uzum`}
        label={s.uzumUrl}
        hint={s.uzumHint}
        error={validUzum ? undefined : s.uzumInvalid}
      >
        <Input
          type="url"
          inputMode="url"
          autoComplete="off"
          placeholder="https://"
          value={uzumUrl}
          onChange={(e) => {
            setUzumUrl(e.target.value);
            edited();
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
            const id = `${base}-pick-${i}`;
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
                      edited();
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
        <Button type="submit" loading={pending} disabled={!ready}>
          {set ? s.save : s.create}
        </Button>
        {!set && (
          <Button asChild variant="outline">
            <Link href="/sets">{s.backToList}</Link>
          </Button>
        )}
        {saved && !error && <Saved text={s.saved} />}
      </div>
    </form>
  );
}
