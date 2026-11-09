'use client';

import type { AdminBtsPointDto, AdminRegionDto } from '@lummi/contracts';
import { ADMIN_POINTS_PAGE_SIZE } from '@lummi/contracts';
import type { Language } from '@lummi/i18n';
import { MapPin, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
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
import { Notice } from '@/components/ui/notice';
import { Select } from '@/components/ui/select';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { browserApi } from '@/lib/api';
import type { AdminMessages } from '@/lib/i18n';
import { fill } from '@/lib/utils';

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

/**
 * BTS points for staff (owner and manager): filter by region, status and text, add, edit, and
 * hide or show. There is no delete: a hidden point just leaves the customers' list. The owner
 * also gets the link to the tariffs.
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
  const regionName = (r: { nameRu: string; nameUz: string }) =>
    language === 'uz' ? r.nameUz : r.nameRu;
  const pages = Math.max(1, Math.ceil(data.total / (data.pageSize || ADMIN_POINTS_PAGE_SIZE)));
  const filtered = filters.regionId !== undefined || filters.status !== 'all' || filters.q !== '';

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
  const actions = (p: AdminBtsPointDto) => (
    <>
      <Button variant="ghost" size="sm" onClick={() => setDialog({ point: p })}>
        {t.btsPoints.edit}
      </Button>
      <Button variant="ghost" size="sm" loading={busyId === p.id} onClick={() => toggle(p)}>
        {p.active ? t.btsPoints.hide : t.btsPoints.show}
      </Button>
    </>
  );
  const details = (p: AdminBtsPointDto) => (
    <>
      <p className="[overflow-wrap:anywhere]">{p.address}</p>
      {p.landmark && (
        <p className="mt-0.5 text-[13px] text-muted-foreground [overflow-wrap:anywhere]">
          {p.landmark}
        </p>
      )}
      {p.hours && <p className="mt-0.5 text-[13px] text-muted-foreground">{p.hours}</p>}
    </>
  );

  return (
    <>
      <PageHeader
        title={t.btsPoints.title}
        description={t.btsPoints.description}
        actions={
          <>
            {isOwner && (
              <Button variant="outline" asChild className="max-sm:w-full">
                <Link href="/bts-points/tariffs">{t.btsPoints.tariffs}</Link>
              </Button>
            )}
            <Button onClick={() => setDialog({ point: null })} className="max-sm:w-full">
              <Plus strokeWidth={1.5} aria-hidden />
              {t.btsPoints.add}
            </Button>
          </>
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
          <Field id="f-region" label={t.btsPoints.region}>
            <Select name="region" defaultValue={filters.regionId ?? ''}>
              <option value="">{t.btsPoints.allRegions}</option>
              {regions.map((r) => (
                <option key={r.id} value={r.id}>
                  {regionName(r)}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="f-status" label={t.btsPoints.status}>
            <Select name="status" defaultValue={filters.status}>
              <option value="all">{t.btsPoints.allStatuses}</option>
              <option value="active">{t.btsPoints.onlyVisible}</option>
              <option value="hidden">{t.btsPoints.onlyHidden}</option>
            </Select>
          </Field>
          <Field id="f-q" label={t.btsPoints.search}>
            <Input
              name="q"
              type="search"
              autoComplete="off"
              defaultValue={filters.q}
              placeholder={t.btsPoints.searchPlaceholder}
            />
          </Field>
          <div className="flex items-end gap-2">
            <Button type="submit" className="max-sm:flex-1">
              {t.btsPoints.apply}
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
        <EmptyState
          title={filtered ? t.btsPoints.emptyFiltered : t.btsPoints.empty}
          icon={MapPin}
        />
      ) : (
        <Card className="@container">
          <p className="border-b border-border px-4 py-3 text-[13px] text-muted-foreground @xl:px-5">
            {fill(t.btsPoints.total, { n: String(data.total) })}
          </p>
          <ul className="divide-y divide-border @4xl:hidden">
            {data.items.map((p) => (
              <li key={p.id} className="px-4 py-4 @xl:px-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold [overflow-wrap:anywhere]">{p.name}</p>
                    <p className="mt-0.5 text-[13px] text-muted-foreground [overflow-wrap:anywhere]">
                      {regionName({ nameRu: p.regionNameRu, nameUz: p.regionNameUz })} · {p.city} ·{' '}
                      {p.code}
                    </p>
                  </div>
                  <div className="shrink-0">{status(p)}</div>
                </div>
                <div className="mt-2 text-sm">{details(p)}</div>
                <div className="-ml-3 mt-2 flex flex-wrap gap-1.5">{actions(p)}</div>
              </li>
            ))}
          </ul>
          <div className="hidden @4xl:block">
            <Table>
              <THead>
                <TR>
                  <TH>{t.btsPoints.code}</TH>
                  <TH>{t.btsPoints.name}</TH>
                  <TH>{t.btsPoints.city}</TH>
                  <TH>{t.btsPoints.address}</TH>
                  <TH>{t.btsPoints.status}</TH>
                  <TH>
                    <span className="sr-only">{t.btsPoints.actions}</span>
                  </TH>
                </TR>
              </THead>
              <TBody>
                {data.items.map((p) => (
                  <TR key={p.id} className="align-top">
                    <TD className="whitespace-nowrap text-muted-foreground">{p.code}</TD>
                    <TD className="min-w-[9rem] font-semibold [overflow-wrap:anywhere]">
                      {p.name}
                    </TD>
                    <TD className="[overflow-wrap:anywhere]">
                      {p.city}
                      <p className="text-[13px] text-muted-foreground">
                        {regionName({ nameRu: p.regionNameRu, nameUz: p.regionNameUz })}
                      </p>
                    </TD>
                    <TD className="min-w-[18rem]">{details(p)}</TD>
                    <TD>{status(p)}</TD>
                    <TD className="w-px">
                      <div className="flex gap-1.5">{actions(p)}</div>
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
              <span className="text-[13px] text-muted-foreground">
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
        <DialogContent>
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
  return (
    <>
      <DialogTitle>{point ? t.btsPoints.editTitle : t.btsPoints.addTitle}</DialogTitle>
      <DialogDescription className="sr-only">{t.btsPoints.description}</DialogDescription>
      <form
        className="mt-5 grid gap-4"
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
        <Field id="p-code" label={t.btsPoints.code} hint={point ? undefined : t.btsPoints.codeHint}>
          <Input
            name="code"
            required
            maxLength={40}
            autoComplete="off"
            defaultValue={point?.code}
            readOnly={point !== null}
            disabled={point !== null}
          />
        </Field>
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
          <Select name="region" required defaultValue={point?.regionId ?? defaultRegionId ?? ''}>
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
        <Field id="p-city" label={t.btsPoints.city}>
          <Input
            name="city"
            required
            maxLength={200}
            autoComplete="off"
            defaultValue={point?.city}
          />
        </Field>
        <Field id="p-address" label={t.btsPoints.address}>
          <Input
            name="address"
            required
            maxLength={500}
            autoComplete="off"
            defaultValue={point?.address}
          />
        </Field>
        <Field id="p-landmark" label={t.btsPoints.landmark}>
          <Input
            name="landmark"
            maxLength={500}
            autoComplete="off"
            defaultValue={point?.landmark ?? ''}
          />
        </Field>
        <Field id="p-hours" label={t.btsPoints.hours} hint={t.btsPoints.hoursHint}>
          <Input
            name="hours"
            maxLength={300}
            autoComplete="off"
            defaultValue={point?.hours ?? ''}
          />
        </Field>
        {error && <Notice title={error} />}
        <DialogFooter className="mt-2">
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
