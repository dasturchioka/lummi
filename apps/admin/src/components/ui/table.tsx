import * as React from 'react';
import { cn } from '@/lib/utils';

export const Table = ({ className, ...p }: React.ComponentProps<'table'>) => (
  <div className="w-full overflow-x-auto">
    <table className={cn('w-full text-left text-[15px]', className)} {...p} />
  </div>
);
export const THead = (p: React.ComponentProps<'thead'>) => <thead {...p} />;
export const TBody = (p: React.ComponentProps<'tbody'>) => <tbody {...p} />;
export const TR = ({ className, ...p }: React.ComponentProps<'tr'>) => (
  <tr className={cn('border-b border-border last:border-0', className)} {...p} />
);
export const TH = ({ className, ...p }: React.ComponentProps<'th'>) => (
  <th className={cn('px-4 py-3 text-sm font-medium text-muted-foreground', className)} {...p} />
);
export const TD = ({ className, ...p }: React.ComponentProps<'td'>) => (
  <td className={cn('px-4 py-3 align-middle', className)} {...p} />
);
