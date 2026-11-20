/** The name in ASCII kebab case: `Angels' Share` -> `angels-share`, `Météore` -> `meteore`. */
export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/['’ʻʼ`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
