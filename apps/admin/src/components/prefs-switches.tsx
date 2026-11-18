'use client';

import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
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

/** The theme as the page shows it, and the one way to change it: cookie, `<html>`, bar colour. */
function useThemeChoice(initial: Theme): [Theme, (next: Theme) => void] {
  const theme = useTheme(initial);
  const setTheme = (next: Theme) => {
    if (next === theme) return;
    writeCookie(THEME_COOKIE, next);
    document.documentElement.dataset.theme = next; // at once; the server renders the cookie next time
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[next]);
    window.dispatchEvent(new Event(THEME_EVENT));
  };
  return [theme, setTheme];
}

/** RU / UZ as a segmented pill pair (DESIGN.md); writes the language cookie and re-renders. */
export function LanguageSwitch({ language, label }: { language: 'ru' | 'uz'; label: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const setLanguage = (lang: 'ru' | 'uz') => {
    if (lang === language) return;
    writeCookie(LANG_COOKIE, lang);
    start(() => router.refresh());
  };
  return (
    <Track label={label} busy={pending}>
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
  );
}

/**
 * The theme as one quiet icon button beside sign-out in the account block (#74): the Moon while
 * light, the Sun while dark. The two glyphs share one slot and swap with a short blur-and-scale
 * crossfade (opacity only under reduced motion), so the change reads as one object turning.
 */
export function ThemeToggle({
  theme: initialTheme,
  labels,
}: {
  theme: Theme;
  labels: PrefsLabels['theme'];
}) {
  const [theme, setTheme] = useThemeChoice(initialTheme);
  const dark = theme === 'dark';
  const glyph =
    'absolute inset-0 m-auto size-5 transition-[opacity,transform,filter] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-opacity';
  const hidden = 'scale-50 opacity-0 blur-[2px] motion-reduce:scale-100 motion-reduce:blur-none';
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-pressed={dark}
      aria-label={`${labels.label}: ${labels.dark}`}
      title={dark ? labels.light : labels.dark}
      onClick={() => setTheme(dark ? 'light' : 'dark')}
      className="relative"
    >
      <Moon className={cn(glyph, dark && hidden)} strokeWidth={1.5} aria-hidden />
      <Sun className={cn(glyph, !dark && hidden)} strokeWidth={1.5} aria-hidden />
    </Button>
  );
}

/**
 * Both preferences as twin segmented controls, for the sign-in pages where there is room:
 * RU / UZ, then Светлая / Тёмная (Sun and Moon; `words` adds the names).
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
  const [theme, setTheme] = useThemeChoice(initialTheme);
  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      <LanguageSwitch language={language} label={labels.language} />
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
