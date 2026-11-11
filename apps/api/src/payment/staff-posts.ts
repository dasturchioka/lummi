import { formatDateTime, formatDuration, formatMoney } from '@lummi/i18n';

/*
 * What staff read in the «Системные» topic about receipts (#36). Staff-facing, so Russian, like
 * every owner alert. Plain functions, so the texts are in one place for the posts and the docs.
 */

const at = (d: Date) => formatDateTime(d, 'ru');
const money = (n: number) => formatMoney(n, 'ru');
const duration = (seconds: number) => formatDuration(seconds, 'ru');

/** Where the order stands after payment not found. */
function after(o: { reserveUntil: Date; cancelled: boolean }): string {
  return o.cancelled
    ? 'Бронь уже истекла: заказ отменён, товары вернулись в продажу.'
    : `Заказ снова «Ожидает оплаты», бронь до ${at(o.reserveUntil)}.`;
}

/** Info post: the wait window ended with no fitting credit (ADR 0012). Nobody has to act. */
export function paymentNotFoundPost(o: {
  number: number;
  amountDue: number;
  receiptAt: Date;
  windowSeconds: number;
  pausedSeconds: number;
  reserveUntil: Date;
  cancelled: boolean;
}): string {
  const paused =
    o.pausedSeconds >= 60 ? ` (и ещё ${duration(o.pausedSeconds)} паузы ленты Humo)` : '';
  return [
    `Оплата не найдена: заказ № ${o.number}`,
    `Чек от ${at(o.receiptAt)}: за ${duration(o.windowSeconds)}${paused} на карту магазина не пришёл перевод на ${money(o.amountDue)}.`,
    'Покупателя попросили проверить сумму и карту и загрузить чек заново.',
    after(o),
  ].join('\n');
}

/** Info post: the receipt repeats one sent before; the AI was not asked (spec 2026-11-07). */
export function repeatedReceiptPost(o: {
  number: number;
  twinNumber: number;
  sameFile: boolean;
  reserveUntil: Date;
  cancelled: boolean;
}): string {
  const how = o.sameFile ? 'тот же файл' : 'похожее изображение';
  return [
    `Повторный чек: заказ № ${o.number}`,
    `Этот чек уже был у заказа № ${o.twinNumber} (${how}). ИИ его не проверял.`,
    'Покупателя попросили загрузить чек именно этого перевода.',
    after(o),
  ].join('\n');
}

/** Owner alert, once per outage: the payment feed stopped and every receipt timer is paused. */
export function pauseStartedAlert(o: { cause: 'heartbeat' | 'silence'; since: Date | null }) {
  const why =
    o.cause === 'heartbeat'
      ? o.since
        ? `Юзербот не выходит на связь с ${at(o.since)}: поступления Humo не доходят до магазина.`
        : 'Юзербот ещё ни разу не выходил на связь: поступления Humo не доходят до магазина.'
      : o.since
        ? `С ${at(o.since)} от Humo не пришло ни одного поступления, а покупатели ждут проверки чеков.`
        : 'От Humo ещё не пришло ни одного поступления, а покупатели ждут проверки чеков.';
  return [
    'Таймеры чеков на паузе.',
    why,
    'Пока пауза, чеки не получают «оплата не найдена» и брони заказов с чеками не истекают. Проверьте поступления в приложении банка.',
  ].join('\n');
}

/** Owner alert when the outage is over: the timers go on, extended by the pause. */
export function pauseEndedAlert(o: { startedAt: Date; endedAt: Date }) {
  const seconds = Math.round((o.endedAt.getTime() - o.startedAt.getTime()) / 1000);
  return [
    'Таймеры чеков снова идут: лента Humo работает.',
    `Пауза длилась ${duration(seconds)}; ожидание чеков и брони заказов с чеками продлены на неё.`,
  ].join('\n');
}

/** Why a waiting receipt waits, as staff read it. */
const WAITS_FOR: Record<'duplicate' | 'not_confirmed' | 'judge_failed', string> = {
  duplicate: 'ждёт решения менеджера (повторный чек)',
  not_confirmed: 'ждёт решения менеджера (ИИ не подтвердил чек)',
  judge_failed: 'ждёт решения менеджера (ИИ не смог проверить чек)',
};

/** Owner alert, once per receipt: it has waited longer than the setting (TZ §6). */
export function uncheckedReceiptAlert(o: {
  number: number;
  amountDue: number;
  receiptAt: Date;
  waitedSeconds: number;
  reviewReason: keyof typeof WAITS_FOR | null;
}) {
  const state = o.reviewReason
    ? WAITS_FOR[o.reviewReason]
    : `ждёт поступления ${money(o.amountDue)} на карту магазина`;
  return `Чек к заказу № ${o.number} не проверен ${duration(o.waitedSeconds)} (загружен ${at(o.receiptAt)}): ${state}.`;
}
