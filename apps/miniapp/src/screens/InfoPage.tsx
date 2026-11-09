import { useParams, useRouter } from '@tanstack/react-router';
import { Markdown } from '../content/Markdown';
import { useInfoPage } from '../content/queries';
import { usePrefs } from '../lib/prefs';
import { Button } from '../ui/Button';
import { Screen } from '../ui/Screen';
import { ScreenHeader } from '../ui/ScreenHeader';
import { Skeleton } from '../ui/Skeleton';
import { EmptyState, ErrorState } from '../ui/States';
import { AlertIcon } from '../ui/icons';

function PageSkeleton() {
  return (
    <div aria-hidden="true" className="space-y-3 pt-1">
      {['w-full', 'w-11/12', 'w-full', 'w-3/5'].map((w, i) => (
        <Skeleton key={i} className={`h-3.5 ${w}`} rounded="pill" />
      ))}
    </div>
  );
}

/** One info page in the customer's language: a plain, readable column of long text. */
export function InfoPage() {
  const { slug } = useParams({ strict: false }) as { slug: string };
  const { t, language } = usePrefs();
  const router = useRouter();
  const page = useInfoPage(slug);

  if (page.isError) {
    return (
      <Screen>
        <ErrorState fill onRetry={page.refetch} retrying={page.isFetching} />
      </Screen>
    );
  }
  if (page.data === null) {
    return (
      <Screen>
        <EmptyState
          fill
          icon={<AlertIcon size={28} />}
          title={t.info.notFoundTitle}
          text={t.info.notFoundText}
          action={
            <Button onClick={() => void router.navigate({ to: '/profile', replace: true })}>
              {t.info.toProfile}
            </Button>
          }
        />
      </Screen>
    );
  }
  const data = page.data;
  return (
    <Screen>
      <ScreenHeader title={data ? (language === 'uz' ? data.titleUz : data.titleRu) : ''} />
      {data ? (
        <article lang={language}>
          <Markdown source={language === 'uz' ? data.bodyUz : data.bodyRu} />
        </article>
      ) : (
        <div role="status" aria-label={t.info.loadingLabel}>
          <PageSkeleton />
        </div>
      )}
    </Screen>
  );
}
