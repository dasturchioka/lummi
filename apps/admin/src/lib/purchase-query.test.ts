import { describe, expect, it } from 'vitest';
import { planQueryString, readPlanQuery } from './purchase-query';

describe('readPlanQuery', () => {
  it('reads the default and the per-fragrance kilograms, with a decimal comma', () => {
    expect(readPlanQuery({ kg: '2,5', k7: '3', k12: '0', q: 'x' })).toEqual({
      kg: 2.5,
      by: '7:3,12:0',
    });
  });
  it('drops what the contract would refuse', () => {
    expect(readPlanQuery({ kg: 'abc', k7: '-1', k8: '', k9: '5000', kx: '1' })).toEqual({});
    expect(readPlanQuery({})).toEqual({});
  });
  it('builds the export query', () => {
    expect(planQueryString({ kg: 2, by: '7:3' }, 'uz')).toBe('lang=uz&kg=2&by=7%3A3');
  });
});
