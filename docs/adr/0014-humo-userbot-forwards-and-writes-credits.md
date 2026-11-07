# The Humo userbot forwards credit notifications to a group and records them as credits

As agreed with the customer in the project chat on 2026-11-07, a userbot (separate process `apps/userbot`, mtcute) logged into the customer's own Telegram account listens only to the official Humo bot chat and **forwards each credit (➕) notification** to the target group, so staff see the original Humo message. Debits (➖) are neither forwarded nor stored. Independently of the forward, it posts the raw notification text with its Humo `message_id` to the API's internal endpoint (ADR 0015). The API parses it and records a **Credit**, unique on `message_id` and keeping the raw text, so matching never depends on re-reading the group. The parser lives in the API, not the userbot, so it is tested through the API seam and fixed without redeploying the userbot on the customer's server. After a restart it reads the Humo chat history after the last stored `message_id`, so nothing is missed. If a message doesn't fit the template, the raw text is stored and the owner is alerted. Decision APIs can't parse free text (ADR 0013), so the parser is fixed by hand rather than "AI parses it" as TZ §4 says. A heartbeat every minute feeds the Humo-silence guard of ADR 0012.

Login happens once with the customer (SMS code + 2FA) through a CLI on the server. The session string is stored encrypted, only on the customer's server, with the key in `.env`, never in the repo.

Known consequences, accepted by the customer: forwarding means the personal account sends messages automatically (small account-restriction risk compared with a read-only session), and the forwarded notification shows the card **balance** line to everyone in the target group.

## Considered Options

- **Read-only userbot; our bot posts a sanitized line (no balance) to the group** — proposed, not chosen: the customer prefers the original Humo message forwarded.
