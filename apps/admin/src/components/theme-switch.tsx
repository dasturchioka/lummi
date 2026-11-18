'use client';

import { Moon, Sun } from 'lucide-react';
import { useState } from 'react';
import { THEME_COLOR, THEME_COOKIE, type Theme } from '@/lib/theme-cookie';
import { cn } from '@/lib/utils';

/** Светлая / Тёмная as a segmented control, the twin of the RU/UZ switch (same track and segment),
 * two icon segments (Sun, Moon) named for screen readers, so it fits beside RU/UZ in the 280 px sidebar. */
export function ThemeSwitch({
  current,
  label,
  names,
  className,
}: {
  current: Theme;
  label: string;
  names: Record<Theme, string>;
  className?: string;
}) {
  const [theme, setTheme] = useState(current);
  const set = (next: Theme) => {
    if (next === theme) return;
    document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.dataset.theme = next; // at once; the server renders the cookie next time
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[next]);
    setTheme(next);
  };
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        'inline-flex h-9 shrink-0 items-center rounded-full bg-field p-[3px]',
        className,
      )}
    >
      {(['light', 'dark'] as const).map((value) => (
        <button
          key={value}
          type="button"
          onClick={() => set(value)}
          aria-pressed={theme === value}
          aria-label={names[value]}
          title={names[value]}
          className={cn(
            'grid h-full min-w-9 place-items-center rounded-full px-2 transition-[color,background-color,transform] duration-150 ease-out active:scale-[0.96]',
            theme === value
              ? 'bg-card text-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {value === 'light' ? (
            <Sun className="size-4" strokeWidth={1.5} aria-hidden />
          ) : (
            <Moon className="size-4" strokeWidth={1.5} aria-hidden />
          )}
        </button>
      ))}
    </div>
  );
}
