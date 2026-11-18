'use client';

import { useRouter } from 'next/navigation';
import { createContext, use, useTransition, type ReactNode } from 'react';
import { Card } from '@/components/ui/card';
import type { AdminMessages } from '@/lib/i18n';
import { cn, fill } from '@/lib/utils';
import { percentValue } from './cost-rows';
import { PROFITABILITY_VOLUMES } from '@lummi/contracts';
import { hrefOf, type View } from './view';

/*
 * Every choice on «Рентабельность» (#77) goes to the URL, and the server answers with the figures:
 * the table, the calculator and the simulator are all rendered from the URL, so a reload or a link
 * keeps them. While the next figures load, the ones shown stay and dim (`Dimmed`), never flash.
 */

type Nav = { view: View; go: (change: Partial<View>) => void; pending: boolean };
const NavContext = createContext<Nav | null>(null);

export function useViewNav(): Nav {
  const nav = use(NavContext);
  if (!nav) throw new Error('useViewNav outside ViewNav');
  return nav;
}

export function ViewNav({ view, children }: { view: View; children: ReactNode }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const go = (change: Partial<View>) =>
    start(() => router.replace(hrefOf(view, change), { scroll: false }));
  return <NavContext value={{ view, go, pending }}>{children}</NavContext>;
}

/** The figures under the controls: kept while the next ones load, at 60 % after 150 ms. */
export function Dimmed({ children }: { children: ReactNode }) {
  const { pending } = useViewNav();
  return (
    <div
      aria-busy={pending || undefined}
      className={cn('transition-opacity duration-150 ease-out', pending && 'opacity-60 delay-150')}
    >
      {children}
    </div>
  );
}

/** A pill track of options, the current one a white segment at 600 (the panel's segmented grammar). */
export function Segmented<K extends string>({
  label,
  items,
  current,
  onPick,
}: {
  label: string;
  items: readonly { key: K; label: string }[];
  current: K | null;
  onPick: (key: K) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex h-9 max-w-full items-center overflow-x-auto rounded-full bg-field p-[3px] [scrollbar-width:none]"
    >
      {items.map((i) => (
        <button
          key={i.key}
          type="button"
          aria-pressed={i.key === current}
          onClick={() => i.key !== current && onPick(i.key)}
          className={cn(
            'grid h-full shrink-0 place-items-center rounded-full px-3 text-[13px] whitespace-nowrap transition-[color,background-color] duration-150 ease-out',
            i.key === current
              ? 'bg-card font-semibold text-foreground'
              : 'font-medium text-muted-foreground hover:text-foreground',
          )}
        >
          {i.label}
        </button>
      ))}
    </div>
  );
}

function Check({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (on: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label className="flex min-h-9 cursor-pointer items-center gap-2.5 text-sm">
      <input
        type="checkbox"
        className="size-[18px] shrink-0 accent-graphite"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="min-w-0">{children}</span>
    </label>
  );
}

export const FIELD_LABEL = 'text-[12.5px] font-medium text-muted-foreground';

/**
 * The view of every tab: the channel and the calculator's two toggles, and on the table its volume
 * filter.
 */
export function ProfitabilityControls({
  afterSetPercent,
  t,
}: {
  afterSetPercent: number;
  t: AdminMessages;
}) {
  const p = t.profitability;
  const { view, go } = useViewNav();
  return (
    <Card className="mb-4 flex flex-wrap items-end gap-x-6 gap-y-4 p-4 lg:p-5">
      <div className="grid gap-1.5">
        <span className={FIELD_LABEL}>{p.channel}</span>
        <Segmented
          label={p.channel}
          current={view.channel}
          items={[
            { key: 'miniapp', label: p.channels.miniapp },
            { key: 'uzum', label: p.channels.uzum },
          ]}
          onPick={(channel) => go({ channel })}
        />
      </div>
      {view.tab === 'table' && (
        <div className="grid max-w-full gap-1.5">
          <span className={FIELD_LABEL}>{p.volume}</span>
          <Segmented
            label={p.volume}
            current={view.ml}
            items={PROFITABILITY_VOLUMES.map((k) => ({
              key: k,
              label: k === 'all' ? p.all : k === 'set' ? p.set : fill(p.ml, { ml: k }),
            }))}
            onPick={(ml) => go({ ml })}
          />
        </div>
      )}
      <fieldset className="grid">
        <legend className={cn(FIELD_LABEL, 'mb-1')}>{p.conditions}</legend>
        <div className="flex flex-wrap gap-x-5">
          <Check
            checked={view.afterSetDiscount}
            onChange={(afterSetDiscount) => go({ afterSetDiscount })}
          >
            {fill(p.afterSetDiscount, { percent: percentValue(afterSetPercent) })}
          </Check>
          <Check checked={view.giftSample} onChange={(giftSample) => go({ giftSample })}>
            {p.giftSample}
          </Check>
        </div>
      </fieldset>
    </Card>
  );
}
