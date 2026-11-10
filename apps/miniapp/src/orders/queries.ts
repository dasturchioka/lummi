import type {
  CheckoutConflictCode,
  CheckoutDto,
  CreateOrderBody,
  OrderDto,
  OrderInputError,
  OrderStatus,
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

export const checkoutKey = (regionId: number | undefined) =>
  ['checkout', regionId ?? null] as const;

/**
 * The cart as checkout shows it, quoted by the server with the chosen point's region tariff
 * (ADR 0001). Re-read on every open; while another region is being quoted the last numbers stay.
 */
export function useCheckout(regionId: number | undefined) {
  return useQuery({
    queryKey: checkoutKey(regionId),
    staleTime: 0,
    refetchOnMount: 'always',
    placeholderData: keepPreviousData,
    queryFn: async () => unwrap(await api.checkout.get({ query: { regionId } }), 200),
  });
}

export type CreateResult =
  | { kind: 'created'; order: OrderDto }
  | { kind: 'conflict'; code: CheckoutConflictCode; checkout: CheckoutDto }
  | { kind: 'try_again' }
  | { kind: 'phone_required' }
  | { kind: 'invalid'; code: OrderInputError };

/** POST /orders. A created order empties the ordered cart lines, so the cart is re-read. */
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
      throw new Error(`HTTP ${res.status}`);
    },
    onSuccess: (result) => {
      if (result.kind !== 'created') return;
      qc.setQueryData(orderKey(result.order.number), result.order);
      void qc.invalidateQueries({ queryKey: CART_KEY });
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
    },
  });
}
