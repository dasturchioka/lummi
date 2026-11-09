---
name: LUMMI.
description: The LUMMI box opened inside Telegram — a quiet perfume shop where each fragrance appears as its own label.
colors:
  milk: "#F5F2EC"
  stone: "#CFC6B8"
  graphite: "#2A2A2A"
  sage: "#9AA592"
  card-white: "#FFFFFF"
  milk-field: "#ECE7DF"
  ink-muted: "#67625B"
  ink-faint: "#A39D94"
  sage-ink: "#5C6855"
  hairline: "rgba(42, 42, 42, .11)"
  hairline-strong: "rgba(42, 42, 42, .22)"
  sage-wash: "rgba(154, 165, 146, .18)"
  photo-blush: "#F1DDD0"
  dark-room: "#1D1C1A"
  dark-field: "#353330"
  dark-block: "#31302C"
  dark-ink-faint: "#6E6A63"
  dark-sage-ink: "#AEB8A6"
  dark-hairline: "rgba(245, 242, 236, .10)"
  dark-hairline-strong: "rgba(245, 242, 236, .22)"
  dark-sage-wash: "rgba(154, 165, 146, .16)"
  dark-photo: "#3A322C"
  on-sage: "#2A2A2A"
  photo-disc: "rgba(245, 242, 236, .92)"
  photo-disc-ink: "#2A2A2A"
typography:
  title:
    fontFamily: "Tenor Sans, Manrope, sans-serif"
    fontSize: "22px"
    fontWeight: 400
    lineHeight: 1.25
    letterSpacing: "0.2em"
  section:
    fontFamily: "Tenor Sans, Manrope, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.35
    letterSpacing: "0.2em"
  label-caps:
    fontFamily: "Tenor Sans, Manrope, sans-serif"
    fontSize: "10.5px"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "0.2em"
  name:
    fontFamily: "Cormorant Garamond, Georgia, serif"
    fontSize: "20px"
    fontWeight: 500
    lineHeight: 1.1
    letterSpacing: "0.005em"
  name-large:
    fontFamily: "Cormorant Garamond, Georgia, serif"
    fontSize: "24px"
    fontWeight: 500
    lineHeight: 1.1
  slogan:
    fontFamily: "Cormorant Garamond, Georgia, serif"
    fontSize: "21px"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "0.005em"
  body:
    fontFamily: "Manrope, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  body-small:
    fontFamily: "Manrope, system-ui, sans-serif"
    fontSize: "12.5px"
    fontWeight: 400
    lineHeight: 1.45
  row:
    fontFamily: "Manrope, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.4
  caption:
    fontFamily: "Manrope, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.3
  value:
    fontFamily: "Manrope, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.3
  hint:
    fontFamily: "Manrope, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.45
  heading:
    fontFamily: "Manrope, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.35
  input:
    fontFamily: "Manrope, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.4
  price:
    fontFamily: "Manrope, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    fontFeature: "tnum"
  price-small:
    fontFamily: "Manrope, system-ui, sans-serif"
    fontSize: "12.5px"
    fontWeight: 500
    lineHeight: 1.3
    fontFeature: "tnum"
  amount:
    fontFamily: "Manrope, system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.01em"
    fontFeature: "tnum"
  button:
    fontFamily: "Manrope, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1
  badge:
    fontFamily: "Tenor Sans, Manrope, sans-serif"
    fontSize: "10px"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "0.2em"
rounded:
  thumb: "6px"
  photo: "8px"
  button: "10px"
  card: "12px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  gutter: "16px"
  section: "28px"
