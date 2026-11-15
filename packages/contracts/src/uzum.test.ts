import { describe, expect, it } from 'vitest';
import { fragranceInputSchema } from './admin-catalog';
import { discoverySetInputSchema } from './sets';
import { isUzumUrl, uzumUrlSchema } from './uzum';

describe('the Uzum link rule', () => {
  it('is https only, trimmed, and empty clears', () => {
    expect(uzumUrlSchema.parse('  https://uzum.uz/p/1 ')).toBe('https://uzum.uz/p/1');
    expect(uzumUrlSchema.parse('')).toBe('');
    expect(isUzumUrl('http://uzum.uz/p/1')).toBe(false);
    expect(isUzumUrl('javascript:alert(1)')).toBe(false);
    expect(isUzumUrl('https://uzum.uz/a b')).toBe(false);
  });

  it('is the same rule for the set and the fragrance', () => {
    const set = { price: 1000, composition: [1, 2, 3, 4, 5] };
    expect(discoverySetInputSchema.safeParse({ ...set, uzumUrl: 'http://uzum.uz' }).success).toBe(
      false,
    );
    expect(discoverySetInputSchema.safeParse({ ...set, uzumUrl: 'https://uzum.uz' }).success).toBe(
      true,
    );
    // an otherwise empty fragrance fails on many fields; only the link's verdict matters here
    const verdict = (uzumUrl: string | null) =>
      fragranceInputSchema
        .safeParse({ uzumUrl })
        .error?.issues.some((x) => x.path[0] === 'uzumUrl') ?? false;
    expect(verdict('http://uzum.uz')).toBe(true);
    expect(verdict('https://uzum.uz')).toBe(false);
    expect(verdict(null)).toBe(false);
  });
});
