import type { BtsPointDto } from '@lummi/contracts';
import { fill, plural } from '@lummi/i18n';
import { usePrefs } from '../lib/prefs';
import { MetaLine } from '../ui/MetaLine';
import { PinIcon } from '../ui/icons';
import { Hours } from './Hours';

/**
 * The chosen BTS point, collapsed (checkout, mockup 06): «Пункт BTS» with «Сменить», then a
 * white plate outlined in Graphite (selected) with the name in 600, «address · hours» and the pin,
 * and under it how many other points the city has. `onChange` reopens the picker on this point.
 */
export function ChosenPoint({
  point,
  otherPoints = 0,
  onChange,
}: {
  point: BtsPointDto;
  /** The city's other offered points (`pointCount - 1` from the picker's city list). */
  otherPoints?: number;
  onChange: () => void;
}) {
  const { t, language } = usePrefs();
  return (
    <div data-testid="chosen-point">
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="type-small font-medium text-muted">{t.delivery.pointTitle}</span>
        {/* the padding widens the tap target to 44 px without moving the text */}
        <button
          type="button"
          onClick={onChange}
          className="type-small -my-3 -mr-2 rounded-btn px-2 py-3 font-medium text-ink underline decoration-line-strong underline-offset-[3px] transition-[text-decoration-color] duration-150 hover:decoration-current"
        >
          {t.delivery.change}
        </button>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2.5 gap-y-1 rounded-btn bg-card px-3.5 py-3 shadow-[inset_0_0_0_1.5px_var(--c-ink)]">
        <span className="type-row font-semibold break-words">{point.name}</span>
        <span className="col-start-2 row-span-2 row-start-1 self-center text-ink">
          <PinIcon size={20} />
        </span>
        <MetaLine
          className="type-small text-muted"
          parts={[point.address, point.hours ? <Hours text={point.hours} /> : null]}
        />
      </div>
      {otherPoints > 0 ? (
        <p className="type-hint mt-1.5 text-muted">
          {fill(plural(language, otherPoints, t.delivery.moreInCity), { city: point.city })}
        </p>
      ) : null}
    </div>
  );
}
