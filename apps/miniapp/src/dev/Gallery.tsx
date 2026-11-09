/**
 * lummi-ui-gallery: every base component in every state, for reviewers and later tickets.
 * DEV ONLY. The routes exist only when `import.meta.env.DEV` (router.tsx), so neither this
 * module nor its chunk reaches a production build; `npm run size` fails if this marker does.
 * Section names are developer labels and stay in English; component content comes from i18n
 * where a key exists, otherwise from the `demo` strings below (never shipped).
 */
import { useState, type ReactNode } from 'react';
import { usePrefs } from '../lib/prefs';
import { Badge, FragranceBadge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card, CardList, ListRow } from '../ui/Card';
import { FragranceListCard } from '../ui/FragranceListCard';
import type { FragranceListItem } from '@lummi/contracts';
import {
  AlertIcon,
  BagIcon,
  BottleIcon,
  BoxIcon,
  ChevronIcon,
  CloseIcon,
  ContrastIcon,
  GlobeIcon,
  GridIcon,
  HomeIcon,
  SearchIcon,
  Spinner,
  UserIcon,
} from '../ui/icons';
import { Logo, Monogram } from '../ui/Logo';
import { Money } from '../ui/Money';
import { Screen } from '../ui/Screen';
import { ScreenHeader } from '../ui/ScreenHeader';
import { Chip, TypeChips } from '../ui/Chips';
import { Segmented } from '../ui/Segmented';
import { Sheet } from '../ui/Sheet';
import { Skeleton } from '../ui/Skeleton';
import { EmptyState, ErrorState } from '../ui/States';
import { TabBar } from '../ui/TabBar';
// Placeholder bottle thumbnails, cut down from materials/flakons (dev only, never in dist).
import thumbA from './thumbs/symphony.webp';
import thumbB from './thumbs/althair.webp';
import thumbC from './thumbs/absolu-aventus.webp';

const LIST_ITEMS: Record<'normal' | 'worst' | 'soldOut', FragranceListItem> = {
  normal: {
    slug: 'baccarat-rouge-540',
    name: 'Baccarat Rouge 540',
    brand: 'Maison Francis Kurkdjian',
    type: 'unisex',
    family: { ru: 'Амброво-древесный', uz: 'Ambrali yogʻochli' },
    keyNotes: {
      ru: ['шафран', 'амбровое дерево', 'кедр'],
      uz: ['za’faron', 'ambra daraxti', 'kedr'],
    },
    isHit: true,
    isNew: false,
    fromPrice: 69_000,
    soldOut: false,
    photo: '32c0930f6c672207',
  },
  // The realistic worst case: very long name and brand, no family, a seven-digit price, no photo.
  worst: {
    slug: 'long',
    name: 'Elysium Pour Homme Parfum Extraordinaire',
    brand: 'Maison Francis Kurkdjian Paris Collection',
    type: 'homme',
    family: null,
    keyNotes: {
      ru: ['грейпфрут', 'имбирь', 'бергамот'],
      uz: ['greypfrut', 'zanjabil', 'bergamot'],
    },
    isHit: false,
    isNew: true,
    fromPrice: 1_249_000,
    soldOut: false,
    photo: null,
  },
  soldOut: {
    slug: 'ink-mark',
    name: 'Ink Mark',
    brand: 'Nishane',
    type: 'femme',
    family: { ru: 'Цветочный', uz: 'Gulli' },
    keyNotes: { ru: [], uz: [] },
    isHit: false,
    isNew: false,
    fromPrice: 69_000,
    soldOut: true,
    photo: null,
  },
};

const demo = {
  ru: {
    add: 'В корзину',
    reason: 'Выберите ещё 2',
    catalog: 'В каталог',
    sheetTitle: 'Город доставки',
    sheetText: 'Выберите регион, затем город или район.',
    region: 'Ташкент',
    regionHint: '12 пунктов BTS',
    attribution: 'По мотивам Louis Vuitton',
    notes: 'грейпфрут · имбирь · бергамот',
    emptyCart: 'В корзине пока пусто',
    emptyCartText: 'Начните с Discovery set: пять ароматов по 10 мл, чтобы найти свой.',
    types: ['Все', 'Homme', 'Femme', 'Unisex', 'Наборы'],
    buildSet: 'Собрать набор',
  },
  uz: {
    add: 'Savatga',
    reason: 'Yana 2 ta tanlang',
    catalog: 'Katalogga',
    sheetTitle: 'Yetkazish shahri',
    sheetText: 'Viloyatni, keyin shahar yoki tumanni tanlang.',
    region: 'Toshkent',
    regionHint: '12 ta BTS punkti',
    attribution: 'Louis Vuitton asosida',
    notes: 'greypfrut · zanjabil · bergamot',
    emptyCart: 'Savat hozircha boʻsh',
    emptyCartText: 'Discovery set’dan boshlang: oʻzingiznikini topish uchun 10 ml’dan beshta ifor.',
    types: ['Hammasi', 'Homme', 'Femme', 'Unisex', 'Toʻplamlar'],
    buildSet: 'Toʻplam yigʻish',
  },
} as const;

