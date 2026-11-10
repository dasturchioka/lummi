import type { FragranceInput } from '@lummi/contracts';
import { auditLog, eq, families, fragrances, notes, staff, volumes } from '@lummi/db';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seedCatalog } from '../src/catalog/seed';
import { createTestApp, type StaffSession, type TestApp } from './harness/test-app';

const materialsDir = fileURLToPath(new URL('../../../materials', import.meta.url));

let t: TestApp;
let owner: StaffSession;
let manager: StaffSession;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
beforeEach(async () => {
  await t.reset();
  t.edges.files.files.clear();
  await seedCatalog(t.db, { materialsDir, limit: 6 });
  owner = await t.ownerSession();
  manager = await t.managerSession();
});

const baseInput = (over: Partial<FragranceInput> = {}): FragranceInput => ({
  name: 'Nuit Blanche',
  originalBrand: 'Maison Test',
  type: 'unisex',
  familyId: null,
  season: 'autumn_winter',
  timeOfDay: 'evening',
  sillage: 'strong',
  longevityRu: 'до 24 часов',
  longevityUz: '24 soatgacha',
  descriptionRu: 'Тёплый аромат для вечера.',
  descriptionUz: 'Kechqurun uchun iliq ifor.',
  whenToWearRu: 'Для встреч вечером.',
  whenToWearUz: 'Kechki uchrashuvlar uchun.',
  keyNotesRu: ['Ваниль', 'Амбра', 'Кедр'],
  keyNotesUz: ['Vanil', 'Amber', 'Kedr'],
  internalRemark: null,
  aliases: [],
  uzumUrl: null,
  isHit: false,
  isNew: true,
  hidden: false,
  notes: { top: [], heart: [], base: [] },
  similarIds: [],
  volumes: [
    { ml: 10, price: 70_000, salePrice: null, saleEndsOn: null, onHand: 5 },
    { ml: 30, price: 150_000, salePrice: null, saleEndsOn: null, onHand: 5 },
  ],
  ...over,
});

