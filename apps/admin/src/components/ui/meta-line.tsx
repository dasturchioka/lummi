import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Short facts joined by « · » («Самарканд · Пн-Сб: 09:00-18:00») where a wrap never leaves a
 * dot at the end or the start of a line. Each part carries its dot in a 1.1 em slot on its left,
 * and every line starts 1.1 em outside the clipped box, so a part that opens a line loses its dot.
 * A part longer than the line wraps inside its own box (it keeps the slot as a hanging indent,
 * which the shift cancels). Empty parts are dropped.
 */
export function MetaLine({ parts, className }: { parts: ReactNode[]; className?: string }) {
  const shown = parts.filter((p) => p !== null && p !== undefined && p !== false && p !== '');
  if (shown.length === 0) return null;
  return (
    <span className={cn('block overflow-hidden', className)}>
      <span className="-ml-[1.1em] flex flex-wrap">
        {shown.map((part, i) => (
          <span key={i} className="relative min-w-0 pl-[1.1em] break-words">
            <span aria-hidden className="absolute left-0 w-[1.1em] text-center">
              ·
            </span>
            {part}
          </span>
        ))}
      </span>
    </span>
  );
}
