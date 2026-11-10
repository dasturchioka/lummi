import type {
  CheckoutConflictCode,
  CheckoutDto,
  CreateOrderBody,
  OrderDto,
  OrderInputError,
  OrderStatus,
  RepeatResultDto,
  SavedPointDto,
} from '@lummi/contracts';
import { ordersMessages } from '@lummi/i18n/orders';
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { CART_KEY } from '../cart/queries';
import { api, unwrap } from '../lib/api';
import { usePrefs } from '../lib/prefs';

/** Checkout and «Заказы» strings: their own namespace, so only these lazy screens carry them. */
export function useOrdersText() {
  const { language } = usePrefs();
  return ordersMessages[language];
}

export const checkoutKey = (regionId: number | undefined, item: string | undefined) =>
  ['checkout', regionId ?? null, item ?? null] as const;

/**
 * The cart as checkout shows it, or the one «Купить сейчас» `item` instead, quoted by the server
 * with the chosen point's region tariff (ADR 0001). Re-read on every open; while another region is
 * being quoted the last numbers stay. `null`: the item is unknown or no longer sold (404).
 */
export function useCheckout(regionId: number | undefined, item: string | undefined) {
  return useQuery({
    queryKey: checkoutKey(regionId, item),
    staleTime: 0,
    refetchOnMount: 'always',
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const res = await api.checkout.get({ query: { regionId, item } });
      if (res.status === 404) return null;
      return unwrap(res, 200);
    },
  });
}

export type CreateResult =
  | { kind: 'created'; order: OrderDto }
  | { kind: 'conflict'; code: CheckoutConflictCode; checkout: CheckoutDto }
  | { kind: 'try_again' }
  | { kind: 'phone_required' }
  | { kind: 'invalid'; code: OrderInputError }
  /** No shop card is set: checkout is closed («Оплата временно недоступна», #28). */
  | { kind: 'payment_unavailable' };

/** POST /orders. A created cart order empties the ordered cart lines, so the cart is re-read; a «Купить сейчас» order leaves it alone. */
export function useCreateOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateOrderBody): Promise<CreateResult> => {
      const res = await api.orders.create({ body });
      if (res.status === 201) return { kind: 'created', order: res.body };
      if (res.status === 409)
        return 'checkout' in res.body
          ? { kind: 'conflict', code: res.body.code, checkout: res.body.checkout }
          : { kind: 'try_again' };
      if (res.status === 403) return { kind: 'phone_required' };
      if (res.status === 422) return { kind: 'invalid', code: res.body.code };
      if (res.status === 503) return { kind: 'payment_unavailable' };
      throw new Error(`HTTP ${res.status}`);
    },
    onSuccess: (result, body) => {
      if (result.kind !== 'created') return;
      qc.setQueryData(orderKey(result.order.number), result.order);
      if (!body.item) void qc.invalidateQueries({ queryKey: CART_KEY });
      void qc.invalidateQueries({ queryKey: ORDERS_KEY });
      void qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
}

export const ORDERS_KEY = ['orders'] as const;
export const orderKey = (number: number) => ['orders', number] as const;

/** The «Заказы» list, newest first, a page at a time; statuses come from the server, never the bot. */
export function useOrders() {
  return useInfiniteQuery({
    queryKey: [...ORDERS_KEY, 'list'],
    refetchOnMount: 'always',
    initialPageParam: undefined as number | undefined,
    queryFn: async ({ pageParam }) =>
      unwrap(await api.orders.list({ query: { before: pageParam } }), 200),
    getNextPageParam: (page) => page.next ?? undefined,
  });
}

/** One order; `null` when it is not this customer's (or does not exist). */
export function useOrder(number: number) {
  return useQuery({
    queryKey: orderKey(number),
    refetchOnMount: 'always',
    queryFn: async () => {
      const res = await api.orders.get({ params: { number } });
      if (res.status === 404) return null;
      return unwrap(res, 200);
    },
  });
}

export const paymentKey = (number: number) => ['orders', number, 'payment'] as const;