components:
  button-primary:
    backgroundColor: "{colors.graphite}"
    textColor: "{colors.milk}"
    typography: "{typography.button}"
    rounded: "{rounded.button}"
    padding: "0 16px"
    height: "48px"
  button-primary-small:
    backgroundColor: "{colors.graphite}"
    textColor: "{colors.milk}"
    rounded: "{rounded.button}"
    padding: "0 14px"
    height: "36px"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.graphite}"
    typography: "{typography.button}"
    rounded: "{rounded.button}"
    height: "48px"
  button-tonal:
    backgroundColor: "{colors.stone}"
    textColor: "{colors.graphite}"
    typography: "{typography.button}"
    rounded: "{rounded.button}"
    padding: "0 14px"
    height: "48px"
  button-disabled:
    backgroundColor: "{colors.milk-field}"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.button}"
    height: "48px"
  button-add:
    backgroundColor: "{colors.graphite}"
    textColor: "{colors.milk}"
    rounded: "{rounded.button}"
    size: "32px"
  field:
    backgroundColor: "{colors.milk-field}"
    textColor: "{colors.graphite}"
    typography: "{typography.input}"
    rounded: "{rounded.button}"
    padding: "0 14px"
    height: "48px"
  chip:
    backgroundColor: "transparent"
    textColor: "{colors.graphite}"
    rounded: "{rounded.pill}"
    padding: "0 14px"
    height: "34px"
  chip-selected:
    backgroundColor: "{colors.graphite}"
    textColor: "{colors.milk}"
    rounded: "{rounded.pill}"
    height: "34px"
  type-chip:
    backgroundColor: "{colors.card-white}"
    textColor: "{colors.graphite}"
    rounded: "{rounded.pill}"
    padding: "0 16px 0 5px"
    height: "40px"
  type-chip-selected:
    backgroundColor: "{colors.graphite}"
    textColor: "{colors.milk}"
    rounded: "{rounded.pill}"
    height: "40px"
  card-product:
    backgroundColor: "{colors.card-white}"
    textColor: "{colors.graphite}"
    rounded: "{rounded.card}"
    padding: "8px 8px 12px"
  block-stone:
    backgroundColor: "{colors.stone}"
    textColor: "{colors.graphite}"
    rounded: "{rounded.card}"
  badge-hit:
    backgroundColor: "{colors.sage}"
    textColor: "{colors.on-sage}"
    typography: "{typography.badge}"
    rounded: "{rounded.pill}"
    padding: "5px 8px 4px"
  badge-new:
    backgroundColor: "transparent"
    textColor: "{colors.sage-ink}"
    typography: "{typography.badge}"
    rounded: "{rounded.pill}"
    padding: "5px 8px 4px"
  badge-discount:
    backgroundColor: "{colors.sage-wash}"
    textColor: "{colors.sage-ink}"
    typography: "{typography.caption}"
    rounded: "{rounded.pill}"
    padding: "0 8px"
  volume-option:
    backgroundColor: "{colors.card-white}"
    textColor: "{colors.graphite}"
    rounded: "{rounded.button}"
    padding: "10px 6px 9px"
  volume-option-selected:
    backgroundColor: "{colors.graphite}"
    textColor: "{colors.milk}"
    rounded: "{rounded.button}"
  tab-bar:
    backgroundColor: "{colors.graphite}"
    textColor: "{colors.stone}"
    rounded: "{rounded.pill}"
    height: "64px"
  totals-block:
    backgroundColor: "{colors.graphite}"
    textColor: "{colors.milk}"
    rounded: "{rounded.card}"
    padding: "16px"
  segmented:
    backgroundColor: "{colors.milk-field}"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.button}"
    padding: "3px"
---

# Design System: LUMMI.

## Overview

**Creative North Star: "The Opened Box"**

The shop is the LUMMI box opened inside Telegram. Every fragrance is shown the way the brand prints it on its own bottle label: the original brand in small tracked Tenor Sans caps, the name in Cormorant Italic, a thin Sage line. The packaging grammar becomes the working controls. The set builder is drawn as the Discovery box with five compartments. The one Sage thread on the box becomes the app's single measure of progress.

The world is pinned by Brandbook v2.0. The milk, stone, graphite and sage palette, the three typefaces, the 12 / 10 px radii and the 1.5 px linear icons are binding brand decisions, not taste. Surfaces are calm and dense in the way of a well-made category app: a 360 px phone column, 16 px gutters, white cards on a Milk ground, Graphite filled actions. Restraint carries the premium feel. There are no shadows, no gradients, no sticker discounts, no red sale prices and no badges on every card.

**Light is the default**, whatever Telegram's theme is. Light is the brandbook. Dark is our derivation, a warm graphite room, approved by the customer through Nurmuhammad's variant 2 on 2026-11-07. The customer switches to it in Profile, and the choice is saved per customer. Telegram draws the top header (Close / Back, title, ⋯), and the app sets the header and background colours to match its own theme. The app owns everything below the header.

