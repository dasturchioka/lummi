import type { BirthdayCouponDto, MyDiscountsDto } from '@lummi/contracts';
import { fill, formatCalendarDate, formatMoney, plural } from '@lummi/i18n';
import { useState } from 'react';
import { WithManagerLink } from '../orders/CancelOrder';
import { usePrefs } from '../lib/prefs';
import { useRegistration } from '../lib/registration';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { AlertIcon, GiftIcon } from '../ui/icons';
import { Skeleton } from '../ui/Skeleton';
import { BirthDateSheet } from './BirthDateSheet';
import { useDiscountsText, useMyDiscounts } from './queries';

/**
 * An active birthday coupon (mockup 08's gift card): what it gives, «−20%» as the discount badge
 * (Sage Wash, DESIGN.md), and how long it lasts («Осталось 9 дней · до 21 марта»). It applies in
 * the cart by itself, so the card has no button.
 */
function CouponCard({ c }: { c: BirthdayCouponDto }) {
  const { language } = usePrefs();
  const d = useDiscountsText();
  const until = fill(d.until, { date: formatCalendarDate(c.lastDay, language) });
  return (
    <Card className="flex items-start gap-3 px-4 py-3.5" data-testid="birthday-coupon">
      <span className="mt-0.5 shrink-0 text-sage-ink">
        <GiftIcon size={20} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center justify-between gap-3">
          <span className="type-row font-semibold">{d.coupon}</span>
          <Badge tone="discount">−{c.percent}%</Badge>
        </p>
        <p className="type-small mt-0.5 text-pretty text-muted">
          {fill(d.couponTerms, { max: formatMoney(c.maxAmount, language) })}
        </p>
        <p className="type-small mt-2 font-medium text-ink tabular-nums">
          {c.daysLeft === 0 ? d.lastDay : plural(language, c.daysLeft, d.daysLeft)} · {until}
        </p>
      </div>
    </Card>
  );
}

/**
 * No coupon now: the next one to come («−20% · появится 11 марта, за 3 дня до дня рождения») and
 * the date it counts from, with the manager to write to about a wrong date (only staff correct
 * it); without a date, an invitation to enter it.
 */
function BirthdayCard({ data, onEnter }: { data: MyDiscountsDto; onEnter: () => void }) {
  const { language } = usePrefs();
  const d = useDiscountsText();
  const days = plural(language, data.birthdayDaysBefore, d.days);
  const percent = String(data.birthdayPercent);
  const next = data.nextBirthdayCoupon;
  return (
    <Card className="flex items-start gap-3 px-4 py-3.5" data-testid="birthday-card">
      <span className="mt-0.5 shrink-0 text-ink">
        <GiftIcon size={20} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="type-row font-semibold">{d.coupon}</p>
        {data.birthDate ? (
          <>
            {next ? (
              <p className="type-small mt-0.5 text-pretty text-muted">
                {fill(data.birthdayDaysBefore === 0 ? d.upcomingOnTheDay : d.upcoming, {
                  percent: String(next.percent),
                  date: formatCalendarDate(next.opensOn, language),
                  days,
                })}
              </p>
            ) : null}
            <p className="type-small mt-2 text-ink">
              {fill(d.birthDate, { date: formatCalendarDate(data.birthDate, language, true) })}
            </p>
            <p className="type-small mt-0.5 text-muted">
              <WithManagerLink text={d.wrongDate} link={d.wrongDateManager} />
            </p>
          </>
        ) : (
          <>
            <p className="type-small mt-0.5 text-pretty text-muted">
              {fill(data.birthdayDaysBefore === 0 ? d.inviteOnTheDay : d.invite, {
                percent,
                days,
              })}
            </p>
            <Button
              size="sm"
              variant="secondary"
              className="mt-3"
              onClick={onEnter}
              data-testid="birth-date-enter"
            >
              {d.inviteAction}
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}

/**
 * Profile → «Мои скидки» (#30; the upgrade rights of #38 join it): the active birthday coupons
 * with days left, else the next one or the invitation to enter the date of birth. Entering it
 * needs the account phone first (one phone, one account), so the registration step runs before
 * the sheet when there is none.
 */
export function DiscountsSection() {
  const { t, customer } = usePrefs();
  const { ensurePhone } = useRegistration();
  const d = useDiscountsText();
  const query = useMyDiscounts();
  const [open, setOpen] = useState(false);
  const data = query.data;
  const enter = async () => {
    if (!customer?.phone && (await ensurePhone()) !== 'ready') return;
    setOpen(true);
  };
  return (
    <section className="mt-6" aria-labelledby="discounts-title" data-testid="my-discounts">
      <h2 id="discounts-title" className="type-section text-ink">
        {d.title}
      </h2>
      <div className="mt-3 flex flex-col gap-3">
        {query.isPending ? (
          <Card className="flex items-start gap-3 px-4 py-3.5" aria-busy="true">
            <Skeleton className="size-5" rounded="pill" />
            <div className="flex-1 space-y-2 pt-0.5">
              <Skeleton className="h-3.5 w-40" />
              <Skeleton className="h-3 w-56" />
            </div>
          </Card>
        ) : !data ? (
          <Card className="flex items-center gap-3 py-2 pr-2 pl-4">
            <span className="shrink-0 text-ink">
              <AlertIcon size={20} />
            </span>
            <p className="type-small min-w-0 flex-1 text-ink">{d.loadFailed}</p>
            <Button
              size="sm"
              variant="secondary"
              loading={query.isFetching}
              onClick={() => void query.refetch()}
            >
              {t.common.retry}
            </Button>
          </Card>
        ) : data.birthdayCoupons.length > 0 ? (
          data.birthdayCoupons.map((c) => <CouponCard key={c.id} c={c} />)
        ) : (
          <BirthdayCard data={data} onEnter={() => void enter()} />
        )}
      </div>
      {data ? (
        <BirthDateSheet
          open={open}
          onOpenChange={setOpen}
          percent={data.birthdayPercent}
          daysBefore={data.birthdayDaysBefore}
          needsConsent={data.needsConsent}
        />
      ) : null}
    </section>
  );
}
