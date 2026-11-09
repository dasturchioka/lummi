# What the adapters rely on (read 2026-11-09)

## TypeSafe Jev

Sources: [quick start](https://docs.typesafe.ai/introduction/quickstart.md), [images](https://docs.typesafe.ai/images.md),
[noul](https://docs.typesafe.ai/primitives/noul.md), [choice](https://docs.typesafe.ai/primitives/choice.md),
[errors](https://docs.typesafe.ai/api/errors.md), [models](https://docs.typesafe.ai/models.md), [OpenAPI](https://api.typesafe.ai/openapi.json).

- `POST https://api.typesafe.ai/v1/systemone`, `Authorization: Bearer <key>`, body `{model, state, questions, assets?}`; model `jev-latest` (= `jev-1.14.0`; pin a versioned id once thresholds are tuned).
- Images: header `TypeSafe-Danger-Zone-Images: true` (else 400); top-level `assets` map `{ref: {type:"image", format:"png"|"jpg"|"jpeg", data_base64}}`, the ref string placed in `state`. PNG/JPEG only. Limits: each side 280-1568 px, total 78 400-2 458 624 px, 16 MiB per image, 32 MiB request. **Upstream normalisation must therefore also downscale to <= 1568 px per side** (and upscale tiny images to >= 280).
- Noul (yes/no): `{type:"noul", instructions}` -> `{type:"noul", noul: 0..1}` (probability of yes, no confidence).
- Choice: `{type:"choice", instructions, criteria:{option: description}}` -> `{choice, probabilities, confidence}`.
- Errors: 400/401/413/415/422/429/529; 429 and 529 are retryable (we do not retry: the fallback is the retry).
- No refusal concept is documented for TypeSafe.

## OpenAI Decisions

Sources: [Decisions guide](https://developers.openai.com/api/docs/guides/decisions), [reference](https://developers.openai.com/api/reference/resources/decisions). OpenAI's own pages returned 403 to our fetcher for the reference; the guide text was read through a summariser, so the shapes below are worth one live check when a key exists.

- `POST https://api.openai.com/v1/decisions`, body `{model:"gpt-6-luna", input, questions[]}`, Bearer key (standard OpenAI auth, assumed).
- Image: a user message `{role:"user", content:[{type:"input_text"},{type:"input_image", image_url:"data:image/png;base64,..."}]}`; base64 data URLs are the safe form, `file_id` unsupported.
- Questions: `{type:"predicate", name, instructions}` -> `{type:"predicate", name, probability}`; `{type:"choice", name, instructions, choices:[{value, description}]}` -> `{choice, probabilities:[{value, probability}], confidence}`.
- Refusal: an answer with `type:"refusal"` and the question `name`.
- Error shapes and image limits are not documented; any non-2xx counts as failed.

## Choices we made

- Candidate options are opaque keys `c1..cN` plus `none`, each described by its own credit amount and time (Tashkent local time, UTC+5, minute precision). The order amount due is a separate question. Internal credit ids are never sent.
- Fixtures in `test/fixtures/receipt-ai/` are hand-built from the shapes above and marked `_synthetic`.

## Privacy and image size
- The receipt image leaves Uzbekistan for TypeSafe and OpenAI. ADR 0013 and CLAUDE.md allow this: the AI gets only the image, candidate credits (amount and time), the shop card's last-4 and the holder name, never a phone or address. The stored original and the DB stay on the Tashkent VPS (ADR 0020).
- TypeSafe rejects images whose sides are outside 280-1568 px (total 78 400-2 458 624 px). The receipt-upload ticket (#28) downscales into that range.
- Only `confirmed` on the result counts; see the `ReceiptJudge` interface.
