'use client';

import type { AdminHome, StaffDto } from '@lummi/contracts';
import { formatCalendarDate, type Language } from '@lummi/i18n';
import { RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { browserApi } from '@/lib/api';
import { nowKey, weekdayOf } from '@/lib/home-format';
import { fill } from '@/lib/utils';
import { LIVE_POLL_MS, useVisiblePoll } from '@/lib/use-visible-poll';
import { QueueCard, SalesStrip, SystemLine, type HomeCopy } from './home-parts';
import { LIFTED, NoCardLine, NowBlock, nowAnnouncement } from './now-block';

/** The Home refreshes this often while its tab is visible. */
export const REFRESH_MS = LIVE_POLL_MS;

type Load = { data: AdminHome | null; failed: boolean };

/**
 * The admin Home (#48): one call (`GET /admin/home`), again every 10 s while the tab is visible
 * and when the window regains focus. The first load shows the skeleton; a failed first load the
 * error plate with «Повторить»; a failed refresh keeps what is shown (its «обновлено» time says
 * how old it is). The Now block animates only when its item changes, and one stable live region,
 * outside everything that re-renders, announces only that.
 */
export function HomeView({
  copy,
  title,
  retry,
  language,
  role,
  today,
}: {
  copy: HomeCopy;
  title: string;
  retry: string;
  language: Language;
  role: StaffDto['role'];
  /** The server's Tashkent day, for the date line before the first answer. */
  today: string;
}) {
  const router = useRouter();
  const [load, setLoad] = useState<Load>({ data: null, failed: false });
  const [retrying, setRetrying] = useState(false);
  const { refresh } = useVisiblePoll(
    async (signal) => {
      try {
        const res = await browserApi.home({ fetchOptions: { signal } });
        if (signal.aborted) return;
        if (res.status === 401) {
          router.replace('/login');
          return;
        }
        if (res.status !== 200) throw new Error(`home ${res.status}`);
        setLoad({ data: res.body, failed: false });
      } catch {
        if (signal.aborted) return;
        setLoad((was) => (was.data ? was : { data: null, failed: true }));
      } finally {
        if (!signal.aborted) setRetrying(false);
      }
    },
    { ms: REFRESH_MS, immediate: true },
  );

  // the Now item: which one is shown, whether it arrived on a refresh, what the live region says
  const data = load.data;
  const key = data ? nowKey(data.now) : null;
  const [shownKey, setShownKey] = useState<string | null>(null);
  const [arrive, setArrive] = useState(false);
  const [announce, setAnnounce] = useState('');
  if (key !== shownKey) {
    setShownKey(key);
    if (shownKey !== null && key !== null && data) {
      setArrive(true);
      setAnnounce(nowAnnouncement(data, copy, language));
    }
  }

  const day = data?.at.day ?? today;
  const weekday = weekdayOf(day);
  const date = fill(copy.date, {
    weekday: copy.weekdays[weekday] ?? '',
    date: formatCalendarDate(day, language),
  });
  const owner = data?.role === 'owner' ? data : null;

  let body: React.ReactNode;
  if (data) {
    body = (
      <>
        {owner && <SalesStrip copy={copy} language={language} data={owner} />}
        {data.cardMissing && data.role === 'manager' && <NoCardLine copy={copy} />}
        <NowBlock
          key={key}
          data={data}
          copy={copy}
          language={language}
          arrive={arrive}
          refreshSeconds={REFRESH_MS / 1000}
        />
        <QueueCard
          copy={copy}
          language={language}
          queues={data.queues}
          today={data.at.day}
          lifted={LIFTED[data.now.kind] ?? null}
        />
        {owner && (
          <SystemLine copy={copy} language={language} system={owner.system} today={data.at.day} />
        )}
      </>
    );
  } else if (load.failed) {
    body = (
      <div
        role="alert"
        className="flex flex-col items-stretch gap-6 rounded-card bg-field p-6 sm:flex-row sm:items-center sm:justify-between"
      >
        <span>
          <b className="block text-[17px] leading-[1.35] font-semibold">{copy.error.title}</b>
          <span className="mt-0.5 block text-muted-foreground">{copy.error.text}</span>
        </span>
        <Button
          loading={retrying}
          className="h-12"
          onClick={() => {
            setRetrying(true);
            refresh();
          }}
        >
          <RefreshCw strokeWidth={1.5} aria-hidden />
          {retry}
        </Button>
      </div>
    );
  } else {
    body = <HomeSkeleton owner={role === 'owner'} />;
  }

  return (
    <>
      <PageHeader
        title={title}
        description={data ? fill(copy.updated, { date, time: data.at.time }) : date}
      />
      <div className="space-y-4" aria-busy={!data && !load.failed}>
        {body}
      </div>
      <div className="sr-only" aria-live="polite">
        {announce}
      </div>
    </>
  );
}

/** The Home's shape, breathing, until the first answer. */
function HomeSkeleton({ owner }: { owner: boolean }) {
  return (
    <>
      {owner && (
        <div className="rounded-card bg-card px-[18px] pt-[18px] pb-5 sm:px-6 sm:pt-5 sm:pb-[22px]">
          <div className="skeleton h-4 w-36" />
          <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-[18px] sm:flex sm:gap-x-10">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="sm:w-32">
                <div className="skeleton h-2.5 w-3/5" />
                <div className="skeleton mt-2.5 h-[22px] w-4/5" />
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="skeleton h-44 rounded-card" />
      <div className="rounded-card bg-card">
        <div className="px-[18px] pt-4 pb-2.5 sm:px-6 sm:pt-[18px] sm:pb-3">
          <div className="skeleton h-3.5 w-24" />
        </div>
        {Array.from({ length: 8 }, (_, i) => (
          <div
            key={i}
            className="grid min-h-[58px] grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-t border-border px-[18px] py-3 sm:min-h-[62px] sm:grid-cols-[minmax(0,1fr)_120px_220px_20px] sm:px-6"
          >
            <span>
              <span className="skeleton block h-3.5 w-[46%]" />
              <span className="skeleton mt-2 block h-2.5 w-[30%]" />
            </span>
            <span className="skeleton block h-[18px] w-7 justify-self-end" />
            <span className="skeleton block h-2.5 w-[70%] max-sm:hidden" />
          </div>
        ))}
      </div>
    </>
  );
}
