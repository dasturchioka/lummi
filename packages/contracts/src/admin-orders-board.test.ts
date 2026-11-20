import { describe, expect, it } from 'vitest';
import { staffMove, staffTargets } from './admin-orders-board';

describe('the board offers only the moves staff may make (ADR 0011)', () => {
  it('each status leads to its next step and to «Отменён» while it may still be cancelled', () => {
    expect(staffTargets('awaiting_payment')).toEqual(['payment_confirmed', 'cancelled']);
    expect(staffTargets('receipt_review')).toEqual([
      'awaiting_payment',
      'payment_confirmed',
      'cancelled',
    ]);
    expect(staffTargets('payment_confirmed')).toEqual(['accepted', 'cancelled']);
    expect(staffTargets('accepted')).toEqual(['assembling', 'cancelled']);
    expect(staffTargets('assembling')).toEqual(['handed_to_bts', 'cancelled']);
    expect(staffTargets('handed_to_bts')).toEqual(['delivered', 'cancelled']);
    expect(staffTargets('delivered')).toEqual(['returned']);
    expect(staffTargets('cancelled')).toEqual([]);
    expect(staffTargets('returned')).toEqual([]);
  });

  it('names the action: a receipt sent back is a rejection, never the sweep’s «payment not found»', () => {
    expect(staffMove('receipt_review', 'awaiting_payment')?.action).toBe('reject_receipt');
    expect(staffMove('awaiting_payment', 'payment_confirmed')?.action).toBe('confirm_payment');
    expect(staffMove('assembling', 'handed_to_bts')?.action).toBe('hand_to_bts');
    expect(staffMove('delivered', 'returned')?.action).toBe('return');
  });

  it('a shopper’s own move and a skipped step are not staff moves', () => {
    expect(staffMove('awaiting_payment', 'receipt_review')).toBeUndefined();
    expect(staffMove('payment_confirmed', 'assembling')).toBeUndefined();
    expect(staffMove('delivered', 'cancelled')).toBeUndefined();
    expect(staffMove('accepted', 'accepted')).toBeUndefined();
  });
});
