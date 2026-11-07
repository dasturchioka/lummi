# LUMMI — Telegram Mini App shop

Telegram Mini App + bot + admin panel for **LUMMI.**, a perfume brand selling Extrait de Parfum "по мотивам" (inspired by) famous fragrances. Volumes 10 / 30 / 50 ml plus a Discovery set (5 × 10 ml). Market: Uzbekistan, mobile-first, RU + UZ (Latin).

**Status:** Stage 1 (MVP) started 2026-11-07 (day 1) and is due 2026-11-20 (day 14). The day plan with dates is in `docs/spec.md` §10. No code yet. Spec = TZ v1.11 (2026-11-05) plus the dated changes at the end of `docs/spec.md`.

## Docs

- `docs/adr/` — design decisions (0001–0029) locked in the 2026-11-07 grilling session; read the relevant ADR before changing money, payment, stock or architecture code.
- `GLOSSARY.md` — the domain vocabulary; use its terms in code and docs.

- `docs/spec.md` — business rules digest of the TZ (screens, set discount, birthday, payment and reconciliation, bot, manager group, admin, promo, delivery, acceptance). Read the relevant section before implementing or estimating any feature.
- `docs/open-questions.md` — unresolved decisions, missing customer inputs, conflicts between TZ, brandbook and photos. Check it before relying on any `[bracketed]` value; update it when the chat answers something.
- `docs/catalog-sample.md` — the 5 seed fragrances (RU/UZ texts, notes, type, season) mapped to their photos.
- `materials/` — originals from the customer, read-only:
  - `tz/` — TZ PDF + `.txt` dump (Russian; authoritative over `docs/spec.md`)
  - `brandbook/` — Brandbook v2.0 PDF, `.txt` dump, `pages/bb-NN.png` renders (`pages/_overview.png` = all pages)
  - `logo-pack/` — logo, monogram, avatar as SVG + PNG
  - `flakons/` — bottle photos `<slug>_<ml>ml.png` (filenames normalised from the zip)
  - `photos/discovery-set-box.jpg`
  - `_archives/` — the original zips

## People and channels

- Customer / brand owner: Fayzali Jo'ramaxamadov (@Juramaxamadov_Fayzali).
- Contractor: Dynamic Soft (MChJ "DYNAMICC GLOBAL"). Nurmuhammad Rahmatullaev (@nurmuhammad_rahmatullaev) leads on our side and talks to the customer; Sardor (@dasturchioka) is the developer.
- Project chat: Telegram supergroup "Lummi. Telegram mini app", chat id `-1003925824409`. New materials and answers arrive there. History before 2026-11-06 11:22 UTC stays in the pre-migration basic group `-5336739403`. Read both with the telegram-me MCP using `account="default"`. For documents, use `download_media` if the MCP exposes it; otherwise take them from `~/Downloads/Telegram Desktop/` and check the size against `get_media_info`.
- Orders group: "Lummi", chat id `-5579977857`, created by the customer. Its manager account is @lummi_manager, which is the target of "Написать менеджеру". The bot gets added to this group at launch.
- Bot: the customer owns @Lummiuz_bot and hands over the token only at launch. Develop against our own dev bot.
- Brand surfaces: bot + Mini App @Lummiuz_bot · t.me/lummi_uz · instagram.com/lummi.uz · LUMMI store on Uzum Market.

## Stack (agreed in TZ §12)

