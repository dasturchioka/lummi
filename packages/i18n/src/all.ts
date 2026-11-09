import type { Language } from './language';
import { adminMessages } from './admin';
import { botMessages } from './bot';
import { miniappMessages } from './miniapp';
import { sharedMessages } from './shared';

/**
 * Every namespace merged, for server code that needs several (the API). The Mini App and the
 * admin import their own namespace instead, so they never bundle another surface's strings.
 */
export const dictionaries = {
  ru: { ...sharedMessages.ru, ...botMessages.ru, ...miniappMessages.ru, ...adminMessages.ru },
  uz: { ...sharedMessages.uz, ...botMessages.uz, ...miniappMessages.uz, ...adminMessages.uz },
} satisfies Record<Language, object>;
