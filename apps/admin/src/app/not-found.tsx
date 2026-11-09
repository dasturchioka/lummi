import Link from 'next/link';
import { EmptyState } from '@/components/empty-state';
import { NotFoundState } from '@/components/not-found-state';
import { PanelShell } from '@/components/shell/panel-shell';
import { Button } from '@/components/ui/button';
import { getAdminMessages } from '@/lib/i18n';
import { getMe } from '@/lib/server-api';

/**
 * Unknown addresses. A signed-in member keeps the panel around the 404 (menu, account); a
 * signed-out visitor gets the bare page with a way back.
 */
export default async function NotFound() {
  const { language, t } = await getAdminMessages();
  const me = await getMe().catch(() => null);
  if (me?.status === 200) {
    return (
      <PanelShell member={me.body} language={language} t={t}>
        <NotFoundState t={t} />
      </PanelShell>
    );
  }
  return (
    <main className="mx-auto grid min-h-dvh max-w-md content-center px-4 py-10">
      <EmptyState
        icon="monogram"
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
