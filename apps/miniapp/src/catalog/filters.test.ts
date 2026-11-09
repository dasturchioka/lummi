import { describe, expect, it } from 'vitest';
import { activeFilterCount, parseCatalogSearch, toQuery } from './filters';

describe('catalog URL state', () => {
  it('keeps what is valid and drops the rest', () => {
    expect(
      parseCatalogSearch({
        type: 'femme',
        family: '7',
        volume: '30',
        min: '1000',
        sort: 'price_asc',
      }),
    ).toEqual({ type: 'femme', family: 7, volume: 30, min: 1000, sort: 'price_asc' });
    expect(
      parseCatalogSearch({ type: 'x', family: '-1', volume: '20', season: 'summer', sort: 'zzz' }),
    ).toEqual({});
  });

  it('leaves the default sort out of the URL and the type chip «Наборы» out of the query', () => {
    expect(parseCatalogSearch({ sort: 'top' })).toEqual({});
    expect(toQuery({ type: 'sets' }, 24, 0)).toEqual({ sort: 'top', limit: 24, offset: 0 });
  });

  it('counts the sheet filters, a price range once', () => {
    expect(activeFilterCount({ family: 3, min: 1, max: 2, type: 'homme' })).toBe(2);
  });
});
