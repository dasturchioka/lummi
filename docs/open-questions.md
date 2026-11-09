# Open questions, missing inputs, conflicts

Living list. Remove an item once it is resolved and record the answer where it belongs (`CLAUDE.md` decisions, `docs/spec.md`, or code/config). Last synced with the project chat: 2026-11-09 (latest message 2026-11-07, msg 31).

## Conflicts in the received materials

1. **Brandbook page reference.** TZ §2 says "стр. 11 — токены интерфейса"; in Brandbook v2.0 the UI tokens are on p.8 (section 07), p.11 is the back cover. Cosmetic: TZ should be updated.
2. **Logo pack name.** TZ refers to `LUMMI_logo_8K.zip`; received `LUMMI_Logo_Pack.zip` (SVG + PNG ≤ 2000 px). SVGs are vector, so this is sufficient.

## Customer inputs: received vs missing

Received (in `materials/`): TZ v1.11, Brandbook v2.0, logo pack, 15 bottle photos (5 fragrances × 10/30/50), Discovery set box photo, 5 sample descriptions (`docs/catalog-sample.md`), answers: app language = Telegram language; theme = "standart" (superseded by the design approval: light by default).

Received 2026-11-07: **design approval** (variant 2 + elements of variant 1, `design/approved/`), **bottle photos for all 67 fragrances** in 10/30/50 ml (`materials/flakons/`), and the **full fragrance guide** (`materials/catalog/`: RU/UZ texts, notes by level, families, sillage, season, time, curated similar fragrances, note dictionary).

Asked the customer for the items below on 2026-11-06 (chat msg 524878). Answers so far are marked inline. That message asked only for card number + holder. Whether the card must belong to an IP/LLC and who verifies payments were not asked. We write the catalog Excel template ourselves (`docs/spec.md` → Changes, 2026-11-07). Develop on seed data per `docs/catalog-sample.md`.

Missing — **day 1** (blocks the 14-day clock):
- Optional: a BTS API token (`docs.bts.uz`, bearer auth) would let us sync our BTS point list later (2026-11-07).
- Recipient card — **the card isn't opened yet** (2026-11-06). Build with a placeholder; the owner sets and changes the card in admin (TZ §4: owner-only, audit-logged). Still unasked: must it belong to an IP/LLC, and who verifies payments.

Missing — **day 3**:
- Prices per volume, stock, Uzum links and the Discovery set composition. Texts, notes, families and photos for all 67 fragrances arrived on 2026-11-07.
- Prices for the 5 sample fragrances and the Discovery set — customer will know them after a Tashkent trip on Monday 2026-11-09 (box/packaging costs still unknown). Until then use placeholder prices of our choosing; the customer's own example was 10 ml ≈ 69 000 сум.
- 30 control search queries (agreed by both sides).

Missing — **day 11**: About / FAQ / Returns texts (drafts exist in TZ appendix), public offer (lawyer), final stock.

Home-page banner question (asked 2026-11-05): resolved by the approved design, which has a fabric-photo top block with the slogan and a Discovery set banner instead of a slider. Still needed from **Nurmuhammad**: the design source (Figma or similar; the PDF is raster only) and the full-resolution fabric photos for the Home top block, light and dark.

## Our defaults after the design approval (2026-11-07), to confirm with the customer

Recorded in `docs/spec.md` → Changes 2026-11-07 (design approved; catalog guide). We build these defaults; confirm through Nurmuhammad.

- **Reviews on the product card.**
  - Published only after staff approve them, because customer text can contain banned words. Is pre-moderation acceptable, or should reviews publish at once and be hideable?
  - Up to 3 photos, sent to the bot after the comment.
  - A review shows on every fragrance and set of its order.
  - Card block: average rating, count, latest published reviews.
- **«Это подарок».**
  - Is gift packaging free?
  - Is the greeting card text typed by the customer, and is there a length limit?
  - "без чека" = no price slip or receipt in the parcel: does this interact with the fiscal receipt procedure (accountant)?
- **Favourites.** Not in the TZ; it comes from the approved design (heart on cards). The list lives in Profile → «Избранное».
- **Delivery city on Home.**
  - Region + city from the BTS list, saved per customer.
  - Preselects the checkout point picker and labels delivery in the cart.
  - Never changes the price.
- **Theme.** Light by default; dark (variant 2) switched in Profile, saved per customer. Telegram's own theme is ignored.
- **Longevity.** Every fragrance shows «до 24 часов» per his design instruction, although his guide lists 10 / 12 / 16 / 24 h. If he wants the per-fragrance values, it's one Excel column.
- **«Похожие ароматы».** His curated 4 similar fragrances first, then same family and type, available only, up to 6.
- **Display names to confirm.**
  - «Sauvage EDT»: EDT names the original's concentration, while LUMMI sells Extrait de Parfum.
  - «Pink Molécule 090.09»: a number in the name, while LUMMI never shows fragrance numbers; it is the original's name.
  - «Rain Tea»: the guide notes it is sold as «Tea Storm» from 2026.