/** The contract does not list the 400 a schema failure answers with, so those cases go raw. */
async function send(method: string, path: string, body: unknown, as: StaffSession = owner) {
  const res = await fetch(`${t.baseUrl}${path}`, {
    method,
    headers: { cookie: as.cookie, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.status;
}

const create = (over: Partial<FragranceInput> = {}, as = owner) =>
  as.client.admin.catalog.fragrances.create({ body: baseInput(over) });
async function created(over: Partial<FragranceInput> = {}) {
  const res = await create(over);
  if (res.status !== 201) throw new Error(`create failed: ${res.status}`);
  return res.body;
}
async function card(slug: string) {
  const { client } = await t.signIn();
  return client.catalog.fragrance({ params: { slug } });
}
const audits = (action: string) => t.db.select().from(auditLog).where(eq(auditLog.action, action));

describe('create and edit a fragrance', () => {
  it('creates it with the next internal code and a slug from the name, and the Mini App sees it at once', async () => {
    const f = await created();
    expect(f).toMatchObject({ slug: 'nuit-blanche', code: '007', name: 'Nuit Blanche' });
    expect(f.volumes.map((v) => v.ml)).toEqual([10, 30]);
    const c = await card('nuit-blanche');
    expect(c.status).toBe(200);
    if (c.status === 200) {
      expect(c.body.isNew).toBe(true);
      expect(c.body.volumes.map((v) => [v.ml, v.price, v.available])).toEqual([
        [10, 70_000, 5],
        [30, 150_000, 5],
      ]);
    }
    expect(JSON.stringify(c)).not.toContain('"007"');
  });

  it('audits the create with the actor', async () => {
    const f = await created();
    const [row] = await audits('catalog.fragrance_created');
    expect(row).toMatchObject({
      actorType: 'staff',
      actorId: owner.staff.id,
      targetType: 'fragrance',
      targetId: String(f.id),
    });
  });

  it('answers 409 for a name whose slug is taken', async () => {
    await created();
    const again = await create({ name: 'nuit blanche' });
    expect(again.status).toBe(409);
  });

  it('stores notes by level in the picked order and the curated similar fragrances in order', async () => {
    const ns = await t.db.select().from(notes).limit(5);
    const [a, b, c, d, e] = ns.map((n) => n.id) as [number, number, number, number, number];
    const others = (await t.db.select().from(fragrances)).map((f) => f.id);
    const f = await created({
      notes: { top: [c, a], heart: [b], base: [e, d] },
      similarIds: [others[3]!, others[0]!, others[2]!],
    });
    expect(f.notes).toEqual({ top: [c, a], heart: [b], base: [e, d] });
    expect(f.similarIds).toEqual([others[3], others[0], others[2]]);
    const cardRes = await card('nuit-blanche');
    if (cardRes.status !== 200) throw new Error('card');
    expect(cardRes.body.notes.top.map((n) => n.ru)).toEqual(
      [c, a].map((id) => ns.find((n) => n.id === id)!.nameRu),
    );
    // reorder
    const upd = await owner.client.admin.catalog.fragrances.update({
      params: { id: f.id },
      body: baseInput({
        similarIds: [others[2]!, others[3]!],
        notes: { top: [a], heart: [], base: [] },
      }),
    });
    expect(upd.status === 200 && upd.body.similarIds).toEqual([others[2], others[3]]);
    expect(upd.status === 200 && upd.body.notes).toEqual({ top: [a], heart: [], base: [] });
  });

  it('edits every field and audits what changed, without touching the slug or the code', async () => {
    const f = await created();
    const res = await owner.client.admin.catalog.fragrances.update({
      params: { id: f.id },
      body: baseInput({
        name: 'Nuit Noire',
        isHit: true,
        sillage: 'medium',
        uzumUrl: 'https://uzum.uz/ru/product/x',
        volumes: [
          {
            ml: 10,
            price: 80_000,
            salePrice: null,
            saleEndsOn: null,
            onHand: 3,
            loadedOnHand: 5,
          },
        ],
      }),
    });
    expect(res.status).toBe(200);
    if (res.status !== 200) return;
    expect(res.body).toMatchObject({
      slug: 'nuit-blanche',
      code: '007',
      name: 'Nuit Noire',
      isHit: true,
    });
    // a volume left out of the form is kept, not deleted
    expect(res.body.volumes.map((v) => v.ml)).toEqual([10, 30]);
    const [row] = await audits('catalog.fragrance_updated');
    expect(row?.actorId).toBe(owner.staff.id);
    const payload = row?.payload as {
      changed: string[];
      volumes: { ml: number; price?: number[] }[];
    };
    expect(payload.changed).toEqual(
      expect.arrayContaining(['name', 'isHit', 'sillage', 'uzumUrl']),
    );
    expect(payload.volumes).toEqual([{ ml: 10, price: [70_000, 80_000], onHand: [5, 3] }]);
  });

  it('adds a volume that did not exist yet', async () => {
    const f = await created();
    const res = await owner.client.admin.catalog.fragrances.update({
      params: { id: f.id },
      body: baseInput({
        volumes: [{ ml: 50, price: 220_000, salePrice: null, saleEndsOn: null, onHand: 2 }],
      }),
    });
    expect(res.status === 200 && res.body.volumes.map((v) => v.ml)).toEqual([10, 30, 50]);
  });

  it('clears the placeholder flag only on a volume whose price or on hand was set', async () => {
    const [seeded] = await t.db.select().from(fragrances).limit(1);
    const before = await owner.client.admin.catalog.fragrances.get({ params: { id: seeded!.id } });
    if (before.status !== 200) throw new Error('get');
    expect(before.body.volumes.every((v) => v.isPlaceholder)).toBe(true);
    const body = { ...before.body, volumes: before.body.volumes.map((v) => ({ ...v })) };
    body.volumes[0]!.price = 71_000;
    const res = await owner.client.admin.catalog.fragrances.update({
      params: { id: seeded!.id },
      body: body as never,
    });
    expect(res.status === 200 && res.body.volumes.map((v) => v.isPlaceholder)).toEqual([
      false,
      true,
      true,
    ]);
  });

  it('returns 404 for an unknown fragrance', async () => {
    expect((await owner.client.admin.catalog.fragrances.get({ params: { id: 9999 } })).status).toBe(
      404,
    );
    expect(
      (
        await owner.client.admin.catalog.fragrances.update({
          params: { id: 9999 },
          body: baseInput(),
        })
      ).status,
    ).toBe(404);
  });
});

describe('validation', () => {
  it.each([
    ['an empty RU description', { descriptionRu: ' ' }],
    ['an empty UZ description', { descriptionUz: '' }],
    ['an empty UZ «Когда носить»', { whenToWearUz: '' }],
    ['two key notes', { keyNotesRu: ['a', 'b'] }],
    ['four UZ key notes', { keyNotesUz: ['a', 'b', 'c', 'd'] }],
    ['no volumes', { volumes: [] }],
    ['a bad Uzum link', { uzumUrl: 'javascript:alert(1)' }],
    [
      'a sale price equal to the price',
      { volumes: [{ ml: 10, price: 70_000, salePrice: 70_000, saleEndsOn: null, onHand: 1 }] },
    ],
    [
      'a sale price above the price',
      { volumes: [{ ml: 10, price: 70_000, salePrice: 90_000, saleEndsOn: null, onHand: 1 }] },
    ],
    [
      'a fractional price',
      { volumes: [{ ml: 10, price: 70_000.5, salePrice: null, saleEndsOn: null, onHand: 1 }] },
    ],
    [
      'a negative on hand',
      { volumes: [{ ml: 10, price: 70_000, salePrice: null, saleEndsOn: null, onHand: -1 }] },
    ],
    [
      'a sale end date with no sale price',
      {
        volumes: [{ ml: 10, price: 70_000, salePrice: null, saleEndsOn: '2026-12-01', onHand: 1 }],
      },
    ],
    [
      'the same volume twice',
      {
        volumes: [
          { ml: 10, price: 70_000, salePrice: null, saleEndsOn: null, onHand: 1 },
          { ml: 10, price: 80_000, salePrice: null, saleEndsOn: null, onHand: 1 },
        ],
      },
    ],
    [
      'a volume that is not sold',
      { volumes: [{ ml: 20 as never, price: 1, salePrice: null, saleEndsOn: null, onHand: 1 }] },
    ],
  ] as [string, Partial<FragranceInput>][])(
    'rejects %s with 400 and writes nothing',
    async (_n, over) => {
      expect(await send('POST', '/admin/catalog/fragrances', baseInput(over))).toBe(400);
      expect(await t.db.select().from(fragrances)).toHaveLength(6);
      expect(await audits('catalog.fragrance_created')).toHaveLength(0);
    },
  );

  it.each([
    ['a sale price equal to the price', { price: 70_000, salePrice: 70_000, saleEndsOn: null }],
    ['a sale price above the price', { price: 70_000, salePrice: 90_000, saleEndsOn: null }],
    [
      'a sale end date with no sale price',
      { price: 70_000, salePrice: null, saleEndsOn: '2026-12-01' },
    ],
    ['a fractional price', { price: 70_000.5, salePrice: null, saleEndsOn: null }],
  ])('rejects %s on an edit with 400 and changes nothing', async (_n, v) => {
    const f = await created();
    const body = baseInput({ volumes: [{ ml: 10, onHand: 5, ...v }] });
    expect(await send('PUT', `/admin/catalog/fragrances/${f.id}`, body)).toBe(400);
    const [vol] = await t.db.select().from(volumes).where(eq(volumes.fragranceId, f.id));
    expect(vol?.price).toBe(70_000);
    expect(await audits('catalog.fragrance_updated')).toHaveLength(0);
  });

  it('names the fields whose ids do not exist or whose date is not real (422)', async () => {
    const res = await create({
      familyId: 9999,
      notes: { top: [9999], heart: [], base: [] },
      similarIds: [9999],
      volumes: [{ ml: 10, price: 70_000, salePrice: 60_000, saleEndsOn: '2026-02-31', onHand: 1 }],
    });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ code: 'invalid' });
    expect((res.body as { fields: string[] }).fields.sort()).toEqual(
      ['familyId', 'notes.top', 'similarIds', 'volumes.0.saleEndsOn'].sort(),
    );
  });

  it('refuses to list a fragrance as similar to itself', async () => {
    const f = await created();
    const res = await owner.client.admin.catalog.fragrances.update({
      params: { id: f.id },
      body: baseInput({ similarIds: [f.id] }),
    });
    expect(res.status).toBe(422);
  });

  it('a failed edit changes nothing', async () => {
    const f = await created();
    await owner.client.admin.catalog.fragrances.update({
      params: { id: f.id },
      body: baseInput({ name: 'Changed', familyId: 9999 }),
    });
    const [row] = await t.db.select().from(fragrances).where(eq(fragrances.id, f.id));
    expect(row?.name).toBe('Nuit Blanche');
  });
});

describe('uzbek apostrophes', () => {
  it('are normalised on save in UZ texts and aliases, but not in the name', async () => {
    const f = await created({
      name: "Angel's Dream",
      descriptionUz: "Yo'lda o'g'il tong'ni ko'rdi, ma'no",
      whenToWearUz: "O'zbekiston bahori",
      longevityUz: "24 soat'gacha",
      keyNotesUz: ["Go'zal", 'Amber', 'Kedr'],
      aliases: ["to'q", 'Dream'],
    });
    expect(f.name).toBe("Angel's Dream");
    expect(f.descriptionUz).toBe('Yoʻlda oʻgʻil tongʻni koʻrdi, ma’no');
    expect(f.whenToWearUz).toBe('Oʻzbekiston bahori');
    expect(f.keyNotesUz[0]).toBe('Goʻzal');
    expect(f.aliases).toEqual(['toʻq', 'Dream']);
  });
});

describe('markdown', () => {
  it('ends at 23:59:59 Asia/Tashkent of the given day and reverts by itself', async () => {
    const f = await created({
      volumes: [{ ml: 10, price: 70_000, salePrice: 50_000, saleEndsOn: '2026-11-15', onHand: 5 }],
    });
    expect(f.volumes[0]).toMatchObject({ salePrice: 50_000, saleEndsOn: '2026-11-15' });
    const [v] = await t.db.select().from(volumes).where(eq(volumes.id, f.volumes[0]!.id));
    expect(v?.saleEndsAt?.toISOString()).toBe('2026-11-15T18:59:59.000Z');

    t.edges.clock.set(new Date('2026-11-15T18:59:59Z'));
    let c = await card('nuit-blanche');
    expect(c.status === 200 && c.body.volumes[0]).toMatchObject({
      salePrice: 50_000,
      effectivePrice: 50_000,
    });
    t.edges.clock.set(new Date('2026-11-15T19:00:00Z'));
    c = await card('nuit-blanche');
    expect(c.status === 200 && c.body.volumes[0]).toMatchObject({
      salePrice: null,
      effectivePrice: 70_000,
    });
  });

  it('can be removed again', async () => {
    const f = await created({
      volumes: [{ ml: 10, price: 70_000, salePrice: 50_000, saleEndsOn: '2026-11-15', onHand: 5 }],
    });
    const res = await owner.client.admin.catalog.fragrances.update({
      params: { id: f.id },
      body: baseInput({
        volumes: [{ ml: 10, price: 70_000, salePrice: null, saleEndsOn: null, onHand: 5 }],
      }),
    });
    expect(res.status === 200 && res.body.volumes[0]).toMatchObject({
      salePrice: null,
      saleEndsOn: null,
    });
  });
});

describe('hide and the list', () => {
  it('hides and unhides, hides it from the Mini App, and audits both', async () => {
    const f = await created();
    const hide = await owner.client.admin.catalog.fragrances.setHidden({
      params: { id: f.id },
      body: { hidden: true },
    });
    expect(hide.status === 200 && hide.body.hidden).toBe(true);
    expect((await card('nuit-blanche')).status).toBe(404);
    await owner.client.admin.catalog.fragrances.setHidden({
      params: { id: f.id },
      body: { hidden: false },
    });
    expect((await card('nuit-blanche')).status).toBe(200);
    expect(await audits('catalog.fragrance_hidden')).toHaveLength(1);
    expect(await audits('catalog.fragrance_unhidden')).toHaveLength(1);
    expect(
      (
        await owner.client.admin.catalog.fragrances.setHidden({
          params: { id: 9999 },
          body: { hidden: true },
        })
      ).status,
    ).toBe(404);
  });

  it('searches by name, brand, alias and code, and filters by type, family, visibility and flag', async () => {
    const [fam] = await t.db.select().from(families).limit(1);
    const a = await created({ aliases: ['Белая ночь'], isHit: true, familyId: fam!.id });
    await created({ name: 'Other One', originalBrand: 'Zeta', type: 'homme', hidden: true });
    const list = (query: object) => owner.client.admin.catalog.fragrances.list({ query });
    const names = async (query: object) => {
      const res = await list(query);
      return res.status === 200 ? res.body.map((f) => f.name) : res.status;
    };
    expect(await names({ q: 'nuit' })).toEqual(['Nuit Blanche']);
    expect(await names({ q: 'ZETA' })).toEqual(['Other One']);
    expect(await names({ q: 'белая' })).toEqual(['Nuit Blanche']);
    expect(await names({ q: '008' })).toEqual(['Other One']);
    expect(await names({ q: '%' })).toEqual([]);
    expect(await names({ visibility: 'hidden' })).toEqual(['Other One']);
    expect(await names({ type: 'homme', visibility: 'hidden' })).toEqual(['Other One']);
    expect(await names({ flag: 'hit' })).toEqual(['Nuit Blanche']);
    expect(await names({ familyId: fam!.id })).toContain('Nuit Blanche');
    const all = await list({});
    expect(all.status === 200 && all.body).toHaveLength(8);
    const row = all.status === 200 && all.body.find((f) => f.id === a.id);
    expect(row).toMatchObject({ code: '007', volumes: [{ ml: 10 }, { ml: 30 }] });
  });
});

describe('permissions (ADR 0017)', () => {
  it('rejects a signed-out caller with 401', async () => {
    expect((await t.client.admin.catalog.fragrances.list({ query: {} })).status).toBe(401);
    expect((await t.client.admin.stock.list({ query: {} })).status).toBe(401);
  });

  it('keeps the whole catalog away from a manager (403) and writes nothing', async () => {
    const f = await created();
    const m = manager.client.admin.catalog;
    expect((await m.fragrances.list({ query: {} })).status).toBe(403);
    expect((await m.fragrances.get({ params: { id: f.id } })).status).toBe(403);
    expect((await m.fragrances.create({ body: baseInput({ name: 'Sneaky' }) })).status).toBe(403);
    expect(
      (await m.fragrances.update({ params: { id: f.id }, body: baseInput({ name: 'X' }) })).status,
    ).toBe(403);
    expect(
      (await m.fragrances.setHidden({ params: { id: f.id }, body: { hidden: true } })).status,
    ).toBe(403);
    expect((await m.families.list()).status).toBe(403);
    expect(
      (await m.families.create({ body: { nameRu: 'Х', nameUz: 'X', aliases: [] } })).status,
    ).toBe(403);
    expect((await m.notes.list()).status).toBe(403);
    expect(
      (await m.notes.update({ params: { id: 1 }, body: { nameRu: 'Х', nameUz: 'X', aliases: [] } }))
        .status,
    ).toBe(403);
    const upload = await uploadPhoto(manager, f.volumes[0]!.id, await png());
    expect(upload.status).toBe(403);
    const [row] = await t.db.select().from(fragrances).where(eq(fragrances.id, f.id));
    expect(row).toMatchObject({ name: 'Nuit Blanche', hidden: false });
  });

  it('lets a manager (and the owner) set on hand, audited with the actor', async () => {
    const f = await created();
    const vol = f.volumes[0]!;
    const res = await manager.client.admin.onHand.set({
      params: { id: vol.id },
      body: { onHand: 12 },
    });
    expect(res.status === 200 && res.body).toMatchObject({
      onHand: 12,
      reserved: 0,
      available: 12,
    });
    const c = await card('nuit-blanche');
    expect(c.status === 200 && c.body.volumes[0]?.available).toBe(12);
    const [row] = await audits('catalog.on_hand_changed');
    expect(row).toMatchObject({
      actorType: 'staff',
      actorId: manager.staff.id,
      targetId: String(vol.id),
    });
    expect(row?.payload).toMatchObject({ ml: 10, onHand: [5, 12] });

    const ownerRes = await owner.client.admin.onHand.set({
      params: { id: vol.id },
      body: { onHand: 0 },
    });
    expect(ownerRes.status === 200 && ownerRes.body.available).toBe(0);
    expect((await audits('catalog.on_hand_changed')).map((r) => r.actorId)).toEqual([
      manager.staff.id,
      owner.staff.id,
    ]);
  });

  it('refuses a negative or fractional on hand and an unknown volume', async () => {
    const f = await created();
    const id = f.volumes[0]!.id;
    const path = `/admin/volumes/${id}/on-hand`;
    expect(await send('PATCH', path, { onHand: -1 }, manager)).toBe(400);
    expect(await send('PATCH', path, { onHand: 1.5 }, manager)).toBe(400);
    expect(
      (await manager.client.admin.onHand.set({ params: { id: 9999 }, body: { onHand: 1 } })).status,
    ).toBe(404);
  });

  it('lists on hand for a manager', async () => {
    await created();
    const res = await manager.client.admin.stock.list({ query: { q: 'nuit' } });
    expect(
      res.status === 200 &&
        res.body.rows.filter((s) => s.kind === 'volume').map((s) => [s.ml, s.onHand, s.available]),
    ).toEqual([
      [10, 5, 5],
      [30, 5, 5],
    ]);
  });

  it('an inactive owner is signed out of the catalog at once', async () => {
    await t.db.update(staff).set({ active: false });
    expect((await owner.client.admin.catalog.fragrances.list({ query: {} })).status).toBe(401);
  });
});

async function png(width = 900, height = 1200) {
  return sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 190, b: 180 } },
  })
    .png()
    .toBuffer();
}
function uploadPhoto(
  as: StaffSession,
  volumeId: number,
  body: Uint8Array,
  contentType = 'image/png',
) {
  return fetch(`${t.baseUrl}/admin/volumes/${volumeId}/photo`, {
    method: 'PUT',
    headers: { cookie: as.cookie, 'content-type': contentType },
    body: body as never,
  });
}

