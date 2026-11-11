import type { MyUpgradeRightDto } from '@lummi/contracts';
import { fill, formatCalendarDate, plural } from '@lummi/i18n';
import { usePrefs } from '../lib/prefs';
import { Badge } from '../ui/Badge';
import { Card } from '../ui/Card';
import { BottleIcon } from '../ui/icons';
import { useDiscountsText } from './queries';

/**
 * An open upgrade right in «Мои скидки» (TZ §3.4; mockup 08's set card): what it is, «−20%» as the
 * discount badge, the fragrances it covers in the Name role (each opens its card while on sale)
 * and how long it lasts. It applies in the cart by itself, so the card has no button.
 */
export function RightCard({
  right,
  onOpen,
}: {
  right: MyUpgradeRightDto;
  onOpen: (slug: string) => void;
}) {
  const { language } = usePrefs();
  const d = useDiscountsText();
  const until = fill(d.until, { date: formatCalendarDate(right.lastDay, language) });
  return (
    <Card className="flex items-start gap-3 px-4 py-3.5" data-testid="upgrade-right">
      <span className="mt-0.5 shrink-0 text-sage-ink">
        <BottleIcon size={20} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center justify-between gap-3">
          <span className="type-row font-semibold">{d.right[right.source]}</span>
          <Badge tone="discount">−{right.percent}%</Badge>
        </p>
        <p className="type-small mt-0.5 text-pretty text-muted">{d.rightTerms[right.source]}</p>
        <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5">
          {right.fragrances.map((f) => (
            <li key={f.name} className="type-name min-w-0 text-[18px] [overflow-wrap:anywhere]">
              {f.slug ? (
                <button
                  type="button"
                  onClick={() => onOpen(f.slug as string)}
                  className="text-left text-ink underline decoration-line-strong decoration-1 underline-offset-[3px] transition-opacity duration-150 active:opacity-60"
                >
                  {f.name}
                </button>
              ) : (
                <span className="text-muted">{f.name}</span>
              )}
            </li>
          ))}
        </ul>
        <p className="type-small mt-2 font-medium text-ink tabular-nums">
          {right.daysLeft === 0 ? d.lastDay : plural(language, right.daysLeft, d.daysLeft)} ·{' '}
          {until}
        </p>
      </div>
    </Card>
  );
}
