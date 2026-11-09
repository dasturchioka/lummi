'use client';

import type { AdminBtsPointDto, AdminRegionDto } from '@lummi/contracts';
import { ADMIN_POINTS_PAGE_SIZE } from '@lummi/contracts';
import type { Language } from '@lummi/i18n';
import { MapPin, Plus, SlidersHorizontal } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { MetaLine } from '@/components/ui/meta-line';
import { Notice } from '@/components/ui/notice';
import { Select } from '@/components/ui/select';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { browserApi } from '@/lib/api';
import type { AdminMessages } from '@/lib/i18n';
import { cn, fill } from '@/lib/utils';

type Status = 'all' | 'active' | 'hidden';
export type PointFilters = { regionId: number | undefined; status: Status; q: string };
type PageData = {
  items: AdminBtsPointDto[];
  total: number;
  page: number;
  pageSize: number;
};

const href = (f: PointFilters, page: number) => {
  const p = new URLSearchParams();
  if (f.regionId) p.set('region', String(f.regionId));
  if (f.status !== 'all') p.set('status', f.status);
  if (f.q) p.set('q', f.q);
  if (page > 1) p.set('page', String(page));
  const qs = p.toString();
  return qs ? `/bts-points?${qs}` : '/bts-points';
};

/** Row actions are quiet: Muted Ink 500, Ink on hover and focus (the row itself opens the editor). */
export const QUIET_ACTION =
  'font-medium text-muted-foreground hover:text-foreground focus-visible:text-foreground';

/** A text link in the page header or a form (DESIGN.md link: Ink 500, hairline underline). */
const TEXT_LINK =
  'rounded-sm text-sm font-medium underline decoration-border-strong underline-offset-[3px] transition-[text-decoration-color] duration-150 hover:decoration-current';

/**
 * BTS points for staff (owner and manager): filter by region, status and text, add, edit, and
 * hide or show. There is no delete: a hidden point just leaves the customers' list. The owner
 * also gets the link to the tariffs. A row (or its name) opens the editor; «Скрыть» / «Показать»
 * is the one explicit row action.
 */
