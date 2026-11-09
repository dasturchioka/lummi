import * as React from 'react';

/**
 * Every panel screen opens with this: the Tenor caps title (the nav label of the section), an
 * optional one-line purpose in Muted Ink, and the screen's actions on the right (stacked under
 * the title on phones).
 */
export function PageHeader({
  title,
  description,
  actions,
  titleAction,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  /** Phones only: a compact control beside the title (an icon «+»), instead of a full-width button. */
  titleAction?: React.ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between lg:mb-8">
      <div className="min-w-0">
        <div className="flex items-start justify-between gap-3">
          <h1 className="title min-w-0 break-words">{title}</h1>
          {titleAction && <div className="-my-1.5 shrink-0 sm:hidden">{titleAction}</div>}
        </div>
        {description && (
          <p className="mt-2 max-w-[64ch] text-sm text-pretty text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </header>
  );
}
