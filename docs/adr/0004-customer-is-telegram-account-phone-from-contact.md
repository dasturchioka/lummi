# A customer is a Telegram account; the account phone comes only from shared contact

TZ §3.4/§3.8 key set rights and the birthday guard to the phone ("one phone = one account") but also allow typing the phone at checkout. A typed phone is unverified, so anyone could claim another person's upgrade rights or collect a birthday coupon per invented number. We identify a **Customer** by their Telegram account (the `initData` user id), and all orders and entitlements hang on it. The **Account phone** is set only from Telegram's shared contact (`requestContact`, verified server-side), is unique across customers, and sharing it is mandatory on the first order. The phone typed at checkout is the **Recipient**'s phone for BTS pickup: it defaults to the account phone, may differ (a gift), and grants nothing.

If a verified phone already belongs to a customer with another Telegram id (the person moved to a new account), the customer record is relinked to the new id and the relink is audit-logged; the phone verified by Telegram wins.

This is an internal deviation from TZ §3.6, recorded in `docs/spec.md` → Changes.
