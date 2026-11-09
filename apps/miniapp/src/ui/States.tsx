import type { ReactNode } from 'react';
import { usePrefs } from '../lib/prefs';
import { Button } from './Button';
import { AlertIcon } from './icons';
import { Monogram } from './Logo';

/** `fill`: take the free height of the Screen and sit at its optical centre (a whole-screen state). */
interface StateLayout {
  fill?: boolean;
}

function State({
  disc,
  title,
  text,
  action,
  fill = false,
}: {
  disc: ReactNode;
  title: string;
  text?: string;
  action?: ReactNode;
} & StateLayout) {
  return (
    <div
      className={`flex flex-col items-center px-6 text-center ${
        fill ? 'flex-1 justify-center pt-8 pb-[12vh]' : 'py-12'
      }`}
    >
      <div
        aria-hidden="true"
        className="mb-5 grid size-[72px] shrink-0 place-items-center rounded-pill bg-block text-ink"
      >
        {disc}
      </div>
      <h2 className="type-heading max-w-[24ch] text-balance text-ink">{title}</h2>
      {text ? <p className="type-body mt-2 max-w-[34ch] text-balance text-muted">{text}</p> : null}
      {action ? (
        <div className="mt-6 flex w-full max-w-[280px] flex-col gap-2">{action}</div>
      ) : null}
    </div>
  );
}

/** Nothing here yet: the Stone disc with the "L." monogram. */
export function EmptyState({
  title,
  text,
  action,
  fill,
}: {
  title: string;
  text?: string;
  action?: ReactNode;
} & StateLayout) {
  return (
    <State disc={<Monogram size={38} />} title={title} text={text} action={action} fill={fill} />
  );
}

/** Network or server trouble: calm wording and one way forward, «Повторить». */
export function ErrorState({
  title,
  text,
  onRetry,
  retrying = false,
  fill,
}: {
  title?: string;
  text?: string;
  onRetry: () => void;
  /** The retry is in flight: the button turns busy instead of the state flickering away. */
  retrying?: boolean;
} & StateLayout) {
  const { t } = usePrefs();
  return (
    <State
      disc={<AlertIcon size={28} />}
      title={title ?? t.errors.loadFailedTitle}
      text={text ?? t.errors.loadFailedText}
      fill={fill}
      action={
        <Button block onClick={onRetry} loading={retrying}>
          {t.common.retry}
        </Button>
      }
    />
  );
}
