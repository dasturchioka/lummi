# Prices are computed only on the server, by one pure quote function

The Mini App never computes money, not even optimistically or for the free-delivery nudge: every cart change asks the API for a **Quote**. The quote function is a pure function in the API's pricing module (inputs: cart lines, current prices, the customer's discount entitlements, the chosen discount, settings; no DB access), and shared packages export only the `Quote` type, so no client can import the logic. Order creation recomputes the quote inside the same DB transaction as the stock reservation; if the total differs from the one the customer last saw (price edited, promo exhausted, entitlement expired), the order is refused with 409 and the customer confirms the new total, because they will transfer exactly that amount to the card. The order stores an immutable snapshot (per line: name RU/UZ, volume, unit price, qty; discount type, source and amount; region, delivery fee, threshold base, total). Later price or setting changes never touch it, and reports read only the snapshot.

## Considered Options

- **Shared pricing package, client computes optimistically, server re-checks** — rejected: two call sites that can drift, and the customer could see a total that the server then silently changes before they transfer money.
