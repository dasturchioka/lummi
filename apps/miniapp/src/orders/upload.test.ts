import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/api', () => ({ API_BASE: '/api', withSession: vi.fn() }));
const { precheckReceipt } = await import('./upload');

const file = (name: string, type: string, size = 1024) =>
  new File([new Uint8Array(size)], name, { type });
const MB = 1024 * 1024;

describe('precheckReceipt', () => {
  it.each([
    ['a screenshot', file('Screenshot.png', 'image/png')],
    ['a JPEG named .jpeg', file('chek.JPEG', '')],
    ['a PDF a picker gave no name to', file('', 'application/pdf')],
    ['a WebP', file('chek.webp', 'image/webp')],
  ])('takes %s', (_name, f) => {
    expect(precheckReceipt(f, 10 * MB)).toBeNull();
  });

  it.each([
    ['an iPhone HEIC photo', file('IMG_2041.HEIC', 'image/heic')],
    ['a file called just "pdf"', file('pdf', '')],
    ['an empty file', file('chek.png', 'image/png', 0)],
  ])('refuses %s as a type the shop does not take', (_name, f) => {
    expect(precheckReceipt(f, 10 * MB)).toBe('unsupported_type');
  });

  it('refuses a file over the limit as too large', () => {
    expect(precheckReceipt(file('chek.pdf', 'application/pdf', 2 * MB), MB)).toBe('too_large');
  });
});
