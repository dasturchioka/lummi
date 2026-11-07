# Discovery set has its own stock; a builder set draws on 10 ml stock; set lines snapshot their five fragrances

The **Discovery set** is a pre-packed box, so it has its own stock count, entered by the owner when boxes are assembled, and doesn't touch 10 ml stock. A **Builder set** has no stock of its own: inside the reservation transaction it takes one 10 ml unit from each of its five fragrances, and the builder only offers fragrances with 10 ml in stock. Boxes and packaging are not tracked in stage 1.

Each set line on an order stores the ids and names of its five fragrances. The upgrade right opened by that set covers exactly those, so a later change to the Discovery set composition in admin never alters existing rights. Every set unit opens its own right (TZ: "новый набор — новое право"). The 10 ml bottles inside a set never also open single-10 ml rights. Promo codes and birthday coupons apply to sets like any item; upgrade rights don't, since a set is not full size.
