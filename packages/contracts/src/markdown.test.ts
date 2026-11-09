import { describe, expect, it } from 'vitest';
import { parseMarkdown, safeHref, type MdBlock, type MdInline } from './markdown';

/** Every string a renderer would print, flattened: if it is here it is text, never markup. */
function texts(nodes: MdInline[]): string[] {
  return nodes.flatMap((n) => (n.t === 'text' ? [n.v] : n.t === 'br' ? [] : texts(n.c)));
}
const blockTexts = (b: MdBlock): string[] =>
  b.t === 'ul' || b.t === 'ol' ? b.items.flatMap(texts) : texts(b.c);

describe('limited Markdown', () => {
  it('parses headings, paragraphs, lists, bold, italic and links', () => {
    const blocks = parseMarkdown(
      '### Доставка\n\nПервая **строка**\nвторая *строка*.\n\n- один\n- два\n\n1. раз\n2. два\n\n[канал](https://t.me/lummi_uz)',
    );
    expect(blocks.map((b) => b.t)).toEqual(['h', 'p', 'ul', 'ol', 'p']);
    const link = (blocks[4] as Extract<MdBlock, { t: 'p' }>).c[0];
    expect(link).toMatchObject({ t: 'a', href: 'https://t.me/lummi_uz' });
  });

  it('keeps a <script> as plain text: the parser has no HTML node at all', () => {
    const blocks = parseMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>');
    expect(blocks.flatMap(blockTexts).join('')).toContain('<script>alert(1)</script>');
    expect(JSON.stringify(blocks)).not.toMatch(/"t":"(html|script|img)"/);
  });

  it('drops links that are not http(s), tg, mailto or tel, keeping their text', () => {
    for (const bad of ['javascript:void0', 'data:text/html,x', 'JaVaScRiPt:void0', '//evil.test']) {
      expect(safeHref(bad)).toBeNull();
      const [p] = parseMarkdown(`[click](${bad})`);
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
      expect(() => parseMarkdown(s)).not.toThrow();
    }
  });
});
