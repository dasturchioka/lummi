import type { Language } from './language';
import { adminMessages } from './admin';
import { botMessages } from './bot';
import { discountsMessages } from './discounts';
import { miniappMessages } from './miniapp';
import { ordersMessages } from './orders';
import { setsMessages } from './sets';
import { sharedMessages } from './shared';

/**
 * Every namespace merged, for server code that needs several (the API). The Mini App and the
 * admin import their own namespace instead, so they never bundle another surface's strings.
 */
export const dictionaries = {
  ru: {
    ...sharedMessages.ru,
    ...botMessages.ru,
    ...miniappMessages.ru,
    ...ordersMessages.ru,
    ...setsMessages.ru,
    ...discountsMessages.ru,
    ...adminMessages.ru,
  },
  uz: {
    ...sharedMessages.uz,
    ...botMessages.uz,
    ...miniappMessages.uz,
    ...ordersMessages.uz,
    ...setsMessages.uz,
    ...discountsMessages.uz,
    ...adminMessages.uz,
  },
} satisfies Record<Language, object>;
