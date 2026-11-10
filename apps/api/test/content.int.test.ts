import type { BannerInput } from '@lummi/contracts';
import { auditLog, eq, promoBanners, infoPages, settings } from '@lummi/db';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { normalizeUzbek } from '@lummi/i18n';
import { PAGE_SEEDS, SLOGAN_SEED, seedContent } from '../src/content/seed';
import { createTestApp, type StaffSession, type TestApp } from './harness/test-app';

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
  await seedContent(t.db);
  owner = await t.ownerSession();
  manager = await t.managerSession();
});

const bannerInput = (over: Partial<BannerInput> = {}): BannerInput => ({
  titleRu: 'Осенняя подборка',
  titleUz: 'Kuzgi tanlov',
  subtitleRu: 'Тёплые ароматы на вечер',
  subtitleUz: 'Kechqurun uchun iliq iforlar',
  priceLineRu: 'от 99 000 сум',
  priceLineUz: 'Narxi 99 000 soʻmdan',
  target: 'catalog',
  ...over,
});

async function photoFor(id: number, as = owner) {
  const png = await sharp({ create: { width: 800, height: 1100, channels: 3, background: '#887' } })
    .png()
    .toBuffer();
  return fetch(`${t.baseUrl}/admin/content/banners/${id}/photo`, {
    method: 'PUT',
    headers: { cookie: as.cookie, 'content-type': 'image/png' },
    body: png,
  });
}

/** A banner with a photo, ready to switch on. */
async function banner(over: Partial<BannerInput> = {}) {
  const res = await owner.client.admin.content.banners.create({ body: bannerInput(over) });
  if (res.status !== 201) throw new Error(`create failed: ${res.status}`);
  expect((await photoFor(res.body.id)).status).toBe(200);
  return res.body;
}
const audits = (action: string) => t.db.select().from(auditLog).where(eq(auditLog.action, action));

