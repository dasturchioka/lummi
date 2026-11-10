import { expect, it } from 'vitest';
import { START_TARGETS, campaignCodeOf, isStartTarget } from '@lummi/contracts/constants';
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

it('opens the two sets', () => {
  expect(routeForStartParam('set_discovery')).toBe('/sets/discovery');
  expect(routeForStartParam('builder')).toBe('/sets/builder');
});

it('opens every target the admin offers on a broadcast button', () => {
  for (const target of START_TARGETS) {
    const route = routeForStartParam(target);
    expect(target === 'home' ? route === '/' : route !== '/').toBe(true);
  }
});

it('opens an order from o_<number> and rejects malformed ones', () => {
  expect(routeForStartParam('o_1001')).toBe('/orders/1001');
  expect(routeForStartParam('o_0')).toBe('/');
  expect(routeForStartParam('o_12a')).toBe('/');
  expect(routeForStartParam('o_')).toBe('/');
});

it('leaves a campaign link to the API: l_<code> is Home here, never an error', () => {
  expect(routeForStartParam('l_insta-nov')).toBe('/');
  expect(campaignCodeOf('l_insta-nov')).toBe('insta-nov');
  expect(campaignCodeOf('l_ab')).toBeNull();
  expect(campaignCodeOf('l_../x')).toBeNull();
  expect(campaignCodeOf('p_tygar')).toBeNull();
  expect(campaignCodeOf(null)).toBeNull();
  // a link's target is a plain target, never another link
  expect(isStartTarget('l_insta-nov')).toBe(false);
});
