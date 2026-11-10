import { defineMessages } from './define';

/**
 * The two sets (ADR 0009): the Discovery set screen, the builder and the set lines of the cart and
 * orders. Its own namespace (`@lummi/i18n/sets`), imported only by those lazy screens, so the Mini
 * App's first screen does not carry these strings (ADR 0030 budget). Keys must match in both
 * languages or typecheck fails.
 */
export const setsMessages = defineMessages(
  {
    sets: {
      setsLabel: 'Наборы',
      discoveryTitle: 'Discovery set',
      discoveryLead: 'Пять ароматов по 10 мл в одной коробке',
      inside: 'Что внутри',
      toCart: 'В корзину',
      soldOut: 'Нет в наличии',
      notReady: 'Набор скоро появится в продаже',
      added: 'Добавлено в корзину',
      builderCardText: 'Пять разных ароматов по 10 мл по цене Discovery set',
      builderTitle: 'Свой набор',
      builderLead: 'Выберите пять разных ароматов, каждый по 10 мл. Цена набора фиксирована.',
      chosen: 'Выбрано {n} из {size}',
      pickMore: {
        one: 'Выберите ещё {n} аромат',
        few: 'Выберите ещё {n} аромата',
        many: 'Выберите ещё {n} ароматов',
        other: 'Выберите ещё {n} аромата',
      },
      pick: 'Выбрать: {name}',
      unpick: 'Убрать из набора: {name}',
      noMore: 'Уже выбрано пять',
      empty: 'Сейчас нет ароматов для набора',
      emptyText: 'Все 10 мл разобрали. Загляните чуть позже.',
      lineDiscovery: 'Discovery set',
      lineBuilder: 'Набор из пяти ароматов',
      unavailable: 'Одного из ароматов уже нет в 10 мл. Выберите другой.',
      unavailableNamed: 'Закончились 10 мл: {names}. Выберите замену.',
      failed: 'Не удалось добавить набор. Попробуйте ещё раз.',
    },
  },
  {
    sets: {
      setsLabel: 'Toʻplamlar',
      discoveryTitle: 'Discovery set',
      discoveryLead: 'Bitta qutida 10 ml’dan beshta ifor',
      inside: 'Ichida nima bor',
      toCart: 'Savatga',
      soldOut: 'Sotuvda yoʻq',
      notReady: 'Toʻplam tez orada sotuvga chiqadi',
      added: 'Savatga qoʻshildi',
      builderCardText: 'Discovery set narxida 10 ml’dan beshta turli ifor',
      builderTitle: 'Oʻz toʻplamim',
      builderLead: 'Beshta turli iforni tanlang, har biri 10 ml. Toʻplam narxi qat’iy.',
      chosen: 'Tanlandi: {n} / {size}',
      pickMore: {
        one: 'Yana {n} ta ifor tanlang',
        few: 'Yana {n} ta ifor tanlang',
        many: 'Yana {n} ta ifor tanlang',
        other: 'Yana {n} ta ifor tanlang',
      },
      pick: 'Tanlash: {name}',
      unpick: 'Toʻplamdan olib tashlash: {name}',
      noMore: 'Beshtasi tanlangan',
      empty: 'Hozir toʻplam uchun iforlar yoʻq',
      emptyText: '10 ml’lar tugadi. Birozdan keyin kiring.',
      lineDiscovery: 'Discovery set',
      lineBuilder: 'Beshta ifordan toʻplam',
      unavailable: 'Iforlardan birining 10 ml’i qolmadi. Boshqasini tanlang.',
      unavailableNamed: '10 ml tugadi: {names}. Oʻrniga boshqasini tanlang.',
      failed: 'Toʻplamni qoʻshib boʻlmadi. Yana urinib koʻring.',
    },
  },
);
