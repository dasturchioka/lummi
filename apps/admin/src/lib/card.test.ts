import { describe, expect, it } from 'vitest';
import { luhnValid } from './card';

describe('luhnValid', () => {
  it('passes card numbers whose check digit fits', () => {
    expect(luhnValid('8600495473316478')).toBe(true);
    expect(luhnValid('4111111111111111')).toBe(true);
  });

  it('fails a mistyped digit and two swapped neighbours', () => {
    expect(luhnValid('8600495473316479')).toBe(false);
    expect(luhnValid('8600495473361478')).toBe(false);
  });
});
