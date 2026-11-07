# Money code is test-first; acceptance items become automated gates where possible

- **Unit (Vitest), test-first for money:** `quote()` as table-driven cases covering ADRs 0002, 0007, 0008, 0009 and the threshold bases (including the 260 000 example from the grilling session); the order transition table; the Humo parser on recorded real notifications; search normalisation.
- **Integration (Vitest + Testcontainers Postgres):** two concurrent orders for the last unit, where exactly one wins; hold and restore of rights, coupons and promo uses; promo limits; on hand vs reserve; matching against candidate credits with `ReceiptJudge` mocked; sweeps run twice send nothing twice.
- **Gates in CI:** the 30-query search check (≥ 27/30, ADR 0019), and the TZ report check: a 20-order fixture whose report figures must equal an independent calculation.
- **E2E (Playwright):** the Mini App in a browser with `initData` signed by a test bot token; happy path only (catalog → cart → checkout → receipt upload → confirmation).
- **AI eval:** 20–30 real receipts with expected verdicts, run by hand because it costs money, to tune the thresholds of ADR 0013; not in CI.
- **Manual acceptance:** the TZ §10 checklist on staging on real phones (iPhone + Android, light + dark, RU + UZ), recorded in `docs/acceptance.md`.