**Key Characteristics:**
- Milk ground, white cards, Stone blocks, Graphite ink and filled buttons, Sage only as thread, rule, badge and confirmation.
- Fragrance shown as a label lockup: tracked caps attribution → italic name → Sage rule → muted meta line (badge, type · family) → notes joined by " · ".
- Flat. Depth comes from tone (Milk → white → Stone) and 1 px hairlines, never from shadows.
- Radii 12 (cards, blocks) and 10 (buttons, fields, controls); pills only for chips, badges, status and the language switch.
- Linear 1.5 px stroke icons on a 24 px grid, round caps and joins, `currentColor`.
- Bilingual RU / UZ-Latin at equal weight; layouts hold the longer string.

## Approved layout (customer, 2026-11-07)

The customer chose **Nurmuhammad's variant 2 with elements of variant 1** (`design/approved/`, with the verbatim reply and a table of what comes from where). It outranks our earlier mockups in `design/mockups/` wherever they differ. The tokens, type, lockups and component rules in this file still hold, because both variants use the same brand palette and type.

| Screen | Follow | Notes |
|---|---|---|
| Home | `design/approved` (variant 2 + search field and «Новинки» from variant 1) | Fabric-photo top block with the logo and «Ароматы, которые освещают» (dark fabric in the dark theme). The block is one 3:2 image slot (`FABRIC` in `Home.tsx`); until the photos arrive it shows Stone (Dark Block) with the hairline arcs of the brandbook cover. The slogan sits on one line under the logo in the Slogan role (Cormorant Italic, as the comp); UZ is the brandbook's «Lahzalaringizni yorituvchi iforlar». The row under it has a search disc (left) and the avatar (right) on Card White discs; until the city selector exists its centre stays empty. Below it the delivery city selector (centre) with search icon left and the profile avatar ("L." monogram disc) right. Then the search field «Название или нота», the dark Discovery set banner, «Популярное» with type chips over a two-column grid, and «Новинки» as a row with «Все →». No banner slider, no RU/UZ switch, no welcome screen. |
| Catalog | `design/approved` (variant 2 + filters and card details from variant 1) | Photo-circle type chips (Все / Homme / Femme / Unisex / Наборы). Filter chips Семейство / Объём / Цена / Сезон, the sort «Топ продаж ▾» and «Найдено: N». Two-column cards: heart, photo, type, name, 2–3 notes, «от … сум», «+». |
| Fragrance card | `design/approved` (variant 2 + icon row from variant 1) | Large photo with back, heart and share. Name lockup, description, the characteristics icon row, volume tiles with price under each, notes pyramid, then the reviews block, then «Купить на Uzum». Dock: «В корзину · <цена>» and «Купить сейчас». |
| Cart | `design/approved` (variant 2 + bin from variant 1) and the free-delivery block from `design/mockups` 04-cart | Lines with stepper and bin. Promo field with «Применить». Dark totals block (items, promo, delivery «Доставка BTS, <город>», «Итого») with «Оформить заказ» inside. The free-delivery Sage thread with «Подойдёт любой аромат 10 мл» suggestions sits above the lines, exactly as in our mockup (the customer asked for it). |
| Tab bar | `design/approved` | Dark floating pill with labels: Главная, Каталог, Корзина, Заказы, Профиль. |
| Set builder, Discovery set, checkout, payment, orders, profile, sale and discount states | `design/mockups` | No approved variant covers them. Keep the mockups' structure, restyled to the approved chrome: floating tab bar, no RU/UZ switch on Home, Profile holds the language and theme switches and «Избранное». |

## Colors

The palette is a quiet paper-and-ink palette. Sage is the only accent, and it is never used for alarm.

### Primary
- **Graphite** (graphite): ink for text, headings and icons; fill of every primary action (button, "+" add, selected chip, selected volume, cart count) with Milk text. 10% of a screen.

### Secondary
- **Sage** (sage): the accent, at 5%. It appears as the thread fill, the rule under a name, the label divider, the "ХИТ" badge fill, the active-tab tick, the set-picker "chosen" square, and the done dots and line in the order timeline. Sage never carries text on Milk or white, because it is too light for that.
- **Sage Ink** (sage-ink; dark: dark-sage-ink): Sage deepened for text and icons. It is used for the "НОВИНКА" outline badge, discount and "free" amounts, the confirmed status, perk icons, and the set-deal emphasis.