describe('customer content endpoints', () => {
  it('answers null banner and the seeded slogan before anything is set up', async () => {
    const { client } = await t.signIn();
    const home = await client.content.home();
    expect(home).toMatchObject({
      status: 200,
      body: {
        banner: null,
        slogan: { ru: 'Ароматы, которые освещают', uz: 'Lahzalaringizni yorituvchi iforlar' },
      },
    });
  });

  it('shows the active banner, RU and UZ, without any admin field', async () => {
    const b = await banner();
    await owner.client.admin.content.banners.setActive({
      params: { id: b.id },
      body: { active: true },
    });
    const { client } = await t.signIn();
    const res = await client.content.home();
    expect(res.status).toBe(200);
    if (res.status !== 200) return;
    expect(res.body.banner).toMatchObject({
      id: b.id,
      titleRu: 'Осенняя подборка',
      titleUz: 'Kuzgi tanlov',
      target: 'catalog',
    });
    expect(res.body.banner?.imageHash).toMatch(/^[a-f0-9]{16}$/);
    expect(res.body.banner).not.toHaveProperty('active');
  });

  it('lists the six pages in order, drafts included and flagged, and reads one by slug', async () => {
    const { client } = await t.signIn();
    const list = await client.content.pages();
    expect(list.status).toBe(200);
    if (list.status !== 200) return;
    expect(list.body.map((p) => p.slug)).toEqual([
      'about',
      'delivery-payment',
      'returns',
      'faq',
      'contacts',
      'offer',
    ]);
    expect(list.body.every((p) => p.draft)).toBe(true);
    const one = await client.content.page({ params: { slug: 'faq' } });
    expect(one.status).toBe(200);
    if (one.status === 200) {
      expect(one.body.bodyRu).toContain('Как оплатить?');
      expect(one.body.bodyUz).toContain('Qanday to‘layman?'.replace('‘', 'ʻ'));
    }
    expect((await client.content.page({ params: { slug: 'nope' } })).status).toBe(404);
  });

  it('needs a session but not a registered phone', async () => {
    const res = await fetch(`${t.baseUrl}/content/pages`);
    expect(res.status).toBe(401);
    const { client } = await t.signIn();
    expect((await client.content.pages()).status).toBe(200);
  });

  it('fills the delivery numbers and the manager from the settings when a page is read', async () => {
    await t.db.insert(settings).values([
      { key: 'pricing.freeDeliveryThreshold', value: 300_000 },
      { key: 'delivery.defaultTariff', value: 30_000 },
      { key: 'shop.managerUsername', value: '@other_manager' },
      { key: 'orders.reserveTtlSeconds', value: 5400 },
    ]);
    const { client } = await t.signIn();
    const dp = await client.content.page({ params: { slug: 'delivery-payment' } });
    const contacts = await client.content.page({ params: { slug: 'contacts' } });
    if (dp.status !== 200 || contacts.status !== 200) throw new Error('read');
    expect(dp.body.bodyRu).toContain('300\u202f000\u202fсум');
    expect(dp.body.bodyRu).toContain('30\u202f000\u202fсум');
    // the UZ «from» suffix sits on the amount: «300 000 soʻmdan»
    expect(dp.body.bodyUz).toContain('300\u202f000\u202fsoʻmdan');
    // the payment window follows the reserve setting (ADR 0012)
    expect(dp.body.bodyRu).toContain('есть 90 минут');
    expect(dp.body.bodyUz).toContain('90 daqiqa vaqtingiz bor');
    expect(dp.body.bodyRu).toContain('до 48 часов');
    expect(contacts.body.bodyRu).toContain('[@other_manager](https://t.me/other_manager)');
    expect(`${dp.body.bodyRu}${dp.body.bodyUz}${contacts.body.bodyUz}`).not.toMatch(
      /\{(freeDeliveryThreshold|defaultTariff|managerUsername|managerLink|reserveTime)\}/,
    );
    // the admin keeps the placeholders, so the owner edits the template
    const admin = await owner.client.admin.content.pages.list();
    if (admin.status !== 200) throw new Error('admin list');
    expect(admin.body.find((p) => p.slug === 'delivery-payment')?.bodyRu).toContain(
      '{freeDeliveryThreshold}',
    );
  });

  it('the seeded UZ texts are written as an admin save stores them (oʻ and gʻ with U+02BB)', () => {
    const uz = [SLOGAN_SEED.uz, ...PAGE_SEEDS.flatMap((p) => [p.titleUz, p.bodyUz])];
    for (const text of uz) {
      expect(text).not.toMatch(/\p{L}[\u2018']\p{L}/u);
      expect(normalizeUzbek(text)).toBe(text);
    }
  });

  it('the seeded drafts follow the copy rules', () => {
    const all = PAGE_SEEDS.flatMap((p) => [p.bodyRu, p.bodyUz, p.titleRu, p.titleUz]).join('\n');
    expect(all).not.toMatch(/оригинал|копия|реплика|[Oo]riginal/);
  });
});

describe('owner-only editing', () => {
  it('answers a manager 403 on every content route', async () => {
    const m = manager.client.admin.content;
    const calls = [
      m.banners.list(),
      m.banners.create({ body: bannerInput() }),
      m.banners.update({ params: { id: 1 }, body: bannerInput() }),
      m.banners.setActive({ params: { id: 1 }, body: { active: true } }),
      m.banners.remove({ params: { id: 1 } }),
      m.slogan.get(),
      m.slogan.set({ body: { ru: 'a', uz: 'b' } }),
      m.pages.list(),
      m.pages.update({
        params: { slug: 'faq' },
        body: { titleRu: 'a', titleUz: 'b', bodyRu: '', bodyUz: '', draft: false },
      }),
    ];
    for (const res of await Promise.all(calls)) expect(res.status).toBe(403);
    expect((await photoFor(1, manager)).status).toBe(403);
    expect(await t.db.select().from(promoBanners)).toHaveLength(0);
  });

  it('answers an anonymous visitor 401', async () => {
    const res = await fetch(`${t.baseUrl}/admin/content/pages`);
    expect(res.status).toBe(401);
  });
});

describe('banners', () => {
  it('keeps at most one active: activating one switches the other off', async () => {
    const a = await banner();
    const b = await banner({ titleRu: 'Другой баннер', titleUz: 'Boshqa banner' });
    const act = (id: number) =>
      owner.client.admin.content.banners.setActive({ params: { id }, body: { active: true } });
    expect((await act(a.id)).status).toBe(200);
    expect((await act(b.id)).status).toBe(200);
    const list = await owner.client.admin.content.banners.list();
    expect(list.status === 200 && list.body.filter((x) => x.active).map((x) => x.id)).toEqual([
      b.id,
    ]);
    const [row] = await audits('content.banner_activated').then((r) =>
      r.filter((x) => x.targetId === String(b.id)),
    );
    expect(row?.payload).toMatchObject({ switchedOff: [a.id] });
  });

  it('audits and touches only the banner that was active, with three banners', async () => {
    const a = await banner();
    const b = await banner();
    const c = await banner();
    const act = (id: number) =>
      owner.client.admin.content.banners.setActive({ params: { id }, body: { active: true } });
    await act(a.id);
    const [cBefore] = await t.db.select().from(promoBanners).where(eq(promoBanners.id, c.id));
    await act(b.id);
    const [row] = (await audits('content.banner_activated')).filter(
      (x) => x.targetId === String(b.id),
    );
    expect(row?.payload).toMatchObject({ switchedOff: [a.id] });
    const [cAfter] = await t.db.select().from(promoBanners).where(eq(promoBanners.id, c.id));
    expect(cAfter?.updatedAt).toEqual(cBefore?.updatedAt);
  });

  it('two activations at once end with exactly one active banner and no error', async () => {
    const a = await banner();
    const b = await banner();
    const c = await banner();
    const act = (id: number) =>
      owner.client.admin.content.banners.setActive({ params: { id }, body: { active: true } });
    for (const first of [
      [a.id, b.id],
      [b.id, c.id],
      [c.id, a.id],
    ] as const) {
      const results = await Promise.all(first.map(act));
      expect(results.map((r) => r.status)).toEqual([200, 200]);
      const active = await t.db.select().from(promoBanners).where(eq(promoBanners.active, true));
      expect(active).toHaveLength(1);
    }
  });

  it('is enforced by the database, not only by the service', async () => {
    const a = await banner();
    const b = await banner();
    await t.db.update(promoBanners).set({ active: true }).where(eq(promoBanners.id, a.id));
    await expect(
      t.db.update(promoBanners).set({ active: true }).where(eq(promoBanners.id, b.id)),
    ).rejects.toThrow();
  });

  it('refuses to activate a banner without a photo', async () => {
    const res = await owner.client.admin.content.banners.create({ body: bannerInput() });
    if (res.status !== 201) throw new Error('create');
    const act = await owner.client.admin.content.banners.setActive({
      params: { id: res.body.id },
      body: { active: true },
    });
    expect(act).toMatchObject({ status: 422, body: { fields: ['image'] } });
  });

  it('refuses a startapp target the Mini App would not open, and accepts a fragrance link', async () => {
    const bad = await fetch(`${t.baseUrl}/admin/content/banners`, {
      method: 'POST',
      headers: { cookie: owner.cookie, 'content-type': 'application/json' },
      body: JSON.stringify(bannerInput({ target: 'admin' })),
    });
    expect(bad.status).toBe(400);
    const ok = await owner.client.admin.content.banners.create({
      body: bannerInput({ target: 'p_tygar' }),
    });
    expect(ok.status).toBe(201);
  });

  it('normalises Uzbek apostrophes on save and audits the change; a no-op writes nothing', async () => {
    const res = await owner.client.admin.content.banners.create({
      body: bannerInput({
        titleUz: "O'zbek tanlov",
        subtitleUz: "Ma'lumot, g`oyat",
        priceLineUz: "so'mdan",
      }),
    });
    if (res.status !== 201) throw new Error('create');
    expect(res.body.titleUz).toBe('Oʻzbek tanlov');
    expect(res.body.subtitleUz).toBe('Ma’lumot, gʻoyat');
    expect(res.body.priceLineUz).toBe('soʻmdan');
    const same = await owner.client.admin.content.banners.update({
      params: { id: res.body.id },
      body: bannerInput({
        titleUz: "O'zbek tanlov",
        subtitleUz: "Ma'lumot, g`oyat",
        priceLineUz: "so'mdan",
        titleRu: res.body.titleRu,
        subtitleRu: res.body.subtitleRu,
        priceLineRu: res.body.priceLineRu,
      }),
    });
    expect(same.status).toBe(200);
    expect(await audits('content.banner_updated')).toHaveLength(0);
    await owner.client.admin.content.banners.update({
      params: { id: res.body.id },
      body: bannerInput({ titleRu: 'Новое имя' }),
    });
    const [row] = await audits('content.banner_updated');
    expect(row).toMatchObject({ actorId: owner.staff.id });
    expect(row?.payload).toMatchObject({ changed: { titleRu: [res.body.titleRu, 'Новое имя'] } });
  });

  it('judges the photo by its bytes and renders the served set', async () => {
    const res = await owner.client.admin.content.banners.create({ body: bannerInput() });
    if (res.status !== 201) throw new Error('create');
    const fake = await fetch(`${t.baseUrl}/admin/content/banners/${res.body.id}/photo`, {
      method: 'PUT',
      headers: { cookie: owner.cookie, 'content-type': 'image/png' },
      body: Buffer.from('<svg onload="alert(1)"></svg>'),
    });
    expect(fake.status).toBe(415);
    const small = await sharp({
      create: { width: 100, height: 100, channels: 3, background: '#000' },
    })
      .png()
      .toBuffer();
    const tiny = await fetch(`${t.baseUrl}/admin/content/banners/${res.body.id}/photo`, {
      method: 'PUT',
      headers: { cookie: owner.cookie, 'content-type': 'image/png' },
      body: small,
    });
    expect(tiny.status).toBe(422);
    const good = await photoFor(res.body.id);
    expect(good.status).toBe(200);
    const body = (await good.json()) as { imageHash: string };
    expect(t.edges.files.files.has(`public/${body.imageHash}-800.webp`)).toBe(true);
    expect(await audits('content.banner_photo_uploaded')).toHaveLength(1);
  });

  it('deletes a banner, and Home falls back to no banner', async () => {
    const b = await banner();
    await owner.client.admin.content.banners.setActive({
      params: { id: b.id },
      body: { active: true },
    });
    const del = await owner.client.admin.content.banners.remove({ params: { id: b.id } });
    expect(del.status).toBe(200);
    const { client } = await t.signIn();
    expect(await client.content.home()).toMatchObject({ body: { banner: null } });
    expect(await audits('content.banner_deleted')).toHaveLength(1);
  });
});

describe('slogan and pages', () => {
  it('saves the slogan with normalised UZ, audits it and shows it to customers', async () => {
    const res = await owner.client.admin.content.slogan.set({
      body: { ru: 'Свет в каждом дне', uz: "Har kuni nur, g'oya" },
    });
    expect(res).toMatchObject({
      status: 200,
      body: { ru: 'Свет в каждом дне', uz: 'Har kuni nur, gʻoya' },
    });
    const { client } = await t.signIn();
    expect(await client.content.home()).toMatchObject({
      body: { slogan: { uz: 'Har kuni nur, gʻoya' } },
    });
    expect(await audits('content.slogan_changed')).toHaveLength(1);
    // saving the same text again writes nothing
    await owner.client.admin.content.slogan.set({
      body: { ru: 'Свет в каждом дне', uz: "Har kuni nur, g'oya" },
    });
    expect(await audits('content.slogan_changed')).toHaveLength(1);
  });

  it('refuses a slogan longer than one line on a 360 px phone (32 RU, 38 UZ characters)', async () => {
    const ru32 = 'Ароматы для важных моментов дня';
    const uz38 = 'Lahzalaringizni yorituvchi iforlar uz';
    expect([ru32.length, uz38.length]).toEqual([31, 37]);
    const set = (ru: string, uz: string) =>
      owner.client.admin.content.slogan.set({ body: { ru, uz } });
    expect((await set(`${ru32}!`, `${uz38}!`)).status).toBe(200);
    expect((await set(`${ru32}!!`, uz38)).status).toBe(422);
    expect((await set(ru32, `${uz38}!!`)).status).toBe(422);
  });

  it('edits a page, flips its draft flag, normalises the UZ body and audits the flag', async () => {
    const res = await owner.client.admin.content.pages.update({
      params: { slug: 'returns' },
      body: {
        titleRu: 'Возврат',
        titleUz: "Qaytarish va o'zgartirish",
        bodyRu: 'Новый текст.',
        bodyUz: "Yangi matn: o'zbek tilida, ma'lumot.",
        draft: false,
      },
    });
    expect(res.status).toBe(200);
    if (res.status !== 200) return;
    expect(res.body).toMatchObject({
      draft: false,
      titleUz: 'Qaytarish va oʻzgartirish',
      bodyUz: 'Yangi matn: oʻzbek tilida, ma’lumot.',
    });
    const [row] = await audits('content.page_updated');
    expect(row).toMatchObject({ actorId: owner.staff.id, targetId: 'returns' });
    expect(row?.payload).toMatchObject({ draft: [true, false] });
    const { client } = await t.signIn();
    const page = await client.content.page({ params: { slug: 'returns' } });
    expect(page).toMatchObject({ status: 200, body: { draft: false, bodyRu: 'Новый текст.' } });
  });

  it('stores a body with markup as text and hands it back unchanged (rendering never makes HTML)', async () => {
    const evil = 'Привет <script>alert(1)</script> **жирный** [x](javascript:alert(1))';
    const res = await owner.client.admin.content.pages.update({
      params: { slug: 'about' },
      body: {
        titleRu: 'О бренде',
        titleUz: 'Brend haqida',
        bodyRu: evil,
        bodyUz: evil,
        draft: true,
      },
    });
    expect(res.status).toBe(200);
    const [row] = await t.db.select().from(infoPages).where(eq(infoPages.slug, 'about'));
    expect(row?.bodyRu).toBe(evil);
  });

  it('answers 404 for a slug that is not one of the six', async () => {
    const res = await owner.client.admin.content.pages.update({
      params: { slug: 'secret' },
      body: { titleRu: 'a', titleUz: 'b', bodyRu: 'c', bodyUz: 'd', draft: true },
    });
    expect(res.status).toBe(404);
  });
});
