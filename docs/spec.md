# LUMMI Mini App — spec digest (TZ v1.11)

English digest of `materials/tz/LUMMI_TZ_MiniApp_v1.11.pdf` (Russian, 13 pages; text dump in `materials/tz/LUMMI_TZ_MiniApp_v1.11.txt`). The PDF is authoritative: when a new TZ version arrives, re-diff it against this file. `§` numbers below are TZ sections.

Values in `[brackets]` are TZ placeholders or defaults still to be confirmed (tracked in `docs/open-questions.md`). Every value in a rules table is **admin-configurable** ("меняется в админке"); store them as settings, not constants.

## §1–2 Goal and global requirements

- Customer opens the LUMMI shop inside Telegram, picks fragrance + volume, orders BTS postal delivery, pays by **card transfer + receipt upload**. Click/Payme are out of scope. Orders go to managers instantly; customer gets status notifications; owner manages catalog, prices, orders in the admin panel.
- Audience: Uzbekistan, mostly mobile. Traffic: Instagram, Telegram channel, in-store stands (QR), Uzum.
- Languages: Russian + Uzbek (Latin). Default = user's Telegram language; switch in profile.
- Design strictly per brandbook (tokens in `CLAUDE.md`). Support Telegram light and dark themes.
- Currency: so'm, formatted `100 000 сум` (narrow-space thousands).
- Responsive from 360 px; iOS, Android, Telegram Desktop.
- First screen < 2 s on 4G; images WebP, lazy-loaded.
- A fragrance is identified by its **name**. No `No.XXX` numbers anywhere. An internal product code exists for import/accounting and is never shown to customers.
- Every list/screen has states: loading, empty, nothing found, out of stock, network error with "Повторить" (retry).

## §3 Mini App screens

### 3.1 Home
Banner slider (managed in admin) · quick sections Homme / Femme / Unisex / Наборы (sets) · "Топ продаж" (auto) and "Новинки" (admin checkbox) blocks · search at the top.

### 3.2 Catalog
- **Search**, one field: by name ("Megamare") and by notes ("ваниль", "уд", "бергамот"). Must tolerate typos and abbreviations ("мегамаре", "megamar"), Cyrillic ↔ Latin, with suggestions while typing. Admin can add name spelling variants (aliases).
- **Search acceptance**: customer and contractor agree on 30 control queries before start; the expected fragrance must be in the top 3 for ≥ 27 of them.
- Filters: gender (Homme/Femme/Unisex), family (woody, floral, fresh, citrus, oriental, gourmand…), volume, price, season.
- Sort: top sales (default), new, price ↑, price ↓. Top sales = auto, by **paid** orders over the last `[30]` days; admin can pin fragrances to the top.
- List card: photo, name, type, 3 main notes, price "от …" (from), "+" button.

### 3.3 Product card
- Gallery — its own photo per volume.
- Name, type (HOMME/FEMME/UNISEX), family; notes pyramid top / heart / base; description RU/UZ; characteristics: longevity, sillage, season, time of day.
- Volume selector 10 / 30 / 50 ml → price and stock change.
- "В корзину" (add to cart), "Купить сейчас" (buy now), "Поделиться" (share link opens this product).
- "Купить на Uzum": per-fragrance URL from admin; hidden when empty.
- "Похожие ароматы" (similar): same family **and** type, in stock, max 6.
- Mandatory disclaimer `[text to approve: «Аромат LUMMI по мотивам, не оригинальный парфюм»]`. Never use original brands' logos or photos.

### 3.4 Sets
- **Discovery set** 5 × 10 ml at fixed `[price]` — behaves as a regular product; its composition is set in admin.
- **Set builder**: customer picks 5 *different* in-stock fragrances at 10 ml. Price = Discovery set price (admin), independent of the picks.

**Full-size discount after a set** — the system remembers a customer's set fragrances and gives 20% when they buy one of them full-size:

| Rule | Value |
|---|---|
| Qualifying sets | Builder sets and the ready Discovery set |
| Right appears | When the order containing the set reaches "Доставлен" (delivered). Fragrances are saved to the customer account (keyed by phone), visible in Profile → "Мои наборы" |
| Discount | 20% on one bottle of one fragrance from the set; delivery excluded |
| Full size | 30 ml and 50 ml |
| Limit | One set = one discount. After use the right for that set closes, even if other set fragrances remain. A new set grants a new right |
| Validity | 30 days from the set order reaching "Доставлен" |
| Reminders | Bot reminds 7 days and 1 day before expiry if unused. If the bot is blocked, the discount stays visible in profile |
| Display | Eligible product card shows the discounted price + "Скидка за набор" label; applied automatically in cart |
| Stacking | Does not stack with promo code or birthday coupon — one discount per order, customer chooses |
| Free-delivery threshold | Computed on items **before** the set discount. (Promo code: threshold computed **after** discount. Birthday coupon: `[before / after]`) |
| Cancel / return | If the discounted order is cancelled/returned, the right is restored within its validity. If the set order itself is cancelled/returned, the right never appears or is closed |

### 3.5 Cart
Change quantity, remove, promo code, total incl. delivery. Cart persists across app closes. An item that went out of stock is flagged and excluded from the order.

### 3.6 Checkout
1. Name; phone via Telegram "share contact" button or typed.
2. Date of birth (optional, see 3.8).
3. Fulfilment: **only** BTS postal delivery across Uzbekistan; customer-facing ETA "до 48 часов"; price by region.
4. Address: region (list), city/district, street, house, landmark + map pin (geolocation). *Superseded: delivery goes to a BTS pickup point, so street/house/map pin need rethinking. See "Changes agreed after TZ v1.11".*
5. Order comment.
6. Total: items + delivery − discount → "Перейти к оплате".
7. Payment screen: card number with "Скопировать" (copy), recipient, exact amount, order number, receipt upload → "Отправить чек".

Name, phone, birthday are asked on the first order; catalog works without registration. Data-processing consent (incl. birthday) and bot write permission are requested on the first order.

### 3.7 Orders and profile
Order history with status and "Повторить заказ" (repeat order). Profile: language, phone, saved addresses, birthday coupon, "Мои наборы" + set discount. Info pages: About, Delivery & payment, Returns, FAQ, Contacts, Public offer (drafts in TZ appendix).

### 3.8 Birthday

| Rule | Value |
|---|---|
| Discount | 20% on items, delivery excluded |
| Coupon sent | 3 days before birthday at 10:00 Asia/Tashkent: bot message + coupon in profile |
| Validity | From 3 days before to 7 days after the birthday |
| Abuse guard | Date entered once; only admin can change it. First coupon no earlier than 14 days after the date was entered. One phone = one account |
| Limits | Once per calendar year, one order. Max discount `[amount]` so'm |
| 29 Feb | In non-leap years treated as 28 Feb |
| Bot blocked | Coupon stays in profile; report shows "не доставлено" (not delivered) |

## §4 Payment

