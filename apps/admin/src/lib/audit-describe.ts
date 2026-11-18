import type { AuditEntryDto } from '@lummi/contracts';
import { formatCalendarDate, formatMoney, type Language } from '@lummi/i18n';
import { ordersMessages } from '@lummi/i18n/orders';
import type { AdminMessages } from './i18n';
import { formatTashkent, num } from './setting-copy';
import { fill } from './utils';

/**
 * What an audit entry says in words, one short line per fact, in the staff member's language.
 * One describer per action. A setting change and the shop card are the exceptions: the view shows
 * their «was → became» pair itself, so they describe nothing here. A key a describer does not
 * know still reads as a «field: value» line (never braces), so a later ticket's payload is
 * readable before it is labelled.
 */

type Payload = Record<string, unknown>;
type Ctx = {
  t: AdminMessages;
  language: Language;
  e: AuditEntryDto;
  /** The payload; each describer takes the keys it reads with `take`, the rest print as «field: value». */
  p: Payload;
  take: (...keys: string[]) => void;
};
type Describer = (c: Ctx) => (string | null | undefined | false)[];

const isRecord = (v: unknown): v is Payload =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** `canonicalDate` → «14 ноября 2026»; an instant → Tashkent date and time; anything else as is. */
function when(v: unknown, language: Language): string | null {
  const s = str(v);
  if (s === null) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return formatCalendarDate(s, language);
  if (/^\d{4}-\d{2}-\d{2}T/.test(s) && !Number.isNaN(Date.parse(s))) return formatTashkent(s);
  return s;
}

