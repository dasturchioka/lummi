# Three environments, one bot each; staging on our VPS, production on the customer's

| Environment | Where | Bot |
|---|---|---|
| local | Sardor's machine | `@lummi_dev_bot`, long polling |
| staging | Sardor's own VPS, its own compose project, DB and `staging.<domain>` | `@lummi_staging_bot` |
| production | the customer's PRO-DATA VPS in Tashkent | @Lummiuz_bot, token handed over at launch |

The day 6–10 demo (2026-11-12 – 11-16) runs on staging, opened by the customer through `@lummi_staging_bot` on their own phone. Telegram opens Mini Apps only over HTTPS, so local development uses a **named Cloudflare Tunnel** on Sardor's personal Cloudflare account for now, which gives stable hostnames and no BotFather edits after restarts. Staging holds seed and test data only, never real customers' data: production alone is bound by the Uzbek localisation rule (ADR 0020).

Humo notifications only exist for real card operations and the card isn't open yet. So the chat the userbot listens to is a setting: outside production it is our own test bot, fed sample "➕" messages by a script, with the userbot logged into Sardor's account. Parser tests run on recorded real notifications once the first sample arrives. Each environment has its own `.env`, validated with zod at startup (a bad config refuses to boot); only `.env.example` is in the repo.