### Card transfer + receipt (manual baseline)
1. On order creation stock is **reserved**; payment status "Ожидает оплаты" (awaiting payment).
2. Customer sees card details + exact amount, transfers, uploads a screenshot or file (JPG, PNG, PDF, ≤ 10 MB).
3. Status → "Чек на проверке" (receipt under review); receipt goes to managers.
4. Manager compares amount/time with the actual account credit → "Оплата подтверждена" (confirmed) or "Чек не принят" (rejected) with a reason.

- Ground truth is money on the account, never the screenshot. Unconfirmed orders are not assembled or shipped.
- Reserve: no receipt within `12 h` (admin) → auto-cancel; stock and promo usage are returned. An uploaded receipt holds the reserve until the manager decides (so payment never "expires" overnight).
- After rejection the customer may re-upload while the reserve window is open.
- Same receipt file re-uploaded on another order → warning to manager.
- Card details editable only by owner; changes go to the audit log. Card `[number + holder; must belong to IP/LLC — confirm with accountant]`.
- No fiscal receipt is generated by the system `[procedure: customer's accountant]`. Refunds are manual to the customer's card, with amount + date recorded on the order.

### AI auto-verification (scope to confirm — see open questions)
Payment is confirmed automatically when AI-read receipt fields match a Humo credit notification; a manager steps in only on mismatch or low confidence.

1. Customer sends the receipt screenshot to @Lummiuz_bot or uploads it on the payment screen — both feed one check.
2. Bot links the receipt to an order: automatically if the customer has exactly one "awaiting payment" order, otherwise the customer picks the order by button.
3. Humo's bot posts every card operation into a private Telegram group "Поступления" (credits) `[to create]`.
4. **Bots cannot see other bots' messages**, so a **service Telegram user account** (separate number, owned by customer) reads Humo notifications via the Telegram API (MTProto userbot) and forwards them to the server. If Humo's bot can't post into a group, the service session reads them where they arrive `[verify on connect]`.
5. Each notification is stored as a credit: amount, datetime, sender (name or last-4), operation id — whatever the message has. Debits and refunds are ignored.
6. AI reads the screenshot: amount, datetime, recipient last-4, recipient name, sender, operation id, bank app.
7. Match found → "Оплата подтверждена", customer notified, order goes to assembly. No match / unsure → "Ручная проверка" (manual review), receipt goes to managers.

| Reconciliation rule | Value |
|---|---|
| Amount | Receipt = credit = order total, exact to the so'm. Any difference → manual |
| Time | Receipt vs credit differ ≤ `[5 min]`; credit not earlier than order creation |
| Recipient | Receipt last-4 = shop card; if absent on the screenshot, check recipient name |
| Operation id | If present on both, must match — strongest signal |
| One credit, one order | A credit already linked to an order is never reused |
| Multiple candidates | ≥ 2 credits fit (same amount, same time) → manual |
| AI confidence | ≥ `[90%]` per required field; unreadable field or cropped screenshot → manual |
| Duplicate receipt | Same file or same operation id on another order → manual, tagged "Повторный чек" |
| No credit | None within `[10 min]` of the receipt → manual; if it arrives later, the system re-matches until a manager decides |

- AI may only **confirm**. Only a manager can reject (with reason, §6).
- Manual-review post in the orders group carries: receipt, candidate credits, reason ("сумма не совпала", "нет поступления", "несколько поступлений", "ИИ не уверен", "повторный чек").
- Order card shows who confirmed: "ИИ" or the manager's name. Recognised fields, matched credit, and confidence are logged.
- Unlinked credits appear in admin as "Не привязано"; manager can link manually.
- Humo silent > `[30 min]` during working hours while receipts wait → all receipts go manual, owner is alerted.
- Humo messages parsed by template; if the format changes, AI parses and owner gets a warning.
- AI provider `[to choose]`, paid by customer per use. Only the receipt image is sent to AI — no phone or address.

## §5 Telegram bot (@Lummiuz_bot)
- `/start`: greeting in the customer's language + "Открыть магазин" button; bot menu button opens the Mini App.
- Customer notifications: order created, receipt received, payment confirmed / receipt rejected, assembling, handed to BTS (with tracking number), delivered, cancelled.
- `startapp` deep links for ads: open a specific product or set, prefill a promo code, attribute the source (Instagram, channel, stand QR).
- "Написать менеджеру" → `[manager @username]`.
- Bot messages only users who granted permission; permission requested on first order.

**Post-order review**

| Rule | Value |
|---|---|
| When | `[24 h]` after "Доставлен", once. Cancelled orders excluded. No re-reminders |
| What | "Как вам заказ?" — rating 1–5 via buttons, then optional comment |
| Low rating | 1–3 goes straight to the orders group: order number, phone, rating, comment |
| Storage | On the order card and admin "Отзывы": list, filter by rating and date, average, Excel export |
| Bot blocked | Not sent; review marked "не доставлено" |
| Publishing | Private. Show on product card: `[yes / no]` |

## §6 Orders for managers
- Each new order → one private Telegram group `[to create]`: order number, items (name, volume, qty), total, receipt, customer, phone, address + map, comment.
- Payment buttons: "Оплата подтверждена" / "Чек не принят". Responsible person `[who sees account credits]`.
- Then status buttons: **Принят → Собирается → Передан в BTS → Доставлен / Отменён** (accepted → assembling → handed to BTS → delivered / cancelled). Customer notified automatically.
- Cancel requires a reason: out of stock, customer refused, unreachable, payment not received, not collected at BTS. Stock and promo usage are returned.
- Receipt unchecked > `[15 min]` in working hours → owner alerted.
- Every cancel/status change in the group is logged with the staff member's name.
- One warehouse, one stock. Uzum and store sales don't decrement app stock, so managers confirm availability per order; stock is updated manually or via Excel until REGOS (stage 2).

## §7 Admin panel (all stage 1)

| Section | Functions |
|---|---|
| Products | Add / edit / hide; Uzum link; name aliases; pin to Top sales; price + stock per volume; photos; hit / new flags; Excel import & update (template `LUMMI_Katalog_shablon.xlsx`, not yet received) |
| Sets | Discovery set as product; builder settings; full-size discount rules |
| Orders | List, filters (status, payment, date), order card with receipt, payment confirmation, reserve window, status change, BTS tracking number, refund mark, Excel export |
| Customers | List, order history, total spend |
| Reviews | Ratings + comments, average, send-delay setting, Excel export |
| Marketing | Banners; promo codes (% or fixed, expiry, limits); birthday rules; broadcast to bot users |
| Delivery | Tariff table region → price, customer ETA, free delivery threshold |
| Reports | Promo codes & sources; sales by day; top fragrances and volumes; set discount (issued, used, net sales) |
| Access | Roles: owner (everything), manager (orders + stock). No "marketer" role |

**Promo codes**: fields — code, source (blogger, Instagram, channel), % or fixed, max discount, expiry, min order total, total limit, per-customer limit, new-customers-only, `startapp` link. One discount per order; computed on items excluding delivery; free-delivery threshold uses the total **after** promo discount; not applied to marked-down items unless enabled.

