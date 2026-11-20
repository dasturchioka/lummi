import { describe, expect, it } from 'vitest';
import { parseCatalogSearch } from './filters';
import { activeFilterCount, toQuery } from './request';

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

  it('takes whole numbers written in digits only', () => {
    for (const bad of ['1e3', '-1', '1.5', '0x10', ' 5', '', '12abc'])
      expect(parseCatalogSearch({ min: bad, family: bad })).toEqual({});
    expect(parseCatalogSearch({ min: '0', max: '250000' })).toEqual({ min: 0, max: 250000 });
  });

  it('never reads isNew from the URL', () => {
    expect(parseCatalogSearch({ isNew: '1' })).toEqual({});
  });

  it('leaves the default sort out of the URL and the type chip «Наборы» out of the query', () => {
    expect(parseCatalogSearch({ sort: 'top' })).toEqual({});
    expect(toQuery({ type: 'sets' }, 24, 0)).toEqual({ sort: 'top', limit: 24, offset: 0 });
  });

  it('counts the sheet filters, a price range once', () => {
    expect(activeFilterCount({ family: 3, min: 1, max: 2, type: 'homme' })).toBe(2);
  });
});
