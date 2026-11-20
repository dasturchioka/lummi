import { describe, expect, it } from 'vitest';
import { ordersView } from './orders-view';

describe('the orders page view (#52)', () => {
  it('opens the board by default and the list behind ?view=list', () => {
    expect(ordersView({})).toBe('board');
    expect(ordersView({ view: 'list' })).toBe('list');
    expect(ordersView({ q: '93 555' })).toBe('board');
  });

  it('a link that names a status opens the list, unless it asks for the board', () => {
    expect(ordersView({ status: 'accepted' })).toBe('list');
    expect(ordersView({ status: 'accepted', view: 'board' })).toBe('board');
    expect(ordersView({ view: ['list', 'board'] })).toBe('list');
  });
});
