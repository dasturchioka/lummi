'use client';

import { usePathname } from 'next/navigation';
import { Monogram } from '@/components/logo';
import { NAV, isActive } from '@/lib/nav';

/** The current section's menu icon (1.5 px stroke); the "L." monogram outside any section. */
export function SectionIcon() {
  const pathname = usePathname();
  const item = NAV.flatMap((g) => g.items).find(
    (i) => i.href && i.href !== '/' && isActive(i.href, pathname),
  );
  if (!item) return <Monogram className="h-[22px]" />;
  const Icon = item.icon;
  return <Icon className="size-6" strokeWidth={1.5} aria-hidden />;
}
