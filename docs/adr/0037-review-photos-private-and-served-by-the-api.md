# Review photos are stored privately and served by the API only while their review is published

Ticket #41 lets a shopper add photos to a review in the bot, and the customer approved showing them on the product card. A review stays private until staff publish it (customer text and photos can carry banned words or imagery), and staff can hide it again.

Photos are fetched by a BullMQ job (like a bot receipt, #31: the `file_id` is written in the update's transaction, the job retries the download), checked by their first bytes (JPEG, PNG or WebP only) and the receipt size cap (`receipts.maxUploadMb`), re-encoded to an upright JPEG of at most 1600 px with no metadata (a phone's location never leaves the original, which is not kept), and stored through `FileStore` under `private/reviews/`. They never go under `public/`, which Caddy serves directly.

A published review's photo is served by the API at `/reviews/photos/<public_key>.jpg`, where `public_key` is an unguessable UUID per photo. The route needs no session (an `<img>` cannot send one) but answers 404 unless the photo's review is published right now, so hiding a review takes its photos down at once. Staff read any photo at `/admin/reviews/photos/<id>` with their session cookie. Responses carry a five-minute cache, so a hidden photo may linger in a browser for that long.

## Considered Options

- **Copy a photo to `public/` on publish and delete it on hide.** Rejected: Caddy and CDN caches keep a hidden photo for as long as their lifetime, there is a second copy to keep in step, and the public path is for catalog photos named by content hash.
- **A signed, expiring URL per view.** Not chosen: the block is read by every customer, a published review is not secret, and the published flag already is the access rule; signatures would only add expiry to handle.

The topic post of a low rating (`review_post`, a new outbox task kind like `order_card`) sends the stored photos as photo messages after the text, stamping each as it lands so a retry sends only what is missing.