describe('photo upload', () => {
  it('renders the 3:4 WebP set, keeps the original bytes, points the volume at it and audits', async () => {
    const f = await created();
    const vol = f.volumes[0]!;
    const source = await png();
    const res = await uploadPhoto(owner, vol.id, source);
    expect(res.status).toBe(200);
    const { photo } = (await res.json()) as { photo: string };
    expect(photo).toMatch(/^[a-f0-9]{16}$/);
    for (const w of [400, 800, 1200]) {
      const out = t.edges.files.files.get(`public/${photo}-${w}.webp`);
      expect(out).toBeDefined();
      const meta = await sharp(out).metadata();
      expect([meta.format, meta.width, meta.height]).toEqual(['webp', w, Math.round(w * (4 / 3))]);
    }
    expect(Buffer.from(t.edges.files.files.get(`originals/${photo}.png`)!).equals(source)).toBe(
      true,
    );
    const c = await card('nuit-blanche');
    expect(c.status === 200 && c.body.volumes[0]?.photo).toBe(photo);
    const served = await fetch(`${t.baseUrl}/media/public/${photo}-400.webp`);
    expect(served.headers.get('content-type')).toBe('image/webp');
    const [row] = await audits('catalog.photo_uploaded');
    expect(row).toMatchObject({ actorId: owner.staff.id, targetId: String(vol.id) });
    // the editor shows it
    const got = await owner.client.admin.catalog.fragrances.get({ params: { id: f.id } });
    expect(got.status === 200 && got.body.volumes[0]?.photo).toBe(photo);
  });

  it('accepts JPEG and WebP too', async () => {
    const f = await created();
    const img = sharp({ create: { width: 800, height: 1100, channels: 3, background: '#aaa' } });
    expect(
      (
        await uploadPhoto(
          owner,
          f.volumes[0]!.id,
          await img.clone().jpeg().toBuffer(),
          'image/jpeg',
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await uploadPhoto(
          owner,
          f.volumes[1]!.id,
          await img.clone().webp().toBuffer(),
          'image/webp',
        )
      ).status,
    ).toBe(200);
  });

  it('judges the type by magic bytes, not by the header', async () => {
    const f = await created();
    const id = f.volumes[0]!.id;
    const text = new TextEncoder().encode('<svg onload=alert(1)></svg>');
    expect((await uploadPhoto(owner, id, text, 'image/png')).status).toBe(415);
    expect((await uploadPhoto(owner, id, await png(), 'image/svg+xml')).status).toBe(415);
    expect([400, 415]).toContain(
      (await uploadPhoto(owner, id, await png(), 'application/json')).status,
    );
    expect((await uploadPhoto(owner, id, new Uint8Array(0), 'image/png')).status).toBe(415);
    expect(t.edges.files.files.size).toBe(0);
  });

  it('refuses a truncated image with 422 and a file over 10 MB with 413', async () => {
    const f = await created();
    const id = f.volumes[0]!.id;
    const whole = await png();
    expect((await uploadPhoto(owner, id, whole.subarray(0, 40))).status).toBe(422);
    const big = new Uint8Array(10 * 1024 * 1024 + 1);
    big.set([0x89, 0x50, 0x4e, 0x47]);
    expect((await uploadPhoto(owner, id, big)).status).toBe(413);
    const [row] = await t.db.select().from(volumes).where(eq(volumes.id, id));
    expect(row?.photoHash).toBeNull();
  });

  it('refuses a picture too small for the 400 px set, and an unknown volume', async () => {
    const f = await created();
    expect((await uploadPhoto(owner, f.volumes[0]!.id, await png(200, 260))).status).toBe(422);
    expect((await uploadPhoto(owner, 9999, await png())).status).toBe(404);
  });

  it('needs a signed-in owner', async () => {
    const f = await created();
    const res = await fetch(`${t.baseUrl}/admin/volumes/${f.volumes[0]!.id}/photo`, {
      method: 'PUT',
      headers: { 'content-type': 'image/png' },
      body: (await png()) as never,
    });
    expect(res.status).toBe(401);
  });
});

describe('dictionaries', () => {
  it('lists families and notes with how many fragrances use them', async () => {
    const res = await owner.client.admin.catalog.families.list();
    expect(res.status === 200 && res.body.length).toBeGreaterThan(0);
    const used = res.status === 200 ? res.body.filter((x) => x.uses > 0) : [];
    expect(used.length).toBeGreaterThan(0);
    const n = await owner.client.admin.catalog.notes.list();
    expect(n.status === 200 && n.body.some((x) => x.uses > 0)).toBe(true);
  });

  it('creates and edits a family and a note with RU/UZ names, normalised UZ and aliases, audited', async () => {
    const fam = await owner.client.admin.catalog.families.create({
      body: { nameRu: 'Морской', nameUz: "Dengiz, o'ng", aliases: ["dengiz o'ti", 'aqua'] },
    });
    expect(fam.status).toBe(201);
    if (fam.status !== 201) return;
    expect(fam.body).toMatchObject({
      nameUz: 'Dengiz, oʻng',
      aliases: ['dengiz oʻti', 'aqua'],
      uses: 0,
    });
    const upd = await owner.client.admin.catalog.families.update({
      params: { id: fam.body.id },
      body: { nameRu: 'Морской', nameUz: 'Dengiz', aliases: [] },
    });
    expect(upd.status === 200 && upd.body).toMatchObject({ nameUz: 'Dengiz', aliases: [] });

    const note = await owner.client.admin.catalog.notes.create({
      body: { nameRu: 'Морская соль', nameUz: 'Dengiz tuzi', aliases: ['sea salt'] },
    });
    expect(note.status).toBe(201);
    const [a] = await audits('catalog.family_created');
    expect(a).toMatchObject({ actorId: owner.staff.id, targetType: 'family' });
    expect(await audits('catalog.family_updated')).toHaveLength(1);
    expect(await audits('catalog.note_created')).toHaveLength(1);
    // the new note can be picked for a fragrance
    const noteId = note.status === 201 ? note.body.id : 0;
    const f = await created({
      notes: { top: [noteId], heart: [], base: [] },
      familyId: fam.body.id,
    });
    expect(f.notes.top).toEqual([noteId]);
    const again = await owner.client.admin.catalog.notes.list();
    expect(again.status === 200 && again.body.find((x) => x.id === noteId)?.uses).toBe(1);
  });

  it('answers 409 for a taken RU name and 404 for an unknown entry', async () => {
    const [fam] = await t.db.select().from(families).limit(1);
    const dup = await owner.client.admin.catalog.families.create({
      body: { nameRu: fam!.nameRu, nameUz: 'Boshqa', aliases: [] },
    });
    expect(dup.status).toBe(409);
    const missing = await owner.client.admin.catalog.notes.update({
      params: { id: 99999 },
      body: { nameRu: 'Х', nameUz: 'X', aliases: [] },
    });
    expect(missing.status).toBe(404);
  });

  it('requires both languages', async () => {
    expect(
      await send('POST', '/admin/catalog/notes', { nameRu: 'Ваниль 2', nameUz: ' ', aliases: [] }),
    ).toBe(400);
  });
});

describe('on hand and a stale form (ADR 0010)', () => {
  const editBody = (f: Awaited<ReturnType<typeof created>>, onHand: number, loaded: number) =>
    baseInput({
      name: 'Nuit Blanche Edit',
      volumes: [
        { ml: 10, price: 70_000, salePrice: null, saleEndsOn: null, onHand, loadedOnHand: loaded },
        { ml: 30, price: 150_000, salePrice: null, saleEndsOn: null, onHand: 5, loadedOnHand: 5 },
      ],
    });
  const stored = async (id: number) =>
    (await t.db.select().from(volumes).where(eq(volumes.id, id))).map((v) => v.onHand);

  it("keeps a manager's count when the owner saves a form loaded before it", async () => {
    const f = await created();
    const vol = f.volumes[0]!;
    await manager.client.admin.onHand.set({ params: { id: vol.id }, body: { onHand: 12 } });
    // the owner's form still carries the old count, 5, and did not touch it
    const res = await owner.client.admin.catalog.fragrances.update({
      params: { id: f.id },
      body: editBody(f, 5, 5),
    });
    expect(res.status).toBe(200);
    expect(await stored(vol.id)).toEqual([12]);
    expect(res.status === 200 && res.body.volumes[0]?.onHand).toBe(12);
    const [row] = await audits('catalog.fragrance_updated');
    expect((row?.payload as { volumes: unknown[] }).volumes).toEqual([]);
  });

  it('refuses with 409 when the owner changes a count that moved meanwhile', async () => {
    const f = await created();
    const vol = f.volumes[0]!;
    await manager.client.admin.onHand.set({ params: { id: vol.id }, body: { onHand: 12 } });
    const res = await owner.client.admin.catalog.fragrances.update({
      params: { id: f.id },
      body: editBody(f, 8, 5),
    });
    expect(res.status).toBe(409);
    expect(res.status === 409 && res.body).toEqual({
      code: 'on_hand_changed',
      fields: ['volumes.0.onHand'],
    });
    expect(await stored(vol.id)).toEqual([12]);
    // nothing else of that save went through either
    const [name] = await t.db
      .select({ n: fragrances.name })
      .from(fragrances)
      .where(eq(fragrances.id, f.id));
    expect(name?.n).toBe('Nuit Blanche');
  });

  it('writes a count the owner changed from the loaded value', async () => {
    const f = await created();
    const res = await owner.client.admin.catalog.fragrances.update({
      params: { id: f.id },
      body: editBody(f, 9, 5),
    });
    expect(res.status).toBe(200);
    expect(await stored(f.volumes[0]!.id)).toEqual([9]);
  });

  it('takes the first count of a new volume, and never writes one omitted loadedOnHand', async () => {
    const f = await created();
    const body = baseInput({
      volumes: [
        { ml: 10, price: 70_000, salePrice: null, saleEndsOn: null, onHand: 99 },
        { ml: 50, price: 250_000, salePrice: null, saleEndsOn: null, onHand: 7 },
      ],
    });
    const res = await owner.client.admin.catalog.fragrances.update({ params: { id: f.id }, body });
    expect(res.status === 200 && res.body.volumes.map((v) => [v.ml, v.onHand])).toEqual([
      [10, 5],
      [30, 5],
      [50, 7],
    ]);
  });

  it('allows a count below the reserve but flags it', async () => {
    // the reserve is 0 until order lines exist (#23), so only the flag's shape is checked here
    const f = await created();
    const res = await manager.client.admin.onHand.set({
      params: { id: f.volumes[0]!.id },
      body: { onHand: 0 },
    });
    expect(res.status === 200 && res.body).toMatchObject({ belowReserve: false, available: 0 });
  });
});

describe('admin search and apostrophes', () => {
  it("finds «Devil's» and «Devil’s» whichever way the name was typed", async () => {
    await created({ name: "Devil's Intrigue" });
    await created({ name: 'Bal d’Afrique', originalBrand: 'Byredo' });
    const names = async (q: string) =>
      (
        (await owner.client.admin.catalog.fragrances.list({ query: { q } })).body as {
          name: string;
        }[]
      ).map((f) => f.name);
    expect(await names("Devil's")).toEqual(["Devil's Intrigue"]);
    expect(await names('Devil’s')).toEqual(["Devil's Intrigue"]);
    expect(await names('devils')).toEqual(["Devil's Intrigue"]);
    expect(await names("bal d'afrique")).toEqual(['Bal d’Afrique']);
  });
});

describe('the customer search follows admin edits', () => {
  const found = async (q: string) => {
    const { client } = await t.signIn();
    const res = await client.catalog.search({ query: { q } });
    if (res.status !== 200) throw new Error(`search ${q}: HTTP ${res.status}`);
    return res.body.items.map((i) => i.slug);
  };

  it('finds a renamed fragrance by its new name, in the same save', async () => {
    const f = await created();
    expect(await found('Nuit Blanche')).toContain('nuit-blanche');
    const res = await owner.client.admin.catalog.fragrances.update({
      params: { id: f.id },
      body: baseInput({ name: 'Aurore Boreale' }),
    });
    expect(res.status).toBe(200);
    expect(await found('Aurore Boreale')).toContain('nuit-blanche');
    expect(await found('Nuit Blanche')).not.toContain('nuit-blanche');
  });

  it('finds fragrances by a renamed note', async () => {
    const [note] = await t.db.select().from(notes).limit(1);
    const f = await created({ notes: { top: [note!.id], heart: [], base: [] } });
    expect(await found('Zorbaxyl')).toEqual([]);
    const res = await owner.client.admin.catalog.notes.update({
      params: { id: note!.id },
      body: { nameRu: 'Зорбаксил', nameUz: 'Zorbaksil', aliases: ['Zorbaxyl'] },
    });
    expect(res.status).toBe(200);
    expect(await found('Zorbaxyl')).toContain('nuit-blanche');
    expect(await found('Зорбаксил')).toContain('nuit-blanche');
    expect(f.slug).toBe('nuit-blanche');
  });

  it('stops returning a hidden fragrance, and returns it again when unhidden', async () => {
    const f = await created();
    expect(await found('Nuit Blanche')).toContain('nuit-blanche');
    await owner.client.admin.catalog.fragrances.setHidden({
      params: { id: f.id },
      body: { hidden: true },
    });
    expect(await found('Nuit Blanche')).not.toContain('nuit-blanche');
    await owner.client.admin.catalog.fragrances.setHidden({
      params: { id: f.id },
      body: { hidden: false },
    });
    expect(await found('Nuit Blanche')).toContain('nuit-blanche');
  });
});
