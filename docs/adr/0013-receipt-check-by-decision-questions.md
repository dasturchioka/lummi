# Receipts are checked with decision questions against known candidate credits, not by field extraction

The receipt AI is **TypeSafe** (Jev) with **OpenAI Decisions** (`gpt-6-luna`) as fallback. Both are decision APIs: they answer yes/no as a probability, pick one of given options, or score. Neither reads free-form values such as an amount or a time out of an image. We don't need extraction anyway. Code first selects **candidate credits** (unclaimed, amount equal to the order total, arrived after the order was created); with no candidate, no AI call is made and the receipt waits (ADR 0012). With candidates, one request asks:

- predicate: the image is a receipt of a successful card transfer;
- predicate: the amount transferred is exactly <order total> so'm;
- predicate: the recipient card ends in <last-4> or the recipient is <holder name>;
- choice: the transfer date-time on the receipt, among the candidate credits' times plus "none of these".

All predicates at or above the probability threshold and a non-"none" choice at or above the confidence threshold confirm the order with the chosen credit. Both thresholds are admin settings, defaulting to 0.8 and 0.6 (TypeSafe's choice confidence averages about 0.7, and confidence measures how concentrated the answer is, not whether it is right). They replace the TZ's "≥ 90% per field" and are tuned on 20–30 real receipts from different bank apps. The model's choice of credit replaces ADR 0012's "closest in time" tie-break.

The questions live once behind a `ReceiptJudge` interface. OpenAI Decisions is asked when TypeSafe errors, times out, refuses, or answers below threshold. Uploads are normalised to PNG/JPEG first (first page of a PDF rasterised, WebP converted), since TypeSafe accepts only PNG and JPEG and its image support is still experimental (opt-in header). The AI receives only the image, candidate amounts and times, the shop card last-4 and holder name — never the customer's phone or address.

## Considered Options

- **Claude Opus 5.5 extracting fields with structured outputs** — not chosen; the team prefers TypeSafe with OpenAI Decisions as fallback.
