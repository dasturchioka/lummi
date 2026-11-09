# Catalog guide — 67 fragrances (customer, 2026-11-07)

Sent by the customer in the project chat on 2026-11-07 (msg 28, `LUMMI — Полный гайд об ароматах.zip`, original in `_archives/LUMMI_Polnyy_gayd_aromatov.zip`): "all fragrances: notes, description, longevity, sillage, season, time and similar fragrances". It replaces the 5-fragrance sample in `docs/catalog-sample.md` as the seed source. **No prices, stock, Uzum links or Discovery set composition yet.**

| File | Content |
|---|---|
| `lummi_aromatlar.json` | Machine-readable source: 67 records, RU and UZ blocks, `similar_ids`. Use this for the seed. |
| `lummi_aromatlar_uz_ru.xlsx` | The same data as sheets "UZ — oʻzbekcha", "RU — русский", "Lugʻat — Словарь нот". The customer's own format, not our import template. |
| `notalar_lugati.txt` | Note dictionary, RU — UZ, ~145 notes. Seeds the note dictionary. |

Bottle photos for all 67 are in `../flakons/<slug>_<ml>ml.webp` (10 / 30 / 50 ml, 1086×1448, WebP q90 converted from the PNG originals in `_archives/LUMMI_FLAKONS_67.zip`). The photo's two-digit prefix in the zip equals the guide `id`.

## Field mapping

| Guide (RU / UZ key) | Our model | Notes |
|---|---|---|
| `id` | internal code | Never shown to customers. |
| `name` | fragrance name (single, untranslated) | Slug = name in ASCII kebab case (table below). |
| `brand` | original brand (single) | `po_motivam` / `asosida` are display strings built from it. |
| `pol` / `jins` | type | Мужской → Homme, Женский → Femme, Унисекс → Unisex (UZ: Erkaklar uchun / Ayollar uchun / Uniseks). |
| `semeystvo` / `oila` | family (dictionary, RU/UZ) | 29 composite families, e.g. «Цитрусово-древесный» / «Sitrusli yogʻochli». Resolves the "families list" open question. |
| `klyuchevye_noty` / `asosiy_notalar` | key notes (exactly 3) | Shown on list cards and under the name. Not always the top notes. |
| `verhnie_noty`, `noty_serdca`, `bazovye_noty` / `yuqori_…`, `yurak_…`, `baza_…` | notes by level (top / heart / base) | Comma-separated; names match `notalar_lugati.txt`. Record 64 has no heart notes on purpose. |
| `ob_aromate` / `ifor_haqida` | description | |
| `kogda_nosit` / `qachon_taqish` | when to wear | New field, not in the TZ. |
| `stoykost` / `turgunlik` | longevity | **Ignored for the seed**: the customer asked for «до 24 часов» / «24 soatgacha» everywhere (design decision, 2026-11-07), and the photos say so too. The guide has 10 / 12 / 16 / 24 h. |
| `shleyf` / `iz` | sillage | Средний / Заметный / Сильный — Oʻrtacha / Sezilarli / Kuchli. |
| `sezon` / `mavsum` | season | Весна–лето, Осень–зима, Круглый год, Весна–осень — Bahor–yoz, Kuz–qish, Yil boʻyi, Bahor–kuz. |
| `vremya` / `vaqt` | time of day | Днём, Вечер, День и вечер, На каждый день — Kunduzi, Kechqurun, Kunduzi va kechqurun, Har kuni. |
| `similar_ids` (`pohozhie` / `oxshash` as names) | curated similar fragrances | 4 per fragrance, ids within this catalog. Drives «Похожие ароматы» first (spec Changes 2026-11-07). |
| `primechanie` / `izoh` | internal remark | Admin-only (3 records), e.g. "notes per Fragrantica". Never shown to customers. |

## Slugs

