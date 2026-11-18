/** The admin theme lives in a plain cookie set by the switch (like `lummi_lang`); light by default. */
export const THEME_COOKIE = 'lummi_theme';
export type Theme = 'light' | 'dark';

/** The ground colour of each theme, for the browser's bar (the `--milk` of globals.css). */
export const THEME_COLOR: Record<Theme, string> = { light: '#f5f2ec', dark: '#1d1c1a' };

export function themeFrom(value: string | undefined): Theme {
  return value === 'dark' ? 'dark' : 'light';
}
