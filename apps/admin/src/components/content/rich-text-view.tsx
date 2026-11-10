import {
  HEADING_TAG,
  keepNumbersTogether,
  parseRichText,
  type RichBlock,
  type RichInline,
} from '@lummi/rich-text';
import { Fragment } from 'react';
import { FILLED } from './placeholders';

/**
 * The info page as the Mini App renders it, for the page editor's preview. Same parser and the same heading table (`HEADING_TAG`) as the Mini App's `RichText`, so what
 * the owner sees is what the customer reads; React escapes every string, nothing is HTML.
 */
/** A text run; a value the settings fill in (see `fillForPreview`) sits on a Sage Wash ground. */
function Text({ v }: { v: string }) {
  const parts = keepNumbersTogether(v).split(FILLED);
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <span key={i} className="rounded-[3px] bg-sage-wash px-0.5 [box-decoration-break:clone]">
        {part}
      </span>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

function Inline({ nodes }: { nodes: RichInline[] }) {
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.t) {
          case 'text':
            return <Text key={i} v={n.v} />;
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
            return (
              <a
                key={i}
                href={n.href}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-[2px] font-medium underline decoration-border-strong decoration-1 underline-offset-[3px]"
              >
                <Inline nodes={n.c} />
              </a>
            );
        }
      })}
    </>
  );
}

function Block({ block }: { block: RichBlock }) {
  switch (block.t) {
    case 'h': {
      const Tag = HEADING_TAG[block.level];
      return (
        <Tag
          className={`text-[17px] leading-snug font-semibold first:mt-0 ${block.level === 2 ? 'mt-7' : 'mt-6'}`}
        >
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
          className={`mt-3 space-y-1.5 pl-5 first:mt-0 ${block.t === 'ul' ? 'list-disc' : 'list-decimal'} marker:text-muted-foreground`}
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

export function RichTextView({ source }: { source: string }) {
  return (
    <div className="text-[15px] leading-[1.6] [overflow-wrap:anywhere] text-pretty">
      {parseRichText(source).map((b, i) => (
        <Block key={i} block={b} />
      ))}
    </div>
  );
}
