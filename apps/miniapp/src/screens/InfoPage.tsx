import type { InfoPageListItem } from '@lummi/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from '@tanstack/react-router';
import { RichText } from '../content/RichText';
import { useInfoPage } from '../content/queries';
import { usePrefs } from '../lib/prefs';
import { Button } from '../ui/Button';
import { Screen } from '../ui/Screen';
import { ScreenHeader } from '../ui/ScreenHeader';
import { Skeleton } from '../ui/Skeleton';
import { EmptyState, ErrorState } from '../ui/States';
import { DocIcon } from '../ui/icons';

/**
 * The page while it loads, in its own shape: the title line (or the real title, when Profile's
 * list already knows it), then a heading and two paragraphs at the text's 24 px line height.
 */
function PageSkeleton({ title }: { title: string | undefined }) {
  const line = (w: string, key: number) => (
    <Skeleton key={key} className={`h-3.5 ${w}`} rounded="pill" />
  );
  return (
    <>
      {title ? (
        <ScreenHeader title={title} />
      ) : (
        <div aria-hidden="true" className="flex min-h-[72px] items-center pt-5 pb-4">
          <Skeleton className="h-[18px] w-44" rounded="pill" />
        </div>
      )}
      <div aria-hidden="true" className="flex flex-col gap-2.5 pt-1">
        {['w-full', 'w-11/12', 'w-full', 'w-3/5'].map(line)}
        <Skeleton className="mt-6 mb-1 h-4 w-2/3" rounded="pill" />
        {['w-full', 'w-10/12', 'w-1/2'].map(line)}
      </div>
    </>
  );
}

/** One info page in the customer's language: a plain, readable column of long text. */
export function InfoPage() {
  const { slug } = useParams({ from: '/info/$slug' });
  const { t, language } = usePrefs();
  const router = useRouter();
  const page = useInfoPage(slug);
  // Profile's list is usually in the cache already: its title stands from the first frame.
  const listed = useQueryClient()
    .getQueryData<InfoPageListItem[]>(['content', 'pages'])
    ?.find((p) => p.slug === slug);

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
          icon={<DocIcon size={28} />}
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
  if (!data) {
    return (
      <Screen>
        <div role="status" aria-label={t.info.loadingLabel}>
          <PageSkeleton title={listed && (language === 'uz' ? listed.titleUz : listed.titleRu)} />
        </div>
      </Screen>
    );
  }
  const body = language === 'uz' ? data.bodyUz : data.bodyRu;
  return (
    <Screen>
      <ScreenHeader title={language === 'uz' ? data.titleUz : data.titleRu} />
      {body.trim() ? (
        <article lang={language} className="pb-2">
          <RichText source={body} />
        </article>
      ) : (
        // the owner saved the page without its text yet: say so instead of a blank screen (the
        // tab bar and Telegram's back button lead on)
        <EmptyState
          fill
          icon={<DocIcon size={28} />}
          title={t.info.emptyTitle}
          text={t.info.emptyText}
        />
      )}
    </Screen>
  );
}
