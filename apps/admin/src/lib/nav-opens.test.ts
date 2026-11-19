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
  it('lists only what an owner adds to a manager', () => {
    const line = opensFor('owner', ru);
    expect(line.startsWith('Всё, что у менеджера, и ещё: Каталог')).toBe(true);
    expect(line).toContain('Сотрудники');
    expect(line).not.toContain('Заказы');
  });
  it('reads the same in UZ, from the same table', () => {
    const uz = adminMessages.uz.admin;
    expect(opensFor('manager', uz)).toBe(
      'Ochiq: Buyurtmalar, Tushumlar, Uzum savdolari, BTS punktlari, Mijozlar, Sharhlar, Ombor, Toʻplamlar',
    );
    expect(opensFor('owner', uz).startsWith('Menejerdagi hammasi va yana: Katalog')).toBe(true);
  });
});
