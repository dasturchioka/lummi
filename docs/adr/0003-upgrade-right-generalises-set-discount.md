# The set discount is one case of a general "upgrade right"

TZ §3.4 grants a 20% full-size discount after a delivered set. We model that as an **Upgrade right** with a source, so the same machinery also covers a single 10 ml bottle: a delivered set opens one right covering its five fragrances; a delivered 10 ml bottle opens one right covering that fragrance (one right per fragrance per order, however many 10 ml bottles of it were bought). Both sources share the lifecycle: the right opens when the source order reaches «Доставлен», lives N days, discounts one 30 or 50 ml bottle once, and is restored if the order that used it is cancelled within the validity. Percentage, validity and an on/off switch are separate admin settings per source.

The 10 ml source is our proposal (2026-11-07), outside the TZ. Uzum Market has no comparable mechanism (its seller tools are timed markdowns, store promo codes and marketplace campaigns), so only the display follows Uzum: struck-through old price, new price, a label. The 10 ml source ships **switched off** until the customer approves it; see `docs/open-questions.md`. Only purchases made in the Mini App count; Uzum and store sales are invisible to us.

## Considered Options

- **A separate "repeat purchase" discount** — rejected: a second lifecycle, expiry job and reminder flow for the same idea.
- **A promo code restricted to returning customers (Uzum-style)** — rejected: cannot express "the fragrance you already tried", and needs manual broadcasting.