- **Banner slider dropped.** TZ §3.1 had an admin-managed banner slider; the approved Home has none. The Discovery set banner and the slogan are editable in admin instead.

## Deferred to the next version

- **Gift certificates** (customer request, 2026-11-07): a buyer pays for a certificate (100/200/300k or custom, 2–3 designs, wish, signed or anonymous), sends it to a friend via `savePreparedInlineMessage` + `shareMessage`, the friend claims it with their phone in the Mini App, and spends the balance at checkout in parts within 6 months; not combined with a promo code. Deferred to v1.1: outside the TZ, about 3–4 days, and it touches pricing, payment matching and reports. Stage 1 keeps the order's amount due separate from its total so it slots in later (ADR 0012). Message to the customer drafted 2026-11-07. The customer agreed to the second stage and **is waiting for our price and timeline** (2026-11-07, design reply). Action: Nurmuhammad.

## Our proposals awaiting customer approval

- **Upgrade right from a single 10 ml bottle** (2026-11-07, ADR 0003). A delivered 10 ml bottle gives a one-time discount on a 30/50 ml bottle of the same fragrance, like the set discount. Outside the TZ, so it ships switched off. Ask the customer: on or off, percentage (set source is 20%), validity (set source is 30 days). Free-delivery threshold for it defaults to "before discount", like the set source.

- **Tell the customer about our TZ deviations** (2026-11-07, via Nurmuhammad). The internal decisions in `docs/spec.md` → Changes alter visible behaviour: status «Возвращён» and refunds; customer can cancel an unpaid order; orders reach the group only once paid; group topics; fully automatic payment matching and "payment not found" instead of manual review; account phone only via Telegram contact; BTS point list instead of street address. None needs approval to build, but acceptance runs against the TZ.

## Bracketed values to confirm (TZ placeholders)

- Discovery set price (expected after 2026-11-09).
- Card disclaimer text: «Аромат LUMMI по мотивам, не оригинальный парфюм» (+ UZ version).
- Birthday coupon: max discount (so'm) and free-delivery threshold base. Our defaults (2026-11-07): threshold computed **after** the coupon, like a promo code; cap 100 000 so'm (placeholder). Both are admin settings; confirm with the customer.
- Defaults to confirm: top-sales window 30 d, reserve 12 h, review delay 24 h, receipt-unchecked alert 15 min, match window 5 min, AI thresholds (now P ≥ 0.8 for predicates, confidence ≥ 0.6 for the date-time choice, ADR 0013), no-credit wait 2 h (TZ had 10 min to manual review; ADR 0012), Humo-silence alert 30 min, review period 3 working days, returns window 3 days.
- "Working hours" (used by several alerts) — not defined anywhere.
- Fiscal receipt procedure and Asl Belgisi marking — customer's accountant.
- Receipt retention period (customer's lawyer). Receipts are personal data (payer name, card mask); until answered we keep them for the life of the order. Storage, DB and backups stay in Uzbekistan (Personal Data Law art. 27-1, ADR 0020).
- Hosting: PRO-DATA Tashkent VPS, domain name.
- Receipt AI (decided 2026-11-07, ADR 0013: TypeSafe, fallback OpenAI Decisions). Still needed: API keys for both on the customer's accounts (customer pays per use); TypeSafe pricing (not on its docs); 20–30 real receipts from different bank apps (Click, Payme, Uzum Bank, Humo, …) to tune the thresholds.
- Humo userbot (see `docs/spec.md` → Changes 2026-11-07). Needed before payment auto-verification (days 6–10):
  - Which Telegram account receives the Humo notifications for the shop card? The card isn't opened yet.
  - A login session with the customer, who must enter the SMS code and 2FA password once.
  - A sample **incoming** (➕) notification, P2P transfer to the card. So far we only have a debit sample. The parser (ticket #13) follows the documented layout strictly and alerts the owner on anything else. Add each real sample to `apps/api/test/fixtures/humo-notifications.ts`, where a test waits for the first ➕.
  - Whether a P2P fee is ever deducted from the **recipient** (credit < amount sent). Matching needs credit = order total exactly; check on the first test transfer.
  - What the 3 inline buttons under the notification do. If one opens a detailed receipt with an operation id, the userbot can read it and restore the strongest match signal.
- Off-site backup location inside Uzbekistan (ADR 0025): a separate PRO-DATA storage or a small second Uzbek VPS. Extra monthly cost for the customer; ask before launch.
- Customer action: convert the "Lummi" orders group (`-5579977857`, a basic group) to a supergroup with topics Заказы / Поступления / Отзывы / Системные, and add the bot as admin. The chat id becomes `-100…`; update `CLAUDE.md` then. The owner must also `/start` the bot to receive alerts in DM.
- Hosting + domain bought on the customer's name (TZ §9). Sardor will ask (2026-11-07). Needed for production only; the day 6–10 demo runs on staging on Sardor's VPS (ADR 0023).
