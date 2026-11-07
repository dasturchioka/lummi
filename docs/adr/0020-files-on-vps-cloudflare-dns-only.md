# Files stay on the Tashkent VPS; Cloudflare only for DNS and the dev tunnel

Uzbekistan's Personal Data Law (art. 27-1, in force since April 2021) requires citizens' personal data to be stored on servers physically in Uzbekistan. Receipts carry the payer's name and card mask, so they, the DB and every backup stay on the customer's Tashkent VPS; Cloudflare R2 or any foreign bucket is ruled out for them. Product photos are not personal data, but we found no Cloudflare PoP in Tashkent, while the VPS sits on TAS-IX right next to local users, so a CDN may well be slower.

Files go through a `FileStore` interface onto a VPS volume:
- **`/media/public`** — product photos. `sharp` renders 3:4 WebP at 400/800/1200 px, file names are content hashes, Caddy serves them with `Cache-Control: immutable` from a separate subdomain (`media.<domain>`), and the source PNG is kept.
- **`/media/private`** — receipts. Outside the web root, random UUID names, served only through an API endpoint that checks a staff session or the receipt owner's `initData`. The original is kept as evidence next to the normalised PNG/JPEG sent to the AI.

Uploads are typed by magic bytes, not the extension, and capped at 10 MB. Cloudflare is used only for the domain's DNS ("DNS only", no proxy) and Cloudflare Tunnel in development. After launch we measure image speed from Uzbek mobile networks; if Cloudflare proxying is faster, it can be switched on for `media.<domain>` alone without code changes.
