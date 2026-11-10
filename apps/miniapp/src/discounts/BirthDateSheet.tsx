import { fill, plural } from '@lummi/i18n';
import { useState } from 'react';
import { useOrdersText } from '../orders/queries';
import { usePrefs } from '../lib/prefs';
import { Button } from '../ui/Button';
import { Checkbox, FieldError } from '../ui/Field';
import { AlertIcon } from '../ui/icons';
import { Sheet, SheetDescription } from '../ui/Sheet';
import { judgeBirthDate, tashkentToday } from './birth-date';
import { BirthDateField } from './BirthDateField';
import { useDiscountsText, useSetBirthDate } from './queries';

/**
 * Profile's one-time date of birth (TZ §3.8): what it brings and that it is entered once, the
 * field, the data-processing consent while the customer has given none (TZ §3.6: «включая дату
 * рождения»), and «Сохранить». It closes once the date is stored.
 */
export function BirthDateSheet({
  open,
  onOpenChange,
  percent,
  daysBefore,
  needsConsent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  percent: number;
  daysBefore: number;
  needsConsent: boolean;
}) {
  const { t, language } = usePrefs();
  const d = useDiscountsText();
  const o = useOrdersText();
  const save = useSetBirthDate();
  const [value, setValue] = useState('');
  const [blurred, setBlurred] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [consent, setConsent] = useState(false);
  const [refused, setRefused] = useState<'range' | 'consent' | 'failed' | null>(null);

  const verdict = judgeBirthDate(value, tashkentToday());
  const empty = value.trim() === '';
  const dateError =
    refused === 'range'
      ? d.rangeError
      : (attempted || blurred) && (!verdict.ok || empty)
        ? !verdict.ok && verdict.reason === 'range'
          ? d.rangeError
          : d.formatError
        : null;
  const consentMissing = needsConsent && !consent;
  const consentError =
    (attempted && consentMissing) || refused === 'consent' ? o.checkout.needConsent : null;

  const reset = () => {
    setValue('');
    setBlurred(false);
    setAttempted(false);
    setConsent(false);
    setRefused(null);
  };
  const submit = () => {
    setAttempted(true);
    setRefused(null);
    if (!verdict.ok || verdict.iso === null || consentMissing) return;
    save.mutate(
      { birthDate: verdict.iso, consent: needsConsent ? consent : false },
      {
        onSuccess: (r) => {
          if (r.kind === 'saved' || r.kind === 'already_set') {
            onOpenChange(false);
            reset();
          } else setRefused(r.kind === 'invalid' ? 'range' : 'consent');
        },
        onError: () => setRefused('failed'),
      },
    );
  };

  const days = plural(language, daysBefore, d.days);
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
      title={d.sheetTitle}
      ownDescription
      closeLabel={t.common.close}
    >
      <form
        className="flex flex-col gap-4 pb-1"
        data-testid="birth-date-sheet"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <SheetDescription className="type-small text-pretty text-muted">
          {daysBefore === 0
            ? fill(d.sheetTextOnTheDay, { percent: String(percent) })
            : fill(d.sheetText, { percent: String(percent), days })}
        </SheetDescription>
        <BirthDateField
          value={value}
          onChange={(v) => {
            setValue(v);
            setRefused(null);
          }}
          onBlur={() => setBlurred(true)}
          error={dateError}
        />
        {needsConsent ? (
          <div>
            <Checkbox checked={consent} onChange={setConsent} invalid={!!consentError}>
              {o.checkout.consent}
            </Checkbox>
            {consentError ? <FieldError inset>{consentError}</FieldError> : null}
          </div>
        ) : null}
        {refused === 'failed' ? (
          <p role="alert" className="type-small flex items-start gap-2 text-ink">
            <span className="mt-px shrink-0">
              <AlertIcon size={16} />
            </span>
            {d.saveFailed}
          </p>
        ) : null}
        <Button block type="submit" loading={save.isPending} data-testid="birth-date-save">
          {d.save}
        </Button>
      </form>
    </Sheet>
  );
}
