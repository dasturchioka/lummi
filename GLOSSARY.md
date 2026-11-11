# LUMMI shop

Telegram Mini App shop for LUMMI. perfumes: customers pick a fragrance and volume, pay by card transfer with a receipt, and managers confirm the payment and ship through BTS.

## Language

### People

**Customer**:
A person identified by their Telegram account. Holds orders and entitlements; can order once they have shared their account phone.
_Avoid_: User, client, account, buyer

**Account phone**:
The customer's phone as shared from Telegram (verified, unique per customer). The key for "one phone = one account".
_Avoid_: Login, contact phone

**Recipient**:
The person who collects an order at the BTS point, with a name and phone typed at checkout. Defaults to the customer; may be someone else.
_Avoid_: Receiver, consignee

### Catalog

**Fragrance**:
A LUMMI perfume, identified by its name and inspired by («по мотивам») one original. Never identified by a number.
_Avoid_: Product (too broad), SKU, aroma No., копия

**Volume**:
One bottle size of a fragrance (10, 30 or 50 ml) with its own price, stock and photo.
_Avoid_: Variant, size, SKU

**Note**:
A scent ingredient shown on a fragrance, placed at a level: top, heart or base.
_Avoid_: Ingredient, component, accord

**Family**:
The olfactory group of a fragrance (woody, floral, fresh, …), used by filters and "similar fragrances".
_Avoid_: Category, type (type means Homme / Femme / Unisex)

**Favourite**:
A fragrance or set the customer marked with the heart. Kept per customer on the server and listed in Profile → «Избранное».
_Avoid_: Wishlist, bookmark, like

**Review**:
A customer's rating (1–5) for a delivered order, with an optional comment and photos. Private until staff publish it; a published review shows on the cards of the fragrances and sets in that order.
_Avoid_: Feedback, testimonial, comment

**Set**:
Five different fragrances in 10 ml sold as one item at one price: the Discovery set or a builder set.
_Avoid_: Kit, bundle, sampler, gift box

**Discovery set**:
The ready-made set whose five fragrances the owner chooses; a pre-packed box.
_Avoid_: Starter set, sample set

**Builder set**:
A set whose five fragrances the customer picks; priced the same as the Discovery set.
_Avoid_: Custom set, own set

### Stock

**On hand**:
Units physically in the Termez warehouse, as counted by staff.
_Avoid_: Stock, остаток, inventory

**Reserve**:
Units held by orders that are neither handed to BTS nor cancelled.
_Avoid_: Booking, hold, allocation

**Available**:
On hand minus reserve: what a customer can still order.
_Avoid_: Stock, in stock

### Money

**Quote**:
The server-computed price breakdown of a cart: lines, at most one discount, delivery fee and the total payable. The customer sees it as «Итого» / «Jami».
_Avoid_: Calculation, estimate, cart total

**Discount**:
The single price reduction on an order's items, taken from exactly one discount source: an upgrade right, a promo code, or a birthday coupon. Never applies to delivery.
_Avoid_: Sale, markdown, bonus

**Entitlement**:
A discount source the customer holds in their profile and that applies without typing anything: an upgrade right or a birthday coupon.
_Avoid_: Reward, bonus, voucher

**Promo code**:
A discount source the customer enters (or gets prefilled by a link); it carries the marketing source it is attributed to.
_Avoid_: Coupon, voucher

**Markdown**:
A temporary lower price on a volume, shown with the regular price struck through. It is a price, not a discount.
_Avoid_: Sale discount, уценка-скидка

**New customer**:
For promo-code eligibility: a customer with no non-cancelled order other than the current one.
_Avoid_: First-time buyer (that is the report metric: first fulfilled order)

**Fulfilled order**:
An order that reached «Доставлен» and was not returned. Reports count only these.
_Avoid_: Completed, closed, successful order

**Upgrade right**:
A customer's one-time right to a discount on one full-size bottle of a fragrance they already received in 10 ml. Opened by a delivered set (covers its five fragrances) or a delivered single 10 ml bottle (covers that fragrance).
_Avoid_: Set discount right, loyalty discount, repeat-purchase discount

**Birthday coupon**:
A customer's entitlement to a percentage off the items of one order, issued once per birthday year at 10:00 Tashkent a few days before their birthday and valid until a few days after it. Needs the date of birth, which the customer enters once.
_Avoid_: Birthday discount, birthday promo code, gift

**Full size**:
A 30 ml or 50 ml bottle. The 10 ml bottle is not full size.
_Avoid_: Big bottle, flakon

### Delivery

**BTS point**:
A BTS branch where the recipient collects the parcel. Chosen from our list, or typed by the customer when missing.
_Avoid_: Address, filial, pickup point, отделение

**Saved point**:
A recipient and BTS point pair remembered from the customer's orders («Мои пункты BTS»), offered first at checkout. Forgetting one never touches an order.
_Avoid_: Saved address, address book, favourite point

**Region**:
One of Uzbekistan's 14 delivery regions (incl. Tashkent city and Karakalpakstan); decides the delivery fee. Taken from the BTS point.
_Avoid_: Oblast, area, zone

