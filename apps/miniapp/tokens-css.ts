/** Value of a custom property inside one block of tokens.css (`:root {` or the dark block). */
export function tokenValue(css: string, block: 'light' | 'dark', name: string): string {
  const start = css.indexOf(block === 'light' ? ':root {' : ":root[data-theme='dark'] {");
  if (start < 0) throw new Error(`tokens.css: no ${block} block`);
  const end = css.indexOf('}', start);
  const m = new RegExp(`${name}:\\s*([^;]+);`).exec(css.slice(start, end));
  if (!m?.[1]) throw new Error(`tokens.css: ${name} missing in the ${block} block`);
  return m[1].trim();
}
