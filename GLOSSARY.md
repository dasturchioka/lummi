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

**Promo gift**:
The one item a gift promo code adds to the order free: a Volume or the Discovery set the owner chose, quantity 1 («Подарок по промокоду» / «Promokod sovgʻasi»). It is the order's one Discount: nothing comes off the paid items, and the reports count its regular price as the discount. Not a Gift order.
_Avoid_: Gift (that is the Gift order), free sample, bonus, present

**Markdown**:
A temporary lower price on a volume, shown with the regular price struck through. It is a price, not a discount.
_Avoid_: Sale discount, уценка-скидка

**New customer**:
For promo-code eligibility: a customer with no non-cancelled order other than the current one.
_Avoid_: First-time buyer (that is the report metric: first fulfilled order)

**First-time buyer**:
The report metric «новые покупатели»: a customer for whom one of a report row's orders is their first Fulfilled order ever, by the day it was delivered. A returned first order makes the next one their first.
_Avoid_: New customer (that is promo-code eligibility), new client

**Fulfilled order**:
An order that reached «Доставлен» and was not returned. Reports count only these.
_Avoid_: Completed, closed, successful order

**Net sales**:
«Чистые продажи»: the items before discount of Fulfilled orders, less their discounts and the Refunds sent for them. Delivery is never part of it. The average check leaves the Refunds out: items before discount less discounts, per Fulfilled order.
_Avoid_: Revenue (an Order profit's revenue is before Refunds), turnover, profit (see Order profit), выручка

**Upgrade right**:
A customer's one-time right to a discount on one full-size bottle of a fragrance they already received in 10 ml. Opened by a delivered set (covers its five fragrances) or a delivered single 10 ml bottle (covers that fragrance).
_Avoid_: Set discount right, loyalty discount, repeat-purchase discount

**Birthday coupon**:
A customer's entitlement to a percentage off the items of one order, issued once per birthday year at 10:00 Tashkent a few days before their birthday and valid until a few days after it. Needs the date of birth, which the customer enters once.
_Avoid_: Birthday discount, birthday promo code, gift

**Full size**:
A 30 ml or 50 ml bottle. The 10 ml bottle is not full size.
_Avoid_: Big bottle, flakon

**Step-up**:
The next larger Volume of the same fragrance that can be bought, offered under the volume tiles with what the customer saves by taking it («С 30 мл экономия 58 000 сум»). The saving is the bigger Volume priced at the chosen Volume's price per ml, less its own price, in whole thousands rounded down. It is offered when the saving is at least a setting's percent, and when the customer's Upgrade right prices neither volume. A nudge, not a Discount: it changes no price.
_Avoid_: Upsell, upgrade (that is the Upgrade right), bigger-bottle discount

### Cost

**Unit cost**:
What one bottle or one set costs the shop to make, computed by the server from the cost settings and the fragrance's Oil price: liquid with the filling loss, bottle, label, spray, filling work, box and QR card (neither for 5 ml; one set box and one card for a whole set), plus the defect percent of all of it («Себестоимость» / «Tannarx»). Whole so'm. No Oil price, no unit cost.
_Avoid_: Price, cost price of the order (that is the order's goods plus order costs), purchase price

**Oil price**:
So'm per gram of a fragrance's perfume oil as the supplier's invoice reads, before the supplier discount. The discount and the delivery to Termez are settings applied on top.
_Avoid_: Oil cost, Landed oil price (that is after the discount and delivery), price per ml

**Landed oil price**:
What a gram of a fragrance's oil really costs the shop: its Oil price less the supplier discount, plus the delivery to Termez (both settings). The oil in a Unit cost is costed at it; the fragrance page shows it («Масло после скидки поставщика и доставки»). Computed by the server, never stored.
_Avoid_: Oil price (that is the invoice's, before the discount), net price, purchase price

**Tier**:
The oil grade a fragrance is bought at, as the invoice names it: TOP, PREMIUM or PREMIUM NEW. Admin only.
_Avoid_: Category, class, level, quality

**Order costs**:
What a sale costs the shop besides its goods: on the Mini App the BTS mailer, BTS's charge less what the customer paid for delivery, and the online-payment %; on Uzum its commission %; on both the ad per sale, the tax % and a gift sample when one goes in («Расходы на заказ» / «Buyurtma xarajatlari»). Settings, computed by the server.
_Avoid_: Expenses, overhead (rent and salaries are the planner's fixed costs), delivery fee (that is what the customer pays)

**Order profit**:
An order's revenue (items less the discount, without delivery) less its goods at Unit cost and its Order costs; its margin is profit ÷ revenue («Прибыль» / «Foyda»). Refunds are not taken off it.
_Avoid_: Net sales (that is revenue less refunds), markup, margin (that is the ratio)

**Cost snapshot**:
An order's Unit cost per line and its Order costs as they were when its payment was confirmed, kept in the order: later Oil prices and settings never change its Order profit. None before the payment, and none while a line's fragrance has no Oil price.
_Avoid_: Current cost, recalculated profit

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

**Order card**:
The one message per paid order in the orders group's «Заказы» topic: what to fulfil, the history, and buttons for the next step or a cancel. Posted when the payment is confirmed and edited in place on every change.
_Avoid_: Order post, group message, ticket

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

**Free credit**:
A credit that may still pay an order: no order holds it and it is not marked not for an order. The credits list's «Не привязано» and the admin Home's «Поступления без заказа» are the free credits.
_Avoid_: Unlinked credit (a marked credit is unlinked too), open credit

**Candidate credit**:
A free credit that could pay a given order: on the shop card (same last 4 digits), same amount as the order's amount due, arrived after the order was created.
_Avoid_: Possible match, suggestion

**Not for an order**:
A mark staff put on an unlinked credit that is not shop money, such as a personal transfer to the shop card («Не для заказа»), with an optional note. A marked credit is no longer free: it is never a candidate credit, is offered for no order, and leaves «Не привязано» and «Поступления без заказа». The mark is never put on a linked credit; to link a marked credit, staff first take the mark off («Вернуть в поступления»). Every mark and unmark is audited with the actor.
_Avoid_: Ignored credit, personal credit, hidden credit

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

**Acquiring link**:
The campaign link that brought a customer to the shop: the first one they opened, while they were still a New customer. A customer who had already ordered (an order not cancelled) before opening any link has none.
_Avoid_: First touch, referral link
