import Link from 'next/link';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import type { AdminMessages } from '@/lib/i18n';

/** The 404 inside the panel: the usual page header, then where to go instead. */
export function NotFoundState({ t }: { t: AdminMessages }) {
  return (
    <>
      <PageHeader title={t.errors.notFoundTitle} />
      <EmptyState
        icon="monogram"
        title={t.errors.notFoundText}
        action={
          <Button asChild variant="outline">
            <Link href="/">{t.errors.toHome}</Link>
          </Button>
        }
      >
        {t.errors.notFoundHint}
      </EmptyState>
    </>
  );
}
