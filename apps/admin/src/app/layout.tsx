import type { Metadata, Viewport } from 'next';
import { Cormorant_Garamond, Manrope, Tenor_Sans } from 'next/font/google';
import { getAdminMessages, getLanguage } from '@/lib/i18n';
import { getTheme, THEME_COLOR } from '@/lib/theme';
import './globals.css';

const manrope = Manrope({ subsets: ['latin', 'cyrillic'], variable: '--font-manrope' });
const tenor = Tenor_Sans({
  subsets: ['latin', 'cyrillic'],
  weight: '400',
  variable: '--font-tenor',
});
const cormorant = Cormorant_Garamond({
  subsets: ['latin', 'cyrillic'],
  style: 'italic',
  weight: '500',
  variable: '--font-cormorant',
  preload: false, // fragrance names only; no admin screen shows one yet
});

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getAdminMessages();
  return { title: `LUMMI. ${t.panel}`, robots: { index: false } };
}
// The theme colour is the ground of the chosen theme (the top of every screen). The keyboard
// resizes the layout so a bottom-sheet form stays above it on Android too.
export async function generateViewport(): Promise<Viewport> {
  return {
    themeColor: THEME_COLOR[await getTheme()],
    viewportFit: 'cover',
    interactiveWidget: 'resizes-content',
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = await getLanguage();
  const theme = await getTheme();
  return (
    <html
      lang={lang}
      data-theme={theme}
      className={`${manrope.variable} ${tenor.variable} ${cormorant.variable}`}
    >
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
