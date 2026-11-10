import type { ReactNode } from 'react';
import { TextField } from '../ui/Field';
import { CalendarIcon } from '../ui/icons';
import { maskBirthDate } from './birth-date';
import { useDiscountsText } from './queries';

/**
 * The date of birth as `ДД.ММ.ГГГГ` on the digit keyboard (mockup 06: the field with a calendar
 * mark), the dots added while typing. Checkout's optional field and the Profile sheet share it.
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
  return (
    <TextField
      label={d.field}
      aside={aside}
      hint={hint}
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
