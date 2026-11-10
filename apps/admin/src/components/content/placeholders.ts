import { CONTENT_PLACEHOLDERS } from '@lummi/contracts';
import { formatMoney, type Language } from '@lummi/i18n';

export type Placeholder = (typeof CONTENT_PLACEHOLDERS)[number];

/** The settings behind the placeholders, as the page route read them (absent when the read failed). */
export interface PlaceholderSettings {
  threshold?: number;
  tariff?: number;
  manager?: string;
}

/**
 * What the API puts in place of each `{placeholder}` when a customer reads the page (`fillBody` in
 * `apps/api/src/content/content.service.ts`), for the editor's preview and the list under the text.
 */
export function placeholderValues(
  s: PlaceholderSettings,
  language: Language,
): Partial<Record<Placeholder, string>> {
  return {
    freeDeliveryThreshold:
      s.threshold === undefined ? undefined : formatMoney(s.threshold, language),
    defaultTariff: s.tariff === undefined ? undefined : formatMoney(s.tariff, language),
    managerUsername: s.manager,
    managerLink: s.manager && `https://t.me/${s.manager.replace(/^@/, '')}`,
  };
}

/** Wraps a filled value in the preview, so it can be drawn as «came from the settings». */
export const FILLED = /\uE000([^\uE001]*)\uE001/;

/**
 * Fills the body the way the API does before it is parsed, so the preview's links and wrapping are
 * the customer's. Text values are wrapped in `FILLED` markers; `{managerLink}` is a link target
 * and goes in plain. A value the route could not read leaves its `{name}`, still marked.
 */
export function fillForPreview(source: string, values: Partial<Record<Placeholder, string>>) {
  return source.replace(/\{(\w+)\}/g, (m, key: string) => {
    if (!(CONTENT_PLACEHOLDERS as readonly string[]).includes(key)) return m;
    const value = values[key as Placeholder];
    if (key === 'managerLink') return value ?? m;
    return `\uE000${value ?? m}\uE001`;
  });
}
