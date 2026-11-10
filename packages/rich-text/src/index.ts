/**
 * Rich text for the info pages (ticket #21): the small formatting language the owner types in the
 * admin and the Mini App renders. Zod-free and DOM-free, so the Mini App, the admin preview and the
 * tests share one parser (ADR 0015 keeps runtime code out of `@lummi/contracts`). It never
 * produces HTML: it returns a small tree that React renders as elements, and text always goes
 * through React's escaping, so a `<script>` in a body is just visible text. Supported: `#`/`##`/`###`
 * headings, paragraphs (a single line break is kept), `-`/`*` and `1.` lists, `**bold**`,
 * `*italic*`, `[text](url)` and `\` escapes. Links keep only https:, tg:, mailto: and tel: targets;
 * anything else renders as plain text.
 */
export type RichInline =
  | { t: 'text'; v: string }
  | { t: 'br' }
  | { t: 'strong'; c: RichInline[] }
  | { t: 'em'; c: RichInline[] }
  | { t: 'a'; href: string; c: RichInline[] };

export type RichBlock =
  | { t: 'h'; level: 2 | 3; c: RichInline[] }
  | { t: 'p'; c: RichInline[] }
  | { t: 'ul'; items: RichInline[][] }
  | { t: 'ol'; items: RichInline[][] };

/** The one block -> semantic element table, so the app and the admin preview never differ. */
export const HEADING_TAG = { 2: 'h2', 3: 'h3' } as const;

const SAFE_HREF = /^(?:https:\/\/|tg:|mailto:|tel:)[^\s<>"'`]+$/i;

export function safeHref(raw: string): string | null {
  const href = raw.trim();
  return SAFE_HREF.test(href) ? href : null;
}

/** t.me links open inside Telegram; every other https link in its in-app browser. */
export function isTelegramLink(href: string): boolean {
  return /^(?:https:\/\/(?:t|telegram)\.me(?:[/?#]|$)|tg:)/i.test(href);
}

const NBSP = '\u00A0';
// a space inside a number's thousands («250 000»), and the space after a number before its word
const THOUSANDS = /(\d) (?=\d{3}(?!\d))/g;
const NUMBER_WORD = /(\d) (?=\p{L})/gu;

/**
 * Display typography for owner-typed text (the info pages, the promo banner): a number never
 * breaks inside its thousands or away from its word, so «250 000 сум», «48 часов» and «10 мл»
 * stay on one line (DESIGN.md: a number stays on the line of its word). Text only, never markup.
 */
export function keepNumbersTogether(text: string): string {
  return text.replace(THOUSANDS, `$1${NBSP}`).replace(NUMBER_WORD, `$1${NBSP}`);
}

const ESCAPABLE = /[\\`*_{}[\]()#+\-.!<>|]/;
const MAX_DEPTH = 3;
// bounded, so a run of unclosed brackets costs a constant per bracket
const LINK = /\[([^\]\n]{1,200})\]\(([^)\s]{1,2000})\)/y;

function inline(s: string, depth = 0): RichInline[] {
  const out: RichInline[] = [];
  let buf = '';
  const flush = () => {
    if (buf) out.push({ t: 'text', v: buf });
    buf = '';
  };
  let i = 0;
  while (i < s.length) {
    const ch = s[i] as string;
    if (ch === '\\' && i + 1 < s.length && ESCAPABLE.test(s[i + 1] as string)) {
      buf += s[i + 1];
      i += 2;
      continue;
    }
    if (ch === '\n') {
      flush();
      out.push({ t: 'br' });
      i++;
      continue;
    }
    if (depth < MAX_DEPTH) {
      if (s.startsWith('**', i)) {
        const end = s.indexOf('**', i + 2);
        if (end > i + 2) {
          flush();
          out.push({ t: 'strong', c: inline(s.slice(i + 2, end), depth + 1) });
          i = end + 2;
          continue;
        }
      } else if (ch === '*') {
        const end = s.indexOf('*', i + 1);
        if (end > i + 1) {
          flush();
          out.push({ t: 'em', c: inline(s.slice(i + 1, end), depth + 1) });
          i = end + 1;
          continue;
        }
      } else if (ch === '[') {
        // sticky: matches at `i` only, never copies or rescans the rest of the input
        LINK.lastIndex = i;
        const m = LINK.exec(s);
        if (m) {
          flush();
          const href = safeHref(m[2] as string);
          const c = inline(m[1] as string, depth + 1);
          if (href) out.push({ t: 'a', href, c });
          else out.push(...c);
          i += m[0].length;
          continue;
        }
      }
    }
    buf += ch;
    i++;
  }
  flush();
  return out;
}

const HEADING = /^(#{1,3})\s+(.*)$/;
const BULLET = /^[-*]\s+(.*)$/;
const ORDERED = /^\d{1,3}[.)]\s+(.*)$/;

export function parseRichText(source: string): RichBlock[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: RichBlock[] = [];
  let para: string[] = [];
  let list: { kind: 'ul' | 'ol'; items: string[] } | null = null;
  const endPara = () => {
    if (para.length) blocks.push({ t: 'p', c: inline(para.join('\n')) });
    para = [];
  };
  const endList = () => {
    if (list) blocks.push({ t: list.kind, items: list.items.map((x) => inline(x)) });
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.trim() === '') {
      endPara();
      endList();
      continue;
    }
    const h = HEADING.exec(line);
    if (h) {
      endPara();
      endList();
      blocks.push({
        t: 'h',
        level: (h[1] as string).length === 3 ? 3 : 2,
        c: inline(h[2] as string),
      });
      continue;
    }
    const b = BULLET.exec(line);
    const o = b ? null : ORDERED.exec(line);
    const item = b ?? o;
    if (item) {
      endPara();
      const kind = b ? 'ul' : 'ol';
      if (list && list.kind !== kind) endList();
      list ??= { kind, items: [] };
      list.items.push(item[1] as string);
      continue;
    }
    if (list) {
      // a wrapped list item continues on the next line
      if (/^\s+\S/.test(raw)) {
        list.items[list.items.length - 1] += ` ${line.trim()}`;
        continue;
      }
      endList();
    }
    para.push(line.trim());
  }
  endPara();
  endList();
  return blocks;
}
