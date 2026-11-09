import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { getAdminMessages } from '@/lib/i18n';
import { getMe } from '@/lib/server-api';

export default async function HomePage() {
  const { t } = await getAdminMessages();
  const me = await getMe();
  const owner = me.status === 200 && me.body.role === 'owner';
  return (
    <>
      <PageHeader title={t.nav.home} />
      <EmptyState
        title={t.home.emptyTitle}
        action={
          owner && (
            <Button asChild variant="outline">
              <Link href="/staff">
                {t.home.toStaff}
                <ArrowRight strokeWidth={1.5} aria-hidden />
              </Link>
            </Button>
          )
        }
      >
        <p>{t.home.empty}</p>
        {owner && <p className="mt-1">{t.home.ownerHint}</p>}
      </EmptyState>
    </>
  );
}
