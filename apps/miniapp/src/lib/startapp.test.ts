import { expect, it } from 'vitest';
import { routeForStartParam } from './startapp';

it('maps known parameters and sends everything else home', () => {
  expect(routeForStartParam('catalog')).toBe('/catalog');
  expect(routeForStartParam('orders')).toBe('/orders');
  expect(routeForStartParam('nonsense')).toBe('/');
  expect(routeForStartParam('constructor')).toBe('/');
  expect(routeForStartParam(undefined)).toBe('/');
});

it('opens a fragrance card from p_<slug> and rejects malformed ones', () => {
  expect(routeForStartParam('p_tygar')).toBe('/p/tygar');
  expect(routeForStartParam('p_pink-molecule-090-09')).toBe('/p/pink-molecule-090-09');
  expect(routeForStartParam('p_')).toBe('/');
  expect(routeForStartParam('p_../admin')).toBe('/');
  expect(routeForStartParam('p_Tygar')).toBe('/');
});
