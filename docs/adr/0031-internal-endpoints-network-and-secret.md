# Internal endpoints need an allowlisted source network, no proxy headers, and a shared secret

ADR 0015 calls the userbot's endpoint "localhost only". In the Compose deploy of ADR 0024 the userbot runs in its own container, so its requests reach the API from the Compose network, not from loopback. The public requests Caddy relays come from that same network. So an internal endpoint (`/internal/*`, ticket #13) runs three checks and needs all of them to pass:

1. The source address is in `INTERNAL_ALLOWED_CIDRS`. The default is loopback only. A deploy adds the Compose subnet, or runs the userbot in the API's network namespace and keeps the default.
2. The request has no `X-Forwarded-For`, `Forwarded` or `X-Real-IP` header. Caddy adds these to every request it relays, so a request from outside is refused even though it arrives from an allowed address.
3. The `x-internal-secret` header equals `INTERNAL_API_SECRET`. Both values are hashed with SHA-256 and the digests compared in constant time, so neither the secret's content nor its length leaks through timing.

A failed network check (1 or 2) answers 403, and a missing or wrong secret answers 401. With no secret configured, the routes answer 404 as if they didn't exist. The Caddy config should also leave `/internal/*` unrouted. That is the deploy's job, and the three checks hold without it.

## Considered Options

- **Loopback only, as ADR 0015 says.** Rejected: it doesn't work with the separate userbot container of ADR 0024.
- **A second, internal-only listener port.** Not chosen for now: Nest serves one HTTP server per app, and the checks above give the same result with one process and one port. Revisit it if more internal endpoints appear.
