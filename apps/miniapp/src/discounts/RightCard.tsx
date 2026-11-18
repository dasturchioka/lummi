import type { MyUpgradeRightDto } from '@lummi/contracts';
import { fill, formatCalendarDate, plural } from '@lummi/i18n';
import { usePrefs } from '../lib/prefs';
import { attribution } from '../ui/attribution';
import { Badge } from '../ui/Badge';
import { Card } from '../ui/Card';
import { BottleIcon } from '../ui/icons';
import { useDiscountsText } from './queries';
import { volumesText } from './volumes';

/**
 * An open upgrade right in «Мои скидки» (TZ §3.4; mockup 08's set card): what it is and the order
 * that opened it («Набор из заказа № 1042»), what it covers (the volumes from the setting), «−20%» as the
 * discount badge, the fragrances it covers in the Name role, each with «по мотивам <brand>» (CLAUDE.md)
 * and opening its card while on sale, and how long it lasts. It applies in the cart by itself, so the card has no button.
 */
export function RightCard({
  right,
  fullSizeMl,
  onOpen,
}: {
  right: MyUpgradeRightDto;
  /** The volumes it discounts (setting `pricing.fullSizeVolumesMl`), from «Мои скидки». */
  fullSizeMl: number[];
  onOpen: (slug: string) => void;
}) {
  const { t, language } = usePrefs();
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
        <p className="type-small mt-0.5 text-ink">
          {fill(d.rightSource[right.source], { number: String(right.sourceOrderNumber) })}
        </p>
        <p className="type-small mt-0.5 text-pretty text-muted">
          {fill(right.anyFragrance ? d.rightTermsAny : d.rightTerms[right.source], {
            volumes: volumesText(fullSizeMl, d.volumesOr),
          })}
        </p>
        {/* a right on any fragrance (#79) names none: the five it came with would mislead */}
        {right.anyFragrance ? null : (
          <ul className="mt-2 flex flex-col gap-1">
            {right.fragrances.map((f) => (
              // a hanging indent: a name that wraps stays one item; the original always follows it
              <li
                key={f.name}
                className="type-small pl-2.5 -indent-2.5 text-pretty text-muted [overflow-wrap:anywhere]"
              >
                {f.slug ? (
                  <button
                    type="button"
                    onClick={() => onOpen(f.slug as string)}
                    className="type-name text-left text-[18px] text-ink underline decoration-line-strong decoration-1 underline-offset-[3px] transition-opacity duration-150 active:opacity-60"
                  >
                    {f.name}
                  </button>
                ) : (
                  <span className="type-name text-[18px] text-muted">{f.name}</span>
                )}{' '}
                {attribution(t.card.basedOn, f.brand)}
              </li>
            ))}
          </ul>
        )}
        <p className="type-small mt-2 font-medium text-ink tabular-nums">
          {right.daysLeft === 0 ? d.lastDay : plural(language, right.daysLeft, d.daysLeft)} ·{' '}
          {until}
        </p>
      </div>
    </Card>
  );
}
