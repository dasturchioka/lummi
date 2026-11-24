import { customerMayCancel } from '@lummi/contracts/constants';
import type { OrderDto } from '@lummi/contracts';
import { fill } from '@lummi/i18n';
import { useState } from 'react';
import { usePrefs } from '../lib/prefs';
import { openManagerChat } from '../lib/telegram';
import { Button } from '../ui/Button';
import { Sheet, SheetDescription } from '../ui/Sheet';
import { StatusPill } from './parts';
import { useCancelOrder, useOrdersText } from './queries';

/**
 * A sentence with a `{manager}` slot that opens the shop's manager account (`openManagerChat`);
 * the words stay plain text until the customer's config has the username.
 */
export function WithManagerLink({ text, link }: { text: string; link: string }) {
  const { customer } = usePrefs();
  const username = customer?.config.managerUsername;
  const [before = '', after = ''] = text.split('{manager}');
  return (
    <>
      {before}
      {username ? (
        <button
          type="button"
          onClick={() => openManagerChat(username)}
          data-testid="sheet-manager"
          className="-my-1 inline rounded-btn py-1 font-medium text-ink underline decoration-line-strong underline-offset-[3px] transition-[text-decoration-color,opacity] duration-150 hover:decoration-current active:opacity-60"
        >
          {link}
        </button>
      ) : (
        link
      )}
      {after}
    </>
  );
}

/**
 * «Отменить заказ» (ADR 0011: only while «Ожидает оплаты»), a quiet link under the manager line as
 * in the payment mockup, behind a confirmation sheet that sends a shopper who already paid to the
 * manager instead. The status the screen showed goes along. If the order moved on meanwhile (a
 * receipt went in, the reserve expired), the screen already shows it as it is now and the sheet
 * says so, rather than closing on a press that seemed to do nothing. Mounted whatever the status,
 * so the sheet can finish after the link has gone.
 */
export function CancelOrder({ order, spaced }: { order: OrderDto; spaced: boolean }) {
  const { t } = usePrefs();
  const o = useOrdersText();
  const [open, setOpen] = useState(false);
  const [changed, setChanged] = useState(false);
  const [failed, setFailed] = useState(false);
  const cancel = useCancelOrder(order.number);
  const show = () => {
    setFailed(false);
    setChanged(false);
    setOpen(true);
  };
  const confirm = () => {
    setFailed(false);
    cancel.mutate(order.status, {
      onSuccess: (result) => {
        if (result.kind === 'try_again') setFailed(true);
        else if (result.kind === 'changed') setChanged(true);
        else setOpen(false);
      },
      onError: () => setFailed(true),
    });
  };
  const gone = order.status === 'cancelled';
  return (
    <>
      {customerMayCancel(order.status) ? (
        // under «Написать менеджеру», or on its own when that line is not there
        <p className={`type-small mb-4 text-center ${spaced ? 'mt-6' : 'mt-4'}`}>
          <button
            type="button"
            onClick={show}
            data-testid="cancel-order"
            className="-my-3 rounded-btn px-1 py-3 font-medium text-muted underline decoration-line-strong underline-offset-[3px] transition-[text-decoration-color,opacity] duration-150 hover:decoration-current active:opacity-60"
          >
            {o.orders.cancel}
          </button>
        </p>
      ) : null}
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title={
          changed
            ? gone
              ? o.orders.changedCancelledTitle
              : o.orders.changedTitle
            : fill(o.orders.cancelTitle, { number: String(order.number) })
        }
        ownDescription
        closeLabel={t.common.close}
      >
        <SheetDescription className="type-small pb-3 text-pretty text-muted">
          {changed ? (
            gone && order.cancellation ? (
              `${o.orders.cancelReason[order.cancellation.reason]}.`
            ) : (
              <WithManagerLink text={o.orders.changedText} link={o.orders.cancelManager} />
            )
          ) : (
            <WithManagerLink text={o.orders.cancelText} link={o.orders.cancelManager} />
          )}
        </SheetDescription>
        {changed ? (
          <div className="flex flex-col gap-4 pb-1" data-testid="cancel-changed">
            <div className="flex items-center gap-3">
              <StatusPill status={order.status} />
            </div>
            <Button block onClick={() => setOpen(false)}>
              {o.orders.gotIt}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2 pb-1" data-testid="cancel-sheet">
            {failed ? (
              <p className="type-small mb-2 text-alert" role="alert">
                {o.orders.cancelFailed}
              </p>
            ) : null}
            <Button block loading={cancel.isPending} onClick={confirm}>
              {o.orders.cancelConfirm}
            </Button>
            <Button block variant="secondary" onClick={() => setOpen(false)}>
              {o.orders.cancelKeep}
            </Button>
          </div>
        )}
      </Sheet>
    </>
  );
}
