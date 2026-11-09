import { expect, it } from 'vitest';
import { routeForStartParam } from './startapp';

it('maps known parameters and sends everything else home', () => {
  expect(routeForStartParam('catalog')).toBe('/catalog');
  expect(routeForStartParam('orders')).toBe('/orders');
  expect(routeForStartParam('nonsense')).toBe('/');
  expect(routeForStartParam('constructor')).toBe('/');
  expect(routeForStartParam(undefined)).toBe('/');
});