/**
 * The payment screen: the order, the shop card (null while none is set), the receipts sent and
 * the upload limit; `null` when the order is not this customer's. Re-read on every open, so a
 * card the owner changed meanwhile is the one shown.
 */
export function usePayment(number: number) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: paymentKey(number),
    refetchOnMount: 'always',
    staleTime: 0,
    queryFn: async () => {
      const res = await api.orders.payment({ params: { number } });
      if (res.status === 404) return null;
      const payment = unwrap(res, 200);
      // the order screen reads the same order: keep it in step
      qc.setQueryData(orderKey(number), payment.order);
      return payment;
    },
  });
}

export type CancelResult =
  /** Cancelled now; the order as it reads after. */
  | { kind: 'cancelled'; order: OrderDto }
  /** Its status moved on before the press (a receipt went in, the reserve expired, a second press). */
  | { kind: 'changed'; order: OrderDto }
  | { kind: 'try_again' };

/**
 * «Отменить заказ» (ADR 0011: only while «Ожидает оплаты»). The status the shopper saw goes along,
 * so a stale screen or a second press is answered with the order as it is now, never a second
 * cancel. Either way the screen shows what the server says.
 */
export function useCancelOrder(number: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (expectedStatus: OrderStatus): Promise<CancelResult> => {
      const res = await api.orders.cancel({ params: { number }, body: { expectedStatus } });
      if (res.status === 200) return { kind: 'cancelled', order: res.body };
      if (res.status === 409)
        return 'order' in res.body
          ? { kind: 'changed', order: res.body.order }
          : { kind: 'try_again' };
      if (res.status === 403 || res.status === 404) {
        // not cancellable from what the screen showed: read the order again
        const fresh = await api.orders.get({ params: { number } });
        if (fresh.status === 200) return { kind: 'changed', order: fresh.body };
      }
      throw new Error(`HTTP ${res.status}`);
    },
    onSuccess: (result) => {
      if (result.kind === 'try_again') return;
      qc.setQueryData(orderKey(number), result.order);
      void qc.invalidateQueries({ queryKey: [...ORDERS_KEY, 'list'] });
      void qc.invalidateQueries({ queryKey: paymentKey(number) });
    },
  });
}

export type RepeatOutcome =
  | { kind: 'done'; result: RepeatResultDto }
  /** 409: the order is not delivered or cancelled (any more): the screens re-read it. */
  | { kind: 'not_repeatable' };

/**
 * «Повторить заказ» (a delivered or cancelled order): the order's lines go into the cart at
 * today's prices; the answer says, per line, what went in and why a line came back short. The
 * cart it returns replaces the cached one (tab-bar count included).
 */
export function useRepeatOrder(number: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<RepeatOutcome> => {
      const res = await api.orders.repeat({ params: { number } });
      if (res.status === 409) {
        void qc.invalidateQueries({ queryKey: ORDERS_KEY });
        return { kind: 'not_repeatable' };
      }
      const body = unwrap(res, 200);
      qc.setQueryData(CART_KEY, body.cart);
      return { kind: 'done', result: body.result };
    },
  });
}

export const SAVED_POINTS_KEY = ['me', 'points'] as const;

/** «Мои пункты BTS»: the recipient and point pairs of past orders, the last used first. */
export function useSavedPoints() {
  return useQuery({
    queryKey: SAVED_POINTS_KEY,
    refetchOnMount: 'always',
    queryFn: async () => unwrap(await api.me.savedPoints(), 200),
  });
}

/** Forgets one pair (orders keep their own snapshot); checkout re-reads its list. */
export function useRemoveSavedPoint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number): Promise<SavedPointDto[]> => {
      const res = await api.me.removeSavedPoint({ params: { id } });
      // already gone (another device): the list as it is now
      if (res.status === 404) return unwrap(await api.me.savedPoints(), 200);
      return unwrap(res, 200);
    },
    onSuccess: (list) => {
      qc.setQueryData(SAVED_POINTS_KEY, list);
      void qc.invalidateQueries({ queryKey: ['checkout'] });
    },
  });
}
