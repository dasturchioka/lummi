/**
 * DEV ONLY: fragrance cards for `/dev/fragrance?data=…`, shaped exactly like the API's answer.
 * `worst` is the realistic worst case (long name and brand, no family, every volume on sale, a
 * seven-digit price, a sold-out volume, a missing photo, an empty pyramid level), kept as the
 * regression fixture for the card. Photo hashes are the seed's (`npm run seed:catalog`).
 */
import type { Bilingual, FragranceCard } from '@lummi/contracts';

const PHOTO = { 10: '32c0930f6c672207', 30: 'e72fb0b319a12df8', 50: '0583e3c60c88b024' } as const;
/** 23:59:59 Tashkent on 2 December: «до 2 декабря» / «2-dekabrgacha». */
const SALE_ENDS = '2026-12-02T18:59:59.000Z';
const note = (ru: string, uz: string): Bilingual => ({ ru, uz });

const demo: FragranceCard = {
  slug: 'baccarat-rouge-540',
  name: 'Baccarat Rouge 540',
  brand: 'Maison Francis Kurkdjian',
  type: 'unisex',
  family: { ru: 'Амброво-древесный', uz: 'Ambrali yogʻochli' },
  season: 'all_year',
  timeOfDay: 'day_evening',
  sillage: 'strong',
  longevity: { ru: 'до 24 часов', uz: '24 soatgacha' },
  description: {
    ru: 'Шафран и жасмин с амбровым деревом и кедром. Воздушный, сладко-минеральный, с шлейфом, который замечают.',
    uz: 'Za’faron va yasmin, ambra daraxti va kedr bilan. Yengil, shirin-mineral, sezilarli iz qoldiradi.',
  },
  whenToWear: {
    ru: 'круглый год, день и вечер. Для вечерних выходов и особых случаев.',
    uz: 'yil boʻyi, kunduzi va kechqurun. Kechki chiqishlar va maxsus kunlar uchun.',
  },
  keyNotes: {
    ru: ['шафран', 'амбровое дерево', 'кедр'],
    uz: ['za’faron', 'ambra daraxti', 'kedr'],
  },
  notes: {
    top: [note('шафран', 'za’faron'), note('жасмин', 'yasmin')],
    heart: [note('амбровое дерево', 'ambra daraxti'), note('серая амбра', 'kulrang ambra')],
    base: [note('смола пихты', 'archa smolasi'), note('кедр', 'kedr')],
  },
  uzumUrl: null,
  isHit: true,
  isNew: false,
  volumes: [
    {
      ml: 10,
      price: 69_000,
      salePrice: null,
      salePercent: null,
      saleEndsAt: null,
      effectivePrice: 69_000,
      available: 20,
      photo: PHOTO[10],
    },
    {
      ml: 30,
      price: 149_000,
      salePrice: null,
      salePercent: null,
      saleEndsAt: null,
      effectivePrice: 149_000,
      available: 20,
      photo: PHOTO[30],
    },
    {
      ml: 50,
      price: 219_000,
      salePrice: null,
      salePercent: null,
      saleEndsAt: null,
      effectivePrice: 219_000,
      available: 20,
      photo: PHOTO[50],
    },
  ],
  upgradeRightPrices: [],
  fullSizeMl: [30, 50],
  // as the server's `stepUps` gives them for these prices (#57)
  stepUps: [
    { fromMl: 10, toMl: 30, saving: 58_000 },
    { fromMl: 30, toMl: 50, saving: 29_000 },
  ],
  showStockCount: true,
};

const worst: FragranceCard = {
  slug: 'baccarat-rouge-540-extrait-de-parfum',
  name: 'Baccarat Rouge 540 Extrait de Parfum',
  brand: 'Maison Francis Kurkdjian Paris',
  type: 'unisex',
  family: null,
  season: 'spring_autumn',
  timeOfDay: 'day_evening',
  sillage: 'noticeable',
  longevity: { ru: 'до 24 часов', uz: '24 soatgacha' },
  description: {
    ru: 'Горький миндаль и шафран раскрываются на облаке жасмина, а за ними тянется тёплый шлейф амбры, кедра и мускуса. Аромат, который замечают издалека и о котором спрашивают ещё долго после того, как вы ушли.',
    uz: 'Achchiq bodom va za’faron yasmin bulutida ochiladi, ortidan ambra, kedr va mushkning iliq izi ergashadi. Uzoqdan sezilib turadigan va siz ketganingizdan keyin ham uzoq soʻraladigan ifor.',
  },
  whenToWear: {
    ru: 'весна–осень, день и вечер. Для свиданий, торжеств и вечеров, когда хочется, чтобы вас запомнили.',
    uz: 'bahor–kuz, kunduzi va kechqurun. Uchrashuvlar, tantanalar va esda qolishni istagan oqshomlar uchun.',
  },
  keyNotes: {
    ru: ['горький миндаль', 'чёрная смородина', 'розовый перец'],
    uz: ['achchiq bodom', 'qora smorodina', 'pushti qalampir'],
  },
  notes: {
    top: [
      note('горький миндаль', 'achchiq bodom'),
      note('шафран', 'za’faron'),
      note('розовый перец', 'pushti qalampir'),
      note('бергамот', 'bergamot'),
      note('чёрная смородина', 'qora smorodina'),
      note('мандарин', 'mandarin'),
    ],
    heart: [],
    base: [
      note('амброксан', 'ambroksan'),
      note('кашмировое дерево', 'kashmir daraxti'),
      note('кедр', 'kedr'),
      note('ветивер', 'vetiver'),
      note('пачули', 'pachuli'),
      note('бензоин', 'benzoin'),
      note('ваниль', 'vanil'),
      note('белый мускус', 'oq mushk'),
    ],
  },
  uzumUrl: 'https://uzum.uz/ru/shop/lummi',
  isHit: false,
  isNew: true,
  volumes: [
    {
      ml: 10,
      price: 89_000,
      salePrice: 71_200,
      salePercent: 20,
      saleEndsAt: SALE_ENDS,
      effectivePrice: 71_200,
      available: 0,
      photo: PHOTO[10],
    },
    {
      ml: 30,
      price: 489_000,
      salePrice: 391_200,
      salePercent: 20,
      saleEndsAt: SALE_ENDS,
      effectivePrice: 391_200,
      available: 3,
      photo: null,
    },
    {
      ml: 50,
      price: 1_290_000,
      salePrice: 1_032_000,
      salePercent: 20,
      saleEndsAt: null,
      effectivePrice: 1_032_000,
      available: 1,
      photo: PHOTO[50],
    },
  ],
  upgradeRightPrices: [],
  fullSizeMl: [30, 50],
  // 30 -> 50 ml costs more per ml than 30 ml itself: no step-up
  stepUps: [],
  showStockCount: true,
};

/** A fragrance sold in one volume only (the others "simply absent"), all notes on one level. */
const one: FragranceCard = {
  ...demo,
  slug: 'one-volume',
  isHit: false,
  notes: { top: [], heart: [], base: demo.notes.base },
  volumes: demo.volumes.filter((v) => v.ml === 50),
  stepUps: [],
  showStockCount: true,
};

/** Nothing optional: no volumes yet, no notes, no family, no key notes. */
const empty: FragranceCard = {
  ...demo,
  slug: 'empty',
  isHit: false,
  family: null,
  keyNotes: { ru: [], uz: [] },
  notes: { top: [], heart: [], base: [] },
  volumes: [],
  stepUps: [],
  showStockCount: true,
};

export const FIXTURES = { demo, worst, one, empty } as const;
export type FixtureName = keyof typeof FIXTURES;
