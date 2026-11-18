import { CANCEL_REASONS, ORDER_STATUSES } from '@lummi/contracts';
import type { OrderLineRow, OrderRow } from '@lummi/db';
import { GrammyError } from 'grammy';
import { describe, expect, it } from 'vitest';
import { editError, MessageGoneError, RateLimitedError } from '../src/edges';
import {
  CALLBACK_DATA_MAX,
  decodePress,
  encodePress,
  MESSAGE_MAX,
  renderCard,
  visibleLength,
  type CardData,
  type CardPress,
} from '../src/orders-group/card-view';
import { plainText } from './fakes';

describe('the card buttons’ callback data', () => {
  it('fits Telegram’s 64 bytes for the largest order id, the longest status and reason', () => {
    const longest: CardPress[] = ORDER_STATUSES.flatMap((expected) =>
      CANCEL_REASONS.flatMap((reason) => [
        { verb: 'confirm' as const, orderId: Number.MAX_SAFE_INTEGER, expected, reason },
        { verb: 'reason' as const, orderId: Number.MAX_SAFE_INTEGER, expected, reason },
        { verb: 'next' as const, orderId: Number.MAX_SAFE_INTEGER, expected },
      ]),
    );
    for (const p of longest) {
      const data = encodePress(p);
      expect(Buffer.byteLength(data)).toBeLessThanOrEqual(CALLBACK_DATA_MAX);
      expect(decodePress(data)).toEqual(p);
    }
  });

  it('reads nothing into a button it did not make', () => {
    for (const data of [
      'rcpt:1:1001',
      'ord:n:1:shipped',
      'ord:x:1:accepted',
      'ord:y:1:accepted',
      'ord:y:1:accepted:because',
      'ord:n:1:accepted:out_of_stock',
      'ord:n:0:accepted',
      'ord:n:99999999999999999:accepted',
      'ord:n:-1:accepted',
    ])
      expect(decodePress(data)).toBeNull();
  });
});

const order: OrderRow = {
  id: 7,
  number: 1007,
  customerId: 1,
  status: 'payment_confirmed',
  reserveUntil: new Date('2026-11-09T22:00:00Z'),
  recipientName: 'Dilnoza',
  recipientPhone: '+998901234567',
  regionId: 1,
  regionNameRu: 'Самаркандская область',
  regionNameUz: 'Samarqand viloyati',
  btsPointId: 1,
  pointCode: '57',
  pointName: 'FIRDAVSIY',
  pointCity: 'Самарканд',
  pointAddress: 'ул. Гагарина, 155',
  pointLandmark: null,
  pointHours: null,
  typedAddress: null,
  comment: null,
  isGift: false,
  giftMessage: null,
  itemsSubtotal: 69_000,
  discount: null,
  discountAmount: 0,
  deliveryFee: 25_000,
  thresholdBase: 'before',
  thresholdBaseAmount: 69_000,
  total: 94_000,
  amountDue: 94_000,
  creditId: 1,
  idempotencyKey: '00000000-0000-0000-0000-000000000000',
  campaignLinkId: null,
  trackingNumber: null,
  reserveReminderSentAt: null,
  reviewRequestedAt: null,
  reviewRequest: null,
  costs: null,
  createdAt: new Date('2026-11-09T10:00:00Z'),
  updatedAt: new Date('2026-11-09T10:00:00Z'),
};
const line = (position: number): OrderLineRow => ({
  id: position + 1,
  orderId: 7,
  position,
  kind: 'volume',
  volumeId: 1,
  fragranceId: 1,
  slug: 'symphony',
  nameRu: 'Очень длинное название аромата для проверки длины карточки',
  nameUz: 'Juda uzun atir nomi',
  brand: 'Louis Vuitton',
  ml: 50,
  photo: null,
  unitPrice: 199_000,
  regularUnitPrice: 199_000,
  markedDown: false,
  qty: 99,
  lineTotal: 19_701_000,
  promoGift: false,
  setVolumeIds: null,
  setComposition: null,
  unitCost: null,
});
const data = (over: Partial<CardData> = {}): CardData => ({
  order,
  lines: [line(0)],
  customer: {
    telegramId: 41,
    firstName: 'Ali',
    lastName: null,
    username: null,
    phone: '+998901234567',
  },
  events: [],
  panel: { kind: 'steps' },
  money: { paid: 94_000, paidOn: '2026-11-09', refunded: 0, refundable: 94_000, owed: 0 },
  ...over,
});

