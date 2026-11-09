import { dictionaries, type Language } from '@lummi/i18n';
import { cookies } from 'next/headers';

export const LANG_COOKIE = 'lummi_lang';

/** Admin language: a plain cookie set by the switch in the header; RU by default. */
export async function getLanguage(): Promise<Language> {
  const value = (await cookies()).get(LANG_COOKIE)?.value;
  return value === 'uz' ? 'uz' : 'ru';
}

export async function getAdminMessages() {
  const language = await getLanguage();
  return { language, t: dictionaries[language].admin };
}
export type AdminMessages = Awaited<ReturnType<typeof getAdminMessages>>['t'];
