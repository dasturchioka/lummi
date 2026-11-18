import { describe, expect, it } from 'vitest';
import { isTelegramPhotoUrl } from '../src/edges/telegram-files';

describe('isTelegramPhotoUrl', () => {
  it('takes Telegram https hosts only', () => {
    expect(isTelegramPhotoUrl('https://t.me/i/userpic/320/x.jpg')).toBe(true);
    expect(isTelegramPhotoUrl('https://cdn4.telesco.pe/file/x.jpg')).toBe(true);
    expect(isTelegramPhotoUrl('http://t.me/i/userpic/320/x.jpg')).toBe(false);
    expect(isTelegramPhotoUrl('https://evil.test/t.me')).toBe(false);
    expect(isTelegramPhotoUrl('https://t.me.evil.test/x.jpg')).toBe(false);
    expect(isTelegramPhotoUrl('https://user@t.me/x.jpg')).toBe(false);
    expect(isTelegramPhotoUrl('https://t.me:8443/x.jpg')).toBe(false);
    expect(isTelegramPhotoUrl('not a url')).toBe(false);
  });
});
