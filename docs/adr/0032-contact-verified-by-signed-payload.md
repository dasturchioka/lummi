# The account phone is verified from the signed `requestContact` payload

`Telegram.WebApp.requestContact` answers the Mini App with `contact=<json {user_id, phone_number, first_name}>&auth_date=<unix>&hash=<hex>`. The `hash` is computed with the bot token exactly like initData (HMAC-SHA256, key = HMAC("WebAppData", bot token), sorted `key=value` lines). The Mini App sends that raw string to `POST /me/contact` as `proof`; the server (`verifyContactProof`) accepts a phone only when all of these hold:

1. the signature is valid for our bot token (so the number cannot be edited or invented);
2. `auth_date` is within the same freshness window as initData (settings `auth.initDataMaxAgeSeconds` and `…MaxFutureSkewSeconds`);
3. `contact.user_id` equals the Telegram id of the customer behind the session (so another user's genuine, signed contact is rejected with 403).

A phone sent as a plain field is never read: the body schema has only `proof`. The number is stored as `+` and digits (E.164), unique per customer.

We do not also read the contact message the bot receives in the private chat. It would be a second path to the same fact, with its own pitfalls (a user can attach any contact card), and the signed payload already binds phone, user and time. Clients too old for `requestContact` (Mini Apps below 6.9) get a "update Telegram" message in the registration sheet.

**Relink (ADR 0004).** If the verified phone belongs to another customer, that older customer takes over this Telegram id: the fresh record created at sign-in is deleted (it only exists because this id just opened the app), the older one keeps its orders, rights and settings, and `customer.relinked` is audited with both Telegram ids. The response then carries a new session for the relinked customer, which the Mini App adopts. Tickets that hang rows on `customers` (cart, orders) must account for the merged-away record: at sign-in time it can hold only a cart, so they should delete or move it in `setVerifiedPhone`.

**Write access.** `requestWriteAccess` answers only on the client, so `POST /me/write-access {allowed}` is the customer's own report, not a proof. That is fine: it can only reduce what we send. `refused` sets `bot_blocked` (statuses stay in the app); `granted` clears it. `/start` clears the flag as before.
