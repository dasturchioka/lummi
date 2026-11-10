import { describe, expect, it } from 'vitest';
import {
  isTelegramLink,
  keepNumbersTogether,
  parseRichText,
  safeHref,
  type RichBlock,
  type RichInline,
} from './index';

/** Every string a renderer would print, flattened: if it is here it is text, never markup. */
function texts(nodes: RichInline[]): string[] {
  return nodes.flatMap((n) => (n.t === 'text' ? [n.v] : n.t === 'br' ? [] : texts(n.c)));
}
const blockTexts = (b: RichBlock): string[] =>
  b.t === 'ul' || b.t === 'ol' ? b.items.flatMap(texts) : texts(b.c);

describe('rich text', () => {
  it('parses headings, paragraphs, lists, bold, italic and links', () => {
    const blocks = parseRichText(
      '### Доставка\n\nПервая **строка**\nвторая *строка*.\n\n- один\n- два\n\n1. раз\n2. два\n\n[канал](https://t.me/lummi_uz)',
    );
    expect(blocks.map((b) => b.t)).toEqual(['h', 'p', 'ul', 'ol', 'p']);
    const link = (blocks[4] as Extract<RichBlock, { t: 'p' }>).c[0];
    expect(link).toMatchObject({ t: 'a', href: 'https://t.me/lummi_uz' });
  });

  it('keeps a <script> as plain text: the parser has no HTML node at all', () => {
    const blocks = parseRichText('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>');
    expect(blocks.flatMap(blockTexts).join('')).toContain('<script>alert(1)</script>');
    expect(JSON.stringify(blocks)).not.toMatch(/"t":"(html|script|img)"/);
  });

  it('drops links that are not https, tg, mailto or tel, keeping their text', () => {
    for (const bad of [
      'javascript:void0',
      'data:text/html,x',
      'http://plain.test',
      'JaVaScRiPt:void0',
      '//evil.test',
    ]) {
      expect(safeHref(bad)).toBeNull();
      const [p] = parseRichText(`[click](${bad})`);
      expect(p).toMatchObject({ t: 'p', c: [{ t: 'text', v: 'click' }] });
    }
    expect(safeHref('mailto:a@b.uz')).toBe('mailto:a@b.uz');
    expect(safeHref('tel:+998901234567')).toBe('tel:+998901234567');
  });

  it('survives hostile and malformed input without throwing', () => {
    for (const s of [
      '**',
      '*',
      '[',
      '[a](',
      '](',
      '\\',
      '#',
      '- ',
      '1. ',
      '*'.repeat(500),
      '[a]('.repeat(300),
    ]) {
      expect(() => parseRichText(s)).not.toThrow();
    }
  });

  it('routes t.me links to Telegram and the rest to the browser', () => {
    expect(isTelegramLink('https://t.me/lummi_uz')).toBe(true);
    expect(isTelegramLink('tg://resolve?domain=lummi_uz')).toBe(true);
    expect(isTelegramLink('https://instagram.com/lummi.uz')).toBe(false);
    expect(isTelegramLink('https://t.me.evil.test/x')).toBe(false);
  });

  it('parses a long run of unclosed brackets in linear time', () => {
    // Compare growth, not wall-clock time: CI runners are slow and busy, so an absolute limit
    // flakes there. Four times the input must cost far less than the 16× a quadratic parser takes.
    const best = (n: number) => {
      const input = '['.repeat(n);
      let fastest = Infinity;
      for (let run = 0; run < 3; run++) {
        const started = performance.now();
        parseRichText(input);
        fastest = Math.min(fastest, performance.now() - started);
      }
      return fastest;
    };
    best(2_000); // warm the JIT
    const ratio = best(40_000) / Math.max(best(10_000), 0.5);
    expect(ratio).toBeLessThan(8);
  }, 30_000);

  it('keeps a number with its thousands and its word, and leaves other spaces alone', () => {
    const nb = (x: string) => x.replace(/_/g, '\u00A0');
    expect(keepNumbersTogether('от 1 234 567 сум за набор')).toBe(nb('от 1_234_567_сум за набор'));
    expect(keepNumbersTogether('до 48 часов, по 10 мл')).toBe(nb('до 48_часов, по 10_мл'));
    expect(keepNumbersTogether('48 soatgacha · 2026 2027')).toBe(nb('48_soatgacha · 2026 2027'));
  });
});
