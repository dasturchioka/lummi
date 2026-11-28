'use client';

import {
  staffMove,
  WAITING_RECEIPT_VERDICTS,
  type AdminBoardCardDto,
  type AdminOrderDto,
  type OrderStatus,
} from '@lummi/contracts';
import type { Language } from '@lummi/i18n';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { browserApi } from '@/lib/api';
import type { AdminMessages } from '@/lib/i18n';
import { fill } from '@/lib/utils';
import { conflictText, refusalFailure, type Failure } from '../order-dialogs';
import { isStep, moveKind, type Move, type MoveKind, type StepAction } from './board-state';

/** How long a refusal stays on screen. */
const TOAST_MS = 6_000;

/** A move that waits for its dialog: the order as it is now, and the receipt it is about. */
export type DialogState = {
  kind: Exclude<MoveKind, 'step'>;
  move: Move;
  page: AdminOrderDto;
  receiptId: number | null;
  key: number;
};

export type MoveResponse = Awaited<ReturnType<typeof browserApi.orders.fulfil>>;

/** The receipt under check, newest first: the one a confirmation or a rejection is about. */
const waitingReceipt = (page: AdminOrderDto) =>
  page.receipts.find((r) => WAITING_RECEIPT_VERDICTS.includes(r.verdict)) ?? null;

/**
 * The board's moves (#52): a move shows at once (optimistic) and the server decides. A step is
 * one request with the status the board saw; anything that needs words opens the order page's
 * dialog with the order as it is now. A refusal of a step, or a 409 in a dialog, puts the card
 * back with one sentence; a 422 in a dialog shows inside it, and closing the dialog puts the
 * card back. `onSettled` hears when a move is over, so the board fetches the truth.
 */
export function useBoardMoves({
  t,
  language,
  statusName,
  serverNow,
  onSettled,
}: {
  t: AdminMessages;
  language: Language;
  statusName: (s: OrderStatus) => string;
  serverNow: () => string;
  onSettled: () => void;
}) {
  const b = t.orders.board;
  const router = useRouter();
  const [moves, setMoves] = useState<Move[]>([]);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [toast, setToast] = useState<{ text: string; key: number } | null>(null);
  const [said, setSaid] = useState('');
  /** Bumped by every move: an answer to a request sent before it describes an older board. */
  const epoch = useRef(0);

  // a refusal reads for a while, then goes
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  const say = (text: string) => setToast({ text, key: Date.now() });
  const no = (key: 'failed' | 'notAllowed', move: Move) =>
    fill(b.refused[key], { number: String(move.number) });

  /** The move is over (either way): the next board is the truth. */
  const settle = (move: Move, outcome: 'done' | 'dropped') => {
    epoch.current += 1;
    setMoves((all) =>
      outcome === 'dropped'
        ? all.filter((m) => m.number !== move.number)
        : all.map((m) => (m.number === move.number ? { ...m, state: 'done' } : m)),
    );
    if (outcome === 'done')
      setSaid(fill(b.moved, { number: String(move.number), status: statusName(move.to) }));
    onSettled();
  };

  /** A 409 as one sentence about this order. */
  const refused409 = (res: Extract<MoveResponse, { status: 409 }>, move: Move) =>
    res.body.code === 'try_again'
      ? no('failed', move)
      : conflictText(res.body, t, language, move.number);

  /** A step needs nothing more: it is sent at once (the order page's own press). */
  const step = async (move: Move, action: StepAction) => {
    const res = await browserApi.orders
      .fulfil({ params: { number: move.number }, body: { action, expectedStatus: move.from } })
      .catch(() => null);
    if (res?.status === 200) return settle(move, 'done');
    settle(move, 'dropped');
    if (res?.status === 401) return router.replace('/login');
    say(
      res?.status === 409
        ? refused409(res, move)
        : res?.status === 422
          ? no('notAllowed', move)
          : no('failed', move),
    );
  };

  /** A move that needs words: the order page's dialog, with the order as it is now. */
  const ask = async (move: Move, kind: DialogState['kind']) => {
    const res = await browserApi.orders.get({ params: { number: move.number } }).catch(() => null);
    if (res?.status === 401) return router.replace('/login');
    if (res?.status !== 200) {
      settle(move, 'dropped');
      return say(no('failed', move));
    }
    const page = res.body;
    if (page.order.status !== move.from) {
      settle(move, 'dropped');
      return say(
        fill(b.refused.conflict, {
          number: String(move.number),
          status: statusName(page.order.status),
        }),
      );
    }
    const receipt = move.from === 'receipt_review' ? waitingReceipt(page) : null;
    if (kind === 'reject' && !receipt) {
      settle(move, 'dropped');
      return say(no('notAllowed', move));
    }
    setDialog({ kind, move, page, receiptId: receipt?.id ?? null, key: Date.now() });
  };

  /** Picks the move for `card` to `to` (only what staff may do), shows it, and makes it. */
  const begin = (card: AdminBoardCardDto, to: OrderStatus): boolean => {
    const row = staffMove(card.status, to);
    const kind = row ? moveKind(row.action) : null;
    if (!row || !kind) return false;
    const move: Move = {
      number: card.number,
      from: card.status,
      to,
      since: serverNow(),
      state: kind === 'step' ? 'saving' : 'pending',
    };
    epoch.current += 1;
    setMoves((all) => [...all.filter((m) => m.number !== card.number), move]);
    if (isStep(row.action)) void step(move, row.action);
    else if (kind !== 'step') void ask(move, kind);
    return true;
  };

  /** What a dialog's request answered: done, or what to show in it, or the card goes back. */
  const answer = (res: MoveResponse | null, move: Move, reason?: string): Failure | null => {
    if (!res) return { text: t.errors.generic };
    switch (res.status) {
      case 200:
        setDialog(null);
        settle(move, 'done');
        return null;
      case 409:
        if (res.body.code === 'try_again') return { text: t.orders.tryAgain };
        setDialog(null);
        settle(move, 'dropped');
        say(refused409(res, move));
        return null;
      case 422:
        return refusalFailure(res.body, t, language, reason);
      case 401:
        router.replace('/login');
        return null;
      default:
        return { text: t.errors.generic };
    }
  };

  /** The dialog closed without its move: the card goes home. */
  const dismiss = () => {
    if (!dialog) return;
    const { move } = dialog;
    setDialog(null);
    settle(move, 'dropped');
    setSaid(
      fill(b.announce.stayed, { number: String(move.number), status: statusName(move.from) }),
    );
  };

  return {
    moves,
    /** The poll drops moves the server's board now shows. */
    setMoves,
    dialog,
    toast,
    closeToast: () => setToast(null),
    said,
    epoch,
    begin,
    answer,
    dismiss,
  };
}