describe('the card text', () => {
  it('stays within Telegram’s 4096 for the largest order a customer can make', () => {
    const typed = 'а'.repeat(300);
    const worst = data({
      order: {
        ...order,
        recipientName: 'Р'.repeat(100),
        comment: '<&>'.repeat(166),
        isGift: true,
        giftMessage: 'Ж'.repeat(1000),
        btsPointId: null,
        pointCode: null,
        pointName: null,
        pointCity: null,
        pointAddress: null,
        typedAddress: typed,
      },
      lines: Array.from({ length: 120 }, (_, i) => line(i)),
      events: Array.from({ length: 40 }, () => ({
        action: 'reject_receipt' as const,
        at: new Date('2026-11-09T10:00:00Z'),
        actorType: 'staff' as const,
        staffName: 'Очень длинное имя менеджера',
        reason: 'amount_mismatch',
        payload: {},
      })),
    });
    const { text } = renderCard(worst);
    expect(visibleLength(text)).toBeLessThanOrEqual(MESSAGE_MAX);
    const shown = plainText(text, { parse_mode: 'HTML' });
    expect(shown).toContain('… и ещё');
    // what people typed stays escaped, cut or not
    expect(text).not.toMatch(/<&>/);
  });

  it('names the discount by its source, and a set by its five fragrances', () => {
    const { text } = renderCard(
      data({
        order: {
          ...order,
          itemsSubtotal: 299_000,
          discount: { type: 'promo_code', code: 'LUMMI10', amount: 29_900 },
          discountAmount: 29_900,
          deliveryFee: 0,
          total: 269_100,
          amountDue: 269_100,
        },
        lines: [
          {
            ...line(0),
            kind: 'builder_set',
            volumeId: null,
            nameRu: 'Набор 5 × 10 мл',
            ml: 10,
            qty: 1,
            unitPrice: 299_000,
            regularUnitPrice: 299_000,
            lineTotal: 299_000,
            setComposition: ['Symphony', 'Tygar', 'Megamare', 'Erba Pura', 'Oud Wood'].map(
              (name, i) => ({ fragranceId: i + 1, name, brand: 'X' }),
            ),
          },
        ],
      }),
    );
    const shown = plainText(text, { parse_mode: 'HTML' }).replace(/[\u00a0\u202f]/g, ' ');
    expect(shown).toContain('• Набор 5 × 10 мл × 1 — 299 000 сум');
    expect(shown).toContain('   Symphony, Tygar, Megamare, Erba Pura, Oud Wood');
    expect(shown).toContain('Скидка (Промокод LUMMI10): −29 900 сум');
    expect(shown).toContain('Доставка: бесплатно');
    expect(shown).toContain('Итого: 269 100 сум');
  });

  it('lists a Promo gift as «Подарок по промокоду RAINTEA: Rain Tea 10 мл», with nothing taken off (ADR 0039)', () => {
    const gift = (language: 'ru' | 'uz') =>
      plainText(
        renderCard(
          data({
            order: {
              ...order,
              itemsSubtotal: 219_000,
              discount: {
                type: 'promo_code',
                code: 'RAINTEA',
                amount: 0,
                promoGift: { item: { kind: 'volume', volumeId: 9 }, value: 69_000 },
              },
              discountAmount: 0,
              deliveryFee: 25_000,
              total: 244_000,
              amountDue: 244_000,
            },
            lines: [
              {
                ...line(0),
                qty: 1,
                unitPrice: 219_000,
                regularUnitPrice: 219_000,
                lineTotal: 219_000,
              },
              {
                ...line(1),
                nameRu: 'Rain Tea',
                nameUz: 'Rain Tea',
                ml: 10,
                qty: 1,
                unitPrice: 0,
                regularUnitPrice: 69_000,
                lineTotal: 0,
                promoGift: true,
              },
            ],
          }),
          language,
        ).text,
        { parse_mode: 'HTML' },
      ).replace(/[\u00a0\u202f]/g, ' ');
    const ru = gift('ru');
    expect(ru).toContain('• Подарок по промокоду RAINTEA: Rain Tea 10 мл');
    expect(ru).not.toContain('Скидка');
    expect(ru).not.toMatch(/Rain Tea.*— 0/);
    expect(ru).toContain('Итого: 244 000 сум');
    expect(gift('uz')).toContain('• RAINTEA promokodi sovgʻasi: Rain Tea 10 ml');
  });

  it('never squeezes the Promo gift out: a card near 4096 still says which gift goes in the parcel', () => {
    const worst = data({
      order: {
        ...order,
        comment: '<&>'.repeat(166),
        isGift: true,
        giftMessage: 'Ж'.repeat(1000),
        discount: {
          type: 'promo_code',
          code: 'BLOGER_MALIKA_NOVOGODNIY_2026_UZ',
          amount: 0,
          promoGift: { item: { kind: 'discovery_set' }, value: 299_000 },
        },
        discountAmount: 0,
      },
      lines: [
        ...Array.from({ length: 120 }, (_, i) => line(i)),
        {
          ...line(120),
          kind: 'discovery_set',
          volumeId: null,
          nameRu: 'Discovery set',
          nameUz: 'Discovery set',
          ml: 10,
          qty: 1,
          unitPrice: 0,
          regularUnitPrice: 299_000,
          lineTotal: 0,
          promoGift: true,
          setComposition: ['Symphony', 'Tygar', 'Megamare', 'Erba Pura', 'Oud Wood'].map(
            (name, i) => ({ fragranceId: i + 1, name, brand: 'X' }),
          ),
        },
      ],
    });
    const { text } = renderCard(worst);
    expect(visibleLength(text)).toBeLessThanOrEqual(MESSAGE_MAX);
    const shown = plainText(text, { parse_mode: 'HTML' });
    expect(shown).toContain('… и ещё');
    expect(shown).toContain(
      '• Подарок по промокоду BLOGER_MALIKA_NOVOGODNIY_2026_UZ: Discovery set',
    );
    expect(shown).toContain('   Symphony, Tygar, Megamare, Erba Pura, Oud Wood');
  });

  it('escapes what people typed, everywhere it appears', () => {
    const { text } = renderCard(
      data({
        order: { ...order, recipientName: 'A <b>&', comment: '</a><a href="x">' },
        customer: {
          telegramId: 41,
          firstName: '<i>Ali</i>',
          lastName: '&',
          username: 'ali',
          phone: null,
        },
      }),
    );
    expect(text).toContain('A &lt;b&gt;&amp;');
    expect(text).toContain('&lt;/a&gt;&lt;a href=&quot;x&quot;&gt;');
    expect(text).toContain('<a href="tg://user?id=41">&lt;i&gt;Ali&lt;/i&gt; &amp;</a>');
  });
});

