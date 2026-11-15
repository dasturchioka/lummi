import { CONTENT_PLACEHOLDERS } from '@lummi/contracts';
import { deliveryEta, formatDuration, formatMoney, type Language } from '@lummi/i18n';

export type Placeholder = (typeof CONTENT_PLACEHOLDERS)[number];

/** The settings behind the placeholders, as the page route read them (absent when the read failed). */
export interface PlaceholderSettings {
  threshold?: number;
  tariff?: number;
  manager?: string;
  reserveSeconds?: number;
  etaHours?: number;
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
    reserveTime:
      s.reserveSeconds === undefined ? undefined : formatDuration(s.reserveSeconds, language),
    deliveryTerm: s.etaHours === undefined ? undefined : deliveryEta(language, s.etaHours),
  };
}

/**
 * Fills the body the way the API does before it is parsed, so the preview reads exactly as the
 * customer's page: values plain, links working. A value the route could not read keeps its
 * `{name}`, as an unknown placeholder does in the app.
 */
export function fillForPreview(source: string, values: Partial<Record<Placeholder, string>>) {
  return source.replace(/\{(\w+)\}/g, (m, key: string) =>
    (CONTENT_PLACEHOLDERS as readonly string[]).includes(key)
      ? (values[key as Placeholder] ?? m)
      : m,
  );
}

/** The placeholders a body uses, for the list under the editor. */
export function usedPlaceholders(source: string): Set<Placeholder> {
  return new Set(
    CONTENT_PLACEHOLDERS.filter((name) => source.includes(`{${name}}`)) as Placeholder[],
  );
}