| # | Slug | Name | Original brand |
|---|---|---|---|
| 1 | `guidance` | Guidance | Amouage |
| 2 | `blue-seduction` | Blue Seduction | Antonio Banderas |
| 3 | `blue-sapphire` | Blue Sapphire | Boadicea the Victorious |
| 4 | `tygar` | Tygar | Bvlgari |
| 5 | `tygar-extrait` | Tygar Extrait | Bvlgari |
| 6 | `good-girl-gone-bad` | Good Girl Gone Bad | Kilian |
| 7 | `smoking-hot` | Smoking Hot | Kilian |
| 8 | `angels-share` | Angels' Share | Kilian |
| 9 | `black-phantom` | Black Phantom | Kilian |
| 10 | `bal-dafrique` | Bal d'Afrique | Byredo |
| 11 | `bleu-de-chanel` | Bleu de Chanel | Chanel |
| 12 | `miss-dior-blooming-bouquet` | Miss Dior Blooming Bouquet | Dior |
| 13 | `sauvage-edt` | Sauvage EDT | Dior |
| 14 | `blonde-amber` | Blonde Amber | Clive Christian |
| 15 | `absolu-aventus` | Absolu Aventus | Creed |
| 16 | `aventus` | Aventus | Creed |
| 17 | `silver-mountain-water` | Silver Mountain Water | Creed |
| 18 | `wild-vetiver` | Wild Vetiver | Creed |
| 19 | `molecule-02` | Molecule 02 | Escentric Molecules |
| 20 | `fleur-narcotique` | Fleur Narcotique | Ex Nihilo |
| 21 | `my-way` | My Way | Giorgio Armani |
| 22 | `stronger-with-you` | Stronger With You | Emporio Armani |
| 23 | `power-of-you` | Power Of You | Giorgio Armani |
| 24 | `flora-gorgeous-gardenia` | Flora Gorgeous Gardenia | Gucci |
| 25 | `flora-gorgeous-jasmine` | Flora Gorgeous Jasmine | Gucci |
| 26 | `gaba` | Gaba | Hormone Paris |
| 27 | `devils-intrigue` | Devil's Intrigue | HFC |
| 28 | `le-male-elixir` | Le Male Elixir | Jean Paul Gaultier |
| 29 | `le-male-le-parfum` | Le Male Le Parfum | Jean Paul Gaultier |
| 30 | `meteore` | Météore | Louis Vuitton |
| 31 | `stellar-times` | Stellar Times | Louis Vuitton |
| 32 | `symphony` | Symphony | Louis Vuitton |
| 33 | `pacific-chill` | Pacific Chill | Louis Vuitton |
| 34 | `imagination` | Imagination | Louis Vuitton |
| 35 | `limmensite` | L'Immensité | Louis Vuitton |
| 36 | `ombre-nomade` | Ombre Nomade | Louis Vuitton |
| 37 | `oud-maracuja` | Oud Maracujá | Maison Crivelli |
| 38 | `hibiscus-mahajad` | Hibiscus Mahajád | Maison Crivelli |
| 39 | `safran-secret` | Safran Secret | Maison Crivelli |
| 40 | `baccarat-rouge-540` | Baccarat Rouge 540 | Maison Francis Kurkdjian |
| 41 | `red-tobacco` | Red Tobacco | Mancera |
| 42 | `ganymede` | Ganymede | Marc-Antoine Barrois |
| 43 | `tilia` | Tilia | Marc-Antoine Barrois |
| 44 | `black-afgano` | Black Afgano | Nasomatto |
| 45 | `montabaco-intensivo` | Montabaco Intensivo | Ormonde Jayne |
| 46 | `valaya` | Valaya | Parfums de Marly |
| 47 | `layton` | Layton | Parfums de Marly |
| 48 | `sedley` | Sedley | Parfums de Marly |
| 49 | `castley` | Castley | Parfums de Marly |
| 50 | `greenley` | Greenley | Parfums de Marly |
| 51 | `althair` | Althaïr | Parfums de Marly |
| 52 | `vra-vra-vroom` | Vra Vra Vroom | Penhaligon's |
| 53 | `elysium-pour-homme-parfum` | Elysium Pour Homme Parfum | Roja |
| 54 | `oligarch` | Oligarch | Roja |
| 55 | `kirke` | Kirke | Tiziana Terenzi |
| 56 | `oud-wood` | Oud Wood | Tom Ford |
| 57 | `tobacco-vanille` | Tobacco Vanille | Tom Ford |
| 58 | `ombre-leather` | Ombre Leather | Tom Ford |
| 59 | `lost-cherry` | Lost Cherry | Tom Ford |
| 60 | `erba-pura` | Erba Pura | Xerjoff |
| 61 | `very-sexy-sea` | Very Sexy Sea | Victoria's Secret |
| 62 | `libre` | Libre | Yves Saint Laurent |
| 63 | `black-opium` | Black Opium | Yves Saint Laurent |
| 64 | `pink-molecule-090-09` | Pink Molécule 090.09 | Zarkoperfume |
| 65 | `ink-mark` | Ink Mark | Louis Vuitton |
| 66 | `moon-tale` | Moon Tale | Louis Vuitton |
| 67 | `rain-tea` | Rain Tea | Louis Vuitton |
