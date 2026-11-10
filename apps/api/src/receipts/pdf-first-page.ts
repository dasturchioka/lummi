import { Worker } from 'node:worker_threads';

/** The first page of a PDF as raw RGBA pixels (4 bytes a pixel, white where the page is empty). */
export interface PdfPage {
  width: number;
  height: number;
  data: Uint8Array;
}

/** A PDF that does not open (broken, password, no pages) or takes too long to render. */
export class UnreadablePdfError extends Error {}

/**
 * Rasterises the first page so its longer side is `maxSide` px, with PDFium (WebAssembly) in a
 * worker thread (ADR 0033): the API's event loop never waits on it, and a page that takes longer
 * than `timeoutMs` is stopped and counts as unreadable. Works in any Node image: no system
 * packages, just the package's `.wasm`.
 */
export function pdfFirstPage(
  bytes: Uint8Array,
  { maxSide, timeoutMs }: { maxSide: number; timeoutMs: number },
): Promise<PdfPage> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./pdf-first-page.worker.mjs', import.meta.url), {
      workerData: { bytes, maxSide },
      // the worker's JavaScript heap; PDFium's own memory is its WebAssembly buffer
      resourceLimits: { maxOldGenerationSizeMb: 128 },
      // a test runner's or tsx's loader flags are not needed by a plain .mjs worker
      execArgv: [],
    });
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      fn();
    };
    const timer = setTimeout(
      () => finish(() => reject(new UnreadablePdfError(`no page within ${timeoutMs} ms`))),
      timeoutMs,
    );
    worker.once(
      'message',
      (m: { ok: true; width: number; height: number; data: Uint8Array } | { ok: false; error: string }) =>
        finish(() =>
          m.ok
            ? resolve({ width: m.width, height: m.height, data: m.data })
            : reject(new UnreadablePdfError(m.error)),
        ),
    );
    worker.once('error', (e) => finish(() => reject(new UnreadablePdfError(e.message))));
    worker.once('exit', (code) =>
      finish(() => reject(new UnreadablePdfError(`the PDF worker stopped (${code})`))),
    );
  });
}
