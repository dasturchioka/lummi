import { defineMessages } from './define';

/**
 * The reviews block on the fragrance and set cards (ticket #41). Its own namespace
 * (`@lummi/i18n/reviews`), imported only by the card screens' lazy chunks, so the Mini App's
 * first screen does not carry these strings (ADR 0030 budget). Keys must match in both languages
 * or typecheck fails.
 */
export const reviewsMessages = defineMessages(
  {
    reviews: {
      title: 'Отзывы',
      count: {
        one: '{n} отзыв',
        few: '{n} отзыва',
        many: '{n} отзывов',
        other: '{n} отзыва',
      },
      averageLabel: 'Средняя оценка {rating} из 5',
      ratingLabel: 'Оценка {rating} из 5',
      photoAlt: 'Фото покупателя',
      emptyTitle: 'Пока нет отзывов',
      emptyText: 'Оценить заказ можно после доставки: мы напишем вам в боте.',
      loadingLabel: 'Загружаем отзывы',
    },
  },
  {
    reviews: {
      title: 'Sharhlar',
      count: {
        one: '{n} ta sharh',
        few: '{n} ta sharh',
        many: '{n} ta sharh',
        other: '{n} ta sharh',
      },
      averageLabel: 'Oʻrtacha baho: 5 dan {rating}',
      ratingLabel: 'Baho: 5 dan {rating}',
      photoAlt: 'Xaridor surati',
      emptyTitle: 'Hozircha sharhlar yoʻq',
      emptyText: 'Buyurtmani yetkazilgandan keyin baholash mumkin: botda sizga yozamiz.',
      loadingLabel: 'Sharhlar yuklanmoqda',
    },
  },
);
export type ReviewsMessages = (typeof reviewsMessages)['ru'];
