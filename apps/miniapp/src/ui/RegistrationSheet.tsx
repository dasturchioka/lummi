import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { formatPhone } from '@lummi/i18n';
import { usePrefs } from '../lib/prefs';
import { Button } from './Button';
import { AlertIcon, ChatIcon, CheckIcon, PhoneIcon, RefreshIcon, UserIcon } from './icons';
import { Sheet } from './Sheet';

/**
 * Where the step stands. The ask (purpose, two numbered steps, the buttons) shows for `idle`,
 * `busy` and the problems a retry can fix (`denied`, `failed`, `foreign`, `expired`). The rest
 * replace the ask with an outcome: `done`, `taken` (phone_taken), `unsupported` (Telegram below
 * 6.9) and `browser` (a plain browser in development).
 */
export type RegistrationStatus =
  | 'idle'
  | 'busy'
  | 'denied'
  | 'failed'
  | 'foreign'
  | 'expired'
  | 'done'
  | 'taken'
  | 'unsupported'
  | 'browser';

/** The registration step: share the contact, then allow the bot to write. Pure view; the flow lives in lib/registration. */
export default function RegistrationSheet({
  open,
  status,
  phone = null,
  botWrites = null,
  onShare,
  onClose,
  onWriteManager,
}: {
  open: boolean;
  status: RegistrationStatus;
  /** The verified account phone (E.164), shown once it is saved. */
  phone?: string | null;
  /** The write-access answer: true allowed, false refused, null not asked. */
  botWrites?: boolean | null;
  onShare: () => void;
  onClose: () => void;
  onWriteManager: () => void;
}) {
  const { t } = usePrefs();
  const r = t.registration;

  let outcome: OutcomeContent | null = null;
  if (status === 'done') {
    outcome = {
      disc: <CheckIcon size={30} />,
      confirmed: true,
      title: r.doneTitle,
      lead: phone ? formatPhone(phone) : undefined,
      text: botWrites === true ? r.doneChat : botWrites === false ? r.doneInApp : undefined,
    };
  } else if (status === 'taken') {
    outcome = {
      disc: <UserIcon size={28} />,
      title: r.takenTitle,
      text: r.takenText,
      actions: (
        <>
          <Button block onClick={onWriteManager}>
            <ChatIcon size={20} />
            {r.writeManager}
          </Button>
          <Button block variant="secondary" onClick={onClose}>
            {t.common.close}
          </Button>
        </>
      ),
    };
  } else if (status === 'unsupported' || status === 'browser') {
    const update = status === 'unsupported';
    outcome = {
      disc: update ? <RefreshIcon size={28} /> : <PhoneIcon size={28} />,
      title: update ? r.updateTitle : r.browserTitle,
      text: update ? r.updateText : r.browserText,
      actions: (
        <Button block onClick={onClose}>
          {r.understood}
        </Button>
      ),
    };
  }

  const notices: Partial<Record<RegistrationStatus, string>> = {
    busy: r.waiting,
    denied: r.denied,
    failed: r.failed,
    foreign: r.foreign,
    expired: r.expired,
  };
  const notice = notices[status];
  // One live region that stays mounted, so every change of state is read out once.
  const announcement = outcome
    ? [outcome.title, outcome.lead, outcome.text].filter(Boolean).join('. ')
    : (notice ?? '');

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={r.title}
      closeLabel={t.common.close}
    >
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
      <AutoHeight>
        {outcome ? (
          <Outcome key={status} {...outcome} />
        ) : (
          <Ask status={status} notice={notice} onShare={onShare} onClose={onClose} />
        )}
      </AutoHeight>
    </Sheet>
  );
}