### Neutral
- **Milk** (milk): app ground (60%) and text on Graphite buttons.
- **Card White** (card-white): product cards, lists, the amount card and the tab bar.
- **Stone** (stone): blocks at 25%, such as the home banner, the empty-state icon disc and the profile avatar.
- **Milk Field** (milk-field): Milk with 25% Stone. It is used for inputs, segmented tracks, disabled buttons and the set-box compartment tray.
- **Muted Ink** (ink-muted): secondary text at 5:1 on Milk, for notes, meta, labels and inactive tabs.
- **Faint Ink** (ink-faint): non-text only, such as sold-out volume glyphs. It is never used for readable copy.
- **Hairline / Hairline Strong** (hairline, hairline-strong): 1 px dividers, and inset outlines on secondary buttons, chips, steppers, volume tiles and empty slots.
- **Sage Wash** (sage-wash): the tinted ground of the set-deal strip and the confirmed status pill.
- **Photo Blush** (photo-blush; dark: dark-photo): placeholder behind bottle photography while it loads, and the photo slot of the product page's loading state.
- **On Sage** (on-sage): text on a Sage fill (the ХИТ badge). Graphite in both themes; it never flips.
- **Photo Disc** (photo-disc, photo-disc-ink): the overlay discs on the product photo, 92% Milk with a Graphite icon in both themes, because the bottle photography is light in both.

### Dark theme (derived; approved 2026-11-07 via variant 2)
Dark is the optional theme, switched in Profile. The Home top block uses the dark fabric photo. Dark tokens swap the same roles. The ground is Dark Room (dark-room). Cards use brand Graphite. The other roles map to Dark Field (dark-field), Dark Block (dark-block), Milk ink, Stone as secondary ink, and Dark Faint Ink (dark-ink-faint). Lines are Milk at 10% / 22%. The tab bar stays brand Graphite, as in the comp. Primary buttons invert to a Milk fill with Graphite text. Sage is unchanged. Badge text on a Sage fill stays Graphite in both themes.

### Named Rules
**The Sage Thread Rule.** Sage is the measure, not decoration. If something fills, completes or confirms, it is Sage. If something is just pretty, it is not.

**The No Alarm Rule.** Discounts and savings are Sage Ink, and old prices are struck through in Muted Ink. Sale prices are never red. Burgundy, rose gold and gold never appear.

## Typography

**Display Font:** Tenor Sans (with Manrope, sans-serif), always uppercase and tracked
**Body Font:** Manrope 400 / 500 / 600 (with system-ui)
**Name Font:** Cormorant Garamond Italic 500 (with Georgia), fragrance names, plus the slogan in the Home top block (customer-approved comp)

All three faces are self-hosted as woff2 with cyrillic, latin and latin-ext subsets. The subsets cover Uzbek Latin `oʻ` / `gʻ` (U+02BB) and keep the first screen within budget.

**Character:** The caps engrave, the italic perfumes, and Manrope does the work. The pairing reads as a printed label laid over a plain, legible shop.

### Hierarchy
- **Title** (Tenor 400, 22px, 1.25, +0.2em, caps): screen titles such as КАТАЛОГ, КОРЗИНА, НАБОРЫ.
- **Section** (Tenor 400, 13px, 1.35, +0.2em, caps): section heads such as "Топ продаж" and "Выберите 5 разных ароматов".
- **Label caps** (Tenor 400, 10.5px, 1.45, +0.2em, caps, Muted Ink): the attribution line "ПО МОТИВАМ <BRAND>" / "<BRAND> asosida" and the box-lid label.
- **Name** (Cormorant Italic 500, 20px; 24px on the product page; 17–19px in compact rows; 12.5px under set slots): fragrance names.
- **Slogan** (Cormorant Italic 500, 21px, 1.2, sentence case, no trailing period): «Ароматы, которые освещают» / «Lahzalaringizni yorituvchi iforlar», one line under the logo in the Home top block. The one use of the italic beyond names (customer-approved comp).
- **Heading** (Manrope 600, 17px, 1.35, sentence case): the title of an empty, error or sign-in state, and the profile name. Never tracked caps, so long UZ titles stay readable.
- **Body** (Manrope 400, 14px, 1.5): running text. Notes, meta and hints use 12.5px / 1.45 in Muted Ink.
- **Row** (Manrope 400, 15px, 1.4, `type-row`): the label of a tappable list row (Profile rows, the region, city and point pickers). At 600 it is a BTS point's name and the Home delivery city.
- **Caption** (Manrope 400, 11px, 1.3, `type-caption`): the smallest readable line, in Muted Ink: characteristic labels, «Доставка» over the Home delivery city, a sold-out volume's «нет в наличии», the discount badge (at 600). The tab bar label is the same size at 500.
- **Value** (Manrope 600, 13px, 1.3, `type-value`): a short value under a caption, in the characteristics row.
- **Hint** (Manrope 400, 12px, 1.45, `type-hint`, Muted Ink): the hint under a field, and secondary counts such as «Самарканд: ещё 4 пункта» under the chosen point.
- **Price / Button** (Manrope 600, 15px, tabular numerals, no-wrap): prices, totals (16px) and button labels. A price inside a control (volume tiles) is **Price small** (Manrope 500, 12.5px, 1.3, tabular, `<Money size="small">`). The amount to pay is 28px / 600, and the card number is 18px / 600 with +0.04em tracking.
- **Badge** (Tenor 400, 10px, +0.2em, caps, `type-badge`): ХИТ and НОВИНКА only.

