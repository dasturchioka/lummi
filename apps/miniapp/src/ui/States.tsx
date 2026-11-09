import type { ReactNode } from 'react';
import { usePrefs } from '../lib/prefs';
import { Button } from './Button';
import { AlertIcon } from './icons';
import { Monogram } from './Logo';

function State({
  disc,
  title,
  text,
  action,
}: {
  disc: ReactNode;
  title: string;
  text?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-8 py-12 text-center">
      <div className="mb-5 grid size-16 place-items-center rounded-pill bg-block text-ink">
        {disc}
      </div>
      <h2 className="type-section mb-2 max-w-[22ch] text-ink">{title}</h2>
      {text ? <p className="type-body max-w-[32ch] text-muted">{text}</p> : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}

/** Nothing here yet: the Stone disc with the monogram. */
export function EmptyState({
  title,
  text,
  action,
}: {
  title: string;
  text?: string;
  action?: ReactNode;
}) {
  return <State disc={<Monogram size={32} />} title={title} text={text} action={action} />;
}

/** Network or server trouble: calm wording and one way forward, «Повторить». */
export function ErrorState({
  title,
  text,
  onRetry,
}: {
  title?: string;
  text?: string;
  onRetry: () => void;
}) {
  const { t } = usePrefs();
  return (
    <State
      disc={<AlertIcon size={28} />}
      title={title ?? t.errors.loadFailedTitle}
      text={text ?? t.errors.loadFailedText}
      action={
        <Button variant="secondary" onClick={onRetry}>
          {t.common.retry}
        </Button>
      }
    />
  );
}