**Promo report**: link opens (app opens via the code's `startapp`) · fulfilled orders (paid, "Доставлен", with code) · customers / new customers (unique phones / first fulfilled order) · total before discount (items of fulfilled orders, no delivery) · discount · net sales (before − discount) · average check (net / fulfilled) · conversion (fulfilled / opens; hidden for codes without a link). Filters: period, source, code. Excel export. No profit (no cost data).

## §8 Delivery
- Single warehouse in **Termez** (Surkhandarya). Only BTS postal delivery nationwide. No pickup, no Tashkent courier.
- 14 regions, price per region `[to fill]`, ETA "до 48 часов" after handover to BTS, **free from 250 000 сум**. *Superseded: delivery goes to a BTS pickup point, at a flat 25 000 сум. See "Changes agreed after TZ v1.11".*
- Manager enters the BTS tracking number manually; no BTS API in stage 1. Delayed order → customer sees tracking number + "Написать менеджеру".

## §9 Technical requirements
- Validate Telegram `initData` signature on the server. **Only the server computes prices and totals.**
- Domain, hosting, bot, DB are registered to the customer, who gets all access. Source code handed over as a repo with a run guide.
- Daily DB backup.
- Receipts in private storage; accessible only to owner and managers.
- Personal data per Uzbekistan law; recommended to host in Uzbekistan (final call by customer's lawyer).
- Data-processing consent on first order, incl. birthday.
- Stock reservation inside a DB transaction — two people can't buy the last unit.
- Errors and staff action log are persisted.
- Customer owns fragrance names, descriptions, photos and rights to them.
- Asl Belgisi digital marking for perfume `[check with accountant]`; separate agreement if mandatory.
- Stage 2: stock/sales sync with REGOS.

## §10 Stages and acceptance
- **Stage 1 (MVP), 14 calendar days** from project start + receipt of the "day 1" materials (§11): everything above — catalog, card, search/filters, cart, Discovery set, set builder + 20% set discount, reviews, broadcasts, full reports, Uzum button, checkout, BTS delivery, card payment with receipt check, bot, orders group, admin (products, orders, Excel import), promo codes + report, birthday, RU/UZ, both themes.
- **Stage 2**: REGOS, bonuses / cashback.

| Days | Dates (day 1 = 2026-11-07) | Result |
|---|---|---|
| 1–2 | 11-07 – 11-08 | Screens approved, server, bot |
| 3–7 | 11-09 – 11-13 | Catalog, search, stock, cart, registration, set builder |
| 6–10 | 11-12 – 11-16 | Catalog + checkout demo; checkout, payment & receipts, statuses, Telegram group, orders panel, Excel import |
| 9–11 | 11-15 – 11-17 | Promo codes, birthday, set discount, reviews, broadcasts, reports, admin panel |
| 12–14 | 11-18 – 11-20 | Testing, data load, training, launch |

**Acceptance checklist**: test orders to 3 regions via BTS with tracking entry · payment: confirm, reject, re-upload, reserve auto-cancel · 30 search queries · Discovery set and Uzum button · builder: set saved after "Доставлен", discount fires once, reminders at 7 and 1 days, delivery threshold computed before discount · review question + 1–3 rating in group · broadcast · promo: valid, expired, exhausted · birthday coupon arrives exactly once · report numbers match a manual calculation over 20 test orders · iPhone + Android, light + dark · both languages. Customer reviews the build within `[3 working days]`; no remarks = accepted.

**Warranty**: 60 days of bug fixes after launch (bug = deviation from TZ); critical (orders failing) response ≤ 24 h.

## §12 Developer answers (stack and hosting)
- Stack: **React + Vite** (Mini App), **grammY** (bot), **NestJS + PostgreSQL + Redis** (server), **Next.js** (admin).
- Hosting paid by customer; target: Tashkent VPS 4 vCPU / 4 GB / 100 GB SSD (~$59/mo, PRO-DATA). Domain yearly. Total ~$60–70/mo. No other paid services in stage 1 (the AI receipt provider would be extra, pay-per-use).

## Changes agreed after TZ v1.11

Customer decisions from the project chat. They override the TZ sections they name.

- **2026-11-06 — Delivery (§3.6, §8).** BTS delivers to a **BTS pickup point** ("BTS punktigacha"), not to the door. Delivery costs a **flat 25 000 сум for every region**. Keep the region → price table as an admin setting with every row at 25 000, so per-region pricing can return without code changes. Free delivery from 250 000 сум is unchanged. BTS point selection and address fields: see the 2026-11-07 entry below.
- **2026-11-07 — Humo credit feed (§4 AI auto-verification, steps 3–4).** Humo notifications don't reach a group. They arrive as messages from the official Humo bot in **the customer's own Telegram account**. A userbot (mtcute session logged into that account) therefore listens **only to the Humo bot chat** and forwards each notification to a group. Our recommendation: it also writes the parsed credit straight into our DB, so matching doesn't depend on re-reading the group. Sample notification (values anonymised), with 3 inline buttons under it:
  ```
  💸 To'lov
  ➖ 75.750,00 UZS
  📍 CLICK P2P HUMO2UZCAR
  💳 HUMOCARD *1234
  🕓 20:54 22.06.2025
  💰 1.234.567,89 UZS
  ```
  Lines: type, signed amount (`.` thousands, `,` tiyin), counterparty, card mask, `HH:MM DD.MM.YYYY` Tashkent time (no seconds), balance after. This sample is a debit ("➖"), and debits are ignored. **No operation id and no sender name**, so the TZ's strongest match signal is missing. Matching relies on amount + time + card last-4, and two same-amount payments inside the time window will go to manual review.
- **2026-11-07 — Stage 1 clock started.** Day 1 = 2026-11-07, day 14 = 2026-11-20 (dates in the §10 plan above).
- **2026-11-07 — Account phone (§3.6, §3.4, §3.8). Internal decision, not from the customer.** The customer's phone comes only from Telegram "share contact", mandatory on the first order, unique per customer. A typed phone is the recipient's phone for BTS pickup and grants no rights. See ADR 0004.
- **2026-11-07 — Returns and refunds (§4, §6, §7). Internal decision.** New terminal status «Возвращён» after «Доставлен» (whole order came back, set in admin only, reason required, per-line back-to-stock flag). Refund is a separate money record on any paid order, may be partial, never changes status. See ADR 0006.
- **2026-11-07 — Free-delivery threshold base (§3.4, §7). Internal decision.** The base ("before" or "after" the discount) is an admin setting per discount source. Defaults: upgrade right (set and 10 ml) before, promo code after, birthday coupon after (to confirm). The nudge "add N so'm" uses the base of the discount currently applied and comes from the server quote.
- **2026-11-07 — Promo code counting (§7). Internal clarification.** "New customers only" = the customer has no other non-cancelled order (awaiting payment, delivered and returned all count). The report's "new customers" metric keeps the TZ definition (first fulfilled order). Total and per-customer limits count non-voided uses; a cancelled order voids its use. Codes are case-insensitive, trimmed, unique, stored upper-case. Expiry = 23:59:59 Asia/Tashkent on the given date. An invalid prefilled code shows its reason in the cart and never blocks the order; the link's source attribution is kept.
- **2026-11-07 — Statuses (§4, §6). Internal decision.** One linear order status; receipts are separate records with their own verdict ("Ручная проверка" is a receipt verdict, the customer sees «Чек на проверке»). «Принят» = manager confirmed the bottles are on the shelf. The customer may cancel their own order in the app only while «Ожидает оплаты». See ADR 0011.
- **2026-11-07 — Payment matching (§4 reconciliation table). Internal decision.** No unique per-order amount. AI confirms when receipt amount = unclaimed Humo credit amount = order total, recipient card is the shop's, and times are within the match window. With several fitting credits the closest in time is taken (TZ said: manual). Goal: no human in payment confirmation. Accepted risk recorded in ADR 0012.
- **2026-11-07 — Receipt without a credit (§4). Internal decision.** Not sent to a manager (TZ said: manual after 10 min). After the wait window (default 2 h) the receipt is marked "payment not found", the order returns to «Ожидает оплаты» and the customer is asked to re-upload; if the reserve has run out the order is cancelled. Timers pause while Humo is silent or the userbot is down. Only a manager can reject. See ADR 0012.
- **2026-11-07 — Receipt AI (§4 steps 6–7, confidence row). Internal decision.** TypeSafe, with OpenAI Decisions as fallback. No field extraction: the AI answers yes/no questions (is a receipt, amount = order total, recipient = shop card) and picks the receipt's date-time among candidate credits. Thresholds are admin settings (P ≥ 0.8, choice confidence ≥ 0.6) instead of "90% per field". PDF/WebP are converted to PNG/JPEG before sending. See ADR 0013.
- **2026-11-07 — Payment details (§4, §5). Internal decisions.** Receipts sent to the bot attach to the customer's only open order, otherwise the customer picks the order by button; JPG/PNG/PDF/WebP ≤ 10 MB. Duplicate receipts (SHA-256 or perceptual hash already on another order) skip the AI, are tagged «Повторный чек» with an info post in the group, and follow the "payment not found" path. New: the bot reminds N hours (default 2) before a reserve auto-cancels if no receipt was uploaded. Payment screen: card number and amount with copy buttons, holder, order number, «Оплатите до …», upload; checkout is closed while no card is set.
- **2026-11-07 — BTS point selection (§3.6, §3.7, §8). Internal decision; closes the question left open on 2026-11-06.** We keep a BTS points table (code, region, city/district, address, landmark, hours, active), seeded once from the public bts.uz offices page and fully managed in the admin panel (owner and manager: add, edit, hide). Checkout: region → city/district → point, with search; «Не нашёл свой пункт» falls back to region + free text, flagged on the order. The delivery region comes from the point. Remaining fields: recipient name and phone, BTS point, comment; street, house and map pin are dropped. Profile "saved addresses" become "Мои пункты BTS" (recipient + point). The order snapshots the point (code, address).
- **2026-11-07 — Cart (§3.3, §3.5, §3.7). Internal clarification.** The cart is server-side, per customer (same on phone and Desktop), and holds the chosen discount and any link-prefilled promo code. Lines: volume × qty, Discovery set × qty, builder set (5 fragrances) × qty; qty never exceeds available; sold-out lines stay flagged «Нет в наличии» and are left out of the quote. «Купить сейчас» opens a one-item checkout and leaves the cart untouched. «Повторить заказ» adds the old lines at current prices, skipping what is unavailable («2 из 3 товаров добавлены»). The cart never expires; prices are re-quoted on every open.
- **2026-11-07 — Orders group (§6). Internal decision.** The "Lummi" group becomes a supergroup with topics: Заказы, Поступления (Humo forwards), Отзывы (ratings 1–3), Системные (alerts, payment not found, duplicate receipts); the bot follows `migrate_to_chat_id`. An order is posted when its payment is confirmed, not at creation (TZ said instantly; unpaid orders stay in admin). One card message per order, edited on every change (status, items, discount, total, BTS point, recipient, customer link, comment, history «✅ Принят — <name>, 14:32»); the receipt is a reply to it. Buttons show only the next step plus «Отменить»: «Передан в BTS» asks for the tracking number by ForceReply, «Отменить» asks for a TZ reason and a confirmation. Callback data carries the expected current status, so a second press gets «Уже изменено». Owner alerts go to Системные and to the owner's DM.
- **2026-11-07 — Customer messages and broadcasts (§5, §7). Internal decision.** Write access is requested with `requestWriteAccess()` in the same step as sharing the contact on the first order; refusing doesn't block the order (statuses stay visible in the app, customer flagged `bot_blocked`). Messages, in the customer's language with 1–2 emoji: order created, receipt received, payment confirmed / receipt rejected (reason), Собирается, Передан в BTS (tracking), Доставлен, Отменён (reason), payment not found, reserve reminder, set-discount reminders at 7 and 1 days, birthday coupon, review request. No message for «Принят». Each carries «Открыть заказ» (web_app) and, where useful, «Написать менеджеру». Broadcasts (owner only): RU + UZ text, optional image and `startapp` button; audience all / RU / UZ; «Отправить себе» test first; each customer gets their language; result counts sent / blocked / failed. Reviews per TZ; ratings 1–3 go to the Отзывы topic.
- **2026-11-07 — Source code (§9).** The customer doesn't need the repository handed over (per Sardor); it stays a private repo with us. The customer still gets the run guide and all access to their server, bot and domain. See ADR 0026.
- **2026-11-07 — Excel import/export (§7). Internal decision.** We write the template `LUMMI_Katalog.xlsx` (`exceljs`): sheets Ароматы (internal code, name, original brand, type, family, season, time of day, longevity, sillage, RU/UZ description, RU/UZ «Когда носить», three key notes, notes by level, similar fragrances by internal code, internal remark, aliases, Uzum link, hit/new, hidden; the last five fields added 2026-11-07 with the customer's guide), Объёмы (internal code, volume, price, sale price and end, on hand), Справочник (families, notes RU/UZ). Upsert by internal code; nothing is deleted by import (hide via the column). A dry run shows new/changed counts, row/column errors and on-hand vs reserve warnings; «Применить» writes everything in one transaction or nothing. Photos are uploaded per volume in admin, not via Excel. Catalog export uses the same template; orders, reviews and reports export per TZ. The seed file (the customer's 67-fragrance guide converted into this template) doubles as the customer's example.
- **2026-11-07 — Gift certificates deferred to v1.1.** The customer asked for e-gift certificates sent through Telegram (see `docs/open-questions.md` → Deferred). Not in stage 1; orders keep an amount due separate from the total so they fit later (ADR 0012). The customer agreed («вторым этапом») and is waiting for our price and timeline.
- **2026-11-07 — Design approved (§2 theme, §3.1–§3.5, §5 reviews).** The customer chose Nurmuhammad's variant 2 with elements of variant 1 (chat msg 26, reply to `LUMMI_Vybor_dizaina.pdf`). The PDF, page renders, verbatim reply and a "what comes from where" table are in `design/approved/`; how it combines with our mockups is in `DESIGN.md`. It overrides:
  - **Theme (§2).** Light by default. Variant 2's dark theme (dark fabric on Home) is the additional theme, switched in Profile and saved per customer. Telegram's `colorScheme` no longer decides (our reading of «по умолчанию — светлая», Sardor 2026-11-09). The dark theme is approved, so our dark tokens are no longer provisional.
  - **Opening and Home (§3.1).** No welcome screen: the app opens on Home. Home has, top to bottom:
    - a top block with a fabric photo, the logo and the slogan «Ароматы, которые освещают»;
    - the delivery city and the profile icon;
    - the search field «Название или нота»;
    - a dark Discovery set banner;
    - «Популярное» (= top sales) with chips Все / Homme / Femme / Unisex over a two-column grid;
    - «Новинки» with «Все →».

    There is **no banner slider**, and the Homme / Femme / Unisex / Наборы quick sections become chips. The RU/UZ switch lives only in Profile.
  - **Delivery city on Home (our reading).** The customer picks region + city from our BTS list. It is saved per customer, preselects the BTS point picker at checkout and labels delivery in the cart («Доставка BTS, Ташкент»). It never changes the price (flat tariff).
  - **Catalog (§3.2).**
    - Two-column grid with large photos.
    - Type chips as photo circles: Все / Homme / Femme / Unisex / Наборы.
    - Filters: family, volume, price, season. Sort, default «Топ продаж». Counter «Найдено: N».
    - Each card: 2–3 notes under the name, «+», and a heart.
  - **Favourites (new, not in the TZ).** The heart on list cards and the fragrance card adds the fragrance (or set) to the customer's favourites, kept on the server. The list lives in Profile → «Избранное» (our default; the design doesn't show the list).
  - **Fragrance card (§3.3).**
    - Large photo with heart and share.
    - Characteristics as **icons**: longevity, sillage, season, time of day.
    - Longevity reads «до 24 часов» / «24 soatgacha» everywhere.
    - Volume tiles 10 / 30 / 50 ml with the price under each.
    - Notes pyramid, then the reviews block.
    - «Купить на Uzum», «В корзину», «Купить сейчас».
  - **Cart (§3.5).**
    - A dark totals block (items, promo code, delivery, total) with «Оформить заказ» inside.
    - A bin button next to the quantity.
    - The free-delivery bar with 10 ml suggestions, as in our first mockup (`design/mockups` cart).
    - Delivery stays flat 25 000, free from 250 000.
  - **Tab bar.** Dark and floating, labelled Главная / Каталог / Корзина / Заказы / Профиль. Sets are reached through the Home banner and the «Наборы» chip.
  - **Reviews (§5 "Publishing", bracket resolved: show).** Published reviews show on the product card with rating and photos, in a block under the notes. Our defaults, to confirm with the customer:
    - After the rating and optional comment, the bot accepts up to 3 optional photos.
    - A review is **published only after staff approve it**, since customer text can carry banned words («копия», «оригинал»).
    - A published review shows on the cards of every fragrance and set in that order. The card shows the average rating and count.
    - Ratings 1–3 still go to the «Отзывы» topic.
  - **«Это подарок» at checkout (agreed separately with the customer).** Gift packaging, a greeting card, no receipt in the parcel. Our defaults, to confirm:
    - free of charge;
    - optional greeting text (RU/UZ as typed);
    - the order is flagged as a gift for the managers (group card, admin order page).
- **2026-11-07 — Full catalog guide and bottle photos (§3.2, §3.3, §7).** The customer sent the guide for all **67** fragrances (chat msg 28; `materials/catalog/`, field mapping in its README) and photos for all of them in 10 / 30 / 50 ml (msg 27; `materials/flakons/`). It brings new fields:
  - «Когда носить» (when to wear), RU/UZ;
  - exactly three key notes (list cards, name block);
  - 4 curated similar fragrances per fragrance;
  - an internal remark (admin only).

  Decisions:
  - Families are the guide's 29 RU/UZ families, which closes the families question.
  - Sillage, season and time of day use the guide's value sets.
  - **Longevity:** the guide gives 10 / 12 / 16 / 24 h per fragrance, but every fragrance shows «до 24 часов» per the customer's design instruction and the bottle photos (Sardor, 2026-11-09). Longevity stays an admin field.
  - **«Похожие ароматы» (internal decision):** the curated similar fragrances first, then same family and type, available only, up to 6.
  - Deep-link slugs follow the fragrance name in ASCII kebab case (`p_guidance`, not the brand).

  Still missing: prices, stock, Uzum links, the Discovery set composition.
- **2026-11-06 — Free-delivery nudge (§3.5).** The customer wants an Uzum-style prompt. Example: a 10 ml costs 69 000, so the cart tells the customer to add N so'm more for free delivery to the BTS point. Shown in the cart, and optionally on the product card or as a mini-bar, until the 250 000 threshold is reached. The threshold follows the same discount rules as §3.4 and §7. The customer left the UX to us ("uyog'ini o'zingiz qilib ko'rasiz").
- **2026-11-06 — Payment card.** The card isn't opened yet. Ship with an empty or placeholder card, editable by the owner in admin (§4).
- **2026-11-06 — Prices.** Use placeholder prices until the customer confirms real ones, expected after 2026-11-09. That includes the Discovery set.
- **2026-11-06 — Photos.** Bottle photos stay as delivered (Russian text baked in), and the gallery switches with the selected volume. Details in `CLAUDE.md` → Design tokens.
- **2026-11-06 — Theme** follows Telegram (customer: "Standart rejim"). **Superseded 2026-11-07** by the design approval: light by default, dark switched on in Profile.
- **2026-11-09 — Receipt AI keys and result (ADR 0013, ticket #7). Internal decision.** `TYPESAFE_API_KEY` is required in production; `OPENAI_API_KEY` is optional everywhere. Without it the fallback fails as `not-configured`, and a receipt TypeSafe cannot confirm waits for a person. The judge returns an explicit `confirmed`, true only when a provider's answer passed the probability and confidence thresholds (settings `ai.receipt.*`); callers act on nothing else. Receipt uploads (#28) must downscale images to 280-1568 px per side before the AI call, since TypeSafe rejects anything outside that range.
- **2026-11-09 — Sign-in defaults (internal decision, ADR 0029).** `initData` freshness window 300 s, clock-skew bound 30 s, customer session lifetime 3600 s; all three are settings (`auth.initDataMaxAgeSeconds`, `auth.initDataMaxFutureSkewSeconds`, `auth.sessionTtlSeconds`). After the session expires the Mini App signs in again with the `initData` it holds; if that is older than the window the customer must reopen the app from Telegram. Language is set from `language_code` on first sign-in only (`uz` gives UZ, else RU); later sign-ins refresh name and username but never overwrite the language the customer chose. The Mini App refreshes the session (`POST /auth/refresh`, Bearer) before it expires, proactively and on resume; only an expired session falls back to `initData`, and if that is stale the app asks the customer to reopen it from Telegram. Money text uses U+202F (narrow no-break space) both for thousands and before the unit: `100 000 сум`.
- **2026-11-09 — Pricing details left open by ADRs 0002, 0007 and 0008 (§3.4, §3.5, §3.8, §7). Internal decision, ticket #5.** `quote()` reads them this way:
  - **Automatic choice.** Without an entered code, an entitlement is applied only when it makes the total incl. delivery *lower* than no discount. One whose discount brings delivery back (an "after" base dropping below 250 000) and doesn't save more stays unused, so the customer keeps it; it is still offered as an alternative. Equal totals go to the soonest expiry, then the lowest id (then the type), never to the order the entitlements happen to be loaded in.
  - **Switch.** The customer's chosen discount (an entitlement, or the entered code) is applied while it still discounts the cart, even when it costs more. If it no longer does (used, expired, not covering anything in the cart, code below its minimum), the quote falls back to the automatic choice and flags it (`staleChoice`). The entered code stays listed as an alternative when the customer switches away from it. **Entering a promo code clears any stored discount choice**, because a typed code is always applied (ADR 0002); a choice the customer makes after that wins until the code changes. `quote()` honours whatever choice it is given, so the cart clears it.
  - **Alternatives.** Every other discount that would discount the cart, cheapest total first, each with its delivery fee, total and how much cheaper it is than the applied one. The «выгоднее на … сум» hint takes that figure from the server.
  - **Promo code checks in `quote()`.** The minimum is compared with items before discount (sold-out lines out, marked-down items in), without delivery; reaching it exactly counts. A code below its minimum, or with no eligible items (say, every item marked down and the code lacks "applies to marked-down"), is not applied and says why (`below_minimum`, `no_eligible_items`). The automatic choice then runs and no use is held. The checks needing the DB (unknown, expired, exhausted, not a new customer) stay with the promo ticket.
  - **Amounts.** Percentages are whole numbers 0–100. A fixed code larger than the eligible items stops at them; delivery is still charged by the base. When two covered full-size units cost the same, the upgrade right discounts the one on the first cart line.
  - **Delivery.** Free when the base is at or above the threshold. A cart with nothing billable (empty, or every line sold out) costs 0, delivery included.
  - **Nudge.** «Добавьте N сум» is the smallest whole N for which items + N bring the applied discount's base to the threshold. Under an "after" base a % or fixed discount grows with what is added (counted as if all of it were discountable, so adding N of anything reaches the threshold), up to its cap: with 10% off 260 000 the nudge is 17 777, not 16 000. An upgrade right discounts one unit, so its discount doesn't grow; under a "before" base the discount is ignored.
  - **Markdown end.** «до <дата>» means the end of that day, 23:59:59 Asia/Tashkent, the same rule as promo expiry. Admin stores that instant in `sale_ends_at` and `quote()` receives it: the markdown is active up to and including it, and the regular price applies from 00:00 the next day.
  - **Settings.** `pricing.freeDeliveryThreshold` (250 000), `pricing.thresholdBase` per source (upgrade right by its source: set before, 10 ml before; promo after; birthday after), `pricing.discountsApplyToMarkedDown` (upgrade right off, birthday off), `pricing.fullSizeVolumesMl` (30, 50; never 10 ml). An entitlement brings its own percent (and the birthday coupon its cap), so the rights and birthday tickets decide whether those are fixed at issue or read live from their settings.
- **2026-11-09 — Profile preferences and Mini App shell (§2 theme, §3.1; internal decision).** Language and theme are saved per customer through `PATCH /me/preferences` (`{ language?, theme? }`, audited as `customer.preferences_changed`); `GET /me` returns both. A new customer starts with `theme = light`. The app opens in the saved language and theme; on a device that has never signed in it guesses the language from `language_code` and the theme is light. The Home slogan «Ароматы, которые освещают» is «Lahzalaringizni yorituvchi iforlar» in UZ, as in Brandbook v2.0 p.02. `startapp` values `home`, `catalog`, `cart`, `orders`, `profile` map to the tab routes; anything else opens Home.
- **2026-11-09 — Humo credit intake (§4; refines the 2026-11-07 Humo credit feed). Internal decision, ticket #13, ADR 0031.**
  - **Humo messages.** The userbot posts every message of the Humo bot chat (text + `message_id`), and the API decides what each one is (term in `GLOSSARY.md`). A message reports a card operation when it has exactly one line starting with ➕ or ➖.
    - ➖ is a debit. It is ignored and nothing of it is stored, because the customer's own spending stays out of our DB.
    - ➕ becomes a credit only when its amount, time and card fit the template below. The type, «📍» counterparty and «💰» balance lines are not required.
    - Every other message is stored, flagged with a reason, and alerts the owner. The reasons are `not_an_operation` (no ➕/➖ line), `amount`, `time` and `card`.
  - **Raw text.** Every stored message keeps its raw text exactly as posted, the «💰» balance line included. The balance is never parsed, copied into a column or used. The alert names the `message_id` and the reason but never quotes the text, because a Humo message can carry anything (a code, a balance) and alerts go to the Системные topic.
  - **What the parser accepts.** Anything outside these variants is refused, never guessed.
    - Lines may come in any order, with `\n` or `\r\n` endings, surrounding spaces and an emoji variation selector (U+FE0F).
    - Amount line: `➕`, optional spaces, the amount, at least one space, `UZS`.
      - The amount has thousands separated by `.`, space, no-break space or narrow no-break space (one kind throughout, groups of three), or no separator at all.
      - It may end in `,` and exactly two tiyin digits, or have no tiyin part (`99.000 UZS`).
      - It must be above zero. «75,750.00», «75.75», another currency, and a second ➕ or ➖ line are refused.
    - Time: one line anywhere holding `HH:MM DD.MM.YYYY` (two-digit hour and minute, no seconds, four-digit year) that is a real date and time. The clock emoji in front doesn't matter.
    - Card: exactly one line starting with `💳` and ending in `*1234` or `* 1234` (four digits). The whole line after the emoji is kept as the card mask.
    - Counterparty: the first `📍` line, if any.
  - **Amount.** Kept exact in tiyin. The whole-so'm amount that matching compares is empty when a credit has tiyin, so such a credit never confirms an order automatically and stays unlinked for a manager.
  - **Time.** `HH:MM DD.MM.YYYY` is read as Asia/Tashkent (UTC+5, no DST) and stored as UTC.
  - **Idempotency.** Intake is idempotent on `message_id`. A repeat records nothing, raises no alert and queues no event. A flagged message is not re-parsed when the parser is fixed, since a re-post counts as a duplicate. Re-parsing flagged messages is a later admin or developer action.
  - **"Credit recorded" event.** It follows the ADR 0021 pattern.
    - The credit row is written in the intake transaction and serves as the event.
    - It is queued to BullMQ right after the commit.
    - A worker sweep queues anything missed.
    - Handlers registered with `CreditEvents.onCreditRecorded` run in the worker, at least once each, so they must be idempotent.
  - **For payment matching (#32).**
    - Only credits whose card last 4 digits equal the shop card's are candidates. The account that receives the notifications may hold other cards.
    - Humo times have minute precision, so "arrived after the order was created" must be compared at the minute. Otherwise a payment made within the order's own minute is missed.
  - **For the userbot (#19).**
    - Post the messages in `message_id` order, and retry each one until it gets a 2xx before posting the next. After a restart, catch-up resumes after the highest stored `message_id`, so a gap left by a failed post would never be filled.
    - Debits aren't stored, so a few may be posted again after a restart, which is harmless.
    - In a user account, message ids are one sequence across all private chats. They stay unique only while the userbot stays on one Telegram account. Moving it to another account requires clearing the stored Humo messages first, or the new account's lower ids would be skipped as already seen.
    - Send a heartbeat every minute. The API keeps the last one for the Humo-silence guard (ADR 0012).
- **2026-11-09 — Messaging backbone (§5, §6). Internal decision.** Every bot message, including the /start greeting, goes through the transactional outbox: the row is written in the caller's transaction and, right after the commit, queued to BullMQ, so a reply arrives within about a second; the worker's one-minute tick is only the safety net (Redis down, a crash after commit). /start in a private chat creates the customer if new and greets in the saved language (Telegram `language_code` only for a new customer) with a «Открыть магазин» `web_app` button, clears `bot_blocked`, and sets that chat's menu button in the same language. `my_chat_member` `kicked` sets `bot_blocked`, `member` clears it. Group chat id, topic thread ids (Заказы, Поступления, Отзывы, Системные) and alert recipients are settings `bot.groupChatId`, `bot.topics`, `bot.alertRecipients`; alerts are in Russian. A sweep failing `worker.sweepFailureAlertAfter` (3) ticks in a row alerts the owner once. Processed `update_id`s are kept 72 h. A send claims its row first (`sending_at`); a claim or queue stamp older than `outbox.requeueAfterSeconds` (300) is retaken. Delivery is at-least-once only for a crash between Telegram accepting a message and our `sent_at` stamp.
- **2026-11-09 — Admin sign-in (§7, §9, ADR 0017). Internal decision.** Staff sign in with the Telegram Login Widget; the API checks the signature (HMAC with SHA-256 of the bot token) and `auth_date` freshness, then sets an httpOnly, SameSite=Lax cookie (Secure in production) holding a random token; only its hash is stored, so a session can be revoked. Lifetimes are settings: `auth.loginWidgetMaxAgeSeconds` 300, `auth.staffSessionTtlSeconds` 7 days (clock skew reuses `auth.initDataMaxFutureSkewSeconds`). Anyone not active in the staff table gets «Нет доступа» (403). The owner adds managers by Telegram id and name, deactivates (all sessions of that manager end at once), reactivates and removes them; owners are never touched in the panel, only seeded by `npm run seed:owner -- --telegram-id <id> --name "<name>"`. A removed manager's audit entries keep their id; the removal entry stores the name and Telegram id. Every change and every sign-in is audited with the staff actor.
- **2026-11-09 — Dev-only admin sign-in. Internal decision.** `ADMIN_DEV_LOGIN=true` enables `POST /admin/auth/dev {telegramId}`, which signs in an active staff member without the widget (the Login Widget only works on a domain set with BotFather `/setdomain`, which only Sardor can do). The env schema throws at boot when it is combined with `NODE_ENV=production`; the endpoint answers 404 when off. It is for local dev and tests only and is off in every deploy.
- **2026-11-09 — BTS points, regions and tariffs (§3.6, §8). Internal decisions (ticket #11).** Regions are 14 reference rows; each carries its delivery tariff (`regions.delivery_tariff`, all 25 000), edited by the owner only and audited as `region.tariff_changed` (old and new). The points come from a one-off, re-runnable import of the public bts.uz offices page (one request per region, 2 s apart); the parsed result is committed as `apps/api/src/bts/bts-points.snapshot.json` (403 points) and `npm run bts:import` loads it, idempotent by `code`. A re-run only adds new codes and never touches existing rows, so staff edits and hidden points survive; `--refresh` rewrites the BTS-published fields but never `active`. Point text (city, address, landmark, hours) stays as BTS publishes it (Russian) in both UI languages; region names are RU/UZ. A hidden point is never offered; a city with no offered point disappears from the picker. The customer's delivery city (region + city, from the offered list) is saved per customer and audited; it preselects the picker and never changes a price. Search folds case and «ё», matches name, city, address and landmark, and returns at most 50.
- **2026-11-09 — BTS tariffs and the delivery city, clarifications (ticket #11 review).** The per-region delivery tariff is owner-edited, audited data (`regions.delivery_tariff`), the deliberate per-region exception to "every rule value is a setting"; it is not a settings key. Ticket #18 (cart) names the delivery city in the cart's delivery line («Доставка BTS, <город>»). Ticket #23 (checkout) persists the typed «Нет вашего пункта? Укажите адрес вручную» fallback on the order, flagged as typed.
- **2026-11-09 — Registration step (§3.4, §5). Internal decision, see ADR 0032.** One bottom sheet asks for the Telegram contact (`requestContact`) and then for bot write access (`requestWriteAccess`). Checkout opens it through `useRegistration().ensurePhone()` and awaits `'ready' | 'cancelled'`. The server verifies the signed contact payload and that it is the signed-in user's own; a typed or body-supplied phone is never accepted. Refusing write access is recorded (`customers.write_access = refused`, `bot_blocked`) and never blocks ordering. Browsing and the cart work without a phone; order creation requires it (checkout ticket). Profile shows the account phone, and lets a customer without one start the step.

- **2026-11-09 — Fragrance card from the seed catalog (§3.3). Internal decisions.** (1) The card endpoint (`GET /catalog/fragrances/:slug`) returns each translatable field as a RU/UZ pair and the Mini App picks by the customer's language, so switching language needs no refetch. Value sets (sillage, season, time of day, type) travel as codes; their RU/UZ labels live in `packages/i18n` (miniapp). (2) The server judges a markdown against the clock at request time, so it reverts by itself; it sends `price`, active `salePrice`, `salePercent`, `saleEndsAt`, `effectivePrice` and `available` (on hand minus reserve; the reserve is 0 until order lines exist). (3) The card opens on the smallest volume in stock (all sold out: the 10 ml one); a sold-out volume stays selectable and says «нет в наличии». (4) The fragrance card hides the tab bar (a task screen) and shows its dock in its final shape, «В корзину · <цена>» and «Купить сейчас»; the cart ticket (#18) and the purchase shortcuts ticket (#25) wire them. (5) `p_<slug>` opens `/p/<slug>`; an unknown or hidden slug shows «Аромат не найден» with «В каталог». (6) The seed loads all 67 fragrances, 29 families and 145 notes from `materials/catalog/` (`npm run seed:catalog`), with placeholder prices 69 000 / 149 000 / 219 000 and stock 20 flagged `is_placeholder`; it never overwrites a price or stock changed since. The internal code is the guide id (`001`…`067`), the internal remark is the guide's RU note. (7) Photos: `FileStore` keys `public/<hash16>-<400|800|1200>.webp` (hash of the source bytes), source kept under `originals/`; the API serves them for dev and tests, Caddy does in production (ADR 0020). The Mini App reads `VITE_MEDIA_URL` (default `/api/media/public`) and `VITE_BOT_LINK` (default `https://t.me/Lummiuz_bot`, the base of share links).
- **2026-11-09 — Photo originals. Internal decision.** The seed keeps the repo's WebP files (`materials/flakons/`, WebP q90 at full size) as its originals under `originals/`; the PNG originals stay in `materials/_archives/LUMMI_FLAKONS_67.zip`. A photo uploaded in the admin keeps its own original bytes, whatever the format.
- **2026-11-10 — Server-side cart (§3.5; internal decisions, ticket #18).** (1) The cart is `carts` (one row per customer: the chosen discount and the prefilled promo code) plus `cart_lines` (customer × volume × qty, unique per volume; set lines — Discovery set, builder set — come with #22). `GET /cart`, `POST /cart/lines {slug, ml, qty}`, `PATCH /cart/lines/:id {qty}`, `DELETE /cart/lines/:id` all answer with the whole cart and a fresh Quote. (2) A line stores what the customer asked for; the read caps the quantity at available (on hand − reserve), so a restock brings the wish back. An add above available is capped, one with nothing available is 409 `sold_out`. A line whose fragrance is hidden stays, flagged like a sold-out one. (3) Delivery fee: the saved delivery city's region tariff, else the setting `delivery.defaultTariff` (25 000). Checkout (#23) uses the chosen point's region. (4) Suggestions come with the cart while the nudge is positive: up to `cart.suggestionsLimit` (setting, default 3) available 10 ml volumes not in the cart whose current price (markdown through the one markdown rule, active up to and including its end instant) is at least the amount still needed, so «Подойдёт любой аромат 10 мл» is always true; when none can close the gap the thread shows only «ещё N сум до бесплатной доставки». (5) "Top sellers first" is one definition (`topSellersOrder` in the catalog): owner-pinned (Хит) first, then the newest, until #15 adds paid-order counts. (6) The Sage thread's fill is an integer 0–100 sent by the server (`freeDeliveryProgress`; 100 once reached or when the threshold is 0). The Mini App renders no money arithmetic. (7) The fragrance card dock keeps «В корзину · <цена>»: every tap adds one unit, capped at available; success is a Telegram haptic and the tab-bar count, a capped add shows «Осталось N» briefly. A cart line whose wish exceeds available says «Осталось N». The totals block shows the applied discount and its source whenever the quote carries one. (8) The tab-bar count is units that can be bought (sold-out lines do not count). (9) `CartService.setPromoCode` upper-cases the code and clears the stored choice; `setDiscountChoice` is for the discount tickets; neither has an endpoint yet. (10) Relink (`moveCustomerData`): lines of the same volume add up, the older cart keeps its own code and choice and only fills missing ones. (11) «Оформить заказ» opens a placeholder (`/checkout`) until #23. (12) Every cart row and suggestion names the original in the caps attribution («ПО МОТИВАМ <BRAND>» / «<BRAND> ASOSIDA») above the name. (13) A line holds at most 99 (`CART_MAX_QTY`), whatever is in stock; the dock says «Не больше 99 шт.» then, «Осталось N» when stock is the limit, and «Добавлено в корзину» after every successful add (Telegram Desktop has no haptics).
- **2026-11-10 — Admin catalog (§7, ticket #17).** Internal decisions: (1) Catalog content is owner-only; on hand is the one field a manager may also change (`PATCH /admin/volumes/:id/on-hand`, audited with the actor as `catalog.on_hand_changed`). (2) The product code is handed out by the server (next free number, three digits) and is shown only in the panel. The slug comes from the name at creation and never changes. (3) A sale end date is a Tashkent calendar day and means 23:59:59 that day; a sale price must be strictly below the price and an end date needs a sale price. (4) Photos go up as raw bytes (JPEG, PNG or WebP by magic bytes, at most 10 MB, at least 400×533); the original is kept and the 3:4 WebP set is rendered. (5) Every content change calls one function, `onCatalogContentChanged`, inside its transaction: the seam where #16 plugs in `reindexFragrances`. (6) A content save never overwrites on hand behind the owner's back (ADR 0010): the form sends the count it loaded; the server writes a changed count only if the stored one still equals it, otherwise answers 409 «Остаток изменился, пока вы редактировали. Обновите страницу.»; an untouched count is never written. (7) A count below the reserve is allowed (a physical count is ground truth) and flagged, available shows 0. (8) Admin search ignores apostrophe variants on both sides. **TZ amendment, pending the customer's confirmation:** a volume, once added to a fragrance, cannot be removed in the admin; hiding the fragrance is the way to take it off sale (TZ §7 does not say; see `docs/open-questions.md`).
- **2026-11-10 — Search (§3.2). Internal decisions.** (1) `fragrance_search` holds one Latin-skeleton document per fragrance (name, aliases, brand, notes RU/UZ, family); the seed and `syncSearchIndex` at API start keep it current, and the admin catalog ticket must call `reindexFragrances` in the same transaction as any change. (2) Ranking tiers: exact name/alias, then word prefix of name/alias, then a whole-word match in brand/notes/family, then weighted `word_similarity`. Weights, minimum similarity (0.3), minimum length (2), suggest limit (5) and results limit (30) are settings `search.*`. (3) The Mini App route is `/search?q=&s=1`; Enter submits and shows result cards, typing shows suggestions (150 ms debounce). (4) The 30 control queries (`apps/api/test/search-control-queries.ts`) are provisional (hard on purpose: Cyrillic for Latin names, all four apostrophes, digraphs, two-letter typos); CI requires 27 of 30. (5) The server says when a text is too short (`tooShort` in the suggest/search response; the minimum is counted on the skeleton, so `'a` is one letter), and the client never hard-codes the minimum. (6) The index is rebuilt by `reindexFragrances(tx, ids?)` in the transaction of every catalog content change (#17 must call it) and, as a safety net, by a full compare-and-rewrite at API start (not in the worker), under an advisory lock. (7) Scope: #16 builds the `/search` screen and points Home's existing search disc at it; the «Название или нота» field on Home and the search field on the Catalog land with #15, which builds those screens.

## Appendix — app texts (drafts)
About, FAQ, Returns, Delivery & payment drafts in RU + UZ are in the TZ appendix (last page of the txt dump). Public offer comes from the customer's lawyer. Returns draft: damaged / leaking / wrong item → contact within `[3]` days with a photo → replacement or refund; opened perfume of proper quality is not returnable.
