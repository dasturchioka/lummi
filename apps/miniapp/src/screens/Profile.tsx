import { formatPhone } from '@lummi/i18n';
import { useRouter } from '@tanstack/react-router';
import { useInfoPages } from '../content/queries';
import { SavedPointsSection } from '../orders/saved-points';
import { usePrefs } from '../lib/prefs';
import { useRegistration } from '../lib/registration';
import { CardList, ListRow } from '../ui/Card';
import { ChevronIcon, ContrastIcon, GlobeIcon, PhoneIcon } from '../ui/icons';
import { Monogram } from '../ui/Logo';
import { Screen } from '../ui/Screen';
import { ScreenHeader } from '../ui/ScreenHeader';
import { Segmented } from '../ui/Segmented';
import { Skeleton } from '../ui/Skeleton';
import { ErrorState } from '../ui/States';

export function Profile() {
  const { ensurePhone } = useRegistration();
  const router = useRouter();
  const pages = useInfoPages().data;
  const { t, language, theme, setLanguage, setTheme, customer, customerQuery } = usePrefs();

  if (customerQuery.isError) {
    return (
      <Screen>
        <ScreenHeader title={t.profile.title} />
        <ErrorState fill onRetry={customerQuery.refetch} retrying={customerQuery.isFetching} />
      </Screen>
    );
  }

  const name = customer ? [customer.firstName, customer.lastName].filter(Boolean).join(' ') : null;
  return (
    <Screen>
      <ScreenHeader title={t.profile.title} />
      <div className="mb-6 flex min-h-14 items-center gap-4">
        <div
          aria-hidden="true"
          className="grid size-14 shrink-0 place-items-center rounded-pill bg-block text-ink"
        >
          <Monogram size={30} />
        </div>
        {customer ? (
          <div className="min-w-0">
            {/* Telegram names run to 64 + 64 characters: wrap to two lines, never cut mid-name. */}
            <p className="type-heading line-clamp-2 [overflow-wrap:anywhere]">
              {name || t.profile.guest}
            </p>
            {customer.username ? (
              <p className="type-small mt-0.5 text-muted [overflow-wrap:anywhere]">
                @{customer.username}
              </p>
            ) : null}
          </div>
        ) : (
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-3 w-24" />
          </div>
        )}
      </div>
      <CardList>
        {/* The account phone, verified from Telegram; without one the row starts the registration step. */}
        <ListRow
          id="row-phone"
          leading={<PhoneIcon size={20} />}
          label={t.profile.phone}
          hint={customer ? (customer.phone ? t.profile.phoneFrom : t.profile.phoneWhy) : undefined}
          onClick={customer && !customer.phone ? () => void ensurePhone() : undefined}
          trailing={
            customer?.phone ? (
              <span className="type-body text-[15px] whitespace-nowrap text-ink tabular-nums">
                {formatPhone(customer.phone)}
              </span>
            ) : customer ? (
              <span className="-mr-1 flex items-center gap-0.5">
                <span className="type-body text-[15px] font-medium whitespace-nowrap text-ink">
                  {t.profile.phoneAdd}
                </span>
                <ChevronIcon size={18} />
              </span>
            ) : (
              <Skeleton className="h-4 w-32" />
            )
          }
        />
        <ListRow
          id="row-language"
          leading={<GlobeIcon size={20} />}
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
          leading={<ContrastIcon size={20} />}
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
      {customer?.phone ? <SavedPointsSection /> : null}
      {pages && pages.length > 0 ? (
        // The info pages close the screen as one plain card of rows (mockup 08-profile): the
        // titles name themselves, so there is no section label and no icon per row.
        <nav aria-label={t.profile.info} className="mt-3">
          <CardList>
            {pages.map((p) => (
              <ListRow
                key={p.slug}
                label={language === 'uz' ? p.titleUz : p.titleRu}
                trailing={<ChevronIcon size={18} />}
                onClick={() =>
                  void router.navigate({ to: '/info/$slug', params: { slug: p.slug } })
                }
              />
            ))}
          </CardList>
        </nav>
      ) : null}
    </Screen>
  );
}
