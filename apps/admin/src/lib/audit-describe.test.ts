import type { AuditEntryDto } from '@lummi/contracts';
import { adminMessages } from '@lummi/i18n/admin';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DESCRIBED_ACTIONS, describeAudit, humanise } from './audit-describe';

const entry = (
  action: string,
  payload: Record<string, unknown> = {},
  over: Partial<AuditEntryDto> = {},
): AuditEntryDto => ({
  id: 1,
  createdAt: '2026-11-17T10:00:00.000Z',
  actorType: 'staff',
  actorId: 1,
  actorName: 'Aziza',
  action,
  targetType: 'x',
  targetId: '2',
  targetName: null,
  targetNameUz: null,
  payload,
  ...over,
});

/**
 * The actions the API source writes, found where it writes them: `action: …` (a literal or a
 * ternary pair), `audit: '…'` in the order-status effects, and the dictionary template
 * `catalog.${target}_created|updated`. A new action there without a describer fails this test.
 */
function apiActions(): string[] {
  const root = fileURLToPath(new URL('../../../api/src', import.meta.url));
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = `${dir}/${name}`;
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.ts$/.test(name) && !/\.(spec|test)\.ts$/.test(name)) files.push(path);
    }
  };
  walk(root);
  const found = new Set<string>();
  const code = /'([a-z_]+(?:\.[a-z_]+)+)'/g;
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/\baction: ([^\n]*)/g))
      for (const c of m[1]!.matchAll(code)) found.add(c[1]!);
    for (const m of text.matchAll(/\baudit: '([a-z_.]+)'/g)) found.add(m[1]!);
    if (text.includes('action: `catalog.${target}_'))
      for (const k of ['family', 'note'])
        for (const v of ['created', 'updated']) found.add(`catalog.${k}_${v}`);
  }
  return [...found].sort();
}

const ru = adminMessages.ru.admin;
const uz = adminMessages.uz.admin;
/** Money and dates join with no-break spaces; the table writes plain ones. */
const flat = (s: string) => s.replace(/[\u00a0\u202f]/g, ' ');
const say = (e: AuditEntryDto, l: 'ru' | 'uz' = 'ru') =>
  describeAudit(l === 'ru' ? ru : uz, l, e).map(flat);

