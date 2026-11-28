import { describe, expect, it } from 'vitest';
import { skeleton } from '../src/search/normalize';

describe('search skeleton', () => {
  it('lower-cases and strips accents', () => {
    expect(skeleton('Météore')).toBe('meteore');
    expect(skeleton('Oud Maracujá')).toBe('oud marakuja');
    expect(skeleton('Pink Molécule 090.09')).toBe('pink molekule 090 09');
  });

  it('transliterates Cyrillic into the same letters a Latin spelling gives', () => {
    expect(skeleton('Мегамаре')).toBe('megamare');
    expect(skeleton('МЕГАМАРЕ')).toBe(skeleton('megamare'));
    expect(skeleton('уд')).toBe('ud');
    expect(skeleton('ваниль')).toBe('vanil');
    expect(skeleton('жасмин')).toBe(skeleton('jasmin'));
    expect(skeleton('бергамот')).toBe(skeleton('bergamot'));
    expect(skeleton('Ёлка')).toBe('iolka');
  });

  it('unifies the digraphs: sh, ch, zh, ng and ks', () => {
    expect(skeleton('шафран')).toBe(skeleton('shafran'));
    expect(skeleton('чай')).toBe(skeleton('chai'));
    expect(skeleton('жар')).toBe(skeleton('zhar'));
    expect(skeleton('Angels')).toBe(skeleton('Анчелс'.replace('ч', 'нг')));
    expect(skeleton('Xerjoff')).toBe(skeleton('Ксерджофф'));
    expect(skeleton('Chanel')).not.toBe(skeleton('Shanel'));
  });

  it('folds Latin spellings: c as k or s, ck, q, w, y and doubled letters', () => {
    expect(skeleton('Baccarat')).toBe(skeleton('Bakarat'));
    expect(skeleton('Баккарат')).toBe(skeleton('baccarat'));
    expect(skeleton('Cedar')).toBe(skeleton('Sedar'));
    expect(skeleton('Symphony')).toBe(skeleton('Simfoni'.replace('f', 'ph')));
    expect(skeleton('Wild')).toBe(skeleton('Vild'));
  });

  it('drops both apostrophe forms, so oʻ and gʻ read as o and g', () => {
    for (const v of ["o'", 'oʻ', 'o‘', 'o’', 'o`']) expect(skeleton(`${v}rik`)).toBe('orik');
    for (const v of ["g'", 'gʻ', 'g‘', 'g’']) expect(skeleton(`yo${v}och`)).toBe('iogoc');
    // The tutuq belgisi in the middle of a word, and in names.
    expect(skeleton("ma'no")).toBe(skeleton('ma’no'));
    expect(skeleton("Angels' Share")).toBe(skeleton('Angels’ Share'));
    expect(skeleton("Bal d'Afrique")).toBe(skeleton('Bal dʻAfrique'));
  });

  it('matches an Uzbek Latin word with its Cyrillic spelling', () => {
    expect(skeleton('yogʻoch')).toBe(skeleton('ёгоч'));
    expect(skeleton('oʻrik')).toBe(skeleton('ўрик'));
  });

  it('collapses punctuation and spaces', () => {
    expect(skeleton('  Blue   Seduction! ')).toBe('blue seduktion');
    expect(skeleton('')).toBe('');
    expect(skeleton('Шафран · Oud-wood')).toBe('xafran oud vod');
  });
});
