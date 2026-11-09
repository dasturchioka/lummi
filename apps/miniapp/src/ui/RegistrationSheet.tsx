import { usePrefs } from '../lib/prefs';
import { Button } from './Button';
import { Sheet } from './Sheet';

export type RegistrationStatus = 'idle' | 'busy' | 'denied' | 'unsupported' | 'failed' | 'foreign';

/** The registration step: share the contact, then allow the bot to write. Pure view; the flow lives in lib/registration. */
export default function RegistrationSheet({
  open,
  status,
  onShare,
  onClose,
}: {
  open: boolean;
  status: RegistrationStatus;
  onShare: () => void;
  onClose: () => void;
}) {
  const { t } = usePrefs();
  const r = t.registration;
  const problem: Partial<Record<RegistrationStatus, string>> = {
    denied: r.denied,
    unsupported: r.unsupported,
    failed: r.failed,
    foreign: r.foreign,
  };
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={r.title}
      description={r.text}
      closeLabel={t.common.close}
    >
      <div className="type-small mb-4 flex flex-col gap-2 text-muted">
        <p>{r.phoneWhy}</p>
        <p>{r.writeWhy}</p>
      </div>
      {problem[status] ? (
        <p role="alert" className="type-small mb-3 text-ink">
          {problem[status]}
        </p>
      ) : null}
      <Button block loading={status === 'busy'} onClick={onShare}>
        {status === 'denied' || status === 'failed' ? t.common.retry : r.share}
      </Button>
      <p className="type-small mt-3 text-center text-muted">{r.privacy}</p>
    </Sheet>
  );
}
