import { Worker } from 'node:worker_threads';

/*
 * Technical guards, not shop rules (ADR 0033): they bound the memory one API process spends on
 * PDF receipts, so they are constants rather than settings.
 */
/** Renders at once in one API process; one more upload is refused with `try_again`, not queued. */
export const MAX_CONCURRENT_PDF_RENDERS = 2;
/** PDFium's WebAssembly memory per render (its glue may over-grow a granted request by 20 %). */
export const PDF_WASM_MAX_BYTES = 256 * 1024 * 1024;
/** The render worker's JavaScript heap (PDFium's own memory is the WebAssembly buffer above). */
const WORKER_HEAP_MB = 128;

/** The first page of a PDF as raw RGBA pixels (4 bytes a pixel, white where the page is empty). */
export interface PdfPage {
  width: number;
  height: number;
  data: Uint8Array;
}

/** A PDF that does not open (broken, password, no pages, past the memory cap) or takes too long. */
export class UnreadablePdfError extends Error {}

/** Every render slot is taken: the upload may be sent again in a moment. */
export class PdfBusyError extends Error {}

/**
 * At most `limit` jobs at once; one more is refused at once with `PdfBusyError` rather than queued,
 * so a burst of PDFs never piles up renders (and their memory) behind each other.
 */
export class RenderSlots {
  private active = 0;
  constructor(readonly limit: number) {}

  get inUse(): number {
    return this.active;
  }

  async run<T>(job: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) throw new PdfBusyError(`${this.limit} renders already running`);
    this.active++;
    try {
      return await job();
    } finally {
      this.active--;
    }
  }
}

/** The API process's PDF render slots. */
export const pdfRenderSlots = new RenderSlots(MAX_CONCURRENT_PDF_RENDERS);

/**
 * Rasterises the first page so its longer side is `maxSide` px, with PDFium (WebAssembly) in a
 * worker thread, in one of the process's render slots (ADR 0033). The API's event loop never waits
 * on it; a page that takes longer than `timeoutMs`, or needs more than `maxWasmBytes`, counts as
 * unreadable. Works in any Node image: no system packages, just the package's `.wasm`.
 */
export function pdfFirstPage(
  bytes: Uint8Array,
  opts: { maxSide: number; timeoutMs: number; maxWasmBytes?: number },
): Promise<PdfPage> {
  return pdfRenderSlots.run(() => renderInWorker(bytes, opts));
}

function renderInWorker(
  bytes: Uint8Array,
  {
    maxSide,
    timeoutMs,
    maxWasmBytes = PDF_WASM_MAX_BYTES,
  }: { maxSide: number; timeoutMs: number; maxWasmBytes?: number },
): Promise<PdfPage> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./pdf-first-page.worker.mjs', import.meta.url), {
      workerData: { bytes, maxSide, maxWasmBytes },
      resourceLimits: { maxOldGenerationSizeMb: WORKER_HEAP_MB },
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
      (
        m:
          | { ok: true; width: number; height: number; data: Uint8Array }
          | { ok: false; error: string },
      ) =>
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