React + Vite (Mini App) · grammY (bot) · NestJS + PostgreSQL + Redis (API) · Next.js (admin). Telegram skills: `telegram-miniapps` (initData verification, viewport, safe areas, themes), `telegram-bots` (webhooks, update dedup, rate limits, grammY), `telegram-userbots` + `using-mtcute` (Humo userbot). Hosting: Tashkent VPS (4 vCPU / 4 GB / 100 GB, PRO-DATA), registered to the customer. The repo stays with us (customer doesn't need it, decided 2026-11-07, ADR 0026); the run guide and all access (server, bot, domain) are handed to the customer at delivery.

AI payment verification matches receipts against credit notifications from the **official Humo bot**. Those notifications arrive in **the customer's own Telegram account**, not in a group. A **userbot** (mtcute session on that account; skills `using-mtcute`, `telegram-userbots`) listens only to the Humo bot chat, parses each notification, and forwards it to a group. The session string is full access to the customer's personal account: store it encrypted, on the customer's server only. Notification format and matching limits are in `docs/spec.md` → Changes (2026-11-07).

## Invariants — every change respects these

- **The server owns money.** It computes prices, discounts, delivery, and totals. The client only displays them. Verify the Telegram `initData` signature and freshness once, at sign-in, and exchange it for our own short-lived session; never trust a user id from the client (ADR 0029).
- **Integer so'm**, displayed as `100 000 сум` / `100 000 soʻm`.
- **One discount per order**: upgrade right (from a set, or from a 10 ml bottle once approved), promo code, or birthday coupon. An entered promo code wins; otherwise the server picks the entitlement giving the lowest total incl. delivery, and the customer can switch (ADR 0002). Discounts apply to items only, never to delivery, and not to marked-down items by default (ADR 0008). The free-delivery threshold (250 000) base is a per-source setting: before an upgrade right, after a promo code, after a birthday coupon (to confirm).
- **Stock reservation** happens in a DB transaction, so the last unit can't be sold twice. Available = on hand − reserve; on hand drops at BTS handover (ADR 0010). A reserve lives 12 h without a receipt. An uploaded receipt holds it until a credit matches or the wait window ends with "payment not found" (ADR 0012). Cancelling returns stock, the promo use and any right or coupon still within validity (ADR 0005).
- **Money on the card is ground truth**, never the screenshot. AI may only confirm a payment. Only a manager rejects, and must give a reason.
- **Every rule value is an admin setting** (percentages, windows, limits, thresholds), never a constant.
- **Audit trail**: payment confirmations (AI or manager name), status changes, cancels, and card-detail edits are logged with the actor.
- **Bilingual everything**: UI strings, product content fields, bot messages, info pages. Default language comes from Telegram `language_code`. Our assumption: `uz` → UZ, anything else → RU.
- Schedules run in **Asia/Tashkent** (birthday coupon at 10:00).
- Receipts (customer payment proofs) go to private storage on the Tashkent VPS, readable only by owner and managers; personal data, DB and backups never leave Uzbekistan (ADR 0020, 0025). The AI gets only the receipt image, candidate amounts/times and the shop card, never phone or address (ADR 0013).
- A fragrance is identified by its **name**. The internal product code is never shown, and `No.XXX` numbers are never used.

## Brand and copy rules (legal-sensitive)

- Always name the original as "по мотивам Louis Vuitton Symphony" / UZ "Louis Vuitton asosida". Use "аромат для вечера", "оставляет шлейф", "тёплый, древесный".
- Banned words and imagery: "копия", "реплика", "оригинал", "как оригинал за копейки", "Oil Perfume", "масляные духи", fragrance numbers, concentration %, and original brands' logos or packaging.
- Every product card shows the disclaimer (text pending approval): «Аромат LUMMI по мотивам, не оригинальный парфюм».
- Tone: modern, warm, confident. Talk about moments and feelings, not chemistry. Address the customer as «вы» / «siz». Bot posts use at most 1–2 emoji.

## Design tokens (Brandbook v2.0 pp.4–8)

| Token | Value | Use |
|---|---|---|
| Milk | `#F5F2EC` (60%) | App background |
| Stone | `#CFC6B8` (25%) | Secondary surfaces, blocks, avatar bg |
| Graphite | `#2A2A2A` (10%) | Text, headings, buttons (button text = Milk), icons |
| Sage | `#9AA592` (5%) | Accent: badges "Хит"/"Новинка", thin lines, icons |
| Card bg | `#FFFFFF` | Product cards |
| Radius | cards 12 px, buttons 10 px | |
| Icons | linear, 1.5 px stroke, Graphite | |

- Burgundy, rose gold, and gold are forbidden. No shadows, outlines, or effects on the logo.
- Fonts (Google Fonts, self-host for the < 2 s first screen):
  - **Tenor Sans**: UPPERCASE, tracking +200…+300; logo and screen titles at 22–26 px.
  - **Manrope**: 400/500/600, Cyrillic + Uzbek Latin; body text 400 at 14–15 px, buttons and prices 600 at 15–16 px.
  - **Cormorant Garamond Italic**: fragrance names only, 20–24 px.
- Product name block: a small Tenor Sans caps line "ПО МОТИВАМ <BRAND>" above the Cormorant Italic name, then the notes joined with " · ", then "от 99 000 сум". See `materials/brandbook/pages/bb-08.png`.
- Logo: the trailing dot is part of the mark. Clear space = height of the "L". Minimum on screen: logo 80 px, monogram "L." 32 px. The avatar/app icon is the "L." monogram on Stone (`logo-pack/LUMMI_avatar_stone.svg`).
- **Theme follows Telegram** (light or dark). The customer said "Standart rejim", agreed internally on 2026-11-06. The brandbook defines light only, so dark-theme tokens are ours to derive (Graphite surfaces, Milk text, Sage accent) and need customer approval.
- Photos: 3:4 for product cards, 9:16 for stories. Bottle photos are 1086×1448 PNG with Russian text baked in (notes, longevity, gender). The customer decided on 2026-11-06 to keep them as-is in both languages. There is one photo per volume, and the gallery switches when the customer picks 10 / 30 / 50 ml. Serve them as WebP.

## Agent skills

### Issue tracker

GitHub Issues in `dasturchioka/lummi`, via `gh`; ticket blocking edges are native issue dependencies. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default roles: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
