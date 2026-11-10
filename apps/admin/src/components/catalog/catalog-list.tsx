'use client';

import type { DictionaryItem, AdminFragranceListItem } from '@lummi/contracts';
import { formatMoney, type Language } from '@lummi/i18n';
import { ImageOff, Plus, SlidersHorizontal } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Fragment, useState } from 'react';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { MetaLine } from '@/components/ui/meta-line';
import { Notice } from '@/components/ui/notice';
import { Select } from '@/components/ui/select';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { browserApi } from '@/lib/api';
import type { AdminMessages } from '@/lib/i18n';
import { QUIET_ACTION, TEXT_LINK } from '@/lib/ui-classes';
import { cn, fill } from '@/lib/utils';
import { FlagBadge } from './flag-badge';
import { photoUrl } from './photo';

type Filters = {
  q?: string;
  type?: string;
  familyId?: number;
  visibility?: string;
  flag?: string;
};

/**
 * Owner-only catalog list: a GET filter form (the URL is the state, so it survives a reload and a
 * shared link), then one row per fragrance with its smallest-volume photo, the flags, and each
 * volume's price and on hand. A row (or its name) opens the editor; «Скрыть» / «Показать» is the
 * one row action. Same grammar as the BTS points list.
 */
export function CatalogList({
  items,
  families,
  filters,
  filtered,
  language,
  t,
}: {
  items: AdminFragranceListItem[];
  families: DictionaryItem[];
  filters: Filters;
  filtered: boolean;
  language: Language;
  t: AdminMessages;
}) {
  const c = t.catalog;
  const router = useRouter();
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeFilters = [filters.type, filters.familyId, filters.visibility, filters.flag].filter(
    (v) => v !== undefined,
  ).length;
  // phones show only the search; the four selects open behind «Фильтры» (open when in use)
  const [showFilters, setShowFilters] = useState(activeFilters > 0);
  const open = (f: AdminFragranceListItem) => router.push(`/catalog/${f.id}`);

  const toggle = async (f: AdminFragranceListItem) => {
    setError(null);
    setBusy(f.id);
    const res = await browserApi.catalog.fragrances
      .setHidden({ params: { id: f.id }, body: { hidden: !f.hidden } })
      .catch(() => null);
    setBusy(null);
    if (res?.status === 200) router.refresh();
    else setError(t.errors.generic);
  };

  const status = (f: AdminFragranceListItem) => (
    <Badge tone={f.hidden ? 'neutral' : 'sage'}>{f.hidden ? c.hidden : c.visible}</Badge>
  );
  // as wide as the longer label, so the column does not jump when a fragrance flips
  const toggleWidth = { minWidth: `calc(${Math.max(c.hide.length, c.unhide.length)}ch + 1.5rem)` };
  const hideAction = (f: AdminFragranceListItem) => (
    <Button
      variant="ghost"
      size="sm"
      className={cn('justify-start', QUIET_ACTION)}
      style={toggleWidth}
      loading={busy === f.id}
      onClick={(e) => {
        e.stopPropagation(); // not the row's «open the editor»
        void toggle(f);
      }}
    >
      {f.hidden ? c.unhide : c.hide}
    </Button>
  );
  /** The name (the keyboard path to the editor) with the flags the shop shows beside it. */
  const title = (f: AdminFragranceListItem) => (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <Link
        href={`/catalog/${f.id}`}
        onClick={(e) => e.stopPropagation()}
        className="min-w-0 rounded-sm text-[15px] leading-snug font-semibold break-words underline-offset-[3px] hover:underline"
      >
        {f.name}
      </Link>
      {f.isHit && <FlagBadge kind="hit">{c.hit}</FlagBadge>}
      {f.isNew && <FlagBadge kind="new">{c.isNew}</FlagBadge>}
    </div>
  );
  const meta = (f: AdminFragranceListItem) => (
    <MetaLine
      className="mt-0.5 text-small text-muted-foreground"
      parts={[f.originalBrand, c.options.type[f.type], language === 'uz' ? f.familyUz : f.familyRu]}
    />
  );
  /** One line per volume: the volume, its price (a markdown strikes the regular one), on hand. */
  const volumes = (f: AdminFragranceListItem) => (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-x-3 gap-y-1 text-[13px] leading-snug tabular-nums">
      {f.volumes.map((v) => (
        <Fragment key={v.ml}>
          <dt className="whitespace-nowrap text-muted-foreground">
            {v.ml} {c.ml}
          </dt>
          <dd className="flex min-w-0 flex-wrap gap-x-1.5">
            {v.salePrice === null ? (
              <span className="whitespace-nowrap">{formatMoney(v.price, language)}</span>
            ) : (
              <>
                <s className="whitespace-nowrap text-muted-foreground">
                  {formatMoney(v.price, language)}
                </s>
                <span className="whitespace-nowrap font-semibold text-sage-ink">
                  {formatMoney(v.salePrice, language)}
                </span>
              </>
            )}
          </dd>
          <dd
            className={cn(
              'text-right whitespace-nowrap',
              v.onHand === 0 && 'text-muted-foreground',
            )}
          >
            {fill(c.pieces, { n: groupDigits(v.onHand) })}
          </dd>
        </Fragment>
      ))}
    </dl>
  );

  return (
    <>
      <PageHeader
        title={c.title}
        description={c.description}
        titleAction={
          <Button size="icon" asChild>
            <Link href="/catalog/new" aria-label={c.add}>
              <Plus strokeWidth={1.5} aria-hidden />
            </Link>
          </Button>
        }
        actions={
          <div className="flex items-center gap-5">
            <Link href="/catalog/import" className={TEXT_LINK}>
              {c.excel.link}
            </Link>
            <Link href="/catalog/dictionaries" className={TEXT_LINK}>
              {c.dictionaries}
            </Link>
            <Button asChild className="max-sm:hidden">
              <Link href="/catalog/new">
                <Plus strokeWidth={1.5} aria-hidden />
                {c.add}
              </Link>
            </Button>
          </div>
        }
      />

      <Card className="mb-4 p-4">
        <form method="get" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {/* phones: search, then the buttons with «Фильтры», then the selects when open */}
          <Field id="f-q" label={c.search} className="max-sm:order-1 sm:col-span-2 lg:col-span-3">
            <Input
              name="q"
              type="search"
              enterKeyHint="search"
              autoComplete="off"
              defaultValue={filters.q ?? ''}
              placeholder={c.searchPlaceholder}
            />
          </Field>
          <div className="flex items-end gap-2 max-sm:order-2 max-sm:flex-wrap sm:order-last sm:col-span-2 lg:order-none lg:col-span-1">
            <Button type="submit" className="max-sm:flex-1 lg:flex-1">
              {c.apply}
            </Button>
            <Button
              type="button"
              variant="outline"
              aria-expanded={showFilters}
              aria-controls="f-type f-family f-state f-flag"
              onClick={() => setShowFilters((v) => !v)}
              className="sm:hidden"
            >
              <SlidersHorizontal strokeWidth={1.5} aria-hidden />
              {c.filters}
              {activeFilters > 0 && (
                <span className="grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1.5 text-xs text-primary-foreground tabular-nums">
                  {activeFilters}
                </span>
              )}
            </Button>
            {filtered && (
              <Button variant="outline" className="max-sm:flex-1" asChild>
                <Link href="/catalog">{c.reset}</Link>
              </Button>
            )}
          </div>
          <Field
            id="f-type"
            label={c.type}
            className={cn('max-sm:order-3', !showFilters && 'max-sm:hidden')}
          >
            <Select name="type" defaultValue={filters.type ?? ''}>
              <option value="">{c.allTypes}</option>
              {(['homme', 'femme', 'unisex'] as const).map((v) => (
                <option key={v} value={v}>
                  {c.options.type[v]}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            id="f-family"
            label={c.family}
            className={cn('max-sm:order-3', !showFilters && 'max-sm:hidden')}
          >
            <Select name="familyId" defaultValue={filters.familyId ?? ''}>
              <option value="">{c.allFamilies}</option>
              {families.map((f) => (
                <option key={f.id} value={f.id}>
                  {language === 'uz' ? f.nameUz : f.nameRu}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            id="f-state"
            label={c.state}
            className={cn('max-sm:order-3', !showFilters && 'max-sm:hidden')}
          >
            <Select name="visibility" defaultValue={filters.visibility ?? ''}>
              <option value="">{c.allStates}</option>
              <option value="visible">{c.visible}</option>
              <option value="hidden">{c.hidden}</option>
            </Select>
          </Field>
          <Field
            id="f-flag"
            label={c.flag}
            className={cn('max-sm:order-3', !showFilters && 'max-sm:hidden')}
          >
            <Select name="flag" defaultValue={filters.flag ?? ''}>
              <option value="">{c.allStates}</option>
              <option value="hit">{c.onlyHits}</option>
              <option value="new">{c.onlyNew}</option>
            </Select>
          </Field>
        </form>
      </Card>

      {error && <Notice title={error} className="mb-4" />}

      {items.length === 0 ? (
        <EmptyState title={filtered ? c.empty : c.emptyCatalog}>
          {filtered ? c.emptyFilteredText : null}
        </EmptyState>
      ) : (
        <Card className="@container">
          <p className="border-b border-border px-4 py-3 text-small text-muted-foreground tabular-nums @xl:px-5">
            {fill(c.total, { n: String(items.length) })}
          </p>
          {/* a tap anywhere on a fragrance opens it; the name is the keyboard path */}
          <ul className="divide-y divide-border @4xl:hidden">
            {items.map((f) => (
              <li
                key={f.id}
                onClick={() => open(f)}
                className="flex cursor-pointer gap-3.5 px-4 py-4 transition-colors duration-150 hover:bg-milk/60 active:bg-milk @xl:px-5"
              >
                <Thumb hash={f.photo} label={c.noPhoto} />
                {/* beside a photo the name needs the width: the state sits with its toggle below */}
                <div className="min-w-0 flex-1">
                  {title(f)}
                  {meta(f)}
                  <div className="mt-2.5">{volumes(f)}</div>
                  <div className="mt-2 flex items-center gap-1">
                    {status(f)}
                    {hideAction(f)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <div className="hidden @4xl:block">
            <Table>
              <THead>
                <TR>
                  <TH>{c.fragrance}</TH>
                  <TH className="w-px">{c.volumes}</TH>
                  <TH className="w-px">{c.state}</TH>
                  <TH className="w-px">
                    <span className="sr-only">{t.btsPoints.actions}</span>
                  </TH>
                </TR>
              </THead>
              <TBody>
                {items.map((f) => (
                  <TR
                    key={f.id}
                    onClick={() => open(f)}
                    className="cursor-pointer [&>td]:py-3.5 [&>td]:align-top"
                  >
                    <TD className="min-w-[16rem]">
                      <div className="flex gap-3.5">
                        <Thumb hash={f.photo} label={c.noPhoto} />
                        <div className="min-w-0 pt-0.5">
                          {title(f)}
                          {meta(f)}
                        </div>
                      </div>
                    </TD>
                    <TD className="min-w-[17rem] pt-4">{volumes(f)}</TD>
                    <TD className="w-px pt-4 whitespace-nowrap">{status(f)}</TD>
                    <TD className="w-px pt-3">{hideAction(f)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        </Card>
      )}
    </>
  );
}

/** Thousands with narrow no-break spaces, as `formatMoney` groups them («1 250 шт.»). */
const groupDigits = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f');

/** The row's 3:4 photo (DESIGN.md thumbnail: 6 px), or a quiet «no photo» glyph in its place. */
function Thumb({ hash, label }: { hash: string | null; label: string }) {
  return (
    <div
      className="grid h-[72px] w-[54px] shrink-0 place-items-center overflow-hidden rounded-[6px] bg-field"
      title={hash ? undefined : label}
    >
      {hash ? (
        <img
          src={photoUrl(hash, 400)}
          alt=""
          width={54}
          height={72}
          className="size-full object-cover"
          loading="lazy"
          decoding="async"
        />
      ) : (
        <ImageOff
          className="size-[18px] text-muted-foreground"
          strokeWidth={1.5}
          role="img"
          aria-label={label}
        />
      )}
    </div>
  );
}