/** [action, payload, target overrides, RU lines, UZ lines]. */
const table: [string, Record<string, unknown>, Partial<AuditEntryDto>, string[], string[]][] = [
  ['setting.changed', { old: 1, new: 2 }, {}, [], []],
  ['shop_card.changed', { old: null, new: { number: '9860', holder: 'A' } }, {}, [], []],
  ['shop_card.cleared', { old: null }, {}, [], []],
  [
    'staff.created',
    { name: 'Aziza', login: 'aziza', role: 'manager' },
    {},
    ['Aziza, логин aziza, роль менеджер'],
    ['Aziza, login aziza, roli menejer'],
  ],
  [
    'staff.created',
    { name: 'Jasur', login: 'jasur', role: 'owner' },
    {},
    ['Jasur, логин jasur, роль владелец'],
    ['Jasur, login jasur, roli egasi'],
  ],
  [
    'staff.role_changed',
    { name: 'Aziza', login: 'aziza', from: 'manager', to: 'owner' },
    {},
    ['Aziza: Менеджер → Владелец'],
    ['Aziza: Menejer → Egasi'],
  ],
  [
    'staff.removed',
    { name: 'Aziza', login: 'aziza' },
    {},
    ['Aziza, логин aziza'],
    ['Aziza, login aziza'],
  ],
  ['staff.activated', { name: 'Aziza' }, {}, ['Aziza'], ['Aziza']],
  ['staff.deactivated', { name: 'Aziza' }, {}, ['Aziza'], ['Aziza']],
  ['staff.owner_seeded', { name: 'Fayzali' }, {}, ['Fayzali'], ['Fayzali']],
  ['staff.owner_updated', { name: 'Fayzali' }, {}, ['Fayzali'], ['Fayzali']],
  [
    'staff.password_reset',
    { name: 'Aziza', login: 'a' },
    {},
    ['Временный пароль для Aziza'],
    ['Aziza uchun vaqtinchalik parol'],
  ],
  [
    'staff.password_changed',
    { forced: true },
    {},
    ['Пароль заменён после временного'],
    ['Vaqtinchalik paroldan keyin parol almashtirildi'],
  ],
  [
    'staff.telegram_linked',
    { name: 'Aziza', telegramId: 5 },
    {},
    ['Aziza, Telegram 5'],
    ['Aziza, Telegram 5'],
  ],
  [
    'staff.telegram_unlinked',
    { name: 'Aziza', telegramId: 5 },
    {},
    ['Aziza, Telegram 5'],
    ['Aziza, Telegram 5'],
  ],
  [
    'staff.locked',
    { until: '2026-11-17T10:30:00.000Z', by: 'login' },
    {},
    ['Закрыто до 17.11.2026 15:30'],
    ['17.11.2026 15:30 gacha yopilgan'],
  ],
  [
    'auth.address_locked',
    { until: '2026-11-17T10:30:00.000Z' },
    { targetId: '1.2.3.4' },
    ['Адрес 1.2.3.4, закрыто до 17.11.2026 15:30'],
    ['Manzil 1.2.3.4, 17.11.2026 15:30 gacha yopilgan'],
  ],
  ['staff.signed_in', { method: 'telegram' }, {}, ['Через Telegram'], ['Telegram orqali']],
  ['customer.created', {}, {}, [], []],
  ['customer.phone_set', { previous: false }, {}, ['Номер указан'], ['Raqam kiritildi']],
  [
    'customer.relinked',
    { mergedCustomerId: 9 },
    {},
    ['Новый аккаунт 9 объединён с этим'],
    ['Yangi akkaunt 9 shu akkaunt bilan birlashtirildi'],
  ],
  [
    'customer.photo_changed',
    { photo: [null, 'ab'], source: 'telegram' },
    {},
    ['Взято фото из Telegram'],
    ['Telegram rasmi olindi'],
  ],
  [
    'staff.photo_changed',
    { photo: ['ab', null], source: 'removed' },
    {},
    ['Фото убрано'],
    ['Rasm olib tashlandi'],
  ],
  [
    'customer.preferences_changed',
    { from: { language: 'ru', theme: 'light' }, to: { language: 'uz', theme: 'light' } },
    {},
    ['Язык: русский → узбекский'],
    ['Til: rus tili → oʻzbek tili'],
  ],
  [
    'customer.delivery_city_changed',
    { from: null, to: { regionId: 1, city: 'Самарканд' } },
    {},
    ['Город доставки: — → Самарканд'],
    ['Yetkazish shahri: — → Самарканд'],
  ],
  ['customer.write_access_granted', {}, {}, [], []],
  ['customer.write_access_refused', {}, {}, [], []],
  ['customer.data_consent_given', { order: 12 }, {}, ['При заказе № 12'], ['№ 12 buyurtmada']],
  ['customer.birth_date_set', { via: 'profile', set: true }, {}, ['В профиле'], ['Profilda']],
  [
    'customer.birth_date_corrected',
    { changed: true },
    {},
    ['Дата рождения исправлена'],
    ['Tugʻilgan sana tuzatildi'],
  ],
  [
    'order.created',
    { number: 12, total: 100000, status: 'awaiting_payment' },
    {},
    ['Заказ № 12 на 100 000 сум'],
    ['№ 12 buyurtma, 100 000 soʻm'],
  ],
  [
    'order.refunded',
    {
      number: 12,
      amount: 50000,
      date: '2026-11-15',
      reason: 'брак',
      paid: 100000,
      refundedBefore: 0,
    },
    {},
    [
      'Заказ № 12: возврат 50 000 сум, перевод 15 ноября',
      'Комментарий: брак',
      'Оплачено 100 000 сум, уже возвращено 0 сум',
    ],
    [],
  ],
  ['review.published', { orderId: 3, rating: 5 }, {}, ['Оценка 5 из 5'], ['Baho 5 / 5']],
  ['review.hidden', { orderId: 3, rating: 2 }, {}, ['Оценка 2 из 5'], ['Baho 2 / 5']],
  [
    'credit.marked_not_for_order',
    {
      amountTiyin: 5000000,
      occurredAt: '2026-11-17T10:00:00.000Z',
      cardLast4: '1234',
      note: 'друг',
    },
    {},
    ['Поступление 50 000 сум от 17.11.2026 15:00, карта ••1234', 'Комментарий: друг'],
    [],
  ],
  [
    'credit.unmarked_not_for_order',
    {
      amountTiyin: 5000000,
      occurredAt: '2026-11-17T10:00:00.000Z',
      cardLast4: '1234',
      note: null,
      markedBy: 1,
      markedAt: '2026-11-17T10:00:00.000Z',
    },
    {},
    ['Поступление 50 000 сум от 17.11.2026 15:00, карта ••1234'],
    [],
  ],
  [
    'bts_point.created',
    { code: 'a', city: 'Самарканд', name: 'Центр', address: 'ул. 1' },
    {},
    ['Самарканд, Центр', 'ул. 1'],
    [],
  ],
  [
    'bts_point.updated',
    { code: 'a', changed: { hours: { from: '9', to: '10' } } },
    {},
    ['Пункт a', 'Часы работы: 9 → 10'],
    [],
  ],
  ['bts_point.shown', { code: 'a' }, {}, ['Пункт a'], ['a punkti']],
  ['bts_point.hidden', { code: 'a' }, {}, ['Пункт a'], ['a punkti']],
  [
    'bts_points.imported',
    { source: 's', fetchedAt: 'x', refresh: true, inserted: 3, updated: 1, unchanged: 5 },
    {},
    ['Добавлено 3, обновлено 1, без изменений 5'],
    [],
  ],
  [
    'region.tariff_changed',
    { code: 'sam', old: 20000, new: 25000 },
    {},
    ['Регион sam: 20 000 сум → 25 000 сум'],
    [],
  ],
  [
    'catalog.fragrance_created',
    { name: 'Tygar', slug: 't', code: 'x', hidden: true },
    {},
    ['Tygar', 'создан скрытым'],
    [],
  ],
  [
    'catalog.fragrance_created',
    { name: 'Tygar', slug: 't', code: 'x', hidden: false, concentrateMl: 250.5 },
    {},
    ['Tygar', 'Готовая концентрация: 250,5 мл'],
    ['Tygar', 'Tayyor konsentrat: 250,5 ml'],
  ],
  [
    'catalog.fragrance_updated',
    { name: 'Tygar', changed: ['descriptionRu'], volumes: [{ ml: 30, price: [1, 2] }] },
    {},
    ['Tygar', 'Изменено: описание (RU)', '30 мл: цена: 1 → 2'],
    [],
  ],
  ['catalog.fragrance_hidden', { name: 'Tygar' }, {}, ['Tygar'], ['Tygar']],
  ['catalog.fragrance_unhidden', { name: 'Tygar' }, {}, ['Tygar'], ['Tygar']],
  [
    'catalog.on_hand_changed',
    { fragrance: 'Tygar', ml: 30, onHand: [5, 3] },
    {},
    ['Tygar, 30 мл: остаток 5 → 3'],
    ['Tygar, 30 ml: qoldiq 5 → 3'],
  ],
  [
    'catalog.on_hand_changed',
    { fragrance: 'Tygar', ml: 30, onHand: [5, 3], reason: 'Разбился флакон' },
    {},
    ['Tygar, 30 мл: остаток 5 → 3', 'Причина: Разбился флакон'],
    [],
  ],
  [
    'catalog.shown_count_changed',
    { name: 'Tygar', shownCount: [null, 5] },
    {},
    ['Tygar: клиенту показывается — → 5 шт.'],
    ['Tygar: mijozga koʻrsatiladi — → 5 dona'],
  ],
  [
    'warehouse.oil_received',
    {
      fragrance: 'Tygar',
      supplier: 'Test Oils',
      invoice: 'INV-1',
      receivedOn: '2026-11-17',
      grams: 1500,
      pricePerGram: 4000,
      discountPercent: 9,
      importPercent: 3,
    },
    {},
    [
      'Tygar: приход масла 1 500 г, накладная INV-1, Test Oils',
      'Дата прихода: 17 ноября',
      'Цена 4 000 сум за 1 г, скидка 9 %, доставка 3 %',
    ],
    [],
  ],
  [
    'warehouse.oil_receipt_corrected',
    { fragrance: 'Tygar', invoice: 'INV-1', reason: 'Опечатка', grams: [100, 120] },
    {},
    ['Tygar: исправлен приход, накладная INV-1', 'Граммы: 100 → 120', 'Причина: Опечатка'],
    ['Tygar: kirim tuzatildi, yuk xati INV-1', 'Grammlar: 100 → 120', 'Sabab: Опечатка'],
  ],
  [
    'warehouse.oil_receipt_voided',
    { fragrance: 'Tygar', supplier: 'Test Oils', invoice: 'INV-1', grams: 100, reason: 'Дубль' },
    {},
    ['Tygar: отменён приход 100 г, накладная INV-1', 'Причина: Дубль'],
    [],
  ],
  [
    'warehouse.bottled',
    {
      fragrance: 'Tygar',
      lines: [
        { ml: 10, quantity: 4 },
        { ml: 50, quantity: 1 },
      ],
      oilGrams: 27.81,
      ethanolMl: 65,
      oilPercent: 30,
      oilDensity: 1,
      fillingLossPercent: 3,
    },
    {},
    ['Tygar: розлив 10 мл × 4, 50 мл × 1', 'Масла 27,81 г, спирта 65 мл'],
    ['Tygar: quyish 10 ml × 4, 50 ml × 1', '27,81 g moy, 65 ml spirt'],
  ],
  [
    'warehouse.mixed',
    {
      fragrance: 'Tygar',
      ml: 100,
      oilGrams: 30,
      ethanolMl: 70,
      oilPercent: 30,
      ethanolPercent: 70,
      oilDensity: 1,
    },
    {},
    ['Tygar: приготовлено 100 мл концентрата', 'Масла 30 г, спирта 70 мл'],
    ['Tygar: 100 ml konsentrat tayyorlandi', '30 g moy, 70 ml spirt'],
  ],
  [
    'warehouse.set_assembled',
    {
      vialMl: 10,
      quantity: 2,
      onHand: [3, 5],
      fragrances: ['Tygar', 'Symphony'],
      concentrateMl: 20.6,
      flacons: 10,
    },
    {},
    [
      'Discovery set 5 × 10 мл: собрано 2 шт., было 3, стало 5',
      'Концентрата по 20,6 мл у каждого: Tygar, Symphony; флаконов 10',
    ],
    [],
  ],
  [
    'warehouse.concentrate_corrected',
    { fragrance: 'Tygar', concentrateMl: [100, 95.5], reason: 'Пролили' },
    {},
    ['Tygar: концентрат 100 → 95,5 мл', 'Причина: Пролили'],
    ['Tygar: konsentrat 100 → 95,5 ml', 'Sabab: Пролили'],
  ],
  [
    'consumable.received',
    {
      nameRu: 'Флакон 10 мл',
      nameUz: 'Flakon 10 ml',
      unit: 'pcs',
      quantity: 200,
      onHand: [5, 205],
      note: 'Накладная 7',
    },
    {},
    ['Флакон 10 мл: приход 200 шт., было 5 шт., стало 205 шт.', 'Комментарий: Накладная 7'],
    ['Flakon 10 ml: kirim 200 dona, 5 dona edi, 205 dona boʻldi', 'Izoh: Накладная 7'],
  ],
  [
    'consumable.corrected',
    { nameRu: 'Спирт', nameUz: 'Spirt', unit: 'ml', onHand: [930, 900], reason: 'Пересчёт' },
    {},
    ['Спирт: пересчёт 930 мл → 900 мл', 'Причина: Пересчёт'],
    ['Spirt: qayta sanoq 930 ml → 900 ml', 'Sabab: Пересчёт'],
  ],
  [
    'consumable.updated',
    {
      nameRu: 'Коробка 10 мл',
      nameUz: 'Quti 10 ml',
      changes: { lowThreshold: [20, 50], archived: [false, true] },
    },
    {},
    ['Коробка 10 мл: мало при: 20 → 50; убран в архив'],
    ['Quti 10 ml: kam deb: 20 → 50; arxivga olindi'],
  ],
  [
    'consumable.created',
    { nameRu: 'Пакет', nameUz: 'Paket', unit: 'pcs', use: 'other', ml: null, lowThreshold: 10 },
    {},
    ['Новый расходник: Пакет'],
    ['Yangi sarf materiali: Paket'],
  ],
  [
    'warehouse.oil_received',
    {
      fragrance: 'Tygar',
      supplier: 'Test Oils',
      invoice: 'INV-2',
      receivedOn: '2026-11-18',
      grams: 980,
      pricePerGram: 3950,
      discountPercent: 9,
      importPercent: 3,
      fromDraft: true,
    },
    {},
    [
      'Подтверждён черновик из плана закупки',
      'Tygar: приход масла 980 г, накладная INV-2, Test Oils',
      'Дата прихода: 18 ноября',
      'Цена 3 950 сум за 1 г, скидка 9 %, доставка 3 %',
    ],
    [],
  ],
  [
    'warehouse.oil_receipt_drafts_created',
    { count: 2, grams: 3500, fragrances: ['Tygar', 'Ombre Leather'] },
    {},
    ['Черновики приходов по плану закупки: 2, всего 3 500 г', 'Tygar, Ombre Leather'],
    ['Xarid rejasi boʻyicha kirim qoralamalari: 2, jami 3 500 g', 'Tygar, Ombre Leather'],
  ],
  [
    'warehouse.oil_receipt_draft_discarded',
    { fragrance: 'Tygar', grams: 1000 },
    {},
    ['Tygar: удалён черновик прихода 1 000 г'],
    [],
  ],
  [
    'warehouse.exported',
    { fragrances: 67, moves: 12 },
    {},
    ['Ароматов в файле: 67, записей истории: 12'],
    [],
  ],
  [
    'catalog.photo_uploaded',
    { ml: 30, fragranceId: 1, photo: ['a', 'b'] },
    { targetName: 'Tygar' },
    ['Tygar', 'Фото для 30 мл'],
    [],
  ],
  [
    'catalog.family_created',
    { nameRu: 'Древесные', nameUz: 'Yogʻochli', aliases: [] },
    {},
    ['Древесные / Yogʻochli'],
    [],
  ],
  [
    'catalog.family_updated',
    { nameRu: 'Древесные', nameUz: 'Yogʻochli', aliases: [] },
    {},
    ['Древесные / Yogʻochli'],
    [],
  ],
  [
    'catalog.note_created',
    { nameRu: 'Ваниль', nameUz: 'Vanil', aliases: [] },
    {},
    ['Ваниль / Vanil'],
    [],
  ],
  [
    'catalog.note_updated',
    { nameRu: 'Ваниль', nameUz: 'Vanil', aliases: [] },
    {},
    ['Ваниль / Vanil'],
    [],
  ],
  [
    'catalog.import_applied',
    {
      counts: { fragrances: { new: 2, changed: 1 }, volumes: { new: 6, changed: 0 } },
      file: 'abc',
      belowReserve: [{}],
    },
    {},
    ['Ароматы: новых 2, изменено 1; объёмы: новых 6, изменено 0', 'Остаток ниже брони: 1'],
    [],
  ],
  ['orders.exported', { filters: {}, count: 40 }, {}, ['Строк в файле: 40'], []],
  [
    'sets.discovery_changed',
    {
      price: [100000, 120000],
      composition: [
        ['A', 'B'],
        ['A', 'C'],
      ],
    },
    {},
    ['Цена: 100 000 сум → 120 000 сум', 'Состав: добавлен C; убран B'],
    [],
  ],
  ['sets.discovery_on_hand_changed', { onHand: [4, 2] }, {}, ['Остаток: 4 → 2'], ['Qoldiq: 4 → 2']],
  [
    'sets.discovery_photo_uploaded',
    { photo: ['a', 'b'] },
    {},
    ['Фото заменено'],
    ['Rasm almashtirildi'],
  ],
  [
    'content.banner_created',
    { title: 'Новый год', target: 'catalog' },
    {},
    ['Баннер «Новый год»', 'Каталог'],
    [],
  ],
  [
    'content.banner_updated',
    { changed: { titleRu: ['A', 'B'] } },
    { targetName: 'B' },
    ['Баннер «B»', 'Заголовок (RU): A → B'],
    [],
  ],
  [
    'content.banner_activated',
    { switchedOff: [2] },
    {},
    ['Баннер 2 включён на Главной', 'Баннер 2 выключен'],
    ['2 banneri Bosh sahifada yoqildi', '2 banneri oʻchirildi'],
  ],
  [
    'content.banner_deactivated',
    { switchedOff: [] },
    { targetName: 'Зима' },
    ['Баннер «Зима» выключен'],
    [],
  ],
  // #62: the slider after the change, Discovery set as slide 1; a move names both places
  [
    'content.banner_activated',
    {
      title: 'Лето',
      slider: [
        { id: 5, title: 'Зима' },
        { id: 2, title: 'Лето' },
      ],
    },
    {},
    ['Баннер «Лето» включён · на Главной: слайд 3 из 3', 'Слайдер: Discovery set, «Зима», «Лето»'],
    [
      '«Лето» banneri yoqildi · Bosh sahifada: 3 tadan 3-slayd',
      'Slayder: Discovery set, «Зима», «Лето»',
    ],
  ],
  [
    'content.banner_deactivated',
    { title: 'Лето', slider: [{ id: 5, title: 'Зима' }] },
    {},
    ['Баннер «Лето» выключен', 'Слайдер: Discovery set, «Зима»'],
    ['«Лето» banneri oʻchirildi', 'Slayder: Discovery set, «Зима»'],
  ],
  [
    'content.banner_deactivated',
    { title: 'Лето', slider: [] },
    {},
    ['Баннер «Лето» выключен', 'Слайдер: Discovery set'],
    ['«Лето» banneri oʻchirildi', 'Slayder: Discovery set'],
  ],
  [
    'content.banner_moved',
    {
      title: 'Лето',
      direction: 'up',
      before: [
        { id: 5, title: 'Зима' },
        { id: 7, title: 'Осень' },
        { id: 2, title: 'Лето' },
      ],
      after: [
        { id: 5, title: 'Зима' },
        { id: 2, title: 'Лето' },
        { id: 7, title: 'Осень' },
      ],
    },
    {},
    ['Баннер «Лето» поднят: место 4 → 3', 'Слайдер: Discovery set, «Зима», «Лето», «Осень»'],
    [
      '«Лето» banneri yuqoriga surildi: 4-oʻrin → 3-oʻrin',
      'Slayder: Discovery set, «Зима», «Лето», «Осень»',
    ],
  ],
  [
    'content.banner_moved',
    {
      title: 'Лето',
      direction: 'down',
      before: [
        { id: 2, title: 'Лето' },
        { id: 5, title: 'Зима' },
      ],
      after: [
        { id: 5, title: 'Зима' },
        { id: 2, title: 'Лето' },
      ],
    },
    { targetName: 'Лето', targetNameUz: 'Yoz', targetType: 'promo_banner' },
    ['Баннер «Лето» опущен: место 2 → 3', 'Слайдер: Discovery set, «Зима», «Лето»'],
    ['«Yoz» banneri pastga surildi: 2-oʻrin → 3-oʻrin', 'Slayder: Discovery set, «Зима», «Лето»'],
  ],
  [
    'content.banner_deleted',
    { title: 'Зима', wasActive: true },
    {},
    ['Баннер «Зима»', 'Был включён на Главной'],
    [],
  ],
  ['content.banner_photo_uploaded', { photo: ['a', 'b'] }, {}, ['Фото заменено'], []],
  ['content.slogan_changed', { ru: ['a', 'b'], uz: ['c', 'c'] }, {}, ['Слоган (RU): a → b'], []],
  [
    'content.page_updated',
    { changed: ['bodyRu'], draft: [true, false] },
    {},
    ['Изменено: текст (RU)', 'Черновик: да → нет'],
    [],
  ],
  ['promo.created', { code: 'NEW10', percent: 10, amount: null }, {}, ['Код NEW10: 10 %'], []],
  [
    'promo.updated',
    { code: 'NEW10', changed: { percent: [10, 15] } },
    {},
    ['Код NEW10', 'Процент: 10 → 15'],
    [],
  ],
  [
    'promo.created',
    {
      code: 'RAINTEA',
      kind: 'gift',
      percent: null,
      amount: null,
      promoGift: { kind: 'volume', fragranceId: 7, ml: 10, name: 'Rain Tea', brand: 'Bvlgari' },
    },
    {},
    ['Код RAINTEA: подарок Rain Tea 10 мл'],
    ['Kod RAINTEA: sovgʻa Rain Tea 10 ml'],
  ],
  [
    'promo.updated',
    {
      code: 'RAINTEA',
      changed: {
        promoGift: [
          { kind: 'volume', fragranceId: 7, ml: 10, name: 'Rain Tea' },
          { kind: 'discovery_set' },
        ],
      },
    },
    {},
    ['Код RAINTEA', 'Подарок: Rain Tea 10 мл → Discovery set'],
    ['Kod RAINTEA', 'Sovgʻa: Rain Tea 10 ml → Discovery set'],
  ],
  ['promo.deleted', { code: 'NEW10' }, {}, ['Код NEW10'], ['Kod NEW10']],
  [
    'campaign_link.created',
    { code: 'insta', promoCode: 'NEW10', sourceLabel: 'Малика' },
    {},
    ['Ссылка insta', 'Малика', 'промокод NEW10'],
    [],
  ],
  [
    'campaign_link.updated',
    { code: 'insta', changed: { sourceLabel: ['a', 'b'] } },
    {},
    ['Ссылка insta', 'Название: a → b'],
    [],
  ],
  ['campaign_link.deleted', { code: 'insta' }, {}, ['Ссылка insta'], []],
  ['broadcast.test_sent', { audience: 'all', hasImage: false }, {}, ['Тестовая рассылка себе'], []],
  [
    'broadcast.sent',
    { audience: 'ru', audienceSize: 40, sender: 'Aziza', hasImage: true },
    {},
    ['Аудитория: клиенты на русском, с картинкой', 'Получателей: 40, отправил Aziza'],
    [],
  ],
  [
    'uzum.sale_recorded',
    {
      uzumOrder: 'UZ-1001',
      soldOn: '2026-11-18',
      lines: [
        { kind: 'volume', name: 'Rain Tea', ml: 10, qty: 2, price: 69_000 },
        { kind: 'discovery_set', name: null, ml: 10, qty: 1, price: 299_000 },
      ],
      revenue: 437_000,
      commissionPercent: 20.5,
      via: 'import',
      rows: [2, 3],
    },
    {},
    [
      'Заказ Uzum UZ-1001 от 18 ноября: Rain Tea 10 мл × 2, Discovery set 5 × 10 мл × 1',
      'Выручка 437 000 сум, комиссия Uzum 20,5 %',
      'Из файла Excel, строки 2, 3',
    ],
    [
      'Uzum buyurtmasi UZ-1001, 18-noyabr: Rain Tea 10 ml × 2, Discovery set 5 × 10 ml × 1',
      'Tushum 437 000 soʻm, Uzum komissiyasi 20,5 %',
      'Excel faylidan, qatorlar 2, 3',
    ],
  ],
  [
    'uzum.sale_voided',
    {
      uzumOrder: 'UZ-1001',
      soldOn: '2026-11-18',
      lines: [{ kind: 'volume', name: 'Rain Tea', ml: 30, qty: 1, price: 189_000 }],
      revenue: 189_000,
      commissionPercent: 20.5,
      reason: 'Возврат на Uzum',
    },
    {},
    [
      'Заказ Uzum UZ-1001 от 18 ноября: Rain Tea 30 мл × 1',
      'Выручка 189 000 сум, комиссия Uzum 20,5 %',
      'Причина: Возврат на Uzum',
    ],
    [],
  ],
];

