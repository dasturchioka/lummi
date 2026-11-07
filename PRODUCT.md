# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Telegram Mini App (WebView inside Telegram on iOS, Android, Telegram Desktop), opened from @Lummiuz_bot. Mobile-first from 360 px. Theme follows Telegram's light / dark scheme.

## Stack

Agreed in TZ §12: React + Vite (Mini App), grammY (bot), NestJS + PostgreSQL + Redis (API), Next.js (admin). Design mockups for customer approval are static HTML under `design/mockups/`.

## Users

- **Shopper** (primary): a customer in Uzbekistan on a phone, inside Telegram. Arrives from an Instagram post or story, the Telegram channel t.me/lummi_uz, a QR code on an in-store stand, or Uzum Market. Reads Russian or Uzbek (Latin); default language comes from Telegram `language_code`. Job: find a fragrance by name or by notes, pick a volume, order BTS delivery to a pickup point, pay by card transfer, upload the receipt, follow the order status.
- **Manager / owner**: work in the admin panel and the Telegram orders group (separate surfaces, not the Mini App).

## Product Purpose

The LUMMI shop inside Telegram: browse and search the catalog, buy 10 / 30 / 50 ml or a Discovery set (5 × 10 ml), build an own set of 5, check out with BTS delivery, pay by card transfer + receipt. Success: a shopper goes from an ad link to a paid order without leaving Telegram, and comes back for a full size after a set.

## Positioning

LUMMI makes Extrait de Parfum "по мотивам" (inspired by) famous fragrances: high concentration, lasting up to 24 hours, at an accessible price. "Looks and smells more expensive than it costs." The set → full-size loop is the mechanism: a delivered set unlocks 20% off one full-size bottle of one of its fragrances for 30 days.

## Operating Context

- Ships inside Telegram: Telegram draws the top header (Close / Back, title, menu); the app owns everything below it.
- Delivery: BTS postal service only, to a BTS pickup point, flat 25 000 сум in every region, free from 250 000 сум, customer ETA "до 48 часов". Pickup point chosen from a list (region → city/district → BTS branch) with a free-text fallback when the point is missing (decided 2026-11-07 for the mockups; customer to confirm).
- Payment: card transfer to the shop card, receipt upload (JPG / PNG / PDF ≤ 10 MB) or receipt sent to the bot. Stock is reserved 12 h without a receipt. Statuses: Ожидает оплаты → Чек на проверке → Оплата подтверждена / Чек не принят → Принят → Собирается → Передан в BTS → Доставлен / Отменён.
- Business rules (discounts, thresholds, windows) are admin settings; full digest in `docs/spec.md`.

## Capabilities and Constraints

- The server computes every price, discount, delivery cost and total; the client displays them.
- One discount per order: set discount, promo code, or birthday coupon; the customer picks. Discounts apply to items only, never delivery.
- Free-delivery nudge in the cart (Uzum-style "add N сум more"), optional on the product card. Threshold computed before a set discount, after a promo discount.
- Every list and screen has loading, empty, nothing-found, out-of-stock and network-error ("Повторить") states.
- A fragrance is identified by its name. No `No.XXX` numbers, internal product codes never shown.
- Money formatted as integer so'm: `100 000 сум` / `100 000 soʻm`.
- Undecided: real prices (placeholders until after 2026-11-09), payment card (not opened yet), disclaimer wording, families list, birthday free-delivery rule, banner images and text.

## Brand Commitments

- Brandbook v2.0 (`materials/brandbook/`) is binding: palette Milk / Stone / Graphite / Sage at 60 / 25 / 10 / 5, fonts Tenor Sans (caps, tracked) + Manrope + Cormorant Garamond Italic (fragrance names only), card radius 12 px, button radius 10 px, linear 1.5 px icons. Burgundy, rose gold and gold are forbidden. Tokens are listed in `CLAUDE.md`.
- Product name block (brandbook p.8): "ПО МОТИВАМ <BRAND>" in small Tenor caps above the Cormorant Italic name.
- Copy is legal-sensitive: always "по мотивам <Brand> <Name>"; never "копия", "реплика", "оригинал", "Oil Perfume", "масляные духи", fragrance numbers, concentration %, or original brands' logos and packaging. Every product card shows the disclaimer «Аромат LUMMI по мотивам, не оригинальный парфюм» (text pending approval).
- Voice: modern, warm, confident; about moments and feelings, not chemistry; «вы» / «siz»; at most 1–2 emoji in bot posts.
- Logo: the trailing dot is part of the mark; minimum 80 px on screen, monogram "L." 32 px.

## Evidence on Hand

- Bottle photos: `materials/flakons/<slug>_<10|30|50>ml.png`, 1086 × 1448 (3:4), one per volume, Russian text baked in; kept as-is in both languages (customer, 2026-11-06).
- Discovery set box photo: `materials/photos/discovery-set-box.jpg`.
- Logo pack: `materials/logo-pack/` (SVG + PNG).
- 5 real fragrances with RU/UZ texts: `docs/catalog-sample.md`. Prices, families, pyramids, longevity and sillage there are placeholders and must not reach launch.
- No banner artwork, reviews, testimonials or sales figures exist yet; do not invent them as real.

## Product Principles

1. The task comes first: a shopper from an Instagram link reaches a paid order in a few taps, in their own language.
2. Money is shown exactly as the server computes it; every discount says where it came from.
3. Payment is trust work: the exact amount, the card, the reserve deadline and the next step are always visible.
4. The set is a door to the full size; the app keeps that promise visible until it is used or expires.
5. Brand restraint is the luxury: the brandbook's quiet palette and type carry the premium feel, not effects.

## Accessibility & Inclusion

Russian and Uzbek (Latin, with `oʻ` / `gʻ` as U+02BB) everywhere; layouts must hold the longer of the two strings. Readable on low-end Android at 360 px over 4G (first screen < 2 s). Both Telegram themes must keep WCAG AA text contrast.
