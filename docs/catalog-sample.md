# Sample catalog — 5 fragrances

> **Superseded for the seed (2026-11-07).** The customer sent the full guide for all 67 fragrances (`materials/catalog/`, see its README) and photos for all of them (`materials/flakons/`). Seed from the guide; this file stays as the record of the first sample and the placeholder-price rules below.

Sent by the customer (Fayzali) in the project chat on 2026-11-06 as seed data. Texts are copied verbatim; the customer asked us to **proofread the spelling** before use (e.g. UZ "tazeligi", "Greyfrutning" vs "greypfrut", mixed `’`/`ʻ` apostrophes — Uzbek Latin uses `oʻ`/`gʻ` with U+02BB and `’` U+2019 for the tutuq belgisi).

**Still missing for each**: price per volume, stock, family (filters + "similar"), full notes pyramid (top/heart/base — only 3 key notes given), longevity and sillage, Uzum link. Photos say "Стойкость до 24 часов" (brandbook: Extrait de Parfum, up to 24 h).

| Slug (photo prefix) | Display name | Original brand ("по мотивам") | Type | Key notes (UZ / RU) | Season · time |
|---|---|---|---|---|---|
| `guidance` | Guidance | Amouage | UNISEX | nok, findiq, ladan / груша, фундук, ладан | autumn–winter · evening |
| `blue-seduction` | Blue Seduction | Antonio Banderas | HOMME | bergamot, qovun, yalpiz / бергамот, дыня, мята | spring–summer · day |
| `blue-sapphire` | Blue Sapphire | Boadicea the Victorious | UNISEX | limon, atirgul, ud / лимон, роза, уд | autumn–winter · evening |
| `tygar` | Tygar | Bvlgari | HOMME | greypfrut, zanjabil, yogʻoch notalari / грейпфрут, имбирь, древесные ноты | spring–summer · day |
| `tygar-extrait` | Tygar Extrait | Bvlgari | HOMME | greypfrut, ambra, benzoin / грейпфрут, амбра, бензоин | all year · day and evening |

Photos: `materials/flakons/<slug>_<10|30|50>ml.webp` (one per volume; renamed from the brand-based `amouage_*` on 2026-11-09, since slugs follow the fragrance name).

## Descriptions (verbatim)

**1. Amouage Guidance** — erkak va ayollar uchun
- UZ: Nok va findiqning shirin-kremli ochilishi, ladan va atirgulning nafis izi. Iliq, sokin va hashamatli.
  Qachon taqish kerak: kuz-qish, kechki vaqt. Uchrashuv, kechki tadbir va bayramlar uchun.
- RU: Сочная груша и сливочный фундук с дымкой ладана и розы. Тёплый, уютный и роскошный.
  Когда носить: осень–зима, вечер. Для свиданий, вечерних выходов и праздников.

**2. Antonio Banderas Blue Seduction** — erkaklar uchun
- UZ: Bergamot, qovun va yalpizning yengil, salqin uyg’unligi. Har kuni uchun toza erkak atiri.
  Qachon taqish kerak: bahor-yoz, kunduzi. Har kuni: ish, o’qish, sayr va sport uchun.
- RU: Лёгкий прохладный аромат бергамота, дыни и мяты. Свежий мужской парфюм на каждый день.
  Когда носить: весна–лето, днём. На каждый день: работа, учёба, прогулки, спорт.

**3. Boadicea the Victorious Blue Sapphire** — erkak va ayollar uchun
- UZ: Limonning yorqin boshlanishi, atirgul yuragi va chuqur ud izi. Boy va hashamatli atir.
  Qachon taqish kerak: kuz-qish, kechki vaqt. To’y, bayram va maxsus tadbirlar uchun.
- RU: Яркий лимон, сердце из розы и глубокий шлейф уда. Богатый и роскошный аромат.
  Когда носить: осень–зима, вечер. Для свадеб, праздников и особых событий.

**4. Bvlgari Tygar** — erkaklar uchun
- UZ: Greypfrut va zanjabilning shiddatli tazeligi, iliq yog’ochli iz bilan.
  Qachon taqish kerak: bahor-yoz, kunduzi. Har kuni va ofis uchun.
- RU: Энергичная свежесть грейпфрута и имбиря на тёплой древесной базе.
  Когда носить: весна–лето, днём. На каждый день и в офис.

**5. Bvlgari Tygar Extrait** — erkaklar uchun
- UZ: Greyfrutning yorqinligi, ambra va benzoinning iliq, chuqur izi. Tygarning eng boy talqini.
  Qachon taqish kerak: yil bo’yi, kunduzi va kechqurun. Har kuni uchun ham, tadbirlar uchun ham mos.
- RU: Яркий грейпфрут, тёплая амбра и бензоин. Самая насыщенная версия Tygar.
  Когда носить: круглый год, днём и вечером. Подходит и на каждый день, и на мероприятия.

## Seed data for development

Real prices, stock, Uzum links and the Discovery set composition come later (prices after 2026-11-09). Every seed value below that the guide doesn't give is **ours, not the customer's**, so no seed price or invented value may reach launch.

- **All 67 fragrances from `materials/catalog/lummi_aromatlar.json`**, with their photos and RU/UZ texts, families, notes by level and curated similar fragrances. Longevity is «до 24 часов» for every fragrance (customer, 2026-11-07), not the guide's per-fragrance hours.
- **Placeholder prices**: 10 ml 69 000 (the customer's own example), 30 ml 149 000, 50 ml 219 000, Discovery set 299 000. Stock: 20 per volume. Prices and stock are flagged as placeholders.
- **Edge cases for tests** (one sold-out volume, one hidden fragrance, a marked-down volume) are set on real fragrances in test fixtures, not as invented demo products. The guide's 67 names already cover typo-prone and Cyrillic/Latin search cases.
- **Seed through the Excel import path.** The seed file then doubles as the template example we send the customer.
- **At data load (days 12–14)** replace placeholder prices and stock with the customer's.
