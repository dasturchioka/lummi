'use client';

import { cn } from '@/lib/utils';

/** RU / UZ tabs of an editor: the same segmented look as the panel's language switch. */
export function LangTabs({
  value,
  onChange,
  label,
  labels,
}: {
  value: 'ru' | 'uz';
  onChange: (v: 'ru' | 'uz') => void;
  label: string;
  labels: { ru: string; uz: string };
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="inline-flex h-9 w-fit items-center justify-self-start rounded-full bg-field p-[3px]"
    >
      {(['ru', 'uz'] as const).map((lang) => (
        <button
          key={lang}
          type="button"
          role="tab"
          lang={lang}
          aria-selected={value === lang}
          onClick={() => onChange(lang)}
          className={cn(
            'h-full min-w-16 rounded-full px-3 text-[13px] transition-[color,background-color,transform] duration-150 ease-out active:scale-[0.96]',
            value === lang
              ? 'bg-card font-semibold text-foreground'
              : 'font-medium text-muted-foreground hover:text-foreground',
          )}
        >
          {labels[lang]}
        </button>
      ))}
    </div>
  );
}
