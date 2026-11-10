import { IMPORT_ISSUE_CODES, type ImportApplied, type ImportReport } from '@lummi/contracts';
import { adminMessages } from '@lummi/i18n/admin';
import { normalizeUzbek } from '@lummi/i18n';
import JSZip from 'jszip';
import { auditLog, eq, fragrances, notes, sql, volumes } from '@lummi/db';
import ExcelJS from 'exceljs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { importBtsPoints, type Snapshot } from '../src/bts/import-points';
import { seedCatalog } from '../src/catalog/seed';
import { parseYesNo } from '../src/catalog-import/workbook';
import { orderBody, samarkandPoint, shopper, slugs } from './harness/orders';
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
  t.edges.clock.set(new Date('2026-11-09T10:00:00Z'));
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
  fn: (sheets: { fragrances: ExcelJS.Worksheet; volumes: ExcelJS.Worksheet }, wb: ExcelJS.Workbook) => void,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as unknown as ArrayBuffer);
  fn({ fragrances: wb.getWorksheet('Ароматы')!, volumes: wb.getWorksheet('Объёмы')! }, wb);
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

describe('notes', () => {
  it('refuses a comma in a note name, in the admin and in the file', async () => {
    const res = await fetch(`${t.baseUrl}/admin/catalog/notes`, {
      method: 'POST',
      headers: { cookie: owner.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ nameRu: 'амбра, ваниль', nameUz: 'amber', aliases: [] }),
    });
    expect(res.status).toBe(400);
    const file = await edit(await exportBytes(), (_s, wb) => {
      const d = wb.getWorksheet('Справочник')!;
      const row = d.getRow(lastData(d) + 1);
      row.getCell(colOf(d, 'Нота RU')).value = 'амбра, ваниль';
      row.getCell(colOf(d, 'Нота UZ')).value = 'amber';
    });
    const { report } = await dryRun(file);
    expect(report.errors).toEqual([
      expect.objectContaining({ sheet: 'dictionary', column: 'Нота RU', code: 'comma_in_note' }),
    ]);
  });

  it('allows one note on two levels and names the level that repeats a note', async () => {
    const [n] = await t.db.select().from(notes).limit(1);
    const name = n!.nameRu;
    const ok = await edit(await exportBytes(), ({ fragrances: f }) => {
      colOf(f, 'Верхние ноты');
      f.getRow(2).getCell(colOf(f, 'Верхние ноты')).value = name;
      f.getRow(2).getCell(colOf(f, 'Ноты сердца')).value = name;
    });
    expect((await dryRun(ok)).report.errors).toEqual([]);
    const bad = await edit(await exportBytes(), ({ fragrances: f }) => {
      f.getRow(2).getCell(colOf(f, 'Ноты сердца')).value = `${name}, ${name}`;
    });
    expect((await dryRun(bad)).report.errors).toEqual([
      expect.objectContaining({ sheet: 'fragrances', row: 2, column: 'Ноты сердца', code: 'duplicate_note' }),
    ]);
  });
});

describe('cells that cannot be trusted', () => {
  it('rejects a formula and an error value instead of importing their text', async () => {
    const file = await edit(await exportBytes(), ({ volumes: v }) => {
      v.getRow(2).getCell(colOf(v, 'Цена, сум')).value = { formula: '1000*70', result: 70_000 };
      v.getRow(3).getCell(colOf(v, 'В наличии, шт.')).value = { error: '#N/A' } as never;
    });
    const { report } = await dryRun(file);
    expect(report.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sheet: 'volumes', row: 2, column: 'Цена, сум', code: 'formula_cell' }),
        expect.objectContaining({ sheet: 'volumes', row: 3, column: 'В наличии, шт.', code: 'error_cell' }),
      ]),
    );
    expect(report.token).toBeNull();
  });
});

