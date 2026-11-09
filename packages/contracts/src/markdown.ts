/**
 * Limited Markdown for the info pages (ticket #21). Zod-free and DOM-free, so the Mini App, the
 * admin preview and the tests share one parser. It never produces HTML: it returns a small tree
 * that React renders as elements, and text always goes through React's escaping, so a `<script>`
 * in a body is just visible text. Supported: `#`/`##`/`###` headings, paragraphs (a single line
 * break is kept), `-`/`*` and `1.` lists, `**bold**`, `*italic*`, `[text](url)` and `\` escapes.
 * Links keep only http(s), tg://, mailto: and tel: targets; anything else renders as plain text.
 */
export type MdInline =
  | { t: 'text'; v: string }
  | { t: 'br' }
  | { t: 'strong'; c: MdInline[] }
  | { t: 'em'; c: MdInline[] }
  | { t: 'a'; href: string; c: MdInline[] };

export type MdBlock =
  | { t: 'h'; level: 2 | 3; c: MdInline[] }
  | { t: 'p'; c: MdInline[] }
  | { t: 'ul'; items: MdInline[][] }
  | { t: 'ol'; items: MdInline[][] };

const SAFE_HREF = /^(?:https?:\/\/|tg:\/\/|mailto:|tel:)[^\s<>"'`]+$/i;

export function safeHref(raw: string): string | null {
  const href = raw.trim();
  return SAFE_HREF.test(href) ? href : null;
}

const ESCAPABLE = /[\\`*_{}[\]()#+\-.!<>|]/;
const MAX_DEPTH = 3;

function inline(s: string, depth = 0): MdInline[] {
  const out: MdInline[] = [];
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
        const m = /^\[([^\]\n]+)\]\(([^)\s]+)\)/.exec(s.slice(i));
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

export function parseMarkdown(source: string): MdBlock[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: MdBlock[] = [];
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
