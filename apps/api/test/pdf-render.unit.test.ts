import { describe, expect, it } from 'vitest';
import {
  PdfBusyError,
  RenderSlots,
  UnreadablePdfError,
  pdfFirstPage,
} from '../src/receipts/pdf-first-page';
import { receiptPdf } from './harness/pdf';

/** A fake render that ends only when the test says so. */
function slowRender() {
  let finish!: () => void;
  let fail!: (e: Error) => void;
  const done = new Promise<string>((ok, no) => {
    finish = () => ok('page');
    fail = no;
  });
  return { job: () => done, finish, fail };
}

describe('PDF render slots', () => {
  it('run two renders at once and refuse a third at once, rather than queue it', async () => {
    const slots = new RenderSlots(2);
    const a = slowRender();
    const b = slowRender();
    const first = slots.run(a.job);
    const second = slots.run(b.job);

    await expect(slots.run(async () => 'third')).rejects.toBeInstanceOf(PdfBusyError);
    expect(slots.inUse).toBe(2);

    a.finish();
    await expect(first).resolves.toBe('page');
    await expect(slots.run(async () => 'next')).resolves.toBe('next');
    b.finish();
    await second;
    expect(slots.inUse).toBe(0);
  });

  it('free the slot of a render that failed', async () => {
    const slots = new RenderSlots(1);
    const a = slowRender();
    const running = slots.run(a.job);

    a.fail(new UnreadablePdfError('broken'));

    await expect(running).rejects.toBeInstanceOf(UnreadablePdfError);
    await expect(slots.run(async () => 'ok')).resolves.toBe('ok');
  });
});

describe("PDFium's memory cap", () => {
  it('a page that needs more WebAssembly memory than the cap is unreadable; one within it renders', async () => {
    const pdf = receiptPdf();
    const cap = { timeoutMs: 15_000, maxWasmBytes: 64 * 1024 * 1024 };
    // only the size comes back, so a failed expectation never prints megabytes of pixels
    const render = (maxSide: number) =>
      pdfFirstPage(pdf, { ...cap, maxSide }).then(
        (p) => [p.width, p.height],
        (e: unknown) => e,
      );

    // 5000 px on the long side is a ~135 MB bitmap; 3000 px fits in ~26 MB
    expect(await render(5000)).toBeInstanceOf(UnreadablePdfError);
    expect(await render(3000)).toEqual([2128, 3000]);
  }, 60_000);
});
