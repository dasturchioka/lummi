'use client';

import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';

const COOKIE = 'lummi_lang';

export function LanguageSwitch({ current, label }: { current: 'ru' | 'uz'; label: string }) {
  const router = useRouter();
  const set = (lang: 'ru' | 'uz') => {
    document.cookie = `${COOKIE}=${lang}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  };
  return (
    <div role="group" aria-label={label} className="flex gap-1 text-sm font-semibold">
      {(['ru', 'uz'] as const).map((lang) => (
        <button
          key={lang}
          type="button"
          onClick={() => set(lang)}
          aria-pressed={current === lang}
          className={cn(
            'rounded-button px-2 py-1 uppercase',
            current === lang ? 'bg-primary text-primary-foreground' : 'hover:bg-muted',
          )}
        >
          {lang}
        </button>
      ))}
    </div>
  );
}
