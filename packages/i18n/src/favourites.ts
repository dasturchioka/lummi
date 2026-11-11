import { defineMessages } from './define';

/**
 * Profile → «Избранное» (ticket #45). Its own namespace (`@lummi/i18n/favourites`), imported only
 * by the lazy Profile and the favourites screen, so the Mini App's first screen does not carry
 * these strings (ADR 0030 budget); the heart's own two labels are in `list`. Keys must match in
 * both languages or typecheck fails.
 */
export const favouritesMessages = defineMessages(
  {
    favourites: {
      title: 'Избранное',
      rowHint: 'Ароматы, которые вам понравились',
      emptyTitle: 'Сохраняйте ароматы сердечком',
      emptyText: 'Нажмите на сердечко у аромата, и он появится здесь.',
      toCatalog: 'В каталог',
      loadingLabel: 'Загружаем избранное',
    },
  },
  {
    favourites: {
      title: 'Sevimlilar',
      rowHint: 'Sizga yoqqan iforlar',
      emptyTitle: 'Iforlarni yurakcha bilan saqlang',
      emptyText: 'Ifordagi yurakchani bosing, u shu yerda paydo boʻladi.',
      toCatalog: 'Katalogga',
      loadingLabel: 'Sevimlilar yuklanmoqda',
    },
  },
);
export type FavouritesMessages = (typeof favouritesMessages)['ru'];
