# One linear order status; receipts are separate records with their own verdict

TZ lists payment statuses and order statuses as two lists. Two independent fields would allow impossible pairs ("unpaid but assembling"), so an order has **one** status:

`Ожидает оплаты → Чек на проверке → Оплата подтверждена → Принят → Собирается → Передан в BTS → Доставлен → (Возвращён)`, plus `Отменён` from any state before `Доставлен`, and `Чек на проверке → Ожидает оплаты` when a receipt is rejected.

«Принят» means a manager confirmed the bottles are physically on the shelf (Uzum and store sales don't decrement app stock). Each upload is a **Receipt** record (file, hash, AI-read fields and confidence, matched credit, verdict: pending / AI-confirmed / manual review with reason / manager-confirmed / rejected with reason). An order may hold several receipts, and at most one is accepted. "Ручная проверка" is a receipt verdict, not an order status; the customer sees «Чек на проверке» either way.

Permissions: AI or a manager confirms payment; only a manager rejects, with a reason; managers move fulfilment one step at a time (a tracking number is required for «Передан в BTS»); managers/owner cancel with a reason, the system cancels on reserve expiry, and the customer may cancel their own order only while «Ожидает оплаты» (no money moved yet, stock frees at once; not in the TZ). Every transition goes through one API function with an allowed-transitions table, whether triggered from the bot or the admin panel, and is written to `order_events` (from, to, actor type and id, reason, time). Audit and customer notifications are driven from there.