const SWATCHES = [
  'ground',
  'card',
  'block',
  'field',
  'ink',
  'ink-muted',
  'ink-faint',
  'sage',
  'sage-ink',
  'sage-wash',
  'line',
  'line-strong',
  'btn',
  'bar',
  'totals',
  'photo',
  'on-sage',
  'photo-disc',
] as const;

const UZ_GLYPHS = 'Oʻ oʻ Gʻ gʻ · Toʻlov · Yorugʻ · Qorongʻi';

function Section({ name, children }: { name: string; children: ReactNode }) {
  return (
    <section className="border-t border-line pt-4 pb-8">
      <h2 className="type-small mb-4 font-semibold text-muted">{name}</h2>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

function Specimen({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] leading-none text-muted">{label}</span>
      {children}
    </div>
  );
}

export function Gallery({ sheetOpen = false }: { sheetOpen?: boolean }) {
  const { t, language, theme, setLanguage, setTheme } = usePrefs();
  const d = demo[language];
  const [sheet, setSheet] = useState(sheetOpen);
  const [type, setType] = useState('0');
  const [busy, setBusy] = useState(false);

  return (
    <Screen>
      <div data-gallery="" className="contents">
        <ScreenHeader
          title="UI"
          trailing={
            <Button variant="secondary" size="sm" onClick={() => setSheet(true)}>
              Sheet
            </Button>
          }
        />

        <Section name="Colour roles (tokens.css)">
          <div className="grid grid-cols-4 gap-2">
            {SWATCHES.map((s) => (
              <div key={s} className="flex flex-col gap-1">
                <span
                  className="h-10 rounded-btn inset-line"
                  style={{ background: `var(--c-${s})` }}
                />
                <span className="truncate text-[10.5px] text-muted">{s}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section name="Type roles">
          <Specimen label="type-title · Tenor 22 / +0.2em">
            <p className="type-title">{t.tabs.catalog}</p>
          </Specimen>
          <Specimen label="type-section · Tenor 13">
            <p className="type-section">{t.home.slogan}</p>
          </Specimen>
          <Specimen label="type-label · Tenor 10.5, Muted · then type-name · Cormorant Italic 20">
            <div>
              <p className="type-label text-muted">{d.attribution}</p>
              <p className="type-name">Symphony</p>
              <span className="my-2 block h-px w-[18px] bg-sage" />
              <p className="type-small text-muted">{d.notes}</p>
            </div>
          </Specimen>
          <Specimen label="type-name-lg · Cormorant Italic 24 (the fragrance card)">
            <p className="type-name-lg">Baccarat Rouge 540</p>
          </Specimen>
          <Specimen label="type-heading · Manrope 600 17">
            <p className="type-heading">{t.home.emptyTitle}</p>
          </Specimen>
          <Specimen label="type-body · Manrope 400 14 · type-small 12.5 Muted">
            <p className="type-body">{t.session.reopenText}</p>
            <p className="type-small text-muted">{t.errors.loadFailedText}</p>
          </Specimen>
          <Specimen label="type-caption 11 Muted · type-value 600 13 (characteristics row)">
            <div className="flex flex-col items-start">
              <span className="type-caption text-muted">{t.card.traits.longevity}</span>
              <span className="type-value">{t.card.season.autumn_winter}</span>
            </div>
          </Specimen>
          <Specimen label="Money · price 15 · small 12.5 (in a control) · amount 28 (tabular)">
            <div className="flex items-baseline justify-between gap-3">
              <Money amount={149000} />
              <Money amount={1250000} size="amount" />
            </div>
            <Money amount={69000} size="small" className="text-muted" />
          </Specimen>
          <Specimen label="Uzbek Latin oʻ gʻ (U+02BB) in every face">
            <div className="flex flex-col gap-1">
              <p className="type-section">{UZ_GLYPHS}</p>
              <p className="type-body font-normal">{UZ_GLYPHS}</p>
              <p className="type-body font-medium">{UZ_GLYPHS}</p>
              <p className="type-body font-semibold">{UZ_GLYPHS}</p>
              <p className="type-name">{UZ_GLYPHS}</p>
            </div>
          </Specimen>
        </Section>

        <Section name="Button · primary">
          <div className="grid grid-cols-2 gap-2">
            <Specimen label="default">
              <Button block>{d.add}</Button>
            </Specimen>
            <Specimen label="pressed">
              <Button block data-pressed="">
                {d.add}
              </Button>
            </Specimen>
            <Specimen label="disabled (reason as label)">
              <Button block disabled>
                {d.reason}
              </Button>
            </Specimen>
            <Specimen label="loading">
              <Button block loading>
                {d.add}
              </Button>
            </Specimen>
          </div>
          <Specimen label="small · block, tap to try loading">
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm">{d.add}</Button>
              <Button size="sm" loading>
                {d.add}
              </Button>
              <Button size="sm" disabled>
                {d.reason}
              </Button>
            </div>
            <Button
              block
              loading={busy}
              onClick={() => {
                setBusy(true);
                setTimeout(() => setBusy(false), 1600);
              }}
            >
              {t.common.retry}
            </Button>
          </Specimen>
        </Section>

        <Section name="Button · secondary">
          <div className="grid grid-cols-2 gap-2">
            <Specimen label="default">
              <Button block variant="secondary">
                {d.catalog}
              </Button>
            </Specimen>
            <Specimen label="pressed">
              <Button block variant="secondary" data-pressed="">
                {d.catalog}
              </Button>
            </Specimen>
            <Specimen label="disabled">
              <Button block variant="secondary" disabled>
                {d.reason}
              </Button>
            </Specimen>
            <Specimen label="loading">
              <Button block variant="secondary" loading>
                {d.catalog}
              </Button>
            </Specimen>
          </div>
        </Section>

        <Section name="Button · tonal · size pair (a dock row of two)">
          <div className="flex gap-2">
            <Button size="pair" className="min-w-0 flex-1">
              {t.card.toCart}
            </Button>
            <Button variant="tonal" size="pair" className="shrink-0">
              {t.card.buyNow}
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Specimen label="pressed">
              <Button block variant="tonal" data-pressed="">
                {t.card.buyNow}
              </Button>
            </Specimen>
            <Specimen label="disabled">
              <Button block variant="tonal" disabled>
                {t.card.buyNow}
              </Button>
            </Specimen>
            <Specimen label="loading">
              <Button block variant="tonal" loading>
                {t.card.buyNow}
              </Button>
            </Specimen>
          </div>
        </Section>

        <Section name="Badge (at most one flag per card; a hit outranks a novelty)">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="hit">{t.card.hit}</Badge>
            <Badge tone="new">{t.card.isNew}</Badge>
            <Badge tone="discount">−20%</Badge>
            <FragranceBadge isHit isNew />
            <span className="rounded-btn bg-card p-2">
              <Badge tone="new">{t.card.isNew}</Badge>
            </span>
            <span className="rounded-btn bg-btn p-2">
              <Badge tone="hit">{t.card.hit}</Badge>
            </span>
          </div>
        </Section>

        <Section name="TypeChips · Chip (in-page filters)">
          <Specimen label="TypeChips · one choice, scrolls under the gutters (live)">
            <TypeChips
              label="type"
              value={type}
              onChange={setType}
              options={d.types.map((label, i) => ({
                value: String(i),
                label,
                thumb: [thumbA, thumbB, thumbC, thumbA, thumbB][i],
              }))}
            />
          </Specimen>
          <Specimen label="Chip · inactive · active · pressed · no thumbnail">
            <div className="flex flex-wrap gap-2">
              <Chip label={d.types[1]} thumb={thumbB} />
              <Chip label={d.types[0]} thumb={thumbA} selected />
              <Chip label={d.types[2]} thumb={thumbC} pressed />
              <Chip label={d.types[3]} />
            </div>
          </Specimen>
        </Section>

        <Section name="Segmented (settings only)">
          <Specimen label="the Profile switches (live)">
            <div className="flex flex-wrap gap-2">
              <Segmented
                label={t.profile.language}
                value={language}
                onChange={setLanguage}
                options={[
                  { value: 'ru', label: 'RU' },
                  { value: 'uz', label: 'UZ' },
                ]}
              />
              <Segmented
                label={t.profile.theme}
                value={theme}
                onChange={setTheme}
                options={[
                  { value: 'light', label: t.profile.themeLight },
                  { value: 'dark', label: t.profile.themeDark },
                ]}
              />
            </div>
          </Specimen>
        </Section>

        <Section name="Card · CardList · ListRow">
          <CardList>
            <ListRow label={t.profile.language} trailing="RU" />
            <ListRow
              leading={<GlobeIcon size={20} />}
              label={d.region}
              hint={d.regionHint}
              trailing={<ChevronIcon size={20} />}
              onClick={() => setSheet(true)}
            />
            <ListRow
              leading={<ContrastIcon size={20} />}
              label={`${d.region} · pressed`}
              trailing={<ChevronIcon size={20} />}
              onClick={() => undefined}
              pressed
            />
            <ListRow label={d.add} trailing={<Money amount={99000} className="text-ink" />} />
          </CardList>
          <Card className="p-4">
            <p className="type-body">{t.home.emptyText}</p>
          </Card>
        </Section>

        <Section name="FragranceListCard · grid / row / compact (catalog, search results, suggestions)">
          <div className="grid grid-cols-2 gap-2">
            <FragranceListCard layout="grid" item={LIST_ITEMS.normal} />
            <FragranceListCard layout="grid" item={LIST_ITEMS.worst} />
          </div>
          <div className="mt-3 flex flex-col gap-2">
            <FragranceListCard item={LIST_ITEMS.normal} />
            <FragranceListCard item={LIST_ITEMS.worst} />
            <FragranceListCard item={LIST_ITEMS.soldOut} />
          </div>
          <div className="mt-3 flex flex-col divide-y divide-line">
            <FragranceListCard compact item={LIST_ITEMS.normal} />
            <FragranceListCard compact item={LIST_ITEMS.worst} />
          </div>
        </Section>

        <Section name="Skeleton (loading)">
          <CardList>
            {[0, 1].map((i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <Skeleton className="size-12 shrink-0" rounded="thumb" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-2/3" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              </div>
            ))}
          </CardList>
          <div className="grid grid-cols-2 gap-2">
            {[0, 1].map((i) => (
              <Card key={i} className="p-2 pb-3">
                <Skeleton className="aspect-[3/4] w-full" rounded="photo" />
                <Skeleton className="mt-3 h-2.5 w-1/2" />
                <Skeleton className="mt-2 h-4 w-3/4" />
                <Skeleton className="mt-3 h-3.5 w-2/5" />
              </Card>
            ))}
          </div>
        </Section>

        <Section name="EmptyState · ErrorState">
          <Card>
            <EmptyState
              icon={<BagIcon size={28} />}
              title={d.emptyCart}
              text={d.emptyCartText}
              action={
                <>
                  <Button block>{d.catalog}</Button>
                  <Button block variant="secondary">
                    {d.buildSet}
                  </Button>
                </>
              }
            />
          </Card>
          <Card>
            <ErrorState onRetry={() => undefined} />
          </Card>
          <Card>
            <ErrorState onRetry={() => undefined} retrying />
          </Card>
        </Section>

        <Section name="TabBar · in flow, with cart counts">
          <TabBar floating={false} badges={{ cart: 3 }} />
          <TabBar floating={false} badges={{ cart: 12, orders: 1 }} />
        </Section>

        <Section name="Logo · monogram · icons (24 grid, 1.5 stroke)">
          <div className="flex items-center justify-between rounded-card bg-block p-4">
            <Logo height={24} />
            <span className="grid size-10 place-items-center rounded-pill bg-ground">
              <Monogram size={22} />
            </span>
          </div>
          <div className="flex flex-wrap gap-4 text-ink">
            {[
              HomeIcon,
              GridIcon,
              BagIcon,
              BoxIcon,
              UserIcon,
              GlobeIcon,
              ContrastIcon,
              ChevronIcon,
              CloseIcon,
              AlertIcon,
              SearchIcon,
              BottleIcon,
            ].map((Icon, i) => (
              <Icon key={i} />
            ))}
            <Spinner size={24} />
          </div>
        </Section>
      </div>

      <Sheet
        open={sheet}
        onOpenChange={setSheet}
        title={d.sheetTitle}
        description={d.sheetText}
        closeLabel={t.common.close}
      >
        <CardList>
          {[d.region, 'Samarqand', 'Buxoro', 'Andijon'].map((r) => (
            <ListRow
              key={r}
              label={r}
              trailing={<ChevronIcon size={20} />}
              onClick={() => setSheet(false)}
            />
          ))}
        </CardList>
        <Button block className="mt-4" onClick={() => setSheet(false)}>
          {t.common.close}
        </Button>
      </Sheet>
    </Screen>
  );
}

/** `/dev/sheet`: the gallery with the sheet already open, for the screenshot run. */
export const GallerySheetOpen = () => <Gallery sheetOpen />;
