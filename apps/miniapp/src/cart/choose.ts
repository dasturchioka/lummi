import type { CartDto, DiscountChoiceDto } from '@lummi/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { CART_KEY } from './queries';

/**
 * The discount switch's tap (#39): the server judges it against the cart's own quote. A choice the
 * cart no longer offers (taken meanwhile) comes back with the cart as it is, which replaces the
 * shown one either way. Only the lazy cart screen imports this.
 */
export function useChooseDiscount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (choice: DiscountChoiceDto): Promise<CartDto> => {
      const res = await api.cart.chooseDiscount({ body: choice });
      if (res.status === 200 || res.status === 409)
        return res.status === 200 ? res.body : res.body.cart;
      throw new Error(`HTTP ${res.status}`);
    },
    onSuccess: (cart) => qc.setQueryData(CART_KEY, cart),
  });
}
