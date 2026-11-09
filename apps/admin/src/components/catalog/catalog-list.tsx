'use client';

import type { DictionaryItem, FragranceListItem } from '@lummi/contracts';
import { BookOpen, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { Select } from '@/components/ui/select';
import { browserApi } from '@/lib/api';
import type { AdminMessages } from '@/lib/i18n';
import { formatMoney, type Language } from '@lummi/i18n';
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
 * shared link), then one row per fragrance. Each row shows its smallest-volume photo, the flags
 * and the volumes with their prices; «Скрыть/Показать» acts in place.
 */
export function CatalogList({
  items,
  families,
  filters,
  filtered,
  language,
  t,
}: {
  items: FragranceListItem[];
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

  const toggle = async (f: FragranceListItem) => {
    setError(null);
    setBusy(f.id);
    const res = await browserApi.catalog.fragrances
      .setHidden({ params: { id: f.id }, body: { hidden: !f.hidden } })
      .catch(() => null);
    setBusy(null);
    if (res?.status === 200) router.refresh();
    else setError(t.errors.generic);
  };

  return (
    <>
      <PageHeader
        title={c.title}
        description={c.description}
        actions={
          <>
            <Button variant="outline" asChild className="max-sm:flex-1">
              <Link href="/catalog/dictionaries">
                <BookOpen strokeWidth={1.5} aria-hidden />
                {c.dictionaries}
              </Link>
            </Button>
            <Button asChild className="max-sm:flex-1">
              <Link href="/catalog/new">
                <Plus strokeWidth={1.5} aria-hidden />
                {c.add}
              </Link>
            </Button>
          </>
        }
      />

      <Card className="mb-4 p-4 sm:p-5">
        <form
          method="get"
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))_auto] lg:items-end"
        >
          <label className="grid gap-1.5 sm:col-span-2 lg:col-span-1">
            <span className="text-[12.5px] font-medium text-muted-foreground">{c.search}</span>
            <Input
              name="q"
              type="search"
              defaultValue={filters.q ?? ''}
              placeholder={c.searchPlaceholder}
            />
          </label>
          <Select name="type" defaultValue={filters.type ?? ''} aria-label={c.type}>
            <option value="">{c.allTypes}</option>
            {(['homme', 'femme', 'unisex'] as const).map((v) => (
              <option key={v} value={v}>
                {c.options.type[v]}
              </option>
            ))}
          </Select>
          <Select name="familyId" defaultValue={filters.familyId ?? ''} aria-label={c.family}>
            <option value="">{c.allFamilies}</option>
            {families.map((f) => (
              <option key={f.id} value={f.id}>
                {language === 'uz' ? f.nameUz : f.nameRu}
              </option>
            ))}
          </Select>
          <Select name="visibility" defaultValue={filters.visibility ?? ''} aria-label={c.state}>
            <option value="">{c.allStates}</option>
            <option value="visible">{c.visible}</option>
            <option value="hidden">{c.hidden}</option>
          </Select>
          <Select name="flag" defaultValue={filters.flag ?? ''} aria-label={c.hit}>
            <option value="">{c.allStates}</option>
            <option value="hit">{c.onlyHits}</option>
            <option value="new">{c.onlyNew}</option>
          </Select>
          <div className="flex gap-2 sm:col-span-2 lg:col-span-1">
            <Button type="submit" className="flex-1">
              {c.apply}
            </Button>
            {filtered && (
              <Button variant="outline" asChild>
                <Link href="/catalog">{c.reset}</Link>
              </Button>
            )}
          </div>
        </form>
      </Card>

      {error && <Notice title={error} className="mb-4" />}

      <Card>
        {items.length === 0 ? (
          <EmptyState title={filtered ? c.empty : c.emptyCatalog} />
        ) : (
          <ul className="divide-y divide-border">
            {items.map((f) => (
              <li
                key={f.id}
                className="flex flex-wrap items-start gap-x-4 gap-y-3 px-4 py-4 sm:px-5"
              >
                <Link
                  href={`/catalog/${f.id}`}
                  className="flex min-w-0 flex-1 basis-64 items-start gap-4"
                >
                  <Thumb hash={f.photo} alt={c.noPhoto} />
                  <div className="min-w-0">
                    <p className="font-semibold [overflow-wrap:anywhere]">{f.name}</p>
                    <p className="mt-0.5 text-[13px] text-muted-foreground [overflow-wrap:anywhere]">
                      {f.originalBrand} · {c.options.type[f.type]}
                      {f.familyRu ? ` · ${language === 'uz' ? f.familyUz : f.familyRu}` : ''}
                    </p>
                    <p className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[13px] tabular-nums">
                      {f.volumes.map((v) => (
                        <span key={v.ml} className="whitespace-nowrap">
                          {v.ml} {c.ml}: {formatMoney(v.price, language)}
                          {v.salePrice !== null && ` → ${formatMoney(v.salePrice, language)}`}
                          <span className="text-muted-foreground"> · {v.onHand}</span>
                        </span>
                      ))}
                    </p>
                  </div>
                </Link>
                <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                  {f.isHit && <Badge tone="sage">{c.hit}</Badge>}
                  {f.isNew && <Badge tone="sage">{c.isNew}</Badge>}
                  <Badge tone={f.hidden ? 'neutral' : 'sage'}>
                    {f.hidden ? c.hidden : c.visible}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={busy === f.id}
                    onClick={() => toggle(f)}
                  >
                    {f.hidden ? c.unhide : c.hide}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

function Thumb({ hash, alt }: { hash: string | null; alt: string }) {
  return (
    <div className="grid h-[72px] w-[54px] shrink-0 place-items-center overflow-hidden rounded-button bg-field text-center text-[10px] leading-tight text-muted-foreground">
      {hash ? (
        <img src={photoUrl(hash, 400)} alt="" className="size-full object-cover" loading="lazy" />
      ) : (
        alt
      )}
    </div>
  );
}
