# Receipt PDFs are rasterised with PDFium (WebAssembly) in a worker thread

A Receipt may be a PDF (TZ §4: «JPG, PNG, PDF»), and the receipt AI takes images only, so the server renders the PDF's first page. We use **`@hyzyla/pdfium`** (MIT; PDFium itself is BSD/Apache), which ships PDFium compiled to WebAssembly. It needs no system packages, so it runs unchanged in the production Docker image (ADR 0024), on a developer machine and in the tests. The package is about 14 MB on disk, and the API process loads it only inside the render worker.

Rejected options:

- **Poppler `pdftoppm`** would need a system package in the image and a child process per upload.
- **pdf.js** would need a native canvas (`node-canvas`, with Cairo) to render on the server.
- **MuPDF** is AGPL.
- **libvips' own PDF loader** (through sharp) is not in sharp's prebuilt binaries.

**Isolation and the memory bound.** Each PDF renders in a `worker_threads` worker (`pdf-first-page.ts`), so the API's event loop never waits on PDFium. The worker's JavaScript heap limit (128 MB) does not cover PDFium, whose memory is a WebAssembly buffer that could grow towards 2 GB. So PDFium's WebAssembly memory is capped at 256 MB: the worker instantiates the module itself and refuses any growth past the cap through `emscripten_resize_heap`, the one import PDFium grows its heap through. The allocation then fails and the render ends as an error. The glue may over-grow a granted request by up to 20 %, so one render holds at most about 310 MB of WebAssembly memory plus the 128 MB heap. PDFium starts at about 18 MB, and a receipt page at 1568 px needs under 30 MB.

At most two renders run at once in one API process (`pdfRenderSlots`), so PDFs can take at most about 0.9 GB of the 4 GB VPS. A third upload is refused at once, not queued, with 503 `try_again`. Nothing is stored, the order still waits, and the Mini App says to try again in a minute with the same file still chosen.

A page that takes longer than 15 s is stopped (`worker.terminate()`) and counts as `unreadable`. So does a page past the memory cap, a PDF with a password, a broken one, or one with no pages. The page is rendered so that its longer side is 1568 px, the AI's largest side. The limits are technical guards, not shop rules, so they are constants rather than settings.

**The AI's image (`receipt-file.ts`, sharp).** Every receipt, whether image or rendered page, is normalised the same way:

- turned upright from EXIF;
- flattened on white;
- scaled into the judge's 280–1568 px per side, with a very long strip padded with white rather than squashed;
- stripped of metadata, so a photo's location stays in the original only.

A JPEG stays a JPEG (quality 90). PNG, WebP and a PDF page become PNG. Images over 100 megapixels are refused before they are decoded. The original is kept byte for byte beside the normalised image, under one random UUID: `private/receipts/<uuid>.<ext>` and `<uuid>.judge.<jpg|png>` (ADR 0020).

**Hashes.** The SHA-256 of the original catches the same file sent twice. A 64-bit difference hash (dHash, 9 × 8 greyscale) of the normalised image catches the same receipt re-saved, re-compressed or rescaled. #28 stores both. Matching repeats is #36's job.

If PDF rendering ever proves too slow on the 4-vCPU VPS, the worker boundary lets it move to the BullMQ worker process without touching the intake.
