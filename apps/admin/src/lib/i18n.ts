import type { Language } from '@lummi/i18n';
import { adminMessages } from '@lummi/i18n/admin';
import { cookies } from 'next/headers';
import { LANG_COOKIE, languageFrom } from './lang-cookie';
import { THEME_COOKIE, type Theme, themeFrom } from './theme-cookie';

/** Admin language: a plain cookie set by the switch in the panel; RU by default. */
export async function getLanguage(): Promise<Language> {
  return languageFrom((await cookies()).get(LANG_COOKIE)?.value);
}

/** Admin theme: a plain cookie set by the switch, so the server renders it with no flash; light by default. */
export async function getTheme(): Promise<Theme> {
  return themeFrom((await cookies()).get(THEME_COOKIE)?.value);
}

export async function getAdminMessages() {
  const language = await getLanguage();
  return { language, t: adminMessages[language].admin };
}
export type AdminMessages = Awaited<ReturnType<typeof getAdminMessages>>['t'];
