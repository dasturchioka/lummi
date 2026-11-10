import type { ImportApplied, ImportReport } from '@lummi/contracts';
import { auditLog, eq, fragranceNotes, fragrances, notes, volumes } from '@lummi/db';
import ExcelJS from 'exceljs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seedCatalog } from '../src/catalog/seed';
import { createTestApp, type StaffSession, type TestApp } from './harness/test-app';

const materialsDir = fileURLToPath(new URL('../../../materials', import.meta.url));
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

let t: TestApp;
let owner: StaffSession;
let manager: StaffSession;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
beforeEach(async () => {
  await t.reset();
  await seedCatalog(t.db, { materialsDir, limit: 6 });
  owner = await t.ownerSession();
  manager = await t.managerSession();
});

const call = (path: string, as: StaffSession, body?: Buffer | string, method = body ? 'POST' : 'GET') =>
  fetch(`${t.baseUrl}/admin/catalog/${path}`, {
    method,
    headers: { cookie: as.cookie, ...(body ? { 'content-type': XLSX } : {}) },
    body: body as never,
  });
const exportBytes = async () => Buffer.from(await (await call('export', owner)).arrayBuffer());
const dryRun = async (file: Buffer, as = owner) => {
  const res = await call('import/dry-run', as, file);
  return { status: res.status, report: (await res.json()) as ImportReport };
};
const apply = (file: Buffer, token: string, as = owner) =>
  call(`import/apply?token=${token}`, as, file);

/** Opens an export, lets the test edit it, writes it back. */
async function edit(
  bytes: Buffer,
  fn: (sheets: { fragrances: ExcelJS.Worksheet; volumes: ExcelJS.Worksheet }) => void,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as unknown as ArrayBuffer);
  fn({ fragrances: wb.getWorksheet('Ароматы')!, volumes: wb.getWorksheet('Объёмы')! });
  return Buffer.from(await wb.xlsx.writeBuffer());
}
function colOf(ws: ExcelJS.Worksheet, header: string): number {
  let found = 0;
  ws.getRow(1).eachCell((c, n) => {
    if (c.text === header) found = n;
  });
  if (!found) throw new Error(`no column ${header}`);
  return found;
}
/** The sheet carries blank formatted rows below the data; the last row with a code is the data end. */
function lastData(ws: ExcelJS.Worksheet): number {
  let last = 1;
  ws.eachRow((r, n) => {
    if (r.getCell(1).text.trim()) last = n;
  });
  return last;
}
const volState = async () =>
  (await t.db.select().from(volumes)).map((v) => [v.id, v.price, v.onHand]).sort();

describe('dry run', () => {
  it('counts new, changed and unchanged rows and writes nothing', async () => {
    const before = await volState();
    const file = await edit(await exportBytes(), ({ fragrances: f, volumes: v }) => {
      v.getRow(2).getCell(colOf(v, 'Цена, сум')).value = 99_000; // one volume changed
      const row = f.getRow(lastData(f) + 1);
      f.getRow(2).eachCell((c, n) => (row.getCell(n).value = c.value)); // a clone of the first, made distinct
      row.getCell(colOf(f, 'Внутренний код')).value = '900';
      row.getCell(colOf(f, 'Название')).value = 'Nuit Test';
      row.getCell(colOf(f, 'Ключевые ноты RU')).value = 'Ваниль · Амбра · Кедр';
      row.getCell(colOf(f, 'Ключевые ноты UZ')).value = 'Vanil · Amber · Kedr';
      row.getCell(colOf(f, 'Похожие (коды)')).value = '';
      const vr = v.getRow(lastData(v) + 1);
      vr.getCell(colOf(v, 'Внутренний код')).value = '900';
      vr.getCell(colOf(v, 'Объём, мл')).value = 30;
      vr.getCell(colOf(v, 'Цена, сум')).value = 150_000;
      vr.getCell(colOf(v, 'В наличии, шт.')).value = 4;
    });
    const { status, report } = await dryRun(file);
    expect(status).toBe(201);
    expect(report.errors).toEqual([]);
    expect(report.counts.fragrances).toMatchObject({ new: 1, changed: 0, unchanged: 6 });
    expect(report.counts.volumes).toMatchObject({ new: 1, changed: 1 });
    expect(report.token).toMatch(/^[a-f0-9]{64}$/);
    expect(await volState()).toEqual(before);
    expect(await t.db.select().from(fragrances)).toHaveLength(6);
  });

  it('reports each problem by sheet, row and column and gives no token', async () => {
    const file = await edit(await exportBytes(), ({ volumes: v }) => {
      v.getRow(3).getCell(colOf(v, 'Цена, сум')).value = 'дорого';
      v.getRow(4).getCell(colOf(v, 'В наличии, шт.')).value = -2;
    });
    const { report } = await dryRun(file);
    expect(report.token).toBeNull();
    expect(report.errorTotal).toBeGreaterThanOrEqual(2);
    expect(report.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sheet: 'volumes', row: 3, column: 'Цена, сум' }),
        expect.objectContaining({ sheet: 'volumes', row: 4, column: 'В наличии, шт.' }),
      ]),
    );
  });

  it('shows on hand, reserve and the resulting available per volume, a negative one as a warning', async () => {
    const [v] = await t.db.select().from(volumes).orderBy(volumes.id).limit(1);
    const file = await edit(await exportBytes(), ({ volumes: vs }) => {
      vs.getRow(2).getCell(colOf(vs, 'В наличии, шт.')).value = 7;
    });
    const { report } = await dryRun(file);
    const row = report.stock.find((s) => s.row === 2)!;
    expect(row).toMatchObject({ onHand: v!.onHand, newOnHand: 7, reserved: 0, available: 7, negative: false });
    expect(report.warnings.filter((w) => w.code === 'below_reserve')).toHaveLength(0);
  });

  it('rejects a file that is not an xlsx', async () => {
    const { report } = await dryRun(Buffer.from('code,name\n1,2'));
    expect(report.errors[0]).toMatchObject({ sheet: 'file', code: 'not_xlsx' });
    expect(report.token).toBeNull();
  });

  it('rejects a file over the size setting', async () => {
    const { report } = await dryRun(Buffer.alloc(5_000_001));
    expect(report.errors[0]).toMatchObject({ sheet: 'file', code: 'too_big' });
  });
});