### Orders and payment

**Order**:
A customer's purchase from creation to its end state. It has exactly one status at a time, from «Ожидает оплаты» to «Доставлен», «Отменён» or «Возвращён».
_Avoid_: Purchase, transaction, checkout

**Buy now**:
«Купить сейчас»: ordering one item (a volume or a set, quantity 1) straight from its card, without the cart, which stays as it was.
_Avoid_: Quick buy, express checkout, one-click order

**Snapshot**:
What an order froze at creation: its lines with names, volumes, prices and quantities, the discount, the delivery region, BTS point (or typed address) and fee, the threshold base, the total and the amount due. Later price, catalog or point edits never change it; reports read only it.
_Avoid_: Copy, order history, archived order

**Gift order**:
An order the customer marked «Это подарок» at checkout: gift-packed, with an optional greeting card text and no receipt in the parcel. Not a gift certificate (that is a deferred means of payment).
_Avoid_: Present, gift certificate, gift card

**Receipt**:
A customer's proof of a card transfer (screenshot or PDF) uploaded for an order. One order may have several; at most one is accepted.
_Avoid_: Check, чек (in code), payment proof, fiscal receipt

**Amount due**:
The part of an order's total the customer must transfer to the shop card. Equals the total in stage 1.
_Avoid_: Payable, balance, sum to pay

**Shop card**:
The one card customers transfer the amount due to, shown on the payment screen with its holder. Only the owner sets, changes or removes it, and every change is audited with the number masked. While none is set, checkout is closed («Оплата временно недоступна»).
_Avoid_: Requisites, реквизиты (in code), the customer's card

**Humo message**:
A message from the official Humo bot in the account that receives the shop card's notifications, as the userbot posts it to the API. One with a ➕ line becomes a credit; one with a ➖ line (a debit) is ignored and not stored; anything else is stored raw and flagged.
_Avoid_: notification (in code), Humo notification, SMS

**Credit**:
An incoming transfer to the shop card, as reported by the official Humo bot. Can be linked to at most one order.
_Avoid_: Payment, transaction, поступление (in code), notification

**Candidate credit**:
A credit that could pay a given order: on the shop card (same last 4 digits), not linked to any order, same amount as the order's amount due, arrived after the order was created.
_Avoid_: Possible match, suggestion

**Payment not found**:
A receipt verdict: no fitting credit arrived within the wait window. The order goes back to «Ожидает оплаты»; it is not a rejection.
_Avoid_: Rejected, failed payment

**Wait window**:
How long a receipt waits for a candidate credit before it becomes payment not found (a setting, 2 h by default). Time during a payment pause does not count, and the order's reserve is extended by it too.
_Avoid_: Timeout, check deadline

**Payment pause**:
A stretch of time when the Humo feed is down while receipts wait: the userbot's heartbeat is stale, or no credit has arrived for too long while a receipt waits for its money. Every receipt timer stops; it ends only when a heartbeat or a credit proves the feed alive. The owner is told once it has lasted a few minutes, and again when it ends.
_Avoid_: Outage (in code), freeze

**Repeat receipt**:
A receipt that is the same as one already accepted, or as one sent earlier for another order: the same file, or (when the owner enables it) a look-alike image. The first and the later receipt are both duplicates and never reach the AI; the later one, the repeat receipt, becomes payment not found at once, marked «Повторный чек», while the first waits for a person.
_Avoid_: Fake receipt, copy

**Manual review**:
A receipt verdict meaning AI could not confirm it and a manager must decide. Not an order status.
_Avoid_: Ручная проверка as a status, escalation

**Payment state**:
Where an order's money stands, as the admin shows it beside the status: unpaid, a receipt under check, a receipt in manual review, or paid. Paid once a payment was confirmed, whatever came after, so a cancelled paid order still reads paid (a refund is owed). Derived, not stored.
_Avoid_: Payment status (there is one order status), оплачен as a status

**Reject reason**:
Why a manager turned a receipt down: one preset the customer reads as a sentence in their language (amount differs, not the shop card, transfer not received, unreadable, not a receipt), optionally with a note in the manager's words, or «другая причина», where the note is the reason. Only a manager rejects (ADR 0013).
_Avoid_: Rejection comment, decline reason

### Order outcomes

**Cancellation**:
Ending an order before it reaches «Доставлен», always with a reason. Returns its stock and its discount source.
_Avoid_: Return, refund, rejection

**Return**:
A delivered order that came back as a whole; the order ends as «Возвращён».
_Avoid_: Refund, cancellation, exchange

**Refund**:
Money sent back to the customer's card for a paid order, recorded with amount and date. May be partial; never changes the order's status.
_Avoid_: Return, chargeback, compensation

### Marketing

**Campaign link**:
A tracked Mini App link created in admin, with a target screen, an optional promo code and a source.
_Avoid_: Deep link (generic), UTM, referral link

**Source**:
The marketing channel a campaign link belongs to: Instagram, the Telegram channel, a store QR stand, a blogger.
_Avoid_: Channel (clashes with the Telegram channel), referrer, utm_source
