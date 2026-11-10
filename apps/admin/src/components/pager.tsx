import { ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

/**
 * Previous / next under a paged list, with «Страница 2 из 5» between them. At either end the
 * button stays in place, disabled, so the row never jumps. Nothing shows for a single page.
 */
export function Pager({
  page,
  pages,
  href,
  labels,
}: {
  page: number;
  pages: number;
  /** The URL of page `p`, with the list's filters. */
  href: (p: number) => string;
  labels: { prev: string; next: string; page: string };
}) {
  if (pages <= 1) return null;
  return (
    <nav
      aria-label={labels.page}
      className="mt-4 flex items-center justify-between gap-3 text-small text-muted-foreground"
    >
      <PageLink href={page > 1 ? href(page - 1) : null}>
        <ChevronLeft strokeWidth={1.5} aria-hidden />
        {labels.prev}
      </PageLink>
      <span className="text-center tabular-nums">{labels.page}</span>
      <PageLink href={page < pages ? href(page + 1) : null}>
        {labels.next}
        <ChevronRight strokeWidth={1.5} aria-hidden />
      </PageLink>
    </nav>
  );
}

function PageLink({ href, children }: { href: string | null; children: React.ReactNode }) {
  return href ? (
    <Button asChild variant="outline" size="sm">
      <Link href={href}>{children}</Link>
    </Button>
  ) : (
    <Button variant="outline" size="sm" disabled>
      {children}
    </Button>
  );
}
