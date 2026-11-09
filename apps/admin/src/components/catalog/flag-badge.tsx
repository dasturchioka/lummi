import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * ХИТ / НОВИНКА drawn as the shop draws them (DESIGN.md "Badges"): a 20 px Tenor caps pill,
 * filled Sage with Graphite text for a hit, a Sage outline with Sage Ink text for a new one. The
 * tracked caps sit 1 px low and 2 px tighter on the right so they look centred.
 */
export function FlagBadge({ kind, children }: { kind: 'hit' | 'new'; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center rounded-full pt-px pr-1.5 pl-2 font-display text-[10px] leading-none tracking-[0.2em] whitespace-nowrap uppercase',
        kind === 'hit'
          ? 'bg-sage text-graphite'
          : 'text-sage-ink shadow-[inset_0_0_0_1px_var(--sage)]',
      )}
    >
      {children}
    </span>
  );
}
