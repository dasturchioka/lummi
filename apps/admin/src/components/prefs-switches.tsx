'use client';

import { Moon, Sun } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useSyncExternalStore, useTransition } from 'react';
import { LANG_COOKIE } from '@/lib/lang-cookie';
import { THEME_COLOR, THEME_COOKIE, type Theme } from '@/lib/theme';
import { cn } from '@/lib/utils';

const THEME_EVENT = 'lummi-theme';

function writeCookie(name: string, value: string) {
  document.cookie = `${name}=${value}; path=/; max-age=31536000; samesite=lax`;
}

/** One source for the theme: `<html data-theme>`, so every switch on the page agrees. */
function useTheme(initial: Theme): Theme {
  return useSyncExternalStore(
    (notify) => {
      window.addEventListener(THEME_EVENT, notify);
      return () => window.removeEventListener(THEME_EVENT, notify);
    },
    () => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'),
    () => initial,
  );
}

function Track({
  label,
  busy,
  children,
}: {
  label: string;
  busy?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      aria-busy={busy || undefined}
      className="inline-flex h-9 shrink-0 items-center rounded-full bg-field p-[3px]"
    >
      {children}
    </div>
  );
}

const segment = (active: boolean, extra?: string) =>
  cn(
    'h-full rounded-full text-xs transition-[color,background-color,transform] duration-150 ease-out active:scale-[0.96]',
    active
      ? 'bg-card font-semibold text-foreground'
      : 'font-medium text-muted-foreground hover:text-foreground',
    extra,
  );

export type PrefsLabels = {
  language: string;
  theme: { label: string; light: string; dark: string };
};

/**
 * The panel's two preferences as twin segmented controls (DESIGN.md): RU / UZ, then Светлая /
 * Тёмная (Sun and Moon; `words` adds the names where there is room). Both write a plain cookie.
 */
export function PrefsSwitches({
  language,
  theme: initialTheme,
  labels,
  words = false,
  className,
}: {
  language: 'ru' | 'uz';
  theme: Theme;
  labels: PrefsLabels;
  words?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const theme = useTheme(initialTheme);

  const setLanguage = (lang: 'ru' | 'uz') => {
    if (lang === language) return;
    writeCookie(LANG_COOKIE, lang);
    start(() => router.refresh());
  };
  const setTheme = (next: Theme) => {
    if (next === theme) return;
    writeCookie(THEME_COOKIE, next);
    document.documentElement.dataset.theme = next; // at once; the server renders the cookie next time
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[next]);
    window.dispatchEvent(new Event(THEME_EVENT));
  };

  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      <Track label={labels.language} busy={pending}>
        {(['ru', 'uz'] as const).map((lang) => (
          <button
            key={lang}
            type="button"
            lang={lang}
            onClick={() => setLanguage(lang)}
            aria-pressed={language === lang}
            className={segment(language === lang, 'min-w-10 px-2.5 tracking-wide uppercase')}
          >
            {lang}
          </button>
        ))}
      </Track>
      <Track label={labels.theme.label}>
        {(['light', 'dark'] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setTheme(value)}
            aria-pressed={theme === value}
            aria-label={labels.theme[value]}
            title={labels.theme[value]}
            className={segment(
              theme === value,
              cn('inline-flex min-w-9 items-center justify-center gap-1.5 px-2', words && 'px-3'),
            )}
          >
            {value === 'light' ? (
              <Sun className="size-4" strokeWidth={1.5} aria-hidden />
            ) : (
              <Moon className="size-4" strokeWidth={1.5} aria-hidden />
            )}
            {words && <span>{labels.theme[value]}</span>}
          </button>
        ))}
      </Track>
    </div>
  );
}