### Named Rules
**The Label Lockup Rule.** A fragrance is always named as: label caps attribution, then the italic name, then (in full cards) the rule (the 72 px label divider on the product page, a 28 px Sage rule on full cards, 18 px on list cards), then one muted meta line in Body small: the ХИТ / НОВИНКА badge inline at its start, then the type in caps (Manrope, +0.04em) and the family («UNISEX · Цитрусово-амбровый»), then the notes joined by " · ". Nothing sits above the attribution: no type, no badge, no family. The attribution line is mandatory legal wording, not a kicker. Never drop it, reword it or move it below the name.

**The Italic Is Sacred Rule.** Cormorant Italic is for fragrance names, plus the slogan in the Home top block (customer-approved comp). Headings, prices, buttons and other marketing lines never use it.

**The Integer So'm Rule.** Money is integer so'm with a no-break space (U+00A0) as the thousands separator, followed by the currency word: "149 000 сум" / "149 000 soʻm". The UZ "from" form is "69 000 soʻmdan". Prices never wrap and always use tabular numerals.

**The Unbroken Date Rule.** UZ date phrases such as "2-dekabrgacha" are wrapped in no-wrap and never break across lines.

## Layout

The app is a single 360 px-first column inside the Telegram WebView. Page gutters are 16 px. The product grid has two columns with an 8 px gap. Horizontal rows («Новинки», suggestions) scroll 158 px cards with an 8 px gap and a hidden scrollbar. Sections are separated by 28 px (26 px between checkout blocks). Within a block, elements stack at 12 px. Controls are 48 px tall (36 px small, 34 px chips, steppers and copy buttons). Every row and card is built to hold the longer of the RU and UZ strings.

