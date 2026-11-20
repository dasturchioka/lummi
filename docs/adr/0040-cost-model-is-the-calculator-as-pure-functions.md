# The cost model is the customer's calculator, as pure functions in the API fed by settings and the fragrance's oil price

The customer keeps a cost and profit calculator (a claude.ai page shared on 2026-11-18). Sardor asked for it and the warehouse built on it in full (#75–#80). Ticket #75 lays the foundation: the inputs and the unit cost. Bottling (#76), order profit (#77), the purchase planner (#78) and 5 ml with the 5 × 5 ml set (#79) build on it, so they must all cost the same way.

**Inputs.** Every number of the calculator is a setting (CLAUDE.md), in three admin groups with the calculator's `P0` as defaults: liquid `cost.liquid.*` (dollar rate, oil and ethanol %, supplier discount on oil, ethanol per litre, oil density, fixative per ml, filling loss, delivery of the oil to Termez), packaging `cost.packaging.*` (bottle 5 / 10 / 30 / 50 ml, label, spray, filling work, box 10 / 30 / 50 ml, set box per vial size, QR card, defect «брак и бой» %) and order costs `cost.order.*` (BTS mailer, BTS charge per parcel, ad per sale, tax %, online-payment %, Uzum commission %, gift sample count and ml). Prices are the catalog's and the free-delivery threshold is pricing's; the calculator's «клиент платит за доставку» is the delivery tariff. None is duplicated. Each fragrance carries its **oil price** (`fragrances.oil_price`, so'm per gram as the supplier's invoice reads, before the supplier discount), its **tier** (TOP / PREMIUM / PREMIUM NEW) and the supplier and invoice it came from, in the admin form and the Excel template. The discount and the import % are settings, not per fragrance, as in the calculator: a new invoice is typed as it reads.

**The seam.** `apps/api/src/cost/unit-cost.ts` holds pure functions on typed inputs. `readCostSettings(tx)` reads the 31 settings in one query into a `CostSettings` object (`liquid`, `packaging`, `order`). With it come:

- `bottleCost(oilPrice, ml, settings)`: the calculator's `unit`;
- `setCost(oilPrices, vialMl, settings)`: its `setUnit`;
- `giftSampleCost(oilPrices, settings)`: its `giftCost`;
- `landedOilPrice(oilPrice, liquid)`: its `oilG`;
- `liquidNeeded(ml, liquid)`: the grams of oil and ml of ethanol a fill uses up, filling loss included (the oil part of `bottleCost` is those grams at the landed price).

Each result is the full breakdown: oil, ethanol with fixative, bottle, label, spray, filling, box, QR card, base, defect, total. Its shape, `UnitCost`, is in `@lummi/contracts`. The callers:

- #75: the catalog page's `fragranceCosts` (`GET /admin/catalog/fragrances/:id/costs`).
- #76: bottling uses `liquidNeeded` for what it consumes.
- #77: costs order lines with `bottleCost` / `setCost` when the order is confirmed and freezes them in the order, then adds the order costs from `settings.order`.
- #78: the planner uses `landedOilPrice`, and `bottleCostExact` and `giftSampleCostExact`, the same bottle and sample before rounding, because it multiplies them by thousands of bottles; it rounds each figure of its own result once.
- #79: 5 ml uses `BottleMl` 5 and `SetVialMl` 5.

A 5 ml bottle has no box and no card. A set's vials have neither: the set gets one set box and one card, and the defect % goes on the whole.

**One formula.** Every filled bottle, whether sold alone, in a set or as a sample, is the calculator's `vial`: liquid with the filling loss, bottle, label, spray and filling work. `bottleCost` adds the box and the QR card to it, `setCost` adds the set box and one card to five of them, and `giftSampleCost` scales its liquid. `liquidNeeded` reads the same oil share, so the oil bottling consumes (#76) and the oil an order is costed at (#77) cannot drift apart. The calculator's own `unit` gives the same rounded figures; this was checked for every oil price from 1 000 to 10 000 so'm/g × 4 volumes.

**Rounding, stated once (`som` in the module).** The functions work on unrounded numbers. Each figure of the result is then rounded to whole so'm, half up, exactly as the calculator shows it; `fragranceCosts` uses the same `som`. `total` is the unrounded total rounded, so the rounded parts can differ from it by a so'm or two (in the unit table, 16 808 + 336 with a total of 17 145). A caller takes `total` and never re-adds the parts. The unit table (`apps/api/test/unit-cost.unit.test.ts`) holds the calculator's own figures for 3 oil prices × 4 volumes, both sets and the gift sample, at the defaults and at other values. The oil prices there are made up: the customer's are commercial data and stay off this public repository.

**No oil price, no cost.** A fragrance without an oil price has no cost (null), never a cost of zero oil. The catalog page asks for the price instead. Profit on that page is price less unit cost, before any order cost; the order-level profit and margin are #77's.

**Seed.** The oil prices, tiers, suppliers and invoices come from the owner's supplier invoices, as listed in his calculator. They never enter the repository, which is public: the list is a JSON file on the server, and the seed step `seedOilPrices` (`apps/api/src/catalog/seed-oil-prices.ts`) reads it only from the path in `OIL_PRICES_FILE`. Without the variable or the file it skips, with one log line. It never fails a deploy. A file it cannot read as a JSON list skips the whole fill with one line. Each row is checked against the admin form's limits (`oilPriceEntrySchema`: a whole number of so'm from 1 to `MAX_OIL_PRICE`, a known tier, supplier and invoice of at most 120 characters). A bad row is dropped with one line naming it and why, and the good rows still go in. `matchOilPrices` pairs the list with the catalog by brand + name. The list's brand spellings («By Kilian», «M.A.B.», «YSL», «Roja Dove», «Xerjoff (Sospiro)») and six whole names are listed in the code. Against the current list, 66 of 67 fragrances match (Parfums de Marly Greenley is not in it). The step fills each field only where it is empty, so a value the owner set is never overwritten. It runs after `seed:catalog` and on every staging deploy (`seed-staging`), so a catalog seeded before this gets the prices too. The seed workbook's four cost columns stay empty. They are optional in the import: a file from the older template still imports and leaves the stored values as they are.

## Considered Options

- **The functions in `@lummi/contracts`, shared with the admin** so pages could recompute live. Rejected: the server owns money (ADR 0001), every consumer (#76–#78) computes server-side, and the admin only shows the API's figures.
- **Integer arithmetic (tiyin or basis points).** Rejected: it would differ from the calculator by a so'm at the half-way points, and the calculator is what the owner checks against.
- **Store the oil price net of the supplier discount.** Rejected: invoices read gross, and one discount setting applies to the whole supplier, as in the calculator.
- **One grouped setting per area.** Rejected: flat keys give each value its own label, hint, bounds and audit line, as the calculator's fields do.
