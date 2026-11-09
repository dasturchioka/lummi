'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { LANG_COOKIE } from '@/lib/lang-cookie';
import { cn } from '@/lib/utils';

/** RU / UZ pill pair (DESIGN.md): Milk Field track, Graphite fill on the active option. */
export function LanguageSwitch({
  current,
  label,
  className,
}: {
  current: 'ru' | 'uz';
  label: string;
  className?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const set = (lang: 'ru' | 'uz') => {
    if (lang === current) return;
    document.cookie = `${LANG_COOKIE}=${lang}; path=/; max-age=31536000; samesite=lax`;
    start(() => router.refresh());
  };
  return (
    <div
      role="group"
      aria-label={label}
      aria-busy={pending || undefined}
      className={cn(
        'inline-flex h-9 shrink-0 items-center rounded-full bg-field p-[3px]',
        className,
      )}
    >
      {(['ru', 'uz'] as const).map((lang) => (
        <button
          key={lang}
          type="button"
          lang={lang}
          onClick={() => set(lang)}
          aria-pressed={current === lang}
          className={cn(
            'h-full min-w-11 rounded-full px-3 text-xs font-semibold tracking-wide uppercase transition-[color,background-color,transform] duration-150 ease-out active:scale-[0.96]',
            current === lang
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {lang}
        </button>
      ))}
    </div>
  );
}
