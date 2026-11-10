import type { MyDiscountsDto, SetBirthDateBody } from '@lummi/contracts';
import { discountsMessages } from '@lummi/i18n/discounts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CART_KEY } from '../cart/queries';
import { api, unwrap } from '../lib/api';
import { usePrefs } from '../lib/prefs';

/** «Мои скидки» strings: their own namespace, so only the lazy Profile and checkout carry them. */
export function useDiscountsText() {
  const { language } = usePrefs();
  return discountsMessages[language].discounts;
}

export const DISCOUNTS_KEY = ['me', 'discounts'] as const;

/** Profile «Мои скидки»: the date of birth, active coupons with days left, the next one to come. */
export function useMyDiscounts() {
  return useQuery({
    queryKey: DISCOUNTS_KEY,
    refetchOnMount: 'always',
    queryFn: async () => unwrap(await api.me.discounts(), 200),
  });
}

export type SetBirthDateResult =
  | { kind: 'saved'; discounts: MyDiscountsDto }
  /** Entered meanwhile (another device): the list as it is now. */
  | { kind: 'already_set'; discounts: MyDiscountsDto }
  | { kind: 'invalid' }
  | { kind: 'consent_required' };

/** The one-time date of birth (TZ §3.8); checkout's field and the coupon both read it again. */
export function useSetBirthDate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: SetBirthDateBody): Promise<SetBirthDateResult> => {
      const res = await api.me.setBirthDate({ body });
      if (res.status === 200) return { kind: 'saved', discounts: res.body };
      if (res.status === 409)
        return { kind: 'already_set', discounts: unwrap(await api.me.discounts(), 200) };
      if (res.status === 422)
        return res.body.code === 'consent_required'
          ? { kind: 'consent_required' }
          : { kind: 'invalid' };
      throw new Error(`HTTP ${res.status}`);
    },
    onSuccess: (r) => {
      if (r.kind === 'saved' || r.kind === 'already_set') {
        qc.setQueryData(DISCOUNTS_KEY, r.discounts);
        void qc.invalidateQueries({ queryKey: ['checkout'] });
        void qc.invalidateQueries({ queryKey: CART_KEY });
      }
    },
  });
}
