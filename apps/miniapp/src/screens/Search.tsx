import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useNavigate, useRouter, useSearch } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { api, unwrap } from '../lib/api';
import { goBackOrCatalog } from '../lib/navigation';
import { usePrefs } from '../lib/prefs';
import { Button } from '../ui/Button';
import { FragranceListCard } from '../ui/FragranceListCard';
import { ArrowLeftIcon, CloseIcon, SearchIcon } from '../ui/icons';
import { Screen } from '../ui/Screen';
import { Skeleton } from '../ui/Skeleton';
import { EmptyState, ErrorState } from '../ui/States';
import { useDebounced } from './search/useDebounced';

/** Suggestions start at this many characters (the server's `search.minQueryLength` default). */
const MIN_CHARS = 2;
const DEBOUNCE_MS = 150;

function Rows() {
  return (
    <div aria-busy="true" className="flex flex-col gap-3 pt-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="aspect-[3/4] w-12" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-2.5 w-32" />
            <Skeleton className="h-4 w-40" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * `/search`: the field, suggestions while typing (after 150 ms, from 2 characters), and the full
 * result list once the customer submits. `?q=` and `?s=1` carry the typed text and the submitted
 * state, so a result list survives going back from a fragrance card.
 */
export function Search() {
  const { t } = usePrefs();
  const router = useRouter();
  const navigate = useNavigate();
  const params: { q?: string; s?: number } = useSearch({ strict: false });
  const [text, setText] = useState(params.q ?? '');
  const [submitted, setSubmitted] = useState(params.s === 1 && (params.q ?? '').trim() !== '');

  const typed = text.trim();
  // A submitted list is for the submitted text; otherwise suggestions follow the debounced input.
  const debounced = useDebounced(typed, DEBOUNCE_MS);
  const q = submitted ? typed : debounced;
  const active = Array.from(q).length >= MIN_CHARS;
  const mode = submitted ? 'search' : 'suggest';

  const query = useQuery({
    queryKey: ['search', mode, q],
    enabled: active,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const res =
        mode === 'search'
          ? await api.catalog.search({ query: { q } })
          : await api.catalog.suggest({ query: { q } });
      return unwrap(res, 200).items;
    },
  });

  const open = (slug: string) => void navigate({ to: '/p/$slug', params: { slug } });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (Array.from(typed).length < MIN_CHARS) return;
    setSubmitted(true);
    void navigate({ to: '/search', search: { q: typed, s: 1 }, replace: true });
  };
  const edit = (v: string) => {
    setText(v);
    setSubmitted(false);
  };

  const items = active ? query.data : undefined;
  // What the debounce has not caught up with yet is still loading, not "nothing found".
  const settled = submitted || debounced === typed;

  let body;
  if (!active) {
    body = (
      <p className="type-body px-1 pt-6 text-center text-muted text-balance">{t.search.hint}</p>
    );
  } else if (query.isError && items === undefined) {
    body = <ErrorState retrying={query.isFetching} onRetry={() => void query.refetch()} />;
  } else if (items === undefined || !settled) {
    body = <Rows />;
  } else if (items.length === 0) {
    body = (
      <EmptyState
        icon={<SearchIcon size={28} />}
        title={t.search.emptyTitle}
        text={t.search.emptyText}
        action={
          <Button variant="secondary" block onClick={() => void navigate({ to: '/catalog' })}>
            {t.search.toCatalog}
          </Button>
        }
      />
    );
  } else if (submitted) {
    body = (
      <ul className="flex flex-col gap-2 pt-2" aria-label={t.search.results}>
        {items.map((it) => (
          <li key={it.slug}>
            <FragranceListCard item={it} onSelect={open} />
          </li>
        ))}
      </ul>
    );
  } else {
    body = (
      <ul className="flex flex-col divide-y divide-line pt-1" aria-label={t.search.suggestions}>
        {items.map((it) => (
          <li key={it.slug}>
            <FragranceListCard item={it} compact onSelect={open} />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <Screen tabBar={false}>
      <form role="search" onSubmit={submit} className="flex items-center gap-2 pt-4 pb-3">
        <button
          type="button"
          aria-label={t.card.back}
          onClick={() => goBackOrCatalog(router)}
          className="grid size-11 shrink-0 place-items-center rounded-pill text-ink active:bg-field"
        >
          <ArrowLeftIcon size={20} />
        </button>
        <label className="relative block flex-1">
          <span className="sr-only">{t.search.label}</span>
          <SearchIcon
            size={18}
            className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted"
          />
          <input
            type="search"
            enterKeyHint="search"
            autoFocus={!params.q}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            maxLength={100}
            value={text}
            onChange={(e) => edit(e.target.value)}
            placeholder={t.search.placeholder}
            className="h-12 w-full appearance-none rounded-btn bg-field pr-11 pl-10 text-[16px] text-ink outline-none placeholder:text-muted focus-visible:ring-2 focus-visible:ring-sage [&::-webkit-search-cancel-button]:hidden"
          />
          {text !== '' ? (
            <button
              type="button"
              aria-label={t.search.clear}
              onClick={() => edit('')}
              className="absolute top-1/2 right-1 grid size-10 -translate-y-1/2 place-items-center text-muted"
            >
              <CloseIcon size={18} />
            </button>
          ) : null}
        </label>
      </form>
      {body}
    </Screen>
  );
}
