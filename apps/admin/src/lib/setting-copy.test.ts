import { adminMessages } from '@lummi/i18n/admin';
import { describe, expect, it } from 'vitest';
import { durationText } from './setting-copy';

const ru = adminMessages.ru.admin;
const uz = adminMessages.uz.admin;

describe('durationText', () => {
  it('names the largest whole unit, counted', () => {
    expect(durationText(604_800, 'seconds', 'ru', ru)).toBe('= 7 дней');
    expect(durationText(3_600, 'seconds', 'ru', ru)).toBe('= 1 час');
    expect(durationText(300, 'seconds', 'ru', ru)).toBe('= 5 минут');
    expect(durationText(20_000, 'ms', 'ru', ru)).toBe('= 20 секунд');
    expect(durationText(604_800, 'seconds', 'uz', uz)).toBe('= 7 kun');
    expect(durationText(20_000, 'ms', 'uz', uz)).toBe('= 20 soniya');
  });

  it('spells out every part when no single unit is exact', () => {
    expect(durationText(5_400, 'seconds', 'ru', ru)).toBe('= 1 ч 30 мин');
    expect(durationText(90_061, 'seconds', 'uz', uz)).toBe('= 1 kun 1 soat 1 daqiqa 1 soniya');
  });

  it('stays quiet where it would only repeat the field', () => {
    expect(durationText(30, 'seconds', 'ru', ru)).toBeNull();
    expect(durationText(1_500, 'ms', 'ru', ru)).toBeNull();
    expect(durationText(0, 'seconds', 'ru', ru)).toBeNull();
  });
});
