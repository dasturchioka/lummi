import type { CartDto, DiscountChoiceDto } from '@lummi/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { CART_KEY } from './queries';

/**
 * The discount switch's tap (#39): the server judges it against the cart's own quote. A choice the
 * cart no longer offers (taken meanwhile) is `refused` and comes back with the cart as it is, which
 * replaces the shown one either way; the screen says the tap was refused. Only the lazy cart screen
 * imports this.
 */
export function useChooseDiscount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (choice: DiscountChoiceDto): Promise<{ cart: CartDto; refused: boolean }> => {
      const res = await api.cart.chooseDiscount({ body: choice });
      if (res.status === 200) return { cart: res.body, refused: false };
      if (res.status === 409) return { cart: res.body.cart, refused: true };
      throw new Error(`HTTP ${res.status}`);
    },
    onSuccess: ({ cart }) => qc.setQueryData(CART_KEY, cart),
  });
}
