import type { CheckoutDto, CreateOrderBody, OrderDto } from '@lummi/contracts';
import { ordersMessages } from '@lummi/i18n/orders';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
  | { kind: 'conflict'; code: 'total_changed' | 'nothing_to_order'; checkout: CheckoutDto }
  | { kind: 'phone_required' }
  | {
      kind: 'invalid';
      code: 'consent_required' | 'unknown_point' | 'unknown_region' | 'gift_message_too_long';
    };

/** POST /orders. A created order empties the ordered cart lines, so the cart is re-read. */
export function useCreateOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateOrderBody): Promise<CreateResult> => {
      const res = await api.orders.create({ body });
      if (res.status === 201) return { kind: 'created', order: res.body };
      if (res.status === 409)
        return { kind: 'conflict', code: res.body.code, checkout: res.body.checkout };
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

/** The «Заказы» list, newest first; statuses come from the server, never from the bot. */
export function useOrders() {
  return useQuery({
    queryKey: ORDERS_KEY,
    refetchOnMount: 'always',
    queryFn: async () => unwrap(await api.orders.list(), 200),
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