const move = (_action: string, payload: Record<string, unknown>) => ({
  number: 12,
  from: 'accepted',
  to: 'assembling',
  ...payload,
});

describe('audit details read as text (#63)', () => {
  it.each(table)('%s', (action, payload, over, ruLines, uzLines) => {
    const e = entry(action, payload, over);
    expect(say(e, 'ru')).toEqual(ruLines.map(flat));
    if (uzLines.length || ruLines.length === 0) expect(say(e, 'uz')).toEqual(uzLines.map(flat));
    for (const line of say(e, 'uz')) expect(line).not.toMatch(/[{}[\]"]/);
  });

  it('names every warehouse and consumable action and their targets in both languages (#82)', () => {
    const actions = apiActions().filter(
      (a) => a.startsWith('consumable.') || a.startsWith('warehouse.'),
    );
    expect(actions).toEqual(
      expect.arrayContaining([
        'warehouse.mixed',
        'warehouse.set_assembled',
        'warehouse.concentrate_corrected',
        'consumable.created',
        'consumable.updated',
        'consumable.received',
        'consumable.corrected',
      ]),
    );
    for (const lang of [ru, uz]) {
      for (const a of actions) expect(lang.audit.actions, a).toHaveProperty([a]);
      expect(lang.audit.targets).toHaveProperty(['consumable']);
    }
  });

  it('names every Uzum sale action and its target in both languages (#80)', () => {
    const actions = apiActions().filter((a) => a.startsWith('uzum.'));
    expect(actions).toEqual(expect.arrayContaining(['uzum.sale_recorded', 'uzum.sale_voided']));
    for (const lang of [ru, uz]) {
      for (const a of actions) expect(lang.audit.actions, a).toHaveProperty([a]);
      expect(lang.audit.targets).toHaveProperty(['uzum_sale']);
    }
  });

  it('names every warehouse action and target in both languages (#76)', () => {
    const actions = apiActions().filter((a) => a.startsWith('warehouse.'));
    expect(actions.length).toBeGreaterThanOrEqual(7);
    for (const lang of [ru, uz]) {
      for (const a of actions) expect(lang.audit.actions, a).toHaveProperty([a]);
      for (const target of ['oil_receipt', 'warehouse'])
        expect(lang.audit.targets, target).toHaveProperty([target]);
    }
  });

  it('every action the API writes has a describer (read from the API source)', () => {
    expect(apiActions().length).toBeGreaterThan(55);
    for (const a of apiActions()) expect(DESCRIBED_ACTIONS, a).toContain(a);
  });

  it('an order move names both statuses and what came with it', () => {
    const lines = say(
      entry('order.cancelled', move('x', { to: 'cancelled', reason: 'out_of_stock', note: 'нет' })),
    );
    expect(lines[0]).toMatch(/^Заказ № 12: .+ → .+$/);
    expect(lines).toContain('Причина: Нет в наличии');
    expect(lines).toContain('Комментарий: нет');
    const hand = say(entry('order.handed_to_bts', move('x', { trackingNumber: 'BTS123456' })));
    expect(hand).toContain('Трек-номер: BTS123456');
    const paid = say(
      entry(
        'order.payment_confirmed',
        move('x', {
          creditAmountTiyin: 10000000,
          differenceTiyin: 500000,
          cardLast4: '4242',
          offShopCard: true,
          receiptId: 3,
          creditId: 4,
          amountDue: 95000,
        }),
      ),
    );
    expect(paid.slice(1).map(flat)).toEqual([
      'Поступление 100 000 сум, карта ••4242',
      'Разница с суммой заказа: 5 000 сум',
      'Пришло не на карту магазина',
    ]);
  });

  it('the legacy banner payload and a new one with titles both read', () => {
    expect(
      say(
        entry(
          'content.banner_activated',
          { switchedOff: [{ id: 3, title: 'Зима' }] },
          { targetName: 'Лето' },
        ),
      ),
    ).toEqual(['Баннер «Лето» включён на Главной', 'Баннер «Зима» выключен']);
  });

  it('an unknown key is a labelled line, never braces; a named key reads in the panel language', () => {
    expect(
      say(
        entry('catalog.fragrance_hidden', {
          name: 'Tygar',
          someKey: 3,
          nested: { a: 1, b: [1, 2] },
          flag: true,
          belowReserve: 3,
        }),
      ),
    ).toEqual(['Tygar', 'Some key: 3', 'Nested: a 1, b 1, 2', 'Flag: да', 'Остаток ниже брони: 3']);
    expect(say(entry('future.thing', { someKey: 'x' }, {}), 'uz')).toEqual(['Some key: x']);
    expect(humanise('belowReserve')).toBe('Below reserve');
  });

  it('a credit in tiyin and a negative difference read exactly, never throw', () => {
    const lines = say(
      entry('order.payment_confirmed', {
        number: 12,
        from: 'receipt_review',
        to: 'payment_confirmed',
        creditAmountTiyin: 7575050,
        differenceTiyin: -12345,
        amountDue: 76000,
        cardLast4: '1111',
        offShopCard: false,
        receiptId: 1,
        creditId: 2,
      }),
    );
    expect(lines.slice(1)).toEqual([
      'Поступление 75 750,50 сум, карта ••1111',
      'Разница с суммой заказа: −123,45 сум',
    ]);
    const credit = say(
      entry('credit.marked_not_for_order', {
        amountTiyin: 7575050,
        occurredAt: '2026-11-17T10:00:00.000Z',
        cardLast4: '1234',
      }),
    );
    expect(credit[0]).toBe('Поступление 75 750,50 сум от 17.11.2026 15:00, карта ••1234');
  });

  it('every key an order move reads is taken: nothing prints twice in English', () => {
    const notFound = say(
      entry('order.payment_not_found', {
        number: 12,
        from: 'receipt_review',
        to: 'awaiting_payment',
        receiptId: 5,
        duplicateOf: 4,
        pausedSeconds: 30,
        reserveEnded: true,
      }),
    );
    expect(notFound.slice(1)).toEqual([
      'Чек повторяет присланный раньше',
      'Бронь закончилась, заказ отменён',
    ]);
    const lines = [
      { position: 0, backToStock: true, nameRu: 'Тигар', nameUz: 'Tygar', ml: 30, qty: 2 },
      { position: 1, backToStock: false },
    ];
    const returned = entry('order.returned', {
      number: 12,
      from: 'delivered',
      to: 'returned',
      reason: 'не подошёл',
      lines,
    });
    expect(say(returned).slice(1)).toEqual([
      'Причина: не подошёл',
      'Тигар, 30 мл × 2: вернули на полку',
      'Позиция 2: не вернули на полку',
    ]);
    expect(say(returned, 'uz').slice(2)).toEqual([
      'Tygar, 30 ml × 2: javonga qaytarildi',
      '2-pozitsiya: javonga qaytarilmadi',
    ]);
  });

  it('a banner is named in the panel language', () => {
    const e = entry(
      'content.banner_deactivated',
      {},
      { targetName: 'Зима', targetNameUz: 'Qish', targetType: 'promo_banner' },
    );
    expect(say(e)).toEqual(['Баннер «Зима» выключен']);
    expect(say(e, 'uz')).toEqual(['«Qish» banneri oʻchirildi']);
  });
});