function Ask({
  status,
  notice,
  onShare,
  onClose,
}: {
  status: RegistrationStatus;
  notice: string | undefined;
  onShare: () => void;
  onClose: () => void;
}) {
  const { t } = usePrefs();
  const r = t.registration;
  // A refusal is the customer's choice, not a fault: it reads calm, with no alert icon.
  const fault = status === 'failed' || status === 'foreign' || status === 'expired';
  const retry = status === 'failed' || status === 'expired';

  return (
    <div>
      {/* The purpose sits in the sheet's description slot and leaves with the ask. */}
      <p className="type-small pb-3 text-muted">{r.text}</p>
      <ol className="flex flex-col gap-4 pt-1 pb-6">
        <Step n={1} title={r.contactTitle} text={r.contactText} />
        <Step n={2} title={r.writeTitle} text={r.writeText} />
      </ol>
      {notice ? (
        <p
          key={status}
          className={`type-small mb-3 flex animate-[fade-in_0.2s_ease-out] gap-2.5 ${
            // Waiting is not news: a quiet line. A refusal or a fault sits on a Milk Field plate.
            status === 'busy'
              ? 'justify-center text-center text-muted'
              : 'rounded-btn bg-field px-3 py-2.5 text-ink'
          }`}
        >
          {fault ? <AlertIcon size={18} className="shrink-0" /> : null}
          <span className="min-w-0 self-center text-pretty">{notice}</span>
        </p>
      ) : null}
      <div className="flex flex-col gap-2">
        <Button block loading={status === 'busy'} onClick={onShare}>
          {retry ? t.common.retry : r.share}
        </Button>
        <Button block variant="secondary" onClick={onClose}>
          {r.later}
        </Button>
      </div>
    </div>
  );
}

/** One step, numbered like the payment steps: a 24 px Sage-outlined circle. */
function Step({ n, title, text }: { n: number; title: string; text: string }) {
  return (
    <li className="grid grid-cols-[24px_1fr] gap-x-3">
      <span
        aria-hidden="true"
        className="mt-px grid size-6 place-items-center rounded-pill text-[12px] leading-none font-semibold text-sage-ink tabular-nums shadow-[inset_0_0_0_1px_var(--c-sage)]"
      >
        {n}
      </span>
      <div className="min-w-0">
        <p className="type-body text-[15px] leading-[22px] font-semibold text-ink">{title}</p>
        <p className="type-small mt-0.5 text-pretty text-muted">{text}</p>
      </div>
    </li>
  );
}

interface OutcomeContent {
  disc: ReactNode;
  /** The Sage disc of a confirmation (Graphite mark), instead of the neutral Stone one. */
  confirmed?: boolean;
  title: string;
  /** A value to read at a glance under the title (the saved phone). */
  lead?: string;
  text?: string;
  actions?: ReactNode;
}

/** A result in place of the ask: a disc, a heading, a line, then at most two actions. */
function Outcome({ disc, confirmed = false, title, lead, text, actions }: OutcomeContent) {
  return (
    <div className="flex animate-[rise-in_0.28s_cubic-bezier(0.23,1,0.32,1)] flex-col items-center pt-4 pb-4 text-center">
      <div
        aria-hidden="true"
        className={`mb-4 grid size-16 shrink-0 place-items-center rounded-pill ${
          confirmed ? 'bg-sage text-on-sage' : 'bg-block text-ink'
        }`}
      >
        {disc}
      </div>
      <h3 className="type-heading max-w-[26ch] text-balance text-ink">{title}</h3>
      {lead ? (
        <p className="type-body mt-1 text-[15px] font-semibold whitespace-nowrap text-ink tabular-nums">
          {lead}
        </p>
      ) : null}
      {text ? <p className="type-body mt-2 max-w-[34ch] text-balance text-muted">{text}</p> : null}
      {actions ? <div className="mt-6 flex w-full flex-col gap-2">{actions}</div> : null}
    </div>
  );
}

/**
 * The sheet rides on its content: when a notice appears or an outcome replaces the ask, the
 * height glides to the new size on the drawer curve instead of the top edge jumping.
 */
function AutoHeight({ children }: { children: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const box = outer.current;
    const content = inner.current;
    if (!box || !content || typeof ResizeObserver === 'undefined') return;
    let last = content.offsetHeight;
    // Delivered after layout and before paint, so the new content never flashes at the old size.
    const ro = new ResizeObserver(() => {
      const next = content.offsetHeight;
      const from = last;
      last = next;
      if (from === next || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      box.style.overflow = 'hidden'; // only while it moves, so focus rings are never clipped
      const glide = box.animate([{ height: `${from}px` }, { height: `${next}px` }], {
        duration: 260,
        easing: 'cubic-bezier(0.32, 0.72, 0, 1)',
      });
      glide.onfinish = glide.oncancel = () => {
        box.style.overflow = '';
      };
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={outer}>
      <div ref={inner}>{children}</div>
    </div>
  );
}
