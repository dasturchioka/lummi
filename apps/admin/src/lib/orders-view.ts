import type { Search } from '@/lib/list-page';

export type OrdersView = 'board' | 'list';

/**
 * Which view «Заказы» opens (#52): the board by default, the list behind `?view=list`. A link
 * that names a status without a view (the Home's queues, an old bookmark) opens the list: on the
 * board the status is the column.
 */
export function ordersView(sp: Search): OrdersView {
  const asked = Array.isArray(sp.view) ? sp.view[0] : sp.view;
  if (asked === 'list') return 'list';
  if (asked === 'board') return 'board';
  return sp.status !== undefined ? 'list' : 'board';
}
