import Link from 'next/link';
import { EmptyState } from '@/components/empty-state';
import { Button } from '@/components/ui/button';
import { getAdminMessages } from '@/lib/i18n';

export default async function NotFound() {
  const { t } = await getAdminMessages();
  return (
    <main className="mx-auto grid min-h-dvh max-w-md content-center px-4 py-10">
      <EmptyState
        title={t.errors.notFoundTitle}
        action={
          <Button asChild variant="outline">
            <Link href="/">{t.errors.toHome}</Link>
          </Button>
        }
      >
        {t.errors.notFoundText}
      </EmptyState>
    </main>
  );
}
