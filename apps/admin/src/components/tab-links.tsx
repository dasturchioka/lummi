import Link from 'next/link';
import { cn } from '@/lib/utils';

/**
 * Link tabs in a pill track: each tab is a page of its own (the sales and marketing reports,
 * «Отзывы» and its requests), so a view keeps its URL. The current one is a white pill.
 */
export function TabLinks<K extends string>({
  label,
  items,
  current,
}: {
  label: string;
  items: readonly { key: K; href: string; label: string }[];
  current: K;
}) {
  return (
    <nav
      aria-label={label}
      className="mb-4 inline-flex h-9 items-center rounded-full bg-field p-[3px]"
    >
      {items.map((i) => (
        <Link
          key={i.key}
          href={i.href}
          aria-current={i.key === current ? 'page' : undefined}
          className={cn(
            'grid h-full place-items-center rounded-full px-4 text-[13px] whitespace-nowrap transition-[color,background-color] duration-150 ease-out',
            i.key === current
              ? 'bg-card font-semibold text-foreground'
              : 'font-medium text-muted-foreground hover:text-foreground',
          )}
        >
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