describe('round trip', () => {
  it('an export re-imports as zero changes', async () => {
    const { report } = await dryRun(await exportBytes());
    expect(report.errors).toEqual([]);
    expect(report.counts.fragrances).toMatchObject({ new: 0, changed: 0, unchanged: 6, notInFile: 0 });
    expect(report.counts.volumes).toMatchObject({ new: 0, changed: 0, unchanged: 18 });
    expect(report.counts.families).toMatchObject({ new: 0, changed: 0 });
    expect(report.counts.notes).toMatchObject({ new: 0, changed: 0 });
  });
});

describe('round trip, awkward names', () => {
  it('a note whose name contains a comma still re-imports as zero changes', async () => {
    const [n] = await t.db
      .insert(notes)
      .values({ nameRu: 'аккорд амбры, ванили и дерева', nameUz: 'amber, vanil va yogʻoch akkordi' })
      .returning();
    const [f] = await t.db.select().from(fragrances).orderBy(fragrances.id).limit(1);
    await t.db
      .insert(fragranceNotes)
      .values({ fragranceId: f!.id, noteId: n!.id, level: 'base', position: 99 });
    const { report } = await dryRun(await exportBytes());
    expect(report.errors).toEqual([]);
    expect(report.counts.fragrances.changed).toBe(0);
  });
});

describe('apply', () => {
  it('writes the change, audits it with the actor and never deletes what the file leaves out', async () => {
    const file = await edit(await exportBytes(), ({ fragrances: f, volumes: v }) => {
      v.getRow(2).getCell(colOf(v, 'Цена, сум')).value = 123_000;
      f.getRow(lastData(f)).values = []; // the last fragrance leaves the file
    });
    const { report } = await dryRun(file);
    expect(report.counts.fragrances.notInFile).toBe(1);
    const res = await apply(file, report.token!);
    expect(res.status).toBe(201);
    expect(((await res.json()) as ImportApplied).counts.volumes.changed).toBe(1);
    expect(await t.db.select().from(fragrances)).toHaveLength(6);
    expect((await volState()).some((r) => r[1] === 123_000)).toBe(true);
    const log = await t.db.select().from(auditLog).where(eq(auditLog.action, 'catalog.import_applied'));
    expect(log).toHaveLength(1);
    expect(log[0]!.actorType).toBe('staff');
  });

  it('is all or nothing: a file with one good and one bad row changes nothing', async () => {
    const before = await volState();
    const file = await edit(await exportBytes(), ({ volumes: v }) => {
      v.getRow(2).getCell(colOf(v, 'Цена, сум')).value = 123_000;
      v.getRow(3).getCell(colOf(v, 'Цена, сум')).value = 'abc';
    });
    const { report } = await dryRun(file);
    expect(report.token).toBeNull();
    const res = await apply(file, 'a'.repeat(64));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await volState()).toEqual(before);
  });

  it('refuses a stale plan when the catalog changed after the dry run, and writes nothing', async () => {
    const file = await edit(await exportBytes(), ({ volumes: v }) => {
      v.getRow(2).getCell(colOf(v, 'Цена, сум')).value = 123_000;
    });
    const { report } = await dryRun(file);
    // another admin edit lands in between
    const [other] = await t.db.select().from(volumes).orderBy(volumes.id).limit(1 as number).offset(5);
    await t.db.update(volumes).set({ price: 55_555 }).where(eq(volumes.id, other!.id));
    const after = await volState();
    const res = await apply(file, report.token!);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('stale');
    expect(await volState()).toEqual(after);
  });

  it('refuses a token from another file', async () => {
    const a = await edit(await exportBytes(), ({ volumes: v }) => {
      v.getRow(2).getCell(colOf(v, 'Цена, сум')).value = 123_000;
    });
    const b = await edit(await exportBytes(), ({ volumes: v }) => {
      v.getRow(2).getCell(colOf(v, 'Цена, сум')).value = 124_000;
    });
    const { report } = await dryRun(a);
    expect((await apply(b, report.token!)).status).toBe(409);
  });
});

describe('access', () => {
  it('is the owner only: a manager gets 403 on every route', async () => {
    const file = await exportBytes();
    expect((await call('export', manager)).status).toBe(403);
    expect((await call('template', manager)).status).toBe(403);
    expect((await call('import/dry-run', manager, file)).status).toBe(403);
    expect((await apply(file, 'a'.repeat(64), manager)).status).toBe(403);
  });

  it('serves the template with the dictionaries and no fragrances', async () => {
    const res = await call('template', owner);
    expect(res.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await res.arrayBuffer()) as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Ароматы', 'Объёмы', 'Справочник']);
    expect(lastData(wb.getWorksheet('Ароматы')!)).toBe(1);
  });
});
