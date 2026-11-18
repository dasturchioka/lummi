'use client';

import {
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DropAnimation,
  type KeyboardCoordinateGetter,
  type Modifier,
} from '@dnd-kit/core';
import { staffMove, type AdminBoardCardDto, type OrderStatus } from '@lummi/contracts';
import type { AdminMessages } from '@/lib/i18n';
import { fill } from '@/lib/utils';
import { moveLabel } from './board-state';

/*
 * The board's carrying (#52) with dnd-kit: the sensors (a mouse drag, a long press on touch,
 * Space on the card), how the keyboard and the pointer find a column, the carried card's
 * landing, and what a screen reader hears.
 */

/** What a carried card and a column hold as dnd-kit data. */
export const cardOf = (data: unknown) =>
  (data as { card?: AdminBoardCardDto } | undefined)?.card ?? null;
export const statusOf = (data: unknown) =>
  (data as { status?: OrderStatus } | undefined)?.status ?? null;

/**
 * Keyboard carrying hops from column to column: the arrows go to the next column the order may
 * go to (or back home), never 25 px at a time.
 */
export const columnHop: KeyboardCoordinateGetter = (event, { context, currentCoordinates }) => {
  const { collisionRect, droppableRects, droppableContainers } = context;
  if (event.code !== 'ArrowRight' && event.code !== 'ArrowLeft') {
    if (event.code === 'ArrowUp' || event.code === 'ArrowDown') event.preventDefault();
    return currentCoordinates;
  }
  if (!collisionRect) return undefined;
  event.preventDefault();
  const columns = droppableContainers
    .getEnabled()
    .map((c) => droppableRects.get(c.id))
    .filter((r): r is NonNullable<typeof r> => Boolean(r))
    .sort((a, b) => a.left - b.left);
  const centre = collisionRect.left + collisionRect.width / 2;
  const next =
    event.code === 'ArrowRight'
      ? columns.find((r) => r.left > centre)
      : [...columns].reverse().find((r) => r.left + r.width < centre);
  if (!next) return currentCoordinates;
  return {
    x: next.left + (next.width - collisionRect.width) / 2,
    y: Math.min(
      Math.max(currentCoordinates.y, next.top),
      next.top + next.height - collisionRect.height,
    ),
  };
};

/**
 * Under the pointer: the column the pointer is over; nothing under the pointer is no target at
 * all. The keyboard (no pointer) takes the column the card overlaps.
 */
export const collide: CollisionDetection = (args) =>
  args.pointerCoordinates ? pointerWithin(args) : rectIntersection(args);

/**
 * The carried card stays on the screen: on a phone a card nearly as wide as the screen would
 * otherwise hang off its edge while the thumb sits over the next column.
 */
export const keepOnScreen: Modifier = ({ transform, draggingNodeRect, windowRect }) => {
  if (!draggingNodeRect || !windowRect) return transform;
  const x = Math.min(
    Math.max(transform.x, windowRect.left - draggingNodeRect.left),
    windowRect.left + windowRect.width - draggingNodeRect.left - draggingNodeRect.width,
  );
  const y = Math.min(
    Math.max(transform.y, windowRect.top - draggingNodeRect.top),
    windowRect.top + windowRect.height - draggingNodeRect.top - draggingNodeRect.height,
  );
  return { ...transform, x, y };
};

const EASE_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';
const at = (t: { x: number; y: number }) => `translate3d(${t.x}px, ${t.y}px, 0)`;

/**
 * How the carried copy leaves the pointer. A card that cannot land goes home (220 ms); one that
 * landed fades where it was let go (140 ms) while the card settles in its column. With reduced
 * motion nothing travels or scales: the copy only fades where it is, either way.
 */
export function dropAnimation(landed: boolean, reduced: boolean): DropAnimation {
  if (reduced)
    return {
      duration: 120,
      easing: 'linear',
      keyframes: ({ transform }) => [
        { opacity: 1, transform: at(transform.initial) },
        { opacity: 0, transform: at(transform.initial) },
      ],
      sideEffects: null,
    };
  if (landed)
    return {
      duration: 140,
      easing: EASE_OUT,
      keyframes: ({ transform }) => [
        { opacity: 1, transform: at(transform.initial) },
        { opacity: 0, transform: `${at(transform.initial)} scale(0.98)` },
      ],
      sideEffects: null,
    };
  return { duration: 220, easing: EASE_OUT };
}

/** A mouse drag from 6 px, a long press on touch (250 ms), Space on the card's link. */
export function useBoardSensors() {
  return useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, {
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter'] },
      coordinateGetter: columnHop,
    }),
  );
}

/** What a screen reader hears while a card is carried, in the panel's language. */
export function boardAnnouncements(
  t: AdminMessages,
  statusName: (s: OrderStatus) => string,
): Announcements {
  const a = t.orders.board.announce;
  const stayed = (card: AdminBoardCardDto) =>
    fill(a.stayed, { number: String(card.number), status: statusName(card.status) });
  return {
    onDragStart: ({ active }) => {
      const card = cardOf(active.data.current);
      return card
        ? fill(a.picked, { number: String(card.number), status: statusName(card.status) })
        : undefined;
    },
    onDragOver: ({ active, over }) => {
      const card = cardOf(active.data.current);
      const to = statusOf(over?.data.current);
      if (!card || !to || to === card.status) return undefined;
      const row = staffMove(card.status, to);
      return row
        ? fill(a.over, { status: statusName(to), action: moveLabel(row.action, t) })
        : fill(a.overNot, { status: statusName(to) });
    },
    onDragEnd: ({ active, over }) => {
      const card = cardOf(active.data.current);
      const to = statusOf(over?.data.current);
      if (!card) return undefined;
      const row = to && to !== card.status ? staffMove(card.status, to) : undefined;
      return row
        ? fill(a.dropped, { number: String(card.number), action: moveLabel(row.action, t) })
        : stayed(card);
    },
    onDragCancel: ({ active }) => {
      const card = cardOf(active.data.current);
      return card ? stayed(card) : undefined;
    },
  };
}
