import { describe, expect, it } from 'vitest';
import { buyNowParam, parseBuyNowParam } from './buy-now';

describe('the buy-now item of a Discovery set', () => {
  it('names any set by its key and reads it back', () => {
    const text = buyNowParam({ kind: 'discovery_set', key: 'set-3' });
    expect(text).toBe('discovery_set:set-3');
    expect(parseBuyNowParam(text)).toEqual({ kind: 'discovery_set', key: 'set-3' });
  });

  it('still reads the texts from before the keys', () => {
    expect(parseBuyNowParam('discovery_set')).toEqual({ kind: 'discovery_set', key: 'discovery' });
    expect(parseBuyNowParam('discovery_set:5')).toEqual({
      kind: 'discovery_set',
      key: 'discovery-5',
    });
  });

  it('refuses a key that is not one', () => {
    expect(parseBuyNowParam('discovery_set:Bad Key')).toBeNull();
    expect(parseBuyNowParam('discovery_set:a:b')).toBeNull();
  });
});
