/**
 * A one-page PDF built by hand (no PDF library in the tests): a white A6-ish page with dark bars,
 * like a bank's transfer receipt. `pages` adds blank pages after it; the first page is what the
 * pipeline rasterises.
 */
export function receiptPdf({ pages = 1 }: { pages?: number } = {}): Buffer {
  const width = 298;
  const height = 420;
  const bars = Array.from({ length: 10 }, (_, i) => {
    const y = height - 60 - i * 32;
    const w = 90 + ((i * 47) % 140);
    return `0.13 0.13 0.13 rg 24 ${y} ${w} 10 re f`;
  }).join('\n');
  const content = `1 1 1 rg 0 0 ${width} ${height} re f\n0.6 0.65 0.57 rg 120 340 58 58 re f\n${bars}`;

  const pageIds = Array.from({ length: pages }, (_, i) => 4 + i * 2);
  const objects: string[] = [];
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages} >>`;
  objects[3] = `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`;
  pageIds.forEach((id, i) => {
    const stream = i === 0 ? 3 : id + 1;
    objects[id] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Contents ${stream} 0 R >>`;
    if (i > 0) objects[id + 1] = '<< /Length 0 >>\nstream\n\nendstream';
  });

  let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets: number[] = [];
  for (let n = 1; n < objects.length; n++) {
    if (objects[n] === undefined) objects[n] = 'null';
    offsets[n] = Buffer.byteLength(out, 'latin1');
    out += `${n} 0 obj\n${objects[n]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let n = 1; n < objects.length; n++)
    out += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
