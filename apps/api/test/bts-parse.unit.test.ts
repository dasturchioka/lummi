import { describe, expect, it } from 'vitest';
import { normalizeCity, normalizeHours, parseOffices } from '../src/bts/parse-offices';
import { fold, likeContains } from '../src/bts/search-text';

const row = (code: string, name: string, addr: string, mark: string, hours: string) => `
<tr style="font-size: 16px">
  <td data-label="No" style="width: 5%">${code}</td>
  <td data-label="Филиал">${name}</td>
  <td data-label="Адрес"><span style="color: black;">${addr}</span><br><a href="https://maps">Посмотреть на карте ...</a></td>
  <td data-label="Ориентир"><span>${mark}</span><br><a href="https://rutube.ru/x">Видео ориентир ...</a></td>
  <td data-label="Рабочие дни">${hours}</td>
</tr>`;

describe('bts.uz offices parser', () => {
  it('reads cities from headings and offices from rows, dropping the link texts', () => {
    const html = `<script>var x = "<h1>nope</h1>";</script>
      <h1 style="x">г.Самарканд</h1><table><thead><tr style="background:#c4"><th>#</th></tr></thead><tbody>
      ${row('0801', 'SAMARKAND', 'Город Самарканд, ул. Рудаки 45&nbsp;', 'Рынок &amp; площадь', '<span>Пн-Сб:</span> <span>09:00-18:00</span>; <br /><span>Вс:</span> Выходные дни ; Время обеда: 13:00-14:00')}
      </tbody></table>
      <h1>Яккасарайский р-н</h1>
      ${row('0101', 'YAKKASAROY', 'ул. Бобур 22', '', 'Пн-Вс: 24/7 ; Время обеда: Выходные дни')}`;
    expect(parseOffices(html)).toEqual([
      {
        code: '0801',
        name: 'SAMARKAND',
        city: 'Самарканд',
        address: 'Город Самарканд, ул. Рудаки 45',
        landmark: 'Рынок & площадь',
        hours: 'Пн-Сб: 09:00-18:00; Вс: выходной; обед 13:00-14:00',
      },
      {
        code: '0101',
        name: 'YAKKASAROY',
        city: 'Яккасарайский р-н',
        address: 'ул. Бобур 22',
        landmark: null,
        hours: 'Пн-Вс: 24/7',
      },
    ]);
  });

  it('normalizes city headings and hours', () => {
    expect(
      ['г.Самарканд', 'город Джизак', 'г. Газалкент', 'Кибрайский р-н'].map(normalizeCity),
    ).toEqual(['Самарканд', 'Джизак', 'Газалкент', 'Кибрайский р-н']);
    expect(normalizeHours('')).toBeNull();
  });
});

describe('search text', () => {
  it('folds case, ё and spaces; escapes LIKE wildcards', () => {
    expect(fold('  Ёлка   ЧИЛОНЗАР ')).toBe('елка чилонзар');
    expect(likeContains('50%_a\\')).toBe('%50\\%\\_a\\\\%');
  });
});
