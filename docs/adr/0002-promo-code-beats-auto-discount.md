# An entered promo code beats the automatically chosen discount

An order gets at most one **Discount**. A valid **Promo code** that the customer typed, or that a `startapp` link prefilled, is always the applied discount, even when one of the customer's **Entitlements** (set discount right, birthday coupon) would make the order cheaper. The cart then lists the cheaper alternative with its total and a one-tap switch («Скидка за набор выгоднее на … сум»). Without a promo code, the server picks the entitlement that gives the **lowest total payable including delivery**, not the largest discount: the free-delivery threshold is computed before a set discount but after a promo discount, so a smaller discount can be cheaper overall. Ties go to the entitlement that expires first. The choice is stored with the cart and re-validated by every quote.

Explicit choice wins because a blogger's code has to stay on the order. Otherwise the promo report loses the attribution the blogger is paid on.

## Considered Options

- **Always auto-pick the cheapest discount** — rejected: silently drops blogger attribution and overrides what the customer chose.
