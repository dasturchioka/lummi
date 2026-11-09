# The account phone is verified from the signed `requestContact` payload

`Telegram.WebApp.requestContact` answers the Mini App with `contact=<json {user_id, phone_number, first_name}>&auth_date=<unix>&hash=<hex>`. The `hash` is computed with the bot token exactly like initData (HMAC-SHA256, key = HMAC("WebAppData", bot token), sorted `key=value` lines). The Mini App sends that raw string to `POST /me/contact` as `proof`; the server (`verifyContactProof`) accepts a phone only when all of these hold:

1. the signature is valid for our bot token (so the number cannot be edited or invented);
2. `auth_date` is within the same freshness window as initData (settings `auth.initDataMaxAgeSeconds` and `…MaxFutureSkewSeconds`);
3. `contact.user_id` equals the Telegram id of the customer behind the session (so another user's genuine, signed contact is rejected with 403).

A phone sent as a plain field is never read: the body schema has only `proof`. The number is stored as `+` and digits (E.164), unique per customer.

We do not also read the contact message the bot receives in the private chat. It would be a second path to the same fact, with its own pitfalls (a user can attach any contact card), and the signed payload already binds phone, user and time. Clients too old for `requestContact` (Mini Apps below 6.9) get a "update Telegram" message in the registration sheet.

**Relink (ADR 0004).** If the verified phone belongs to another customer and the record behind the session is fresh (no phone yet), the older customer takes over this Telegram id and this chat's state (`bot_blocked`, `write_access`), and the fresh record is merged away. Everything hanging on a customer moves in one place, `moveCustomerData(tx, fromId, toId)` in `customers.service.ts`; tickets that add customer-owned tables (cart #18, orders) extend it. A record that already has its own phone is never absorbed: the answer is 409 `phone_taken` (the sheet tells the customer to write to the manager). The relink is audited as `customer.relinked`, and the response carries a session for the relinked customer.

**Sessions are bound to the Telegram id.** The session JWT carries `tg`, and the guard (and so `/auth/refresh`) requires the customer row's `telegram_id` to still equal it. After a relink the abandoned account's token gets 401 everywhere; opening the app from that account creates a new, separate customer.

**Concurrency.** Two verifications of one phone race on the unique index; the loser's transaction is retried (on 23505, deadlock or serialization failure) and then takes the relink or no-op branch, so the caller never sees a 500.

**Write access.** `requestWriteAccess` answers only on the client, so `POST /me/write-access {allowed}` is the customer's own report, not a proof. It changes `write_access` only. `bot_blocked` stays bot-observed (a 403 or `my_chat_member` kicked; cleared by `/start` or `member`), so a client-reported grant never hides a real block. The outbox does not send to a private chat when `write_access = 'refused'` or `bot_blocked`, so statuses stay in the app. `/start` is the customer opening the chat themselves: it clears both flags.
