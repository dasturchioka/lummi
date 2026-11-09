import { parseMarkdown, type MdBlock, type MdInline } from '@lummi/contracts/markdown';
import { Fragment } from 'react';

/**
 * The info page as the Mini App renders it, for the page editor's preview. Same parser, so what
 * the owner sees is what the customer reads; React escapes every string, nothing is HTML.
 */
function Inline({ nodes }: { nodes: MdInline[] }) {
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.t) {
          case 'text':
            return <Fragment key={i}>{n.v}</Fragment>;
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
                className="font-medium underline underline-offset-[3px]"
              >
                <Inline nodes={n.c} />
              </a>
            );
        }
      })}
    </>
  );
}

function Block({ block }: { block: MdBlock }) {
  switch (block.t) {
    case 'h':
      return (
        <h3 className="mt-6 text-[17px] leading-snug font-semibold first:mt-0">
          <Inline nodes={block.c} />
        </h3>
      );
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
          className={`mt-3 space-y-1.5 pl-5 first:mt-0 ${block.t === 'ul' ? 'list-disc' : 'list-decimal'}`}
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

export function MarkdownView({ source }: { source: string }) {
  return (
    <div className="text-[15px] leading-[1.6] [overflow-wrap:anywhere] text-pretty">
      {parseMarkdown(source).map((b, i) => (
        <Block key={i} block={b} />
      ))}
    </div>
  );
}
