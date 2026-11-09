/**
 * Fills `{name}` placeholders in a dictionary string: `fill('по мотивам {brand}', { brand })`.
 * A placeholder with no value stays as it is, so a missing one shows up instead of vanishing.
 */
export function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (m, key: string) => values[key] ?? m);
}
