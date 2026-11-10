// Renders the first page of a PDF to raw RGBA with PDFium (WebAssembly), in a worker thread so a
// hostile or huge PDF can be stopped by the caller's timeout without blocking the API (ADR 0033).
// Plain JavaScript: it runs as is under node, tsx and vitest, with nothing to transform.
import { parentPort, workerData } from 'node:worker_threads';
import { PDFiumLibrary } from '@hyzyla/pdfium';

/** @type {{ bytes: Uint8Array; maxSide: number }} */
const { bytes, maxSide } = workerData;
let library;
try {
  library = await PDFiumLibrary.init();
  const document = await library.loadDocument(bytes);
  if (document.getPageCount() < 1) throw new Error('the PDF has no pages');
  const page = document.getPage(0);
  const { originalWidth, originalHeight } = page.getOriginalSize();
  if (!(originalWidth > 0 && originalHeight > 0)) throw new Error('the first page has no size');
  // the longer side lands on maxSide: the judge's largest image, the sharpest text it reads
  const scale = maxSide / Math.max(originalWidth, originalHeight);
  const render = await page.render({ scale, render: 'bitmap' });
  // a copy of its own: the render may be a view on the WebAssembly memory
  const data = render.data.slice();
  parentPort.postMessage({ ok: true, width: render.width, height: render.height, data }, [
    data.buffer,
  ]);
} catch (e) {
  parentPort.postMessage({ ok: false, error: e instanceof Error ? e.message : String(e) });
} finally {
  library?.destroy();
}
