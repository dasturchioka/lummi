import type { Language } from '@lummi/i18n';

/** The admin language lives in a plain cookie set by the RU/UZ switch; RU by default. */
export const LANG_COOKIE = 'lummi_lang';

export function languageFrom(value: string | undefined): Language {
  return value === 'uz' ? 'uz' : 'ru';
}

/** Client side (error boundaries render without server props). */
export function languageFromDocument(): Language {
  const match = document.cookie.match(new RegExp(`(?:^|; )${LANG_COOKIE}=([^;]*)`));
  return languageFrom(match?.[1]);
}
