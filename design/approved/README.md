# Approved design (customer, 2026-11-07)

Nurmuhammad sent three layout variants (`LUMMI_Vybor_dizaina.pdf`, rendered as `variant-1.png` … `variant-3.png`) to the project chat on 2026-11-07 (msg 21). The customer replied the same day (msg 26): **variant 2 is the base, with elements from variant 1**. Names and prices in the PDF are demo values.

This decision outranks the earlier mockups in `design/mockups/`. How the two fit together is in `DESIGN.md` → "Approved layout".

## What comes from where

| Area | Variant 2 (base) | Variant 1 (added) | Also |
|---|---|---|---|
| Opening | — | — | No welcome screen (variant 3's is dropped): the app opens on Home. Language from Telegram, switch in Profile. |
| Home | Top block with a fabric photo, logo "LUMMI." and the slogan «Ароматы, которые освещают». Below it the delivery city selector and the profile icon. Dark Discovery set banner. «Популярное» with chips Все / Homme / Femme / Unisex and a two-column grid. | Search **field** «Название или нота» right under the top block, not just a magnifier icon. «Новинки» under «Популярное» with «Все →». | |
| Catalog | Two-column grid, large photos, heart («в избранное») on each card, type chips as photo circles (Все / Homme / Femme / Unisex / Наборы). | Full filter set: family, volume, price, season, sort «Топ продаж», counter «Найдено: N». Two or three notes under the name («морская соль · амбра · мускус») and a «+» quick add. | |
| Fragrance card | Large photo, name, description, volume tiles 10 / 30 / 50 ml with the price under each, notes pyramid (top / heart / base), «Купить на Uzum», «В корзину», «Купить сейчас». | Characteristic **icons**: longevity, sillage, season, time of day (instead of text tags). | Longevity reads «до 24 часов» everywhere, never "8–12 ч". Reviews with rating and photos as a block under the notes ("already agreed"). |
| Cart | Dark totals block (items, promo code, delivery, total) with «Оформить заказ» inside it. | Delete (bin) button next to the quantity. | Free-delivery bar «до бесплатной доставки осталось …» with 10 ml suggestions, "as in the first mockup" (our `design/mockups` cart). Delivery a flat 25 000 сум, free from 250 000. |
| Tab bar | Dark floating bar. | Labels under the icons: Главная, Каталог, Корзина, Заказы, Профиль. | |
| Dark theme | Variant 2's dark theme, with dark fabric on Home, as the **additional** theme. | | **Light is the default.** |

Agreed separately (customer's words: «уже согласовано»):
- Checkout option «Это подарок»: a greeting card, no receipt in the parcel, gift packaging.
- Gift certificate: second stage; the customer is waiting for our price and timeline.

## Customer's message (verbatim, RU)

> Выбор дизайна LUMMI: основа — вариант 2, плюс элементы из варианта 1
>
> 1. Приветствие
>
> Отдельного экрана приветствия (как в варианте 3) не делаем. При открытии мини-аппа клиент сразу попадает на главную.
> Язык (RU/UZ) определяется по языку Telegram, переключатель есть в профиле.
>
> 2. Главная
>
> Из варианта 2: верхний блок с фото ткани, логотип LUMMI. и слоган «Ароматы, которые освещают». Под ним выбор города доставки и иконка профиля. Тёмный баннер Discovery set прямо на главной. Блок «Популярное» с фильтрами Все / Homme / Femme / Unisex, карточки в две колонки.
> Из варианта 1: поиск строкой «Название или нота» (не только иконкой лупы) — сразу под верхним блоком. Блок «Новинки» под «Популярным», с кнопкой «Все →».
>
> 3. Каталог
>
> Из варианта 2: сетка в две колонки, крупные фото, сердечко «в избранное» на карточке, фильтры кружками с фото (Все / Homme / Femme / Unisex / Наборы).
> Из варианта 1: полный набор фильтров: семейство, объём, цена, сезон, сортировка «Топ продаж» и счётчик «Найдено: N». Под названием на карточке — 2–3 ноты (например, «морская соль · амбра · мускус») и кнопка «+» для быстрого добавления в корзину.
>
> 4. Карточка товара
>
> Из варианта 2: большое фото, название, описание, выбор объёма 10 / 30 / 50 мл с ценой под каждым, пирамида нот (верх / сердце / база), кнопки «Купить на Uzum», «В корзину» и «Купить сейчас».
> Из варианта 1: иконки характеристик: стойкость, шлейф, сезон, время дня — вместо текстовых тегов.
> Стойкость везде указываем «до 24 часов», а не «8–12 ч».
> Отзывы с оценкой и фото — блок под нотами (уже согласовано).
>
> 5. Корзина
>
> Из варианта 2: тёмный блок итога (товары, промокод, доставка, итого) с кнопкой «Оформить заказ» внутри.
> Из варианта 1: кнопка удаления товара (корзинка) рядом с количеством.
> Полоска «до бесплатной доставки осталось …» с подсказкой добавить 10 мл — как в первом макете.
> Доставка фиксированно 25 000 сум, от 250 000 — бесплатно.
>
> 6. Нижняя панель
>
> Из варианта 2: тёмная плавающая панель.
> Из варианта 1: подписи под иконками: Главная, Каталог, Корзина, Заказы, Профиль.
>
> 7. Тёмная тема
>
> Берём тёмную тему варианта 2 (с тёмной тканью на главной), как дополнительную. По умолчанию — светлая.
>
> 8. Что уже согласовано отдельно
>
> Опция «Это подарок» при оформлении (открытка, без чека, упаковка).
> Подарочный сертификат — вторым этапом, жду цену и сроки.

## Still needed from Nurmuhammad

The PDF is a raster export. Before building Home we need the design source (Figma or similar) and the fabric photos for the Home top block in light and dark, at full resolution.
