/** `fill('Пунктов: {n}', { n: 3 })`. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => String(values[k] ?? m));
}