/** `belowReserve` → «Below reserve»: the fallback label for a key nobody has named yet. */
export function humanise(key: string): string {
  const words = key
    .replace(/[_.-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const label = (t: AdminMessages, key: string) =>
  (t.audit.fields as Record<string, string>)[key] ?? humanise(key);
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const fieldLabel = (t: AdminMessages, key: string) => lower(label(t, key));

const SHORT = 80;
const clip = (s: string) => (s.length > SHORT ? `${s.slice(0, SHORT - 1)}…` : s);

/** Any value as plain text: lists joined, objects as «key: value», never braces or JSON. */
export function valueText(c: Pick<Ctx, 't' | 'language'>, v: unknown, depth = 0): string {
  const { t, language } = c;
  const d = t.audit.detail;
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? d.yes : d.no;
  if (typeof v === 'number') return num(v);
  if (typeof v === 'string') return clip(when(v, language) ?? v);
  if (Array.isArray(v)) return v.map((x) => valueText(c, x, depth + 1)).join(', ');
  if (isRecord(v)) {
    const parts = Object.entries(v).map(([k, x]) =>
      depth >= 2 ? valueText(c, x, depth + 1) : `${fieldLabel(t, k)} ${valueText(c, x, depth + 1)}`,
    );
    return parts.join(', ');
  }
  return String(v);
}

/** A `[before, after]` pair, or a `{from, to}` one. */
function asPair(v: unknown): [unknown, unknown] | null {
  if (Array.isArray(v) && v.length === 2) return [v[0], v[1]];
  if (isRecord(v) && 'from' in v && 'to' in v) return [v.from, v.to];
  if (isRecord(v) && 'old' in v && 'new' in v) return [v.old, v.new];
  return null;
}

/** «цена: 1 → 2», for a diff keyed by field; a list of keys reads as «Изменено: цена, текст». */
function changedLines(c: Ctx, changed: unknown): string[] {
  const { t } = c;
  if (Array.isArray(changed)) {
    const keys = changed.filter((k): k is string => typeof k === 'string');
    return keys.length
      ? [fill(t.audit.detail.changed, { list: keys.map((k) => fieldLabel(t, k)).join(', ') })]
      : [];
  }
  if (!isRecord(changed)) return [];
  return Object.entries(changed).map(([k, v]) => {
    const pair = asPair(v);
    const value = pair ? `${valueText(c, pair[0])} → ${valueText(c, pair[1])}` : valueText(c, v);
    return fill(t.audit.detail.field, { label: label(t, k), value });
  });
}

const orderStatus = (language: Language, s: unknown): string => {
  const names = ordersMessages[language].orders.status as Record<string, string>;
  return typeof s === 'string' ? (names[s] ?? humanise(s)) : '—';
};

/** A reason a manager or the customer gave: one of our coded ones by its name, else as typed. */
function reasonText(c: Ctx, v: unknown): string | null {
  const s = str(v);
  if (s === null) return null;
  const known = { ...c.t.orders.cancelReasons, ...c.t.orders.rejectReasons } as Record<
    string,
    string
  >;
  return known[s] ?? s;
}

const money = (c: Ctx, n: number) => formatMoney(n, c.language);
const quote = (s: string) => `«${s}»`;

/** The order's number, from the payload, else the target id. */
const orderNumber = (c: Ctx) => String(c.p.number ?? c.e.targetId ?? '');

/** One line for an order's move: «Заказ № 12: Принят → Собирается», then why, where and how much. */
const orderMove: Describer = (c) => {
  const { p, t } = c;
  const d = t.audit.detail;
  c.take('number', 'from', 'to', 'reason', 'note', 'trackingNumber');
  const lines: (string | null)[] = [
    fill(d.move, {
      number: orderNumber(c),
      from: orderStatus(c.language, p.from),
      to: orderStatus(c.language, p.to),
    }),
  ];
  const reason = reasonText(c, p.reason);
  if (reason) lines.push(fill(d.reason, { reason }));
  if (str(p.note)) lines.push(fill(d.note, { note: str(p.note)! }));
  if (str(p.trackingNumber)) lines.push(fill(d.tracking, { number: str(p.trackingNumber)! }));
  const credit = int(p.creditAmountTiyin);
  if (credit !== null) {
    c.take('creditAmountTiyin', 'amountDue', 'differenceTiyin', 'cardLast4', 'offShopCard');
    const card = str(p.cardLast4);
    lines.push(
      fill(d.credit, { amount: money(c, credit / 100) }) +
        (card ? `, ${fill(d.cardLast4, { last4: card })}` : ''),
    );
    const diff = int(p.differenceTiyin);
    if (diff) lines.push(fill(d.creditDiff, { diff: money(c, diff / 100) }));
    if (p.offShopCard === true) lines.push(d.otherCard);
  }
  if (p.duplicateOf !== undefined && p.duplicateOf !== null) lines.push(d.duplicate);
  if (p.reserveEnded === true) lines.push(d.reserveEnded);
  if (Array.isArray(p.lines)) {
    const rows = p.lines.filter(isRecord);
    lines.push(
      fill(d.returnedBack, {
        n: String(rows.filter((r) => r.backToStock === true).length),
        total: String(rows.length),
      }),
    );
  }
  return lines;
};

/** The ids a payload stays quiet about: they point at rows, not at anything a person reads. */
const QUIET = ['receiptId', 'creditId', 'pausedSeconds', 'onHand', 'orderId', 'slug', 'code'];

const staffName = (c: Ctx) => str(c.p.name) ?? c.e.targetName ?? c.t.audit.actors.unknownStaff;
const roleName = (c: Ctx, role: unknown) =>
  (c.t.roles as Record<string, string>)[String(role)] ?? String(role ?? '—');
const volumeText = (c: Ctx, v: unknown) => (typeof v === 'number' ? String(v) : valueText(c, v));

/** A banner's name for a sentence: «Title» when known, else its number. */
const bannerName = (title: string | null, id: unknown) =>
  title ? quote(title) : String(id ?? '—');

/** `switchedOff`: banner numbers (legacy) or `{id, title}` objects; each reads as one line. */
function switchedOff(c: Ctx): string[] {
  const list = c.p.switchedOff;
  if (!Array.isArray(list)) return [];
  c.take('switchedOff');
  return list.map((x) => {
    const o = isRecord(x) ? x : null;
    const title = o ? (str(o.title) ?? str(o.titleRu)) : null;
    return fill(c.t.audit.detail.bannerOff, { name: bannerName(title, o ? o.id : x) });
  });
}

/** A promo code's rule, as short as it reads: «10 %» or «50 000 сум». */
function promoRule(c: Ctx): string | null {
  const percent = int(c.p.percent);
  const amount = int(c.p.amount);
  if (percent !== null) return fill(c.t.audit.detail.promoPercent, { percent: String(percent) });
  if (amount !== null) return money(c, amount);
  return null;
}

const describers: Record<string, Describer> = {
  // settings and the shop card: the view prints the «was → became» pair
  'setting.changed': (c) => (c.take('old', 'new'), []),
  'shop_card.changed': (c) => (c.take('old', 'new'), []),
  'shop_card.cleared': (c) => (c.take('old', 'new'), []),

  'staff.created': (c) => {
    c.take('name', 'login', 'role');
    return [
      fill(c.t.audit.detail.staffCreated, {
        name: staffName(c),
        login: str(c.p.login) ?? '—',
        role: roleName(c, c.p.role).toLowerCase(),
      }),
    ];
  },
  'staff.removed': (c) => {
    c.take('name', 'login', 'role', 'telegramId');
    return [
      fill(c.t.audit.detail.staffLogin, { name: staffName(c), login: str(c.p.login) ?? '—' }),
    ];
  },
  'staff.activated': (c) => {
    c.take('name', 'login', 'telegramId');
    return [staffName(c)];
  },
  'staff.deactivated': (c) => {
    c.take('name', 'login', 'telegramId');
    return [staffName(c)];
  },
  'staff.owner_seeded': (c) => {
    c.take('name', 'login', 'telegramId');
    return [staffName(c)];
  },
  'staff.owner_updated': (c) => {
    c.take('name', 'login', 'telegramId');
    return [staffName(c)];
  },
  'staff.password_reset': (c) => {
    c.take('name', 'login');
    return [fill(c.t.audit.detail.passwordReset, { name: staffName(c) })];
  },
  'staff.password_changed': (c) => {
    c.take('forced');
    return [c.p.forced === true ? c.t.audit.detail.passwordForced : c.t.audit.detail.passwordOwn];
  },
  'staff.telegram_linked': (c) => {
    c.take('name', 'telegramId');
    return [
      fill(c.t.audit.detail.telegram, { name: staffName(c), id: String(c.p.telegramId ?? '—') }),
    ];
  },
  'staff.telegram_unlinked': (c) => {
    c.take('name', 'telegramId');
    return [
      fill(c.t.audit.detail.telegram, { name: staffName(c), id: String(c.p.telegramId ?? '—') }),
    ];
  },
  'staff.locked': (c) => {
    c.take('until', 'by');
    return [fill(c.t.audit.detail.until, { until: when(c.p.until, c.language) ?? '—' })];
  },
  'auth.address_locked': (c) => {
    c.take('until');
    return [
      fill(c.t.audit.detail.address, {
        ip: c.e.targetId ?? '—',
        until: when(c.p.until, c.language) ?? '—',
      }),
    ];
  },
  'staff.signed_in': (c) => {
    c.take('method');
    const how = c.t.audit.detail.signedIn as Record<string, string>;
    return [how[String(c.p.method)] ?? valueText(c, c.p.method)];
  },

  'customer.created': () => [],
  'customer.phone_set': (c) => {
    c.take('previous');
    return [c.p.previous === true ? c.t.audit.detail.phoneChanged : c.t.audit.detail.phoneSet];
  },
  'customer.relinked': (c) => {
    c.take('fromTelegramId', 'toTelegramId', 'mergedCustomerId');
    return [fill(c.t.audit.detail.relinked, { id: String(c.p.mergedCustomerId ?? '—') })];
  },
  'customer.preferences_changed': (c) => {
    c.take('from', 'to');
    const d = c.t.audit.detail;
    const from = isRecord(c.p.from) ? c.p.from : {};
    const to = isRecord(c.p.to) ? c.p.to : {};
    const name = (dict: Record<string, string>, v: unknown) => dict[String(v)] ?? String(v ?? '—');
    return [
      from.language !== to.language &&
        fill(d.language, {
          from: name(d.languages, from.language),
          to: name(d.languages, to.language),
        }),
      from.theme !== to.theme &&
        fill(d.theme, { from: name(d.themes, from.theme), to: name(d.themes, to.theme) }),
    ];
  },
  'customer.delivery_city_changed': (c) => {
    c.take('from', 'to');
    const city = (v: unknown) => (isRecord(v) ? (str(v.city) ?? '—') : '—');
    return [fill(c.t.audit.detail.city, { from: city(c.p.from), to: city(c.p.to) })];
  },
  'customer.write_access_granted': () => [],
  'customer.write_access_refused': () => [],
  'customer.data_consent_given': (c) => {
    c.take('order', 'via');
    const d = c.t.audit.detail;
    return [
      c.p.order !== undefined
        ? fill(d.consentOrder, { number: String(c.p.order) })
        : d.consentBirth,
    ];
  },
  'customer.birth_date_set': (c) => {
    c.take('via', 'set');
    return [(c.t.audit.detail.via as Record<string, string>)[String(c.p.via)] ?? null];
  },
  'customer.birth_date_corrected': (c) => {
    c.take('changed');
    return [c.t.audit.detail.birthCorrected];
  },

  'order.created': (c) => {
    c.take('number', 'total', 'status');
    return [
      fill(c.t.audit.detail.orderCreated, {
        number: orderNumber(c),
        total: money(c, int(c.p.total) ?? 0),
      }),
    ];
  },
  'order.receipt_submitted': orderMove,
  'order.payment_confirmed': orderMove,
  'order.receipt_rejected': orderMove,
  'order.payment_not_found': orderMove,
  'order.accepted': orderMove,
  'order.assembling': orderMove,
  'order.handed_to_bts': orderMove,
  'order.delivered': orderMove,
  'order.returned': orderMove,
  'order.cancelled': orderMove,
  'order.refunded': (c) => {
    c.take('number', 'amount', 'date', 'reason', 'paid', 'refundedBefore');
    const d = c.t.audit.detail;
    const { p } = c;
    return [
      fill(d.refund, {
        number: orderNumber(c),
        amount: money(c, int(p.amount) ?? 0),
        date: when(p.date, c.language) ?? '—',
      }),
      str(p.reason) && fill(d.note, { note: str(p.reason)! }),
      int(p.paid) !== null &&
        fill(d.refundPaid, {
          paid: money(c, int(p.paid)!),
          before: money(c, int(p.refundedBefore) ?? 0),
        }),
    ];
  },
  'review.published': (c) => {
    c.take('orderId', 'rating');
    return [
      int(c.p.rating) !== null && fill(c.t.audit.detail.rating, { rating: String(c.p.rating) }),
    ];
  },
  'review.hidden': (c) => {
    c.take('orderId', 'rating');
    return [
      int(c.p.rating) !== null && fill(c.t.audit.detail.rating, { rating: String(c.p.rating) }),
    ];
  },

  'credit.marked_not_for_order': (c) => {
    c.take('amountTiyin', 'occurredAt', 'cardLast4', 'note');
    const d = c.t.audit.detail;
    const card = str(c.p.cardLast4);
    return [
      fill(d.creditMarked, {
        amount: money(c, (int(c.p.amountTiyin) ?? 0) / 100),
        at: when(c.p.occurredAt, c.language) ?? '—',
      }) + (card ? `, ${fill(d.cardLast4, { last4: card })}` : ''),
      str(c.p.note) && fill(d.note, { note: str(c.p.note)! }),
    ];
  },
  'credit.unmarked_not_for_order': (c) => {
    c.take('amountTiyin', 'occurredAt', 'cardLast4', 'note', 'markedBy', 'markedAt');
    const d = c.t.audit.detail;
    const card = str(c.p.cardLast4);
    return [
      fill(d.creditMarked, {
        amount: money(c, (int(c.p.amountTiyin) ?? 0) / 100),
        at: when(c.p.occurredAt, c.language) ?? '—',
      }) + (card ? `, ${fill(d.cardLast4, { last4: card })}` : ''),
      str(c.p.note) && fill(d.note, { note: str(c.p.note)! }),
    ];
  },

  'bts_point.created': (c) => {
    c.take('code', 'city', 'name', 'address', 'landmark', 'hours', 'active', 'regionId');
    return [
      fill(c.t.audit.detail.btsNew, { city: str(c.p.city) ?? '—', name: str(c.p.name) ?? '—' }),
      str(c.p.address),
    ];
  },
  'bts_point.updated': (c) => {
    c.take('code', 'changed');
    return [
      fill(c.t.audit.detail.bts, { code: str(c.p.code) ?? '—' }),
      ...changedLines(c, c.p.changed),
    ];
  },
  'bts_point.shown': (c) => (
    c.take('code'),
    [fill(c.t.audit.detail.bts, { code: str(c.p.code) ?? '—' })]
  ),
  'bts_point.hidden': (c) => (
    c.take('code'),
    [fill(c.t.audit.detail.bts, { code: str(c.p.code) ?? '—' })]
  ),
  'bts_points.imported': (c) => {
    c.take('inserted', 'updated', 'unchanged', 'source', 'fetchedAt', 'refresh');
    return [
      fill(c.t.audit.detail.imported, {
        inserted: String(int(c.p.inserted) ?? 0),
        updated: String(int(c.p.updated) ?? 0),
        unchanged: String(int(c.p.unchanged) ?? 0),
      }),
    ];
  },
  'region.tariff_changed': (c) => {
    c.take('code', 'old', 'new');
    return [
      fill(c.t.audit.detail.tariff, {
        code: str(c.p.code) ?? String(c.e.targetId ?? '—'),
        old: money(c, int(c.p.old) ?? 0),
        new: money(c, int(c.p.new) ?? 0),
      }),
    ];
  },

  'catalog.fragrance_created': (c) => {
    c.take('name', 'slug', 'code', 'hidden', 'source');
    return [str(c.p.name) ?? c.e.targetName, c.p.hidden === true && c.t.audit.detail.hiddenNew];
  },
  'catalog.fragrance_updated': (c) => {
    c.take('name', 'changed', 'volumes', 'source');
    const d = c.t.audit.detail;
    const volumes = Array.isArray(c.p.volumes) ? c.p.volumes.filter(isRecord) : [];
    return [
      str(c.p.name) ?? c.e.targetName,
      ...changedLines(c, c.p.changed),
      ...volumes.map((v) => {
        const { ml, ...diff } = v;
        return fill(d.volumes, {
          ml: String(ml ?? '—'),
          changes: changedLines(c, diff)
            .map((l) => lower(l))
            .join('; '),
        });
      }),
    ];
  },
  'catalog.fragrance_hidden': (c) => (c.take('name'), [str(c.p.name) ?? c.e.targetName]),
  'catalog.fragrance_unhidden': (c) => (c.take('name'), [str(c.p.name) ?? c.e.targetName]),
  'catalog.on_hand_changed': (c) => {
    c.take('fragrance', 'ml', 'onHand');
    const pair = asPair(c.p.onHand) ?? [null, null];
    return [
      fill(c.t.audit.detail.stock, {
        name: str(c.p.fragrance) ?? c.e.targetName ?? '—',
        ml: String(c.p.ml ?? '—'),
        old: volumeText(c, pair[0]),
        new: volumeText(c, pair[1]),
      }),
    ];
  },
  'catalog.photo_uploaded': (c) => {
    c.take('ml', 'fragranceId', 'photo');
    return [
      c.e.targetName && int(c.p.ml) !== null
        ? `${c.e.targetName}: ${lower(fill(c.t.audit.detail.photoFor, { ml: String(c.p.ml) }))}`
        : int(c.p.ml) !== null
          ? fill(c.t.audit.detail.photoFor, { ml: String(c.p.ml) })
          : c.t.audit.detail.photo,
    ];
  },
  'catalog.family_created': (c) => dictionary(c),
  'catalog.family_updated': (c) => dictionary(c),
  'catalog.note_created': (c) => dictionary(c),
  'catalog.note_updated': (c) => dictionary(c),
  'catalog.import_applied': (c) => {
    c.take('counts', 'file', 'belowReserve');
    const counts = isRecord(c.p.counts) ? c.p.counts : {};
    const f = isRecord(counts.fragrances) ? counts.fragrances : {};
    const v = isRecord(counts.volumes) ? counts.volumes : {};
    const below = Array.isArray(c.p.belowReserve) ? c.p.belowReserve.length : 0;
    return [
      fill(c.t.audit.detail.importCounts, {
        fn: String(int(f.new) ?? 0),
        fc: String(int(f.changed) ?? 0),
        vn: String(int(v.new) ?? 0),
        vc: String(int(v.changed) ?? 0),
      }),
      below > 0 && fill(c.t.audit.detail.belowReserve, { n: String(below) }),
    ];
  },
  'orders.exported': (c) => {
    c.take('filters', 'count');
    return [fill(c.t.audit.detail.exported, { count: String(int(c.p.count) ?? 0) })];
  },

  'sets.discovery_changed': (c) => {
    c.take('price', 'uzumUrl', 'composition');
    const d = c.t.audit.detail;
    const price = asPair(c.p.price);
    const comp = asPair(c.p.composition);
    const names = (v: unknown) =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
    const before = names(comp?.[0]);
    const after = names(comp?.[1]);
    const added = after.filter((n) => !before.includes(n));
    const removed = before.filter((n) => !after.includes(n));
    const change = [
      added.length && fill(d.added, { list: added.join(', ') }),
      removed.length && fill(d.removed, { list: removed.join(', ') }),
    ]
      .filter(Boolean)
      .join('; ');
    const uzum = asPair(c.p.uzumUrl);
    return [
      price &&
        price[0] !== price[1] &&
        fill(d.price, { old: money(c, int(price[0]) ?? 0), new: money(c, int(price[1]) ?? 0) }),
      change && fill(d.composition, { list: change }),
      uzum &&
        uzum[0] !== uzum[1] &&
        fill(d.field, {
          label: 'Uzum',
          value: `${valueText(c, uzum[0])} → ${valueText(c, uzum[1])}`,
        }),
    ];
  },
  'sets.discovery_on_hand_changed': (c) => {
    c.take('onHand');
    const pair = asPair(c.p.onHand) ?? [null, null];
    return [
      fill(c.t.audit.detail.onHand, { old: volumeText(c, pair[0]), new: volumeText(c, pair[1]) }),
    ];
  },
  'sets.discovery_photo_uploaded': (c) => (c.take('photo'), [c.t.audit.detail.photo]),

  'content.banner_created': (c) => {
    c.take('title', 'target');
    return [
      fill(c.t.audit.detail.bannerNew, { title: str(c.p.title) ?? c.t.audit.detail.unknownName }),
      str(c.p.target) &&
        (((c.t.content.banner as { targets?: Record<string, string> }).targets ?? {})[
          String(c.p.target)
        ] ??
          valueText(c, c.p.target)),
    ];
  },
  'content.banner_updated': (c) => {
    c.take('changed');
    return [
      c.e.targetName && fill(c.t.audit.detail.bannerNew, { title: c.e.targetName }),
      ...changedLines(c, c.p.changed),
    ];
  },
  'content.banner_activated': (c) => {
    const lines = [
      fill(c.t.audit.detail.bannerOn, { name: bannerName(c.e.targetName, c.e.targetId) }),
    ];
    return [...lines, ...switchedOff(c)];
  },
  'content.banner_deactivated': (c) => {
    const lines = [
      fill(c.t.audit.detail.bannerOff, { name: bannerName(c.e.targetName, c.e.targetId) }),
    ];
    return [...lines, ...switchedOff(c)];
  },
  'content.banner_deleted': (c) => {
    c.take('title', 'wasActive');
    return [
      fill(c.t.audit.detail.bannerNew, { title: str(c.p.title) ?? c.t.audit.detail.unknownName }),
      c.p.wasActive === true && c.t.audit.detail.bannerWasActive,
    ];
  },
  'content.banner_photo_uploaded': (c) => {
    c.take('photo');
    return [
      c.e.targetName && fill(c.t.audit.detail.bannerNew, { title: c.e.targetName }),
      c.t.audit.detail.photo,
    ];
  },
  'content.slogan_changed': (c) => {
    c.take('ru', 'uz');
    const lines: string[] = [];
    for (const lang of ['ru', 'uz'] as const) {
      const pair = asPair(c.p[lang]);
      if (pair && pair[0] !== pair[1])
        lines.push(
          fill(c.t.audit.detail.slogan, {
            lang: lang.toUpperCase(),
            old: valueText(c, pair[0]),
            new: valueText(c, pair[1]),
          }),
        );
    }
    return lines;
  },
  'content.page_updated': (c) => {
    c.take('changed', 'draft');
    const draft = asPair(c.p.draft);
    return [
      ...changedLines(c, c.p.changed),
      draft &&
        fill(c.t.audit.detail.draft, {
          old: valueText(c, draft[0]),
          new: valueText(c, draft[1]),
        }),
    ];
  },

  'promo.created': (c) => {
    c.take(
      'code',
      'kind',
      'percent',
      'amount',
      'maxDiscount',
      'expiresOn',
      'minOrderTotal',
      'totalLimit',
      'perCustomerLimit',
      'newCustomersOnly',
      'appliesToMarkedDown',
      'active',
    );
    const rule = promoRule(c);
    return [
      rule
        ? fill(c.t.audit.detail.promoNew, { code: str(c.p.code) ?? '—', rule })
        : fill(c.t.audit.detail.code, { code: str(c.p.code) ?? '—' }),
    ];
  },
  'promo.updated': (c) => {
    c.take('code', 'changed');
    return [
      fill(c.t.audit.detail.code, { code: str(c.p.code) ?? '—' }),
      ...changedLines(c, c.p.changed),
    ];
  },
  'promo.deleted': (c) => (
    c.take('code'),
    [fill(c.t.audit.detail.code, { code: str(c.p.code) ?? '—' })]
  ),

  'campaign_link.created': (c) => {
    c.take('code', 'target', 'promoCode', 'source', 'sourceLabel', 'automatic');
    const d = c.t.audit.detail;
    const code = str(c.p.code) ?? '—';
    if (c.p.automatic === true)
      return [fill(d.link, { code }), fill(d.automatic, { promo: str(c.p.promoCode) ?? '—' })];
    return [
      fill(d.link, { code }),
      str(c.p.sourceLabel),
      str(c.p.promoCode) && fill(d.promoLinked, { promo: str(c.p.promoCode)! }),
    ];
  },
  'campaign_link.updated': (c) => {
    c.take('code', 'changed');
    return [
      fill(c.t.audit.detail.link, { code: str(c.p.code) ?? '—' }),
      ...changedLines(c, c.p.changed),
    ];
  },
  'campaign_link.deleted': (c) => (
    c.take('code'),
    [fill(c.t.audit.detail.link, { code: str(c.p.code) ?? '—' })]
  ),

  'broadcast.test_sent': (c) => {
    c.take('audience', 'hasImage');
    return [c.t.audit.detail.testSent];
  },
  'broadcast.sent': (c) => {
    c.take('audience', 'audienceSize', 'sender', 'hasImage', 'buttonTarget');
    const d = c.t.audit.detail;
    const audience =
      (d.audiences as Record<string, string>)[String(c.p.audience)] ?? valueText(c, c.p.audience);
    return [
      fill(d.audience, { audience }) + (c.p.hasImage === true ? `, ${d.withImage}` : ''),
      fill(d.sent, { size: String(int(c.p.audienceSize) ?? 0), sender: str(c.p.sender) ?? '—' }),
    ];
  },
};

/** A family or a note: its name in the reader's language, with the other one after it. */
function dictionary(c: Ctx): string[] {
  c.take('nameRu', 'nameUz', 'aliases');
  const ru = str(c.p.nameRu);
  const uz = str(c.p.nameUz);
  if (!ru && !uz) return [];
  return [fill(c.t.audit.detail.dictionary, { ru: ru ?? '—', uz: uz ?? '—' })];
}

/**
 * The entry's details as short lines, in the language the panel is in. A setting change and the
 * shop card give none (the view prints their pair). Any key the action's describer did not read
 * follows as a «field: value» line; an action nobody described gets only those lines.
 */
export function describeAudit(t: AdminMessages, language: Language, e: AuditEntryDto): string[] {
  const used = new Set<string>(QUIET);
  const c: Ctx = {
    t,
    language,
    e,
    p: e.payload,
    take: (...keys) => keys.forEach((k) => used.add(k)),
  };
  const lines = (describers[e.action]?.(c) ?? []).filter(
    (l): l is string => typeof l === 'string' && l !== '',
  );
  for (const [key, value] of Object.entries(e.payload)) {
    if (used.has(key)) continue;
    lines.push(fill(t.audit.detail.field, { label: label(t, key), value: valueText(c, value) }));
  }
  return lines;
}

/** Every action this module describes: the table's keys, for the unit test that every action has a case. */
export const DESCRIBED_ACTIONS = Object.keys(describers);
