/**
 * The 14 delivery regions (spec §8) in the order the picker shows them. `btsId` is bts.uz's own
 * region id (offices page filter); `code` is ours and never changes. The tariff is NOT here:
 * it is data in `regions.delivery_tariff`, owner-edited; `DEFAULT_TARIFF` only seeds new rows
 * (spec Changes 2026-11-06: a flat 25 000 for every region).
 */
export const DEFAULT_TARIFF = 25_000;

export interface RegionSeed {
  code: string;
  btsId: number;
  nameRu: string;
  nameUz: string;
}

export const BTS_REGIONS: readonly RegionSeed[] = [
  { code: 'tashkent-city', btsId: 6, nameRu: 'Город Ташкент', nameUz: 'Toshkent shahri' },
  { code: 'tashkent', btsId: 5, nameRu: 'Ташкентская область', nameUz: 'Toshkent viloyati' },
  { code: 'samarkand', btsId: 8, nameRu: 'Самаркандская область', nameUz: 'Samarqand viloyati' },
  { code: 'fergana', btsId: 15, nameRu: 'Ферганская область', nameUz: 'Fargʻona viloyati' },
  { code: 'andijan', btsId: 2, nameRu: 'Андижанская область', nameUz: 'Andijon viloyati' },
  { code: 'namangan', btsId: 3, nameRu: 'Наманганская область', nameUz: 'Namangan viloyati' },
  { code: 'bukhara', btsId: 7, nameRu: 'Бухарская область', nameUz: 'Buxoro viloyati' },
  {
    code: 'kashkadarya',
    btsId: 14,
    nameRu: 'Кашкадарьинская область',
    nameUz: 'Qashqadaryo viloyati',
  },
  { code: 'navoi', btsId: 10, nameRu: 'Навоийская область', nameUz: 'Navoiy viloyati' },
  {
    code: 'surkhandarya',
    btsId: 13,
    nameRu: 'Сурхандарьинская область',
    nameUz: 'Surxondaryo viloyati',
  },
  { code: 'khorezm', btsId: 4, nameRu: 'Хорезмская область', nameUz: 'Xorazm viloyati' },
  { code: 'jizzakh', btsId: 9, nameRu: 'Джизакская область', nameUz: 'Jizzax viloyati' },
  { code: 'syrdarya', btsId: 12, nameRu: 'Сырдарьинская область', nameUz: 'Sirdaryo viloyati' },
  { code: 'karakalpakstan', btsId: 11, nameRu: 'Каракалпакстан', nameUz: 'Qoraqalpogʻiston' },
];