Vertical order is fixed. Telegram's header comes first (not ours). Then the screen content scrolls. Then comes a bottom zone that is either the floating five-tab bar (Главная, Каталог, Корзина, Заказы, Профиль; a 64 px Graphite pill 20 px from the sides and 12 px above the bottom safe area) on browse screens, or a Milk dock with a top hairline that holds the primary action on task screens (product, set, checkout, payment). Content scrolls under the floating bar with enough bottom padding to clear it. The dock is `Screen`'s `dock` slot: edge to edge, sticky to the bottom while the content scrolls under it, 10 px above its buttons and the bottom safe area (at least 12 px) below them. Its mirror is the `header` slot (the search screen's back + field): edge to edge on the Milk ground, sticky at the top over the top safe area, with a hairline that appears once content scrolls under it, so the field stays in view when the keyboard shrinks the viewport.

## Elevation & Depth

The system is flat, with no box-shadows for depth. Depth is tonal: Milk ground, white card, Stone block, plus 1 px hairlines between rows. Inset 1 px outlines (drawn as inset box-shadow) are used as borders on secondary controls. A 2 px surface-coloured ring separates the cart count from the tab icon. Neither of these is elevation. The one overlay is on the product gallery: the back, share (and later heart) buttons sit on 40 px Photo Disc circles, 92% Milk in both themes.

### Named Rules
**The Flat Box Rule.** Nothing casts a shadow. If a surface needs separation, step it one tone or add a hairline. The one detached surface is the floating tab bar from the approved design, and it is flat too: a solid Graphite pill with no shadow.

## Shapes

Corners are soft but not round: 12 px for cards, blocks, the banner, the set box and the payment card, and 10 px for buttons, fields, steppers, volume tiles and segmented tracks. Photos inside cards are clipped to 8 px, and thumbnails to 6 px. Full pills are reserved for chips, badges, status, the language and theme switches, the floating tab bar and the cart count. Type chips in the catalog and in «Популярное» carry a small circular bottle photo before the label. Bottle photography is always 3:4 (set compartments are 180:564 vial crops).

The one ornament is the **label divider**: hairline, 4 px Sage diamond, hairline, 72 px wide. It is taken from the bottle label. It appears only on label lockups (the product-page name block and the set-box lid). It is not a section divider.

## Components

### Buttons
Quiet, solid and decisive.
- **Shape:** gently rounded (10px), 48px tall, Manrope 600 15px, no-wrap.
- **Primary:** Graphite fill with Milk text (inverted in dark). One per screen, usually in the dock.
- **Secondary:** transparent with a 1 px hairline-strong inset outline and Graphite text.
- **Tonal:** Stone fill with Graphite text (Dark Block with Milk text in dark), the second action beside a primary in a dock («Купить сейчас», approved comp). Never alone, never the main action.
- **Pair size:** 48 px with 14 px sides, for two actions sharing one dock row; the primary grows, the tonal one keeps its label width.
- **Disabled / pending:** Milk Field fill with Muted Ink text, carrying the reason as its label ("Выберите ещё 2").
- **Add "+":** a 32px Graphite square (30px on list cards) with a 10px radius. This is the list-card add-to-cart control per TZ §3.2. A 158 px card cannot hold "В корзину", which is a recorded deviation from bb-08.
- **Focus:** a 2px Sage outline at a 2px offset on every focusable element.

### Chips
- **Style:** a 34px pill with a hairline-strong inset outline, Manrope 500 13px.
- **Selected:** Graphite fill with Milk text. An optional count is shown as an inverted mini-pill.
- **Type chips (approved design, `TypeChips` / `Chip`):** Все / Homme / Femme / Unisex (/ Наборы in the catalog). A 40 px pill: a 30 px circular crop of the bottle photo, then the label in Manrope 500 13px. Inactive is a Card White pill with no outline; active is the primary fill (Graphite with Milk text, inverted in dark) at 600. The row scrolls sideways under the gutters with no scrollbar. Every in-page filter uses chips.

### Empty and error states
A 72px Stone disc holding a 28px line icon of what will live there (grid for the catalog, bag for the cart, box for orders, bottle for Home), a Manrope 600 17px title in sentence case, a 14px Muted line, then at most a primary and a secondary action. The "L." monogram appears only on the avatar and the sign-in states. Errors use the alert icon and one primary «Повторить», which turns busy while it retries.

### Cards / Containers
- **Corner Style:** 12px.
- **Background:** Card White on Milk, or Graphite in dark.
- **Shadow Strategy:** none (see Elevation).
- **Product card:** 8 / 8 / 12 px padding. The 3:4 photo with the favourite heart (32 px Milk disc at 92%, top-left corner of the photo), then the label lockup with an 18 px rule and its meta line (badge inline at the start, the type, the family when there is room), 2–3 key notes joined by " · ", and a footer with the "from" price and "+". In the two-column grid (`FragranceListCard layout="grid"`) the family is left out, the notes stop at two lines, the footer sits on the card's bottom edge so a row of cards lines up, and on a card under 155 px inside (a 360 px phone) the price steps down to 13.5 px so «69 000 soʻmdan» and the 30 px "+" share the line. The whole card is one button laid over the content; the heart and "+" are siblings above it. The search results use the same card as a row (96 px photo left, the lockup right).
- **Compact rows** (cart items, set picker, suggestions): thumbnail plus label lockup without the Sage rule, separated by hairlines. A suggestion row is a 48 px thumbnail (6 px radius), the attribution, the name at 18 px and the price; pressed, it washes to Milk Field.

### Inputs / Fields
- **Style:** Milk Field fill, no border, 10px radius, 48px, 16px text (iOS zooms into a focused field under 16px; the Mini App's base CSS sets it). The label sits above in 12.5px Manrope 500, Muted Ink. Hints sit below in 12px.
- **Search:** the same field with a leading 18px search icon and the placeholder "name or note". Typed text brings a 48 px clear button at the right edge that keeps the keyboard up; «Найти» on the keyboard submits and puts the keyboard away, and so does dragging the list. While the next suggestions load, the current ones stay, dimmed to 60%, rather than flashing a skeleton on every keystroke.
- **Admin panel only (deviation, 2026-11-09):** fields carry a resting 1 px hairline-strong inset outline on top of the Milk Field fill, because in dense forms on white cards and dialogs a borderless field reads as a blank plate. The admin's focus ring is Sage Ink, not Sage (Sage is about 2.6:1 on white). The Mini App keeps borderless fields and the Sage ring.

### Navigation
- **Tab bar (approved design):** a floating Graphite pill (both themes), 64px tall, 20px from the screen sides, with five equal-width tabs, 22px icon over an 11px label: Главная, Каталог, Корзина, Заказы, Профиль (UZ «Asosiy» for Home, to confirm). The active icon sits in a 38px Milk disc, its label Milk at 600. Inactive tabs use Stone. Labels never truncate; the longest UZ one may spill a few pixels past its cell. The cart count is a Milk pill with Graphite text outside the icon's top-right corner, capped at «9+».
- **Segmented control (settings only):** a Milk Field pill track whose chosen option is a gliding Graphite pill (inverted in dark), for the Profile language and theme. In-page filters use type chips, never Segmented.
- **Language and theme switches:** RU / UZ and Светлая / Тёмная pill pairs in Profile, Graphite fill on the active option. Home's top-right slot holds the profile avatar (the "L." monogram on a Stone disc, bb-08), not a switch.
- **Delivery city selector (Home):** "Доставка" in 11px Muted Ink over the city name in 15px 600 with a chevron, centred under the top block. It opens the region → city sheet from the BTS list.

### The Sage Thread (signature)
This is the single progress and measure component: a 2 px track in hairline colour with a Sage fill, rounded 2 px, and an optional row of end labels in 11.5px tabular Muted Ink below it. It is used for the free-delivery nudge, set slots filled, and (as a vertical 2 px Sage line between done dots) the order-status timeline. It is never duplicated by a second progress style.

### Badges
- **ХИТ / Hit:** filled Sage with Graphite text, 10px Tenor, +0.2em, pill.
- **НОВИНКА / Yangi:** transparent with a 1 px Sage inset outline and Sage Ink text.
- **Discount «−20%»:** Sage Wash with Sage Ink, Caption 600 tabular, pill. It always names what it belongs to («10 мл · −20% · до 15 ноября») and sits beside the end date, never on its own as a sticker and never where it could read as another tile's.
- **Shape:** a 20 px pill (`Badge`). The caps badges sit 1 px low and 2 px tighter on the right, so the tracked caps look centred.
- **Rule:** at most one badge per card. It is hidden inside a row whose title already says it (no ХИТ inside "Топ продаж").

### Characteristics row (approved design, from variant 1)
Four equal columns under the description: longevity, sillage, season, time of day. Each is a 24 px linear icon over an 11px Muted Ink label over a 13px 600 value («до 24 часов», «Сильный», «Осень–зима», «Вечер»). Hairlines above and below. These replace text tags.

### Cart totals block (approved design, from variant 2)
A Graphite block (Dark Block in dark) with Milk text: rows for items, the promo code discount in Dark Sage Ink with a "−" sign, delivery «Доставка BTS, <город>», then a hairline and «Итого» in 600. The primary «Оформить заказ» sits inside the block, inverted (Milk fill, Graphite text).
- **Rows:** labels in Milk at 75 %, values in Milk, Price 15 px; the discount row (with its source in Caption under «Скидка») and a free delivery («Бесплатно») in Dark Sage Ink (`totals-accent`, the same in both themes). «Итого» and its amount are 16 px / 600 (`type-total`), not the 28 px payment amount.
- **Place:** it is `Screen`'s `footer`: it follows the lines and, on a viewport of 680 px or more, stays above the floating tab bar (20 px gap) while a long cart scrolls under it, on a Milk ground that runs to the screen edge, with a hairline over it while lines are under it. Below 680 px it stays in the flow.
- **Nothing to buy** (every line sold out): the button is disabled and says so («Нет товаров в наличии»).
- **Lines:** the compact row with a 64 px thumbnail, the name at 18 px, the volume in Body small, the price at the top right (a markdown: Sage Ink over the struck regular price). Under them the 34 px hairline-outlined stepper (or a Milk Field «Нет в наличии» pill in its place), «Осталось N» beside a capped stepper, and the bin at the right edge.

### Volume selector
Three tiles in a grid (10 / 30 / 50 ml; a volume that is not sold is simply absent). Content is top-aligned so the volumes share one baseline: the volume in Price, then the price under it in Price small, Muted Ink. During a markdown the regular price is struck above the sale price, which is Sage Ink on an unselected tile; when any tile shows a struck price, every tile keeps that line, empty, so the prices line up too. The selected tile has a Graphite fill (inverted in dark). A sold-out tile is transparent with a faint hairline, its volume in Faint Ink and "нет в наличии" in Caption, Muted Ink; a sold-out volume can still be chosen (to see its photo) and then takes the selected fill at reduced emphasis (Muted Ink fill, Stone in dark), never a ring that reads as focus. Under the tiles, for a volume that can be bought: a 6 px Sage dot with «В наличии», and during a markdown a second row that starts with the volume: «10 мл · −20% · до 15 ноября». A sold-out volume shows neither: its tile and the dock («Нет в наличии») already say it. The arrows move the choice (one tab stop, like Segmented).

Choosing a volume cross-fades the gallery photo (0.32s, cubic-bezier(.16, 1, .3, 1)): the new photo fades in over the old one, never over the placeholder. Once the first photo is in, the other volumes' photos load quietly.

### Product page
Photo (3:4, 12 px, Photo Blush behind it) with the back and share discs; the label lockup (attribution, name, label divider, the meta line with the badge, the notes); the description, «Когда носить:» in Muted Ink with its label in ink 600, and right under it the disclaimer «Аромат LUMMI по мотивам, не оригинальный парфюм» as quiet Body small in Muted Ink, with no box and no icon (as in the comp); the characteristics row (a number stays on the line of its word: «24 soatgacha»); the volume tiles; the notes pyramid (a white card of rows, the level in Muted Ink on the same baseline as its notes); «Купить на Uzum» as a secondary button with an external icon when a link is set. The dock holds «В корзину · 149 000 сум» (primary, grows) and «Купить сейчас» (tonal). When that line does not fit (a 360 px Android, a 375 px iPhone, a seven-digit price) the price steps under «В корзину» in Price small instead of being clipped. A sold-out volume turns the dock into one disabled «Нет в наличии». While the card loads, a skeleton of the same shape stands in, with the photo slot in Photo Blush.

### Set box
The Discovery box redrawn: a white 12px card. The lid has the logo, the "DISCOVERY SET" label caps at +0.3em, the label divider and "5 × 10 мл". Below it, five vial compartments sit on a Milk Field tray. The next empty slot has a 1.5 px ink outline. Italic names sit under the slots, and the Sage thread runs underneath.

### Payment
The amount card shows the 28px amount, the card number with copy buttons, and the reserve deadline with a clock icon. Steps are numbered in Sage-outlined circles. The receipt drop zone has a 1.5 px dashed hairline-strong border. The status pill is Milk Field (pending) or Sage Wash with Sage Ink (confirmed). The confirmed state shows a 64 px Sage disc with a Graphite check.

## Do's and Don'ts

### Do:
- **Do** open in the light theme and switch to dark only from the Profile setting; set Telegram's header and background colours to the active theme.
- **Do** build every fragrance mention from the Label Lockup: "ПО МОТИВАМ <BRAND>" / "<BRAND> asosida" in label caps above the Cormorant Italic name.
- **Do** use the Sage thread for every progress or measure, and nothing else.
- **Do** keep the label divider (hairline–diamond–hairline) for label lockups only: the product name block and the set-box lid.
- **Do** format money as integer so'm with U+00A0 thousands ("149 000 сум" / "149 000 soʻm", "69 000 soʻmdan"), no-wrap and tabular.
- **Do** keep UZ date phrases ("2-dekabrgacha") on one line.
- **Do** draw icons as 24px-grid linear strokes at 1.5 px with round caps, in `currentColor`.
- **Do** show the logo at 80 px wide or more (home: 16 px tall ≈ 107 px wide). Keep its trailing dot, and never add effects.

### Don't:
- **Don't** use shadows, glows or gradients for depth. Tone and hairlines only.
- **Don't** use Cormorant Italic for anything but fragrance names and the Home slogan.
- **Don't** colour sale prices red or use burgundy, rose gold or gold. Savings are Sage Ink.
- **Don't** put Sage text on Milk or white. Use Sage Ink.
- **Don't** stack a badge on a card inside a row whose title already names it.
- **Don't** draw the top header. Telegram owns it.
- **Don't** add tracked-caps lines above headings. Label caps exist only for the brand attribution and the box-lid label.
