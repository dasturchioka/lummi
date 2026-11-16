import { Kanban, List } from 'lucide-react';
import Link from 'next/link';
import type { AdminMessages } from '@/lib/i18n';
import { listHref } from '@/lib/list-page';
import { cn } from '@/lib/utils';
import type { OrdersView } from '@/lib/orders-view';
import type { OrderFilters } from './orders-filters';

/**
 * «Воронка | Список» (#52): two links in the panel's segmented grammar (a Milk Field track, the
 * current one white). Each keeps the filters that apply to it: the board has no status filter and
 * no `paidOn` (the Home's cards open the list).
 */
export function ViewSwitch({
  view,
  filters,
  t,
}: {
  view: OrdersView;
  filters: OrderFilters;
  t: AdminMessages;
}) {
  const v = t.orders.view;
  const { status: _status, paidOn: _paidOn, ...shared } = filters;
  const links = [
    { key: 'board', label: v.board, icon: Kanban, href: listHref('/orders', shared) },
    {
      key: 'list',
      label: v.list,
      icon: List,
      href: listHref('/orders', { view: 'list', ...filters }),
    },
  ] as const;
  return (
    <nav
      aria-label={v.label}
      className="inline-flex h-11 items-center rounded-full bg-field p-[3px]"
      data-view-switch
    >
      {links.map(({ key, label, icon: Icon, href }) => (
        <Link
          key={key}
          href={href}
          aria-current={view === key ? 'page' : undefined}
          className={cn(
            'inline-flex h-full items-center gap-1.5 rounded-full px-3.5 text-[13.5px] transition-[color,background-color,transform] duration-150 ease-out active:scale-[0.96]',
            view === key
              ? 'bg-card font-semibold text-foreground'
              : 'font-medium text-muted-foreground hover:text-foreground',
          )}
        >
          <Icon className="size-4" strokeWidth={1.5} aria-hidden />
          {label}
        </Link>
      ))}
    </nav>
  );
}
