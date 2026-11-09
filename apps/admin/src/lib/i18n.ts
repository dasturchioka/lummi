import { dictionaries, type Language } from '@lummi/i18n';
import { cookies } from 'next/headers';
import { LANG_COOKIE, languageFrom } from './lang-cookie';

/** Admin language: a plain cookie set by the switch in the panel; RU by default. */
export async function getLanguage(): Promise<Language> {
  return languageFrom((await cookies()).get(LANG_COOKIE)?.value);
}

export async function getAdminMessages() {
  const language = await getLanguage();
  return { language, t: dictionaries[language].admin };
}
export type AdminMessages = Awaited<ReturnType<typeof getAdminMessages>>['t'];