describe('yes / no cells', () => {
  it.each(["yo'q", 'yoʻq', 'yo’q', 'yo`q', 'YOQ', 'нет', 'No', ''])('%j reads as no', (text) => {
    expect(parseYesNo(text)).toBe(false);
  });
  it.each(['ha', 'да', 'Yes', '1'])('%j reads as yes', (text) => {
    expect(parseYesNo(text)).toBe(true);
  });
  it('anything else is refused', () => {
    expect(parseYesNo('balki')).toBeNull();
  });

  it('the Скрыт column hides and unhides a fragrance', async () => {
    const [f0] = await t.db.select().from(fragrances).orderBy(fragrances.id).limit(1);
    const hide = await edit(await exportBytes(), ({ fragrances: f }) => {
      f.getRow(2).getCell(colOf(f, 'Скрыт')).value = 'да';
    });
    const a = await dryRun(hide);
    expect((await apply(hide, a.report.token!)).status).toBe(201);
    expect((await t.db.select().from(fragrances).where(eq(fragrances.id, f0!.id)))[0]!.hidden).toBe(true);
    const show = await edit(await exportBytes(), ({ fragrances: f }) => {
      f.getRow(2).getCell(colOf(f, 'Скрыт')).value = "yo'q";
    });
    const b = await dryRun(show);
    expect((await apply(show, b.report.token!)).status).toBe(201);
    expect((await t.db.select().from(fragrances).where(eq(fragrances.id, f0!.id)))[0]!.hidden).toBe(false);
  });
});

describe('Uzbek text', () => {
  it('normalises apostrophes in every UZ field the import writes', async () => {
    const raw = "O'zbek g'oya o‘ylar";
    const file = await edit(await exportBytes(), ({ fragrances: f }, wb) => {
      const row = f.getRow(2);
      for (const h of ['Описание UZ', 'Когда носить UZ', 'Стойкость UZ']) row.getCell(colOf(f, h)).value = raw;
      row.getCell(colOf(f, 'Ключевые ноты UZ')).value = "O'rik · g'ulob · to'q";
      row.getCell(colOf(f, 'Псевдонимы')).value = "o'rik";
      const d = wb.getWorksheet('Справочник')!;
      d.getRow(2).getCell(colOf(d, 'Нота UZ')).value = "yo'q nota";
    });
    const { report } = await dryRun(file);
    expect(report.errors).toEqual([]);
    expect((await apply(file, report.token!)).status).toBe(201);
    const [f0] = await t.db.select().from(fragrances).orderBy(fragrances.id).limit(1);
    expect(f0!.descriptionUz).toBe(normalizeUzbek(raw));
    expect(f0!.whenToWearUz).toBe(normalizeUzbek(raw));
    expect(f0!.longevityUz).toBe(normalizeUzbek(raw));
    expect(f0!.keyNotesUz).toEqual(["O'rik", "g'ulob", "to'q"].map(normalizeUzbek));
    expect(f0!.aliases).toContain(normalizeUzbek("o'rik"));
    expect((await t.db.select().from(notes)).some((n) => n.nameUz === normalizeUzbek("yo'q nota"))).toBe(true);
  });
});

describe('limits', () => {
  it('rejects a file whose unpacked size is past the ceiling (a zip bomb), before reading it', async () => {
    await owner.client.admin.settings.update({
      params: { key: 'catalog.import.maxBytes' },
      body: { value: 100_000 },
    });
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<Types/>');
    zip.file('xl/sharedStrings.xml', Buffer.alloc(3_000_000, 0x61)); // 3 MB packs to a few KB
    const bomb = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    expect(bomb.length).toBeLessThan(100_000);
    const { report } = await dryRun(bomb);
    expect(report.errors).toEqual([expect.objectContaining({ sheet: 'file', code: 'too_unpacked' })]);
  });

  it('rejects a file with more rows than the setting allows', async () => {
    await owner.client.admin.settings.update({
      params: { key: 'catalog.import.maxRows' },
      body: { value: 10 },
    });
    const { report } = await dryRun(await exportBytes());
    expect(report.errors.map((e) => [e.sheet, e.code])).toEqual([
      ['fragrances', 'too_many_rows'],
      ['volumes', 'too_many_rows'],
      ['dictionary', 'too_many_rows'],
    ]);
  });
});

