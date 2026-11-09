import { usePrefs } from '../lib/prefs';
import { CardList, ListRow } from '../ui/Card';
import { Monogram } from '../ui/Logo';
import { Screen } from '../ui/Screen';
import { ScreenHeader } from '../ui/ScreenHeader';
import { Segmented } from '../ui/Segmented';
import { Skeleton } from '../ui/Skeleton';
import { ErrorState } from '../ui/States';

export function Profile() {
  const { t, language, theme, setLanguage, setTheme, customer, customerQuery } = usePrefs();

  if (customerQuery.isError) {
    return (
      <Screen>
        <ScreenHeader title={t.profile.title} />
        <ErrorState onRetry={customerQuery.refetch} />
      </Screen>
    );
  }

  const name = customer ? [customer.firstName, customer.lastName].filter(Boolean).join(' ') : null;
  return (
    <Screen>
      <ScreenHeader title={t.profile.title} />
      <div className="mb-[var(--section)] flex items-center gap-4">
        <div className="grid size-14 shrink-0 place-items-center rounded-pill bg-block text-ink">
          <Monogram size={28} />
        </div>
        {customer ? (
          <div className="min-w-0">
            <p className="type-body truncate font-semibold">{name}</p>
            {customer.username ? (
              <p className="type-small truncate text-muted">@{customer.username}</p>
            ) : null}
          </div>
        ) : (
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-20" />
          </div>
        )}
      </div>
      <CardList>
        <ListRow
          id="row-language"
          label={t.profile.language}
          trailing={
            <Segmented
              labelledBy="row-language"
              value={language}
              onChange={setLanguage}
              options={[
                { value: 'ru', label: 'RU' },
                { value: 'uz', label: 'UZ' },
              ]}
            />
          }
        />
        <ListRow
          id="row-theme"
          label={t.profile.theme}
          trailing={
            <Segmented
              labelledBy="row-theme"
              value={theme}
              onChange={setTheme}
              options={[
                { value: 'light', label: t.profile.themeLight },
                { value: 'dark', label: t.profile.themeDark },
              ]}
            />
          }
        />
      </CardList>
    </Screen>
  );
}
