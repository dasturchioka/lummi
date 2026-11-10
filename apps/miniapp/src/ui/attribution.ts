const NBSP = '\u00a0';

/**
 * «по мотивам <brand>» / «<brand> asosida» with the template's own words held together, so a long
 * brand wraps between its own words and «по мотивам» never splits across lines. A hyphenated
 * brand keeps its hyphen (a non-breaking one): «MARC-ANTOINE», never «MARC- / ANTOINE».
 *
 * A module of its own: every row that names a fragrance (cart, order, checkout, set lists) uses
 * it, and none of them should load the list card and its «+» to get it.
 */
export function attribution(template: string, brand: string): string {
  return template
    .split('{brand}')
    .map((part) => part.replace(/(\S) (?=\S)/g, `$1${NBSP}`))
    .join(brand.replace(/-/g, '\u2011'));
}