describe('error texts', () => {
  it('every issue code has an RU and a UZ message, and no message is left without a code', () => {
    const codes = [...IMPORT_ISSUE_CODES].sort();
    for (const lang of ['ru', 'uz'] as const) {
      const messages = adminMessages[lang].admin.catalog.excel.issues as Record<string, string>;
      expect(Object.keys(messages).sort()).toEqual(codes);
      for (const c of codes) expect(messages[c]!.trim().length).toBeGreaterThan(3);
    }
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

describe('apply, under pressure', () => {
  it('a failure in a later row (a thrown error mid-apply) leaves the whole catalog unchanged', async () => {
    const before = await volState();
    const fragBefore = await t.db.select().from(fragrances);
    await t.db.execute(sql`
      create or replace function reject_price() returns trigger language plpgsql as
      $$ begin if new.price = 777777 then raise exception 'boom'; end if; return new; end $$`);
    await t.db.execute(sql`
      create trigger reject_price before update on volumes for each row execute function reject_price()`);
    try {
      const file = await edit(await exportBytes(), ({ fragrances: f, volumes: v }) => {
        f.getRow(2).getCell(colOf(f, 'Хит')).value = 'да'; // a fragrance change first
        v.getRow(2).getCell(colOf(v, 'Цена, сум')).value = 123_000; // a good volume row
        v.getRow(lastData(v)).getCell(colOf(v, 'Цена, сум')).value = 777_777; // the last one blows up
      });
      const { report } = await dryRun(file);
      expect(report.errors).toEqual([]);
      const res = await apply(file, report.token!);
      expect(res.status).toBeGreaterThanOrEqual(400);
    } finally {
      await t.db.execute(sql`drop trigger if exists reject_price on volumes`);
      await t.db.execute(sql`drop function if exists reject_price()`);
    }
    expect(await volState()).toEqual(before);
    expect(await t.db.select().from(fragrances)).toEqual(fragBefore);
    expect(await t.db.select().from(auditLog).where(eq(auditLog.action, 'catalog.import_applied'))).toHaveLength(0);
  });

  describe('with an open order holding stock', () => {
    const snapshot = JSON.parse(
      readFileSync(resolve(import.meta.dirname, '../src/bts/bts-points.snapshot.json'), 'utf8'),
    ) as Snapshot;
    /** Places an order for `qty` of the first fragrance's 10 ml (the volume on row 2 of «Объёмы»). */
    async function hold(qty: number) {
      await importBtsPoints(t.db, snapshot);
      const [slug] = await slugs(t, 1);
      const [first] = await t.db.select().from(fragrances).orderBy(fragrances.id).limit(1);
      const client = await shopper(t, { id: 51, first_name: 'Ali', language_code: 'ru' }, '998901234567');
      const slugOfFirst = first!.slug ?? slug!;
      const add = await client.cart.addLine({ body: { slug: slugOfFirst, ml: 10, qty } });
      if (add.status !== 200) throw new Error(`add ${add.status}`);
      const point = await samarkandPoint(t);
      const region = point.regionId;
      const checkout = await client.checkout.get({ query: { regionId: region } });
      if (checkout.status !== 200) throw new Error(`checkout ${checkout.status}`);
      const res = await client.orders.create({ body: orderBody(point.id, checkout.body.quote.total) });
      if (res.status !== 201) throw new Error(`order ${res.status}`);
    }

    it('the dry run warns when the new count is below the reserve', async () => {
      await hold(5);
      const file = await edit(await exportBytes(), ({ volumes: v }) => {
        v.getRow(2).getCell(colOf(v, 'В наличии, шт.')).value = 3;
      });
      const { report } = await dryRun(file);
      const row = report.stock.find((s) => s.row === 2)!;
      expect(row).toMatchObject({ newOnHand: 3, reserved: 5, available: -2, negative: true });
      expect(report.warnings).toEqual([expect.objectContaining({ code: 'below_reserve', row: 2 })]);
      expect(report.token).not.toBeNull(); // a warning never blocks
    });

    it('a reserve that grows after the dry run comes back as a warning and is audited', async () => {
      const file = await edit(await exportBytes(), ({ volumes: v }) => {
        v.getRow(2).getCell(colOf(v, 'В наличии, шт.')).value = 6;
      });
      const { report } = await dryRun(file);
      expect(report.warnings).toEqual([]); // nothing reserved yet
      await hold(8); // …then 8 are held while the owner reads the report
      const res = await apply(file, report.token!);
      expect(res.status).toBe(201);
      const body = (await res.json()) as ImportApplied;
      expect(body.warnings).toEqual([
        expect.objectContaining({ code: 'below_reserve', params: expect.objectContaining({ onHand: 6, reserved: 8 }) }),
      ]);
      const [log] = await t.db.select().from(auditLog).where(eq(auditLog.action, 'catalog.import_applied'));
      expect(JSON.stringify(log!.payload)).toContain('belowReserve');
    });
  });
});
