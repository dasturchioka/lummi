export const LANGUAGES = ['ru', 'uz'] as const;
export type Language = (typeof LANGUAGES)[number];
export const DEFAULT_LANGUAGE: Language = 'ru';

/** Telegram `language_code` -> our language: `uz` gives UZ, anything else RU (CLAUDE.md). */
export function languageFromTelegram(code: string | undefined | null): Language {
  return code?.toLowerCase().split('-')[0] === 'uz' ? 'uz' : 'ru';
}
