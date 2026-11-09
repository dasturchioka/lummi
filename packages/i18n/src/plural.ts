import type { Language } from './language';

/**
 * A counted phrase per CLDR plural category. RU uses one / few / many (2–4 «пункта», 5+
 * «пунктов»); UZ has a single form («N ta punkt»), so it repeats one text in every slot.
 */
export type PluralForms = { one: string; few: string; many: string; other: string };

const rules = new Map<Language, Intl.PluralRules>();

/** `plural('ru', 3, t.pointsCount)` -> «3 пункта». `{n}` is the count; other slots stay for `fill`. */
export function plural(language: Language, n: number, forms: PluralForms): string {
  let rule = rules.get(language);
  if (!rule) rules.set(language, (rule = new Intl.PluralRules(language)));
  const category = rule.select(n);
  const template = category in forms ? forms[category as keyof PluralForms] : forms.other;
  return template.replaceAll('{n}', String(n));
}
