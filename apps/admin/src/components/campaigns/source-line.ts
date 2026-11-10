import type { AdminCampaignLink } from '@lummi/contracts';
import type { AdminMessages } from '@/lib/i18n';

/** «Блогер · Малика»: the source and its label, as the list and the editor read it. */
export function sourceLine(
  l: Pick<AdminCampaignLink, 'source' | 'sourceLabel'>,
  t: AdminMessages,
): string {
  const name = t.campaigns.sources[l.source];
  return l.sourceLabel ? `${name} · ${l.sourceLabel}` : name;
}

/** What the link opens, in words: a fixed screen or «Аромат <name>». */
export function targetLine(
  target: string,
  t: AdminMessages,
  fragranceName: (slug: string) => string,
): string {
  const slug = /^p_(.+)$/.exec(target)?.[1];
  if (slug) return `${t.campaigns.fragrance}: ${fragranceName(slug)}`;
  return (t.broadcasts.targets as Record<string, string>)[target] ?? target;
}
