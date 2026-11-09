import type { Metadata } from 'next';
import { Cormorant_Garamond, Manrope, Tenor_Sans } from 'next/font/google';
import { getLanguage } from '@/lib/i18n';
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
});

export const metadata: Metadata = { title: 'LUMMI. Admin', robots: { index: false } };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = await getLanguage();
  return (
    <html lang={lang} className={`${manrope.variable} ${tenor.variable} ${cormorant.variable}`}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
