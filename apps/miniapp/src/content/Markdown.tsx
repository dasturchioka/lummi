import { parseMarkdown, type MdBlock, type MdInline } from '@lummi/contracts/markdown';
import { Fragment, useMemo, type ReactNode } from 'react';

/**
 * Renders the limited Markdown of the info pages as React elements. It never sets inner HTML:
 * every string goes through React's escaping, and the parser (shared with the admin preview)
 * keeps only safe link targets, so a `<script>` in a body is just visible text.
 */
function Inline({ nodes }: { nodes: MdInline[] }): ReactNode {
  return nodes.map((n, i) => {
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
            className="font-medium underline decoration-line-strong underline-offset-[3px]"
          >
            <Inline nodes={n.c} />
          </a>
        );
    }
  });
}

function Block({ block }: { block: MdBlock }) {
  switch (block.t) {
    case 'h':
      return block.level === 2 ? (
        <h2 className="type-heading mt-7 text-ink first:mt-0">
          <Inline nodes={block.c} />
        </h2>
      ) : (
        <h3 className="type-heading mt-6 text-ink first:mt-0">
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

export function Markdown({ source }: { source: string }) {
  const blocks = useMemo(() => parseMarkdown(source), [source]);
  return (
    <div className="text-[15px] leading-[1.6] break-words text-pretty text-ink [overflow-wrap:anywhere]">
      {blocks.map((b, i) => (
        <Block key={i} block={b} />
      ))}
    </div>
  );
}
