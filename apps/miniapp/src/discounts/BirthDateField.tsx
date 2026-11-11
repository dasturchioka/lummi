import { formatCalendarDate } from '@lummi/i18n';
import type { ReactNode } from 'react';
import { usePrefs } from '../lib/prefs';
import { TextField } from '../ui/Field';
import { CalendarIcon } from '../ui/icons';
import { judgeBirthDate, maskBirthDate, tashkentToday } from './birth-date';
import { useDiscountsText } from './queries';

/**
 * The date of birth as `ДД.ММ.ГГГГ` on the digit keyboard (mockup 06: the field with a calendar
 * mark), the dots added while typing. Once the date is whole and plausible it is read back in
 * words under the field («14 марта 1996 — изменить потом нельзя, проверьте»), since it is
 * entered once. Checkout's optional field and the Profile sheet share it.
 */
export function BirthDateField({
  value,
  onChange,
  onBlur,
  aside,
  hint,
  error,
  autoFocus,
}: {
  value: string;
  onChange: (masked: string) => void;
  onBlur?: () => void;
  aside?: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  autoFocus?: boolean;
}) {
  const d = useDiscountsText();
  const { language } = usePrefs();
  const verdict = judgeBirthDate(value, tashkentToday());
  const [before = '', after = ''] = d.confirmDate.split('{date}');
  const readBack =
    verdict.ok && verdict.iso ? (
      <span data-testid="birth-date-confirm">
        {before}
        <span className="font-medium text-ink">
          {formatCalendarDate(verdict.iso, language, true)}
        </span>
        {after}
      </span>
    ) : null;
  return (
    <TextField
      label={d.field}
      aside={aside}
      hint={readBack ?? hint}
      error={error}
      value={value}
      onChange={(e) => onChange(maskBirthDate(e.target.value))}
      onBlur={onBlur}
      autoFocus={autoFocus}
      inputMode="numeric"
      autoComplete="bday"
      autoCorrect="off"
      spellCheck={false}
      enterKeyHint="done"
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
      maxLength={10}
      placeholder={d.placeholder}
      className="tabular-nums"
      trailing={
        error ? undefined : (
          <span className="text-muted">
            <CalendarIcon size={20} />
          </span>
        )
      }
      data-testid="birth-date-field"
    />
  );
}
