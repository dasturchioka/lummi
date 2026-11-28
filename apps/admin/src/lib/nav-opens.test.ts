import { adminMessages } from '@lummi/i18n/admin';
import { describe, expect, it } from 'vitest';
import { opensFor } from './nav';

const ru = adminMessages.ru.admin;

describe('opensFor', () => {
  it("lists a manager's sections from NAV, without Home and Profile", () => {
    expect(opensFor('manager', ru)).toBe(
      'Открыто: Заказы, Поступления, Продажи Uzum, Пункты BTS, Клиенты, Отзывы, Склад, Наборы',
    );
  });
  it('sums an owner up as full access', () => {
    expect(opensFor('owner', ru)).toBe('Полный доступ');
  });
  it('reads the same in UZ, from the same table', () => {
    const uz = adminMessages.uz.admin;
    expect(opensFor('manager', uz)).toBe(
      'Ochiq: Buyurtmalar, Tushumlar, Uzum savdolari, BTS punktlari, Mijozlar, Sharhlar, Ombor, Toʻplamlar',
    );
    expect(opensFor('owner', uz)).toBe('Toʻliq kirish');
  });
});
