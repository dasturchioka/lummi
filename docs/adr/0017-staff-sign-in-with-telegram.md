# Staff sign in to the admin panel with Telegram; one staff table for the panel and group buttons

TZ defines roles (owner, manager) but no sign-in. Managers also act through inline buttons in the orders group, where they can only be identified by Telegram id, and the audit trail must name the same person in both places. So the admin panel uses the **Telegram Login Widget** (signature checked by the API with the bot token, then an httpOnly session cookie, 7 days, revocable server-side; domain bound with BotFather `/setdomain` — our dev bot in development, @Lummiuz_bot in production). A **staff** table (Telegram id, name, role, active) gates both: a login or a group button press from anyone not active in it gets «Нет доступа», and every audited action points to one staff record. The first owner is seeded by a server CLI; the owner adds and removes everyone else in the panel.

Roles follow the TZ: owner does everything; manager handles orders, stock and BTS points. Card details, settings, promo codes, broadcasts and staff management are owner-only. Our developer accounts hold the owner role during development and are removed at handover (run-guide checklist).

## Considered Options

- **Email + password (+ 2FA)** — rejected: a second identity to map to Telegram ids for group buttons, plus password resets to build.
- **Admin as a Mini App (initData)** — rejected: tables and Excel import/export are desktop work.
