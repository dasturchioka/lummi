import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { SEARCH_QUERY_MAX } from '@lummi/contracts/client';
import { useNavigate, useRouter, useSearch } from '@tanstack/react-router';
import { useRef, useState, type FormEvent } from 'react';
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

const DEBOUNCE_MS = 150;

/** Suggestions loading: the compact rows' shape (thumbnail, attribution, name, price) under hairlines. */
function SuggestionRows() {
  return (
    <div aria-hidden="true" className="flex flex-col divide-y divide-line pt-1">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="flex items-center gap-3 px-1 py-2.5">
          <Skeleton className="aspect-[3/4] w-12 shrink-0" rounded="thumb" />
          <div className="flex flex-1 flex-col">
            <Skeleton className="h-2.5 w-2/5" rounded="pill" />
            <Skeleton className="mt-2 h-4 w-3/5" />
            <Skeleton className="mt-2.5 h-3 w-1/4" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Results loading: the row cards' shape (photo, lockup, price). */
function ResultCards() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-2 pt-1">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-3 rounded-card bg-card p-2 pr-3">
          <Skeleton className="aspect-[3/4] w-24 shrink-0" rounded="photo" />
          <div className="flex flex-1 flex-col">
            <Skeleton className="h-2.5 w-1/2" rounded="pill" />
            <Skeleton className="mt-2 h-4 w-3/5" />
            <Skeleton className="mt-4 h-3 w-2/3" />
            <Skeleton className="mt-2 h-3 w-1/2" />
            <Skeleton className="mt-4 h-3.5 w-2/5" />
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
 *
 * The field sits in `Screen`'s sticky header, so results scroll under it and it stays in view when
 * the keyboard shrinks the viewport. While the next answer is on its way the current list stays,
 * dimmed, instead of flashing a skeleton on every keystroke.
 */
export function Search() {
  const { t } = usePrefs();
  const router = useRouter();
  const navigate = useNavigate();
  const params: { q?: string; s?: number } = useSearch({ strict: false });
  const [text, setText] = useState(params.q ?? '');
  const [submitted, setSubmitted] = useState(params.s === 1 && (params.q ?? '').trim() !== '');
  const field = useRef<HTMLInputElement>(null);

  const typed = text.trim();
  // A submitted list is for the submitted text; otherwise suggestions follow the debounced input.
  const debounced = useDebounced(typed, DEBOUNCE_MS);
  const q = submitted ? typed : debounced;
  // The server decides what is too short (`search.minQueryLength`, counted on the skeleton).
  const active = q !== '' && typed !== '';
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
      return { ...unwrap(res, 200), mode };
    },
  });

  const open = (slug: string) => void navigate({ to: '/p/$slug', params: { slug } });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (typed === '') return;
    setSubmitted(true);
    // «Найти» on the keyboard: put the keyboard away so the whole list is in view.
    field.current?.blur();
    void navigate({ to: '/search', search: { q: typed, s: 1 }, replace: true });
  };
  const edit = (v: string) => {
    setText(v);
    setSubmitted(false);
  };

  const data = active ? query.data : undefined;
  // What the debounce or the request has not caught up with yet is still loading, not "nothing found".
  const stale = !(submitted || debounced === typed) || query.isPlaceholderData;

  let body;
  if (!active || data?.tooShort) {
    body = (
      <p className="type-body mx-auto max-w-[34ch] px-2 pt-8 text-center text-balance text-muted">
        {t.search.hint}
      </p>
    );
  } else if (data === undefined) {
    body = query.isError ? (
      <div className="animate-[rise-in_0.24s_cubic-bezier(0.16,1,0.3,1)]">
        <ErrorState retrying={query.isFetching} onRetry={() => void query.refetch()} />
      </div>
    ) : submitted ? (
      <ResultCards />
    ) : (
      <SuggestionRows />
    );
  } else if (stale && (data.mode !== mode || data.items.length === 0)) {
    body = submitted ? <ResultCards /> : <SuggestionRows />;
  } else if (data.items.length === 0) {
    body = (
      <div className="animate-[rise-in_0.24s_cubic-bezier(0.16,1,0.3,1)]">
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
      </div>
    );
  } else {
    const compact = !submitted;
    body = (
      // Keyed by mode: the list fades in once when it replaces a skeleton or the other list, never
      // on a keystroke (the same list just takes the new rows).
      <ul
        key={mode}
        aria-label={compact ? t.search.suggestions : t.search.results}
        aria-busy={stale || undefined}
        className={`flex animate-[fade-in_0.18s_cubic-bezier(0.23,1,0.32,1)] flex-col transition-opacity duration-150 ${
          compact ? 'divide-y divide-line pt-1' : 'gap-2 pt-1'
        } ${stale ? 'opacity-60' : ''}`}
      >
        {data.items.map((it) => (
          <li key={it.slug}>
            <FragranceListCard item={it} compact={compact} onSelect={open} />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <Screen
      tabBar={false}
      header={
        <form role="search" onSubmit={submit} className="flex items-center gap-1 pt-4 pb-3">
          <button
            type="button"
            aria-label={t.card.back}
            onClick={() => goBackOrCatalog(router)}
            className="-ml-2 grid size-11 shrink-0 place-items-center rounded-pill text-ink transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-field active:scale-95 active:bg-field"
          >
            <ArrowLeftIcon size={20} />
          </button>
          <label className="relative block min-w-0 flex-1">
            <span className="sr-only">{t.search.label}</span>
            <SearchIcon
              size={18}
              className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted"
            />
            <input
              ref={field}
              type="search"
              inputMode="search"
              enterKeyHint="search"
              autoFocus={!params.q}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              maxLength={SEARCH_QUERY_MAX}
              value={text}
              onChange={(e) => edit(e.target.value)}
              placeholder={t.search.placeholder}
              className={`h-12 w-full appearance-none rounded-btn bg-field pl-10 text-base text-ellipsis text-ink placeholder:text-muted [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none ${
                text !== '' ? 'pr-12' : 'pr-3.5'
              }`}
            />
            {text !== '' ? (
              <button
                type="button"
                aria-label={t.search.clear}
                // Keep the focus (and the keyboard) in the field: the button is gone after the tap.
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => {
                  edit('');
                  field.current?.focus();
                }}
                className="absolute top-0 right-0 grid size-12 place-items-center rounded-btn text-muted transition-[color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:text-ink active:scale-95"
              >
                <CloseIcon size={18} />
              </button>
            ) : null}
          </label>
        </form>
      }
    >
      {/* Dragging the list puts the keyboard away, as native search lists do. */}
      <div
        className="flex flex-1 flex-col"
        onTouchMove={() => {
          if (document.activeElement === field.current) field.current?.blur();
        }}
      >
        {body}
      </div>
    </Screen>
  );
}
