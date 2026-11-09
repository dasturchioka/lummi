import * as React from 'react';
import { cn } from '@/lib/utils';

/*
 * Data table on a white card: Muted Ink header on a hairline, hairlines between rows, tabular
 * numerals. Wide tables scroll inside their card, never the page. For phones, a screen may
 * render the same rows as a list (see staff-manager.tsx).
 */
export const Table = ({ className, ...p }: React.ComponentProps<'table'>) => (
  <div className="w-full overflow-x-auto overscroll-x-contain">
    <table
      className={cn('w-full border-collapse text-left text-sm tabular-nums', className)}
      {...p}
    />
  </div>
);
export const THead = (p: React.ComponentProps<'thead'>) => <thead {...p} />;
export const TBody = ({ className, ...p }: React.ComponentProps<'tbody'>) => (
  <tbody className={cn('[&>tr:last-child]:border-0', className)} {...p} />
);
export const TR = ({ className, ...p }: React.ComponentProps<'tr'>) => (
  <tr
    className={cn(
      'border-b border-border transition-colors duration-150 [tbody>&]:hover:bg-milk/60',
      className,
    )}
    {...p}
  />
);
export const TH = ({ className, ...p }: React.ComponentProps<'th'>) => (
  <th
    className={cn(
      'h-10 whitespace-nowrap px-4 text-[12.5px] font-medium text-muted-foreground first:pl-5 last:pr-5',
      className,
    )}
    {...p}
  />
);
export const TD = ({ className, ...p }: React.ComponentProps<'td'>) => (
  <td className={cn('h-14 px-4 py-2 align-middle first:pl-5 last:pr-5', className)} {...p} />
);