export function BtsPointsManager({
  regions,
  page: data,
  filters,
  isOwner,
  language,
  t,
}: {
  regions: AdminRegionDto[];
  page: PageData;
  filters: PointFilters;
  isOwner: boolean;
  language: Language;
  t: AdminMessages;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<{ point: AdminBtsPointDto | null } | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const activeFilters =
    (filters.regionId !== undefined ? 1 : 0) + (filters.status !== 'all' ? 1 : 0);
  // phones show only the search; region and status open behind «Фильтры» (open when in use)
  const [showFilters, setShowFilters] = useState(activeFilters > 0);
  const regionName = (r: { nameRu: string; nameUz: string }) =>
    language === 'uz' ? r.nameUz : r.nameRu;
  const pages = Math.max(1, Math.ceil(data.total / (data.pageSize || ADMIN_POINTS_PAGE_SIZE)));
  const filtered = filters.regionId !== undefined || filters.status !== 'all' || filters.q !== '';
  const edit = (p: AdminBtsPointDto) => setDialog({ point: p });

  const toggle = async (p: AdminBtsPointDto) => {
    setRowError(null);
    setBusyId(p.id);
    const res = await browserApi.btsPoints
      .update({ params: { id: p.id }, body: { active: !p.active } })
      .catch(() => null);
    setBusyId(null);
    if (res?.status === 200) router.refresh();
    else setRowError(t.errors.generic);
  };

  const status = (p: AdminBtsPointDto) => (
    <Badge tone={p.active ? 'sage' : 'neutral'}>
      {p.active ? t.btsPoints.visible : t.btsPoints.hidden}
    </Badge>
  );
  // Hide / show is as wide as the longer of its two labels, so the column does not jump when a
  // point flips.
  const toggleWidth = {
    minWidth: `calc(${Math.max(t.btsPoints.hide.length, t.btsPoints.show.length)}ch + 1.5rem)`,
  };
  const hideAction = (p: AdminBtsPointDto) => (
    <Button
      variant="ghost"
      size="sm"
      className={cn('justify-start', QUIET_ACTION)}
      style={toggleWidth}
      loading={busyId === p.id}
      onClick={(e) => {
        e.stopPropagation(); // not the row's «open the editor»
        void toggle(p);
      }}
    >
      {p.active ? t.btsPoints.hide : t.btsPoints.show}
    </Button>
  );
  /** The point's name, a button that opens the editor (the keyboard path; a tap on the row does the same). */
  const nameButton = (p: AdminBtsPointDto) => (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        edit(p);
      }}
      aria-label={`${t.btsPoints.edit}: ${p.name}`}
      className="rounded-sm text-left font-semibold break-words underline-offset-[3px] hover:underline"
    >
      {p.name}
    </button>
  );
  const region = (p: AdminBtsPointDto) =>
    regionName({ nameRu: p.regionNameRu, nameUz: p.regionNameUz });
  /** Where the point is: region, city (a wrap never leaves a dangling « · »). */
  const place = (p: AdminBtsPointDto) => (
    <MetaLine className="mt-0.5 text-small text-muted-foreground" parts={[region(p), p.city]} />
  );
  const details = (p: AdminBtsPointDto) => (
    <>
      <p className="break-words">{p.address}</p>
      <MetaLine
        className="mt-0.5 text-small text-muted-foreground"
        // a time range never breaks across lines
        parts={[p.landmark, p.hours?.replace(/(\d)-(\d)/g, '$1\u2011$2')]}
      />
    </>
  );

  return (
    <>
      <PageHeader
        title={t.btsPoints.title}
        description={t.btsPoints.description}
        titleAction={
          <Button
            size="icon"
            aria-label={t.btsPoints.add}
            onClick={() => setDialog({ point: null })}
          >
            <Plus strokeWidth={1.5} aria-hidden />
          </Button>
        }
        actions={
          <div className="flex items-center gap-5">
            {isOwner && (
              <Link href="/bts-points/tariffs" className={TEXT_LINK}>
                {t.btsPoints.tariffs}
              </Link>
            )}
            <Button onClick={() => setDialog({ point: null })} className="max-sm:hidden">
              <Plus strokeWidth={1.5} aria-hidden />
              {t.btsPoints.add}
            </Button>
          </div>
        }
      />

      <Card className="mb-4 p-4">
        <form
          key={href(filters, 1)}
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_2fr_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const region = Number(f.get('region')) || undefined;
            router.push(
              href(
                {
                  regionId: region,
                  status: (f.get('status') as Status) || 'all',
                  q: String(f.get('q') ?? '').trim(),
                },
                1,
              ),
            );
          }}
        >
          {/* phones: search, then the buttons with «Фильтры», then region and status when open */}
          <Field
            id="f-region"
            label={t.btsPoints.region}
            className={cn('max-sm:order-3', !showFilters && 'max-sm:hidden')}
          >
            <Select name="region" defaultValue={filters.regionId ?? ''}>
              <option value="">{t.btsPoints.allRegions}</option>
              {regions.map((r) => (
                <option key={r.id} value={r.id}>
                  {regionName(r)}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            id="f-status"
            label={t.btsPoints.status}
            className={cn('max-sm:order-3', !showFilters && 'max-sm:hidden')}
          >
            <Select name="status" defaultValue={filters.status}>
              <option value="all">{t.btsPoints.allStatuses}</option>
              <option value="active">{t.btsPoints.onlyVisible}</option>
              <option value="hidden">{t.btsPoints.onlyHidden}</option>
            </Select>
          </Field>
          <Field id="f-q" label={t.btsPoints.search} className="max-sm:order-1">
            <Input
              name="q"
              type="search"
              autoComplete="off"
              defaultValue={filters.q}
              placeholder={t.btsPoints.searchPlaceholder}
            />
          </Field>
          <div className="flex items-end gap-2 max-sm:order-2">
            <Button type="submit" className="max-sm:flex-1">
              {t.btsPoints.apply}
            </Button>
            <Button
              type="button"
              variant="outline"
              aria-expanded={showFilters}
              aria-controls="f-region f-status"
              onClick={() => setShowFilters((v) => !v)}
              className="sm:hidden"
            >
              <SlidersHorizontal strokeWidth={1.5} aria-hidden />
              {t.btsPoints.filters}
              {activeFilters > 0 && (
                <span className="grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1.5 text-xs text-primary-foreground tabular-nums">
                  {activeFilters}
                </span>
              )}
            </Button>
            {filtered && (
              <Button variant="outline" asChild>
                <Link href="/bts-points">{t.btsPoints.reset}</Link>
              </Button>
            )}
          </div>
        </form>
      </Card>

      {rowError && <Notice title={rowError} className="mb-4" />}

      {data.items.length === 0 ? (
        <EmptyState title={filtered ? t.btsPoints.emptyFiltered : t.btsPoints.empty} icon={MapPin}>
          {filtered ? t.btsPoints.emptyFilteredText : null}
        </EmptyState>
      ) : (
        <Card className="@container">
          <p className="border-b border-border px-4 py-3 text-small text-muted-foreground tabular-nums @xl:px-5">
            {fill(t.btsPoints.total, { n: String(data.total) })}
          </p>
          {/* a tap anywhere on a point opens it; the name is the keyboard path */}
          <ul className="divide-y divide-border @4xl:hidden">
            {data.items.map((p) => (
              <li
                key={p.id}
                onClick={() => edit(p)}
                className="cursor-pointer px-4 py-4 transition-colors duration-150 hover:bg-milk/60 @xl:px-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    {nameButton(p)}
                    {place(p)}
                    <p className="text-small text-muted-foreground tabular-nums break-words">
                      {t.btsPoints.code} {p.code}
                    </p>
                  </div>
                  <div className="shrink-0">{status(p)}</div>
                </div>
                <div className="mt-2 text-sm">{details(p)}</div>
                <div className="-ml-3 mt-1.5 flex">{hideAction(p)}</div>
              </li>
            ))}
          </ul>
          <div className="hidden @4xl:block">
            <Table>
              <THead>
                <TR>
                  <TH>{t.btsPoints.code}</TH>
                  <TH>{t.btsPoints.name}</TH>
                  <TH>{t.btsPoints.address}</TH>
                  <TH>{t.btsPoints.status}</TH>
                  <TH>
                    <span className="sr-only">{t.btsPoints.actions}</span>
                  </TH>
                </TR>
              </THead>
              <TBody>
                {data.items.map((p) => (
                  /*
                    Every cell reads from its top line, so a wrapped address never floats the
                    name. The name carries where the point is under it; break-words, not
                    anywhere, so a column is never squeezed to mid-word breaks.
                  */
                  <TR
                    key={p.id}
                    onClick={() => edit(p)}
                    className="cursor-pointer [&>td]:py-3.5 [&>td]:align-top [&>td]:break-words"
                  >
                    <TD className="w-px whitespace-nowrap text-muted-foreground">{p.code}</TD>
                    <TD className="min-w-[14rem]">
                      {nameButton(p)}
                      {place(p)}
                    </TD>
                    <TD className="min-w-[16rem]">{details(p)}</TD>
                    <TD>{status(p)}</TD>
                    <TD className="w-px">
                      <div className="-my-1.5 flex">{hideAction(p)}</div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
          {pages > 1 && (
            <nav
              aria-label={t.btsPoints.page}
              className="flex items-center justify-between gap-3 border-t border-border px-4 py-3 @xl:px-5"
            >
              <Button variant="outline" size="sm" asChild={data.page > 1} disabled={data.page <= 1}>
                {data.page > 1 ? (
                  <Link href={href(filters, data.page - 1)}>{t.btsPoints.prev}</Link>
                ) : (
                  <span>{t.btsPoints.prev}</span>
                )}
              </Button>
              <span className="text-small text-muted-foreground tabular-nums">
                {fill(t.btsPoints.page, { page: String(data.page), pages: String(pages) })}
              </span>
              <Button
                variant="outline"
                size="sm"
                asChild={data.page < pages}
                disabled={data.page >= pages}
              >
                {data.page < pages ? (
                  <Link href={href(filters, data.page + 1)}>{t.btsPoints.next}</Link>
                ) : (
                  <span>{t.btsPoints.next}</span>
                )}
              </Button>
            </nav>
          )}
        </Card>
      )}

      <Dialog open={dialog !== null} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="sm:w-[min(560px,calc(100vw-32px))]">
          {dialog && (
            <PointForm
              key={dialog.point?.id ?? 'new'}
              point={dialog.point}
              regions={regions}
              regionName={regionName}
              defaultRegionId={filters.regionId}
              t={t}
              onSaved={() => {
                setDialog(null);
                router.refresh();
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Cities already used in a region, so a new point picks one instead of a typo variant. */
const regionCities = new Map<number, Promise<string[]>>();
function loadRegionCities(regionId: number): Promise<string[]> {
  let cached = regionCities.get(regionId);
  if (!cached) {
    cached = (async () => {
      const found = new Set<string>();
      for (let page = 1; page <= 20; page++) {
        const res = await browserApi.btsPoints
          .list({ query: { regionId, status: 'all', page } })
          .catch(() => null);
        if (res?.status !== 200) break;
        for (const p of res.body.items) found.add(p.city);
        if (page * res.body.pageSize >= res.body.total) break;
      }
      return [...found].sort((a, b) => a.localeCompare(b, 'ru'));
    })();
    regionCities.set(regionId, cached);
  }
  return cached;
}

function useRegionCities(regionId: number | undefined): string[] {
  const [loaded, setLoaded] = useState<{ regionId: number; cities: string[] } | null>(null);
  useEffect(() => {
    if (!regionId) return;
    let live = true;
    void loadRegionCities(regionId).then((cities) => live && setLoaded({ regionId, cities }));
    return () => {
      live = false;
    };
  }, [regionId]);
  return loaded && loaded.regionId === regionId ? loaded.cities : [];
}

function PointForm({
  point,
  regions,
  regionName,
  defaultRegionId,
  t,
  onSaved,
}: {
  point: AdminBtsPointDto | null;
  regions: AdminRegionDto[];
  regionName: (r: { nameRu: string; nameUz: string }) => string;
  defaultRegionId: number | undefined;
  t: AdminMessages;
  onSaved: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [regionId, setRegionId] = useState<number | undefined>(point?.regionId ?? defaultRegionId);
  const cities = useRegionCities(regionId);
  return (
    <>
      <DialogTitle>{point ? t.btsPoints.editTitle : t.btsPoints.addTitle}</DialogTitle>
      <DialogDescription className="sr-only">{t.btsPoints.description}</DialogDescription>
      <form
        className="mt-5 grid gap-4 sm:grid-cols-2 sm:items-start"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const text = (k: string) => String(f.get(k) ?? '').trim();
          const fields = {
            regionId: Number(f.get('region')),
            city: text('city'),
            name: text('name'),
            address: text('address'),
            landmark: text('landmark') || null,
            hours: text('hours') || null,
          };
          setPending(true);
          setError(null);
          const res = await (
            point
              ? browserApi.btsPoints.update({ params: { id: point.id }, body: fields })
              : browserApi.btsPoints.create({ body: { ...fields, code: text('code') } })
          ).catch(() => null);
          setPending(false);
          if (res && (res.status === 200 || res.status === 201)) onSaved();
          else if (res?.status === 409) setError(t.btsPoints.errors.codeTaken);
          else if (res?.status === 422) setError(t.btsPoints.errors.region);
          else setError(t.errors.generic);
        }}
      >
        {/* Two columns from 640 px: code and name, region and city; the long texts span both. */}
        {point ? (
          // the code is the point's identity and never changes: plain text, not a dead field
          <div className="grid gap-1.5">
            <p className="text-[12.5px] font-medium text-muted-foreground">{t.btsPoints.code}</p>
            <p className="flex min-h-11 items-center tabular-nums">{point.code}</p>
          </div>
        ) : (
          <Field id="p-code" label={t.btsPoints.code} hint={t.btsPoints.codeHint}>
            <Input name="code" required maxLength={40} autoComplete="off" />
          </Field>
        )}
        <Field id="p-name" label={t.btsPoints.name}>
          <Input
            name="name"
            required
            maxLength={200}
            autoComplete="off"
            defaultValue={point?.name}
          />
        </Field>
        <Field id="p-region" label={t.btsPoints.region}>
          <Select
            name="region"
            required
            value={regionId ?? ''}
            onChange={(e) => setRegionId(Number(e.target.value) || undefined)}
          >
            <option value="" disabled>
              {t.btsPoints.regionChoose}
            </option>
            {regions.map((r) => (
              <option key={r.id} value={r.id}>
                {regionName(r)}
              </option>
            ))}
          </Select>
        </Field>
        {/* A combobox: the region's cities as suggestions, a new one still allowed. */}
        <Field id="p-city" label={t.btsPoints.city} hint={t.btsPoints.cityHint}>
          <Input
            name="city"
            required
            maxLength={200}
            autoComplete="off"
            list="p-city-options"
            defaultValue={point?.city}
          />
        </Field>
        <datalist id="p-city-options">
          {cities.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <Field id="p-address" label={t.btsPoints.address} className="sm:col-span-2">
          <Input
            name="address"
            required
            maxLength={500}
            autoComplete="off"
            defaultValue={point?.address}
          />
        </Field>
        <Field id="p-landmark" label={t.btsPoints.landmark} className="sm:col-span-2">
          <Input
            name="landmark"
            maxLength={500}
            autoComplete="off"
            defaultValue={point?.landmark ?? ''}
          />
        </Field>
        <Field
          id="p-hours"
          label={t.btsPoints.hours}
          hint={t.btsPoints.hoursHint}
          className="sm:col-span-2"
        >
          <Input
            name="hours"
            maxLength={300}
            autoComplete="off"
            defaultValue={point?.hours ?? ''}
          />
        </Field>
        {error && <Notice title={error} className="sm:col-span-2" />}
        <DialogFooter className="mt-2 sm:col-span-2">
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {t.actions.cancel}
            </Button>
          </DialogClose>
          <Button type="submit" loading={pending}>
            {t.btsPoints.save}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
