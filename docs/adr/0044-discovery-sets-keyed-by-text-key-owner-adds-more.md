# Discovery sets are keyed by a text key, not by the ml of their vials; the owner adds more, each with its own name

Sardor (2026-11-28): the panel had exactly two sets, one per vial size (ADR 0042), and the owner wants more, «в том же формате». A set is still a pre-packed box of five fragrances, 5 × 10 ml or 5 × 5 ml, with its own price, photo, Uzum link, composition and boxes; now there can be any number of them, and each has a name.

**The key.** `discovery_set` is keyed by `key` (text, ASCII kebab case), with `vial_ml` (10 or 5) an attribute. The two that were there keep the keys the panel already used for the stock row, the audit target and the photo slot: `discovery` (the main set, 5 × 10 ml) and `discovery-5`. A new one gets the next `set-<n>` (from `set-3`), under an advisory lock so two creates never pick the same. Every reference moves from the vial ml to the key: `discovery_set_items.set_key` (FK), `cart_lines.set_key` (FK), and, without a foreign key (as `stock_moves.fragrance_id`, so a key check never queues behind the set's `FOR UPDATE`), `order_lines.set_key`, `bottlings.set_key` and `uzum_sale_lines.set_key`. The migration fills them from the old vial ml (5 → `discovery-5`, else `discovery`). A stock move's `details.set` gets `key` too; an older one without it is read by its `vialMl` the same way. Set locks are taken in ascending key.

**The name.** `name_ru` / `name_uz`, the owner's, required. The migration gives the two first sets the names the shop used («Discovery set», «Discovery set 5 × 5 мл»). The name is the set's title in the Mini App, its cart and checkout line, the order line's snapshot (`order_lines.name_ru/uz`), the stock page, the Uzum form and import, and the audit's target (the API looks it up by key). The lead under the title stays the i18n text of its vial size.

**The main set.** `MAIN_SET_KEY` (`discovery`) keeps what ADR 0042 gave the 5 × 10 ml set: its price is the builder set's, and it alone has the heart, the share link, the reviews block, the promo gift and the profitability page. It cannot be hidden (422). A new 5 × 10 ml set has none of those.

**Hidden.** `hidden` takes a set off sale in the shop: `GET /sets` leaves it out, `GET /sets/discovery?key=` and the cart's add answer 404, and a cart line that holds it reads as sold out. Its boxes stay on hand and still count on the stock page, in set assemblies and on Uzum (a box may still sell there); its orders and history stay. A set is never deleted.

**Routes.** The shop's `GET /sets` lists the sets on sale (five fragrances, not hidden) in `position` order; `GET /sets/discovery`, the cart's `POST /cart/sets/discovery`, the admin's `GET/PUT /admin/sets/discovery`, `/on-hand` and `/photo` take `?key=` (body `key` for the cart), the main set by default. The admin adds `GET /admin/sets` and `POST /admin/sets` (owner only, audited `sets.discovery_created`); the edit (`PUT`) now also takes the names and `hidden`. The assembly is `POST /admin/warehouse/sets/:key/assemblies`. The Mini App routes are `/sets/<key>`: `/sets/discovery` and `/sets/discovery-5` stay as they were, any other key is `/sets/$key`. «Купить сейчас» reads `discovery_set:<key>`, and still `discovery_set` and `discovery_set:5`. The Uzum import matches a set by its RU or UZ name first, then the generic «Discovery set 5 × N мл» names of the two first sets; the template lists every set by its RU name.

`DISCOVERY_SETS` (the descriptor keyed by vial ml, ADR 0042) is gone: the key, `setRoute(key)` and `MAIN_SET_KEY` say what it said.

## Considered Options

- **A numeric id with a separate slug.** Rejected: every reference would need the id and every route the slug, two names for one thing; the panel already had a text key for each set.
- **Keep `vial_ml` as the key and add a sequence number.** Rejected: a composite key in five tables for nothing the text key does not do.
- **A builder price setting of its own.** Not now: the main set's price stays the builder's, as before; the owner did not ask for two prices.
- **Delete a set.** Rejected: its orders, Uzum sales and stock history name it; hiding it does what the owner needs.
