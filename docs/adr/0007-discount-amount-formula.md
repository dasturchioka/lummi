# Discount amount formula: one unit for upgrade rights, caps, round down

TZ leaves the arithmetic open, so `quote()` fixes it:

| Source | Applies to | Amount |
|---|---|---|
| Upgrade right | the single most expensive unit among covered 30/50 ml lines | `unit price × %` |
| Birthday coupon | all items, no delivery | `items × %`, capped by the admin max amount |
| Promo code, % | eligible items | `eligible × %`, capped by the code's max discount |
| Promo code, fixed | eligible items | `min(fixed, eligible)`; the total never goes negative |

Every discount is rounded **down** to a whole so'm in one place (`quote()`), so prices and totals stay integers and rounding never favours the customer by a fraction. A promo code's minimum order total is checked against items before discount, without delivery. Several upgrade rights in one cart still give one discount per order (ADR 0002): the cheapest total wins, ties go to the right that expires first.
