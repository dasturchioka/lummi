'use client';

import type { Language } from '@lummi/i18n';
import { browserApi } from '@/lib/api';
import type { AdminMessages } from '@/lib/i18n';
import {
  CancelDialog,
  ConfirmPaymentDialog,
  HandToBtsDialog,
  RejectDialog,
  ReturnDialog,
  type Failure,
} from '../order-dialogs';
import type { Move } from './board-state';
import type { DialogState, MoveResponse } from './use-board-moves';

/**
 * The order page's own dialogs for a move dropped on the board (#52), sending the same requests
 * as the order page. Fulfilment, cancel and return carry the status the board saw; confirming and
 * rejecting rely on the payment door's own lock and its 409 (receipt or credit moved on), as on
 * the order page. Closing a dialog takes the move back.
 */
export function BoardDialogs({
  dialog,
  t,
  language,
  answer,
  dismiss,
}: {
  dialog: DialogState | null;
  t: AdminMessages;
  language: Language;
  answer: (res: MoveResponse | null, move: Move, reason?: string) => Failure | null;
  dismiss: () => void;
}) {
  if (!dialog) return null;
  const { move, page, key } = dialog;
  const params = { number: move.number };
  const common = {
    open: true,
    onOpenChange: (open: boolean) => !open && dismiss(),
    page,
    t,
  };
  switch (dialog.kind) {
    case 'hand':
      return (
        <HandToBtsDialog
          key={key}
          {...common}
          onSubmit={async ({ trackingNumber }) =>
            answer(
              await browserApi.orders
                .fulfil({
                  params,
                  body: { action: 'hand_to_bts', expectedStatus: move.from, trackingNumber },
                })
                .catch(() => null),
              move,
            )
          }
        />
      );
    case 'cancel':
      return (
        <CancelDialog
          key={key}
          {...common}
          onSubmit={async (body) =>
            answer(
              await browserApi.orders
                .cancel({ params, body: { ...body, expectedStatus: move.from } })
                .catch(() => null),
              move,
            )
          }
        />
      );
    case 'confirm':
      return (
        <ConfirmPaymentDialog
          key={key}
          {...common}
          receiptId={dialog.receiptId}
          language={language}
          onSubmit={async (body) =>
            answer(
              await browserApi.orders.confirmPayment({ params, body }).catch(() => null),
              move,
              body.reason,
            )
          }
        />
      );
    case 'reject':
      return dialog.receiptId === null ? null : (
        <RejectDialog
          key={key}
          {...common}
          receiptId={dialog.receiptId}
          onSubmit={async (body) =>
            answer(await browserApi.orders.rejectReceipt({ params, body }).catch(() => null), move)
          }
        />
      );
    case 'return':
      return (
        <ReturnDialog
          key={key}
          {...common}
          language={language}
          onSubmit={async (body) =>
            answer(
              await browserApi.orders
                .return({ params, body: { ...body, expectedStatus: move.from } })
                .catch(() => null),
              move,
            )
          }
        />
      );
  }
}
