import {
  HEADING_TAG,
  keepNumbersTogether,
  parseRichText,
  type RichBlock,
  type RichInline,
} from '@lummi/rich-text';
import { Fragment, useMemo, type ReactNode } from 'react';
import { openContentLink } from '../lib/open-content-link';

/**
 * Renders the rich text of the info pages as React elements. It never sets inner HTML:
 * every string goes through React's escaping, and the parser (shared with the admin preview)
 * keeps only safe link targets, so a `<script>` in a body is just visible text.
 */
function Inline({ nodes }: { nodes: RichInline[] }): ReactNode {
  return nodes.map((n, i) => {
    switch (n.t) {
      case 'text':
        return <Fragment key={i}>{keepNumbersTogether(n.v)}</Fragment>;
      case 'br':
        return <br key={i} />;
      case 'strong':
        return (
          <strong key={i} className="font-semibold">
            <Inline nodes={n.c} />
          </strong>
        );
      case 'em':
        return (
          <em key={i}>
            <Inline nodes={n.c} />
          </em>
        );
      case 'a':
        // t.me links stay inside Telegram, https links open in its browser (lib/telegram.ts);
        // mailto: and tel: are left to the system. A link here is part of the text, so it stays
        // selectable with its sentence (the base CSS makes control links unselectable).
        return (
          <a
            key={i}
            href={n.href}
            onClick={(e) => {
              if (openContentLink(n.href)) e.preventDefault();
            }}
            className="rounded-[2px] font-medium underline select-text decoration-line-strong decoration-1 underline-offset-[3px] transition-opacity duration-150 active:opacity-60"
          >
            <Inline nodes={n.c} />
          </a>
        );
    }
  });
}

function Block({ block }: { block: RichBlock }) {
  switch (block.t) {
    case 'h': {
      const Tag = HEADING_TAG[block.level];
      return (
        <Tag className={`type-heading text-ink first:mt-0 ${block.level === 2 ? 'mt-7' : 'mt-6'}`}>
          <Inline nodes={block.c} />
        </Tag>
      );
    }
    case 'p':
      return (
        <p className="mt-3 first:mt-0">
          <Inline nodes={block.c} />
        </p>
      );
    case 'ul':
    case 'ol': {
      const List = block.t;
      return (
        <List
          className={`mt-3 space-y-1.5 pl-5 first:mt-0 ${
            block.t === 'ul' ? 'list-disc' : 'list-decimal'
          } marker:text-muted`}
        >
          {block.items.map((item, i) => (
            <li key={i} className="pl-1">
              <Inline nodes={item} />
            </li>
          ))}
        </List>
      );
    }
  }
}

export function RichText({ source }: { source: string }) {
  const blocks = useMemo(() => parseRichText(source), [source]);
  return (
    <div className="text-[15px] leading-[1.6] break-words text-pretty text-ink [overflow-wrap:anywhere]">
      {blocks.map((b, i) => (
        <Block key={i} block={b} />
      ))}
    </div>
  );
}
