# Open questions, missing inputs, conflicts

Living list. Remove an item once it is resolved and record the answer where it belongs (`CLAUDE.md` decisions, `docs/spec.md`, or code/config). Last synced with the project chat: 2026-11-07.

## Conflicts in the received materials

1. **Brandbook page reference.** TZ §2 says "стр. 11 — токены интерфейса"; in Brandbook v2.0 the UI tokens are on p.8 (section 07), p.11 is the back cover. Cosmetic: TZ should be updated.
2. **Logo pack name.** TZ refers to `LUMMI_logo_8K.zip`; received `LUMMI_Logo_Pack.zip` (SVG + PNG ≤ 2000 px). SVGs are vector, so this is sufficient.

## Customer inputs: received vs missing

Received (in `materials/`): TZ v1.11, Brandbook v2.0, logo pack, 15 bottle photos (5 fragrances × 10/30/50), Discovery set box photo, 5 sample descriptions (`docs/catalog-sample.md`), answers: app language = Telegram language; theme = "standart".

Asked the customer for the items below on 2026-11-06 (chat msg 524878). Answers so far are marked inline. That message asked only for card number + holder. Whether the card must belong to an IP/LLC and who verifies payments were not asked. We write the catalog Excel template ourselves (`docs/spec.md` → Changes, 2026-11-07). Develop on seed data per `docs/catalog-sample.md`.

Missing — **day 1** (blocks the 14-day clock):
- Optional: a BTS API token (`docs.bts.uz`, bearer auth) would let us sync our BTS point list later (2026-11-07).
- Recipient card — **the card isn't opened yet** (2026-11-06). Build with a placeholder; the owner sets and changes the card in admin (TZ §4: owner-only, audit-logged). Still unasked: must it belong to an IP/LLC, and who verifies payments.
- `LUMMI_photos.zip`: bottle photos beyond the 5 seed fragrances.

Missing — **day 3**:
- Full catalog in Excel: names, notes pyramid, family, RU/UZ descriptions, prices per volume, stock, Uzum links.
- Prices for the 5 sample fragrances and the Discovery set — customer will know them after a Tashkent trip on Monday 2026-11-09 (box/packaging costs still unknown). Until then use placeholder prices of our choosing; the customer's own example was 10 ml ≈ 69 000 сум.
- 30 control search queries (agreed by both sides).

Missing — **day 11**: About / FAQ / Returns texts (drafts exist in TZ appendix), public offer (lawyer), final stock.

Also asked on 2026-11-05 and not yet answered: **home-page banner images (1–2) and banner text**.

## Our proposals awaiting customer approval

- **Upgrade right from a single 10 ml bottle** (2026-11-07, ADR 0003). A delivered 10 ml bottle gives a one-time discount on a 30/50 ml bottle of the same fragrance, like the set discount. Outside the TZ, so it ships switched off. Ask the customer: on or off, percentage (set source is 20%), validity (set source is 30 days). Free-delivery threshold for it defaults to "before discount", like the set source.

- **Tell the customer about our TZ deviations** (2026-11-07, via Nurmuhammad). The internal decisions in `docs/spec.md` → Changes alter visible behaviour: status «Возвращён» and refunds; customer can cancel an unpaid order; orders reach the group only once paid; group topics; fully automatic payment matching and "payment not found" instead of manual review; account phone only via Telegram contact; BTS point list instead of street address. None needs approval to build, but acceptance runs against the TZ.

## Bracketed values to confirm (TZ placeholders)

- Discovery set price (expected after 2026-11-09).
- Card disclaimer text: «Аромат LUMMI по мотивам, не оригинальный парфюм» (+ UZ version).
- Birthday coupon: max discount (so'm) and free-delivery threshold base. Our defaults (2026-11-07): threshold computed **after** the coupon, like a promo code; cap 100 000 so'm (placeholder). Both are admin settings; confirm with the customer.
- Reviews shown on product card: yes / no.
- Defaults to confirm: top-sales window 30 d, reserve 12 h, review delay 24 h, receipt-unchecked alert 15 min, match window 5 min, AI thresholds (now P ≥ 0.8 for predicates, confidence ≥ 0.6 for the date-time choice, ADR 0013), no-credit wait 2 h (TZ had 10 min to manual review; ADR 0012), Humo-silence alert 30 min, review period 3 working days, returns window 3 days.
- "Working hours" (used by several alerts) — not defined anywhere.
- Fragrance families list (TZ gives examples only).
- Fiscal receipt procedure and Asl Belgisi marking — customer's accountant.
- Receipt retention period (customer's lawyer). Receipts are personal data (payer name, card mask); until answered we keep them for the life of the order. Storage, DB and backups stay in Uzbekistan (Personal Data Law art. 27-1, ADR 0020).
- Hosting: PRO-DATA Tashkent VPS, domain name.
- Receipt AI (decided 2026-11-07, ADR 0013: TypeSafe, fallback OpenAI Decisions). Still needed: API keys for both on the customer's accounts (customer pays per use); TypeSafe pricing (not on its docs); 20–30 real receipts from different bank apps (Click, Payme, Uzum Bank, Humo, …) to tune the thresholds.
- Humo userbot (see `docs/spec.md` → Changes 2026-11-07). Needed before payment auto-verification (days 6–10):
  - Which Telegram account receives the Humo notifications for the shop card? The card isn't opened yet.
  - A login session with the customer, who must enter the SMS code and 2FA password once.
  - A sample **incoming** (➕) notification, P2P transfer to the card. So far we only have a debit sample.
  - Whether a P2P fee is ever deducted from the **recipient** (credit < amount sent). Matching needs credit = order total exactly; check on the first test transfer.
  - What the 3 inline buttons under the notification do. If one opens a detailed receipt with an operation id, the userbot can read it and restore the strongest match signal.
- Off-site backup location inside Uzbekistan (ADR 0025): a separate PRO-DATA storage or a small second Uzbek VPS. Extra monthly cost for the customer; ask before launch.
- Customer action: convert the "Lummi" orders group (`-5579977857`, a basic group) to a supergroup with topics Заказы / Поступления / Отзывы / Системные, and add the bot as admin. The chat id becomes `-100…`; update `CLAUDE.md` then. The owner must also `/start` the bot to receive alerts in DM.
- Hosting + domain bought on the customer's name (TZ §9). Sardor will ask (2026-11-07). Needed for production only; the day 6–10 demo runs on staging on Sardor's VPS (ADR 0023).