describe('the money a paid order owes back (Refunds, #40)', () => {
  const shown = (over: Partial<CardData>) =>
    plainText(renderCard(data(over)).text, { parse_mode: 'HTML' }).replace(/[\u00a0\u202f]/g, ' ');
  const paid = (refunded: number) => ({
    paid: 94_000,
    paidOn: '2026-11-09',
    refunded,
    refundable: 94_000 - refunded,
    owed: 0,
  });

  it('an order that ended paid asks for the money back until the refunds cover it', () => {
    for (const status of ['cancelled', 'returned'] as const) {
      const ended = { ...order, status };
      expect(shown({ order: ended, money: { ...paid(0), owed: 94_000 } }), status).toContain(
        '💸 Заказ был оплачен: верните деньги покупателю.',
      );
      const part = shown({ order: ended, money: { ...paid(30_000), owed: 64_000 } });
      expect(part, status).toContain(
        '💸 Возвращено покупателю: 30 000 сум. Осталось вернуть 64 000 сум.',
      );
      expect(part, status).not.toContain('верните деньги');
      const all = shown({ order: ended, money: paid(94_000) });
      expect(all, status).toContain('💸 Возвращено покупателю: 94 000 сум.');
      expect(all, status).not.toContain('Осталось');
    }
  });

  it('a refund on an order still on its way, or delivered, is shown as it is', () => {
    expect(shown({ order: { ...order, status: 'delivered' }, money: paid(20_000) })).toContain(
      '💸 Возвращено покупателю: 20 000 сум.',
    );
    expect(shown({ money: paid(0) })).not.toContain('💸');
  });
});

describe('editing a message', () => {
  const error = (code: number, description: string, parameters = {}) =>
    new GrammyError(
      'Call to editMessageText failed!',
      { ok: false, error_code: code, description, parameters },
      'editMessageText',
      { chat_id: -100 },
    );
  it('an edit that changes nothing is fine; a gone message is told apart; a 429 waits', () => {
    expect(
      editError(
        error(
          400,
          'Bad Request: message is not modified: specified new message content and reply markup are exactly the same',
        ),
      ),
    ).toBe('not_modified');
    for (const gone of [
      'Bad Request: message to edit not found',
      // the group became a supergroup (migrate_to_chat_id), or the bot can no longer see it
      'Bad Request: group chat was upgraded to a supergroup chat',
      'Bad Request: chat not found',
    ])
      expect(editError(error(400, gone))).toBeInstanceOf(MessageGoneError);
    const limited = editError(error(429, 'Too Many Requests: retry after 7', { retry_after: 7 }));
    expect(limited).toBeInstanceOf(RateLimitedError);
    expect((limited as RateLimitedError).retryAfterSeconds).toBe(7);
  });
});
