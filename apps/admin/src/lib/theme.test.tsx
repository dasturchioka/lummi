import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { THEME_COLOR, themeFrom } from './theme-cookie';

const cookieJar = vi.hoisted(() => ({ theme: undefined as string | undefined }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'lummi_theme' && cookieJar.theme ? { value: cookieJar.theme } : undefined,
  }),
}));
vi.mock('next/font/google', () => {
  const font = () => ({ variable: 'font-var' });
  return { Manrope: font, Tenor_Sans: font, Cormorant_Garamond: font };
});

const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
const block = (selector: string) => {
  const start = css.indexOf(`${selector} {`);
  return css.slice(start, css.indexOf('\n}', start));
};
const vars = (body: string) => [...body.matchAll(/^\s*(--[a-z-]+):/gm)].map((m) => m[1] ?? '');

describe('admin dark tokens', () => {
  const light = vars(block(':root'));
  const dark = vars(block(":root[data-theme='dark']"));
  // geometry and motion are not colours: they do not change with the theme
  const notColour = ['--radius-card', '--radius-button', '--ease-out', '--ease-drawer'];
  // brand constants: surfaces that mimic the Mini App's light look keep their value in both themes
  const constants = ['--brand-graphite', '--brand-milk', '--brand-stone'];

  it('gives every light colour token a dark value', () => {
    const missing = light.filter(
      (name) => !notColour.includes(name) && !constants.includes(name) && !dark.includes(name),
    );
    expect(missing).toEqual([]);
  });
  it('invents no dark token the light theme lacks', () => {
    expect(dark.filter((name) => !light.includes(name))).toEqual([]);
  });
  it('keeps the browser bar on the ground of each theme', () => {
    const ground = (selector: string) => /--milk: (#[0-9a-f]{6})/.exec(block(selector))?.[1] ?? '';
    expect(THEME_COLOR.dark).toBe(ground(":root[data-theme='dark']"));
    expect(THEME_COLOR.light).toBe(ground(':root'));
  });
});

describe('the cookie selects the theme', () => {
  it('reads it, light by default', () => {
    expect(themeFrom('dark')).toBe('dark');
    expect(themeFrom('light')).toBe('light');
    expect(themeFrom('sepia')).toBe('light');
    expect(themeFrom(undefined)).toBe('light');
  });
  it('the root layout renders the cookie into <html> on the server', async () => {
    const { default: RootLayout } = await import('../app/layout');
    for (const [value, expected] of [
      ['dark', 'dark'],
      [undefined, 'light'],
    ] as const) {
      cookieJar.theme = value;
      const html = renderToStaticMarkup(await RootLayout({ children: null }));
      expect(html).toContain(`data-theme="${expected}"`);
    }
  });
});
