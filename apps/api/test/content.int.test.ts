import { ACTIVE_BANNERS_MAX, type BannerInput } from '@lummi/contracts';
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
const activate = (id: number) =>
  owner.client.admin.content.banners.setActive({ params: { id }, body: { active: true } });
const move = (id: number, direction: 'up' | 'down') =>
  owner.client.admin.content.banners.move({ params: { id }, body: { direction } });
/** The slides after the Discovery set, as a customer's Home gets them. */
async function sliderIds() {
  const { client } = await t.signIn();
  const res = await client.content.home();
  if (res.status !== 200) throw new Error(`home: ${res.status}`);
  return res.body.banners.map((b) => b.id);
}

describe('customer content endpoints', () => {
  it('answers no banners and the seeded slogan before anything is set up', async () => {
    const { client } = await t.signIn();
    const home = await client.content.home();
    expect(home).toMatchObject({
      status: 200,
      body: {
        banners: [],
        slogan: { ru: 'Ароматы, которые освещают', uz: 'Lahzalaringizni yorituvchi iforlar' },
      },
    });
  });

  it('shows every active banner in the owner’s order, RU and UZ, without any admin field; inactive ones are left out', async () => {
    const a = await banner();
    const off = await banner({ titleRu: 'Черновик', titleUz: 'Qoralama' });
    const b = await banner({ titleRu: 'Второй', titleUz: 'Ikkinchi', target: 'p_tygar' });
    expect((await activate(a.id)).status).toBe(200);
    expect((await activate(b.id)).status).toBe(200);
    const { client } = await t.signIn();
    const res = await client.content.home();
    expect(res.status).toBe(200);
    if (res.status !== 200) return;
    expect(res.body.banners.map((x) => x.id)).toEqual([a.id, b.id]);
    expect(res.body.banners.map((x) => x.id)).not.toContain(off.id);
    expect(res.body.banners[0]).toMatchObject({
      id: a.id,
      titleRu: 'Осенняя подборка',
      titleUz: 'Kuzgi tanlov',
      target: 'catalog',
    });
    expect(res.body.banners[1]).toMatchObject({ titleUz: 'Ikkinchi', target: 'p_tygar' });
    expect(res.body.banners[0]?.imageHash).toMatch(/^[a-f0-9]{16}$/);
    expect(res.body.banners[0]).not.toHaveProperty('active');
    expect(res.body.banners[0]).not.toHaveProperty('position');
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
      { key: 'delivery.etaHours', value: 72 },
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
    expect(dp.body.bodyRu).toContain('до 72 часов');
    expect(dp.body.bodyUz).toContain('72 soatgacha');
    expect(contacts.body.bodyRu).toContain('[@other_manager](https://t.me/other_manager)');
    expect(`${dp.body.bodyRu}${dp.body.bodyUz}${contacts.body.bodyUz}`).not.toMatch(
      /\{(freeDeliveryThreshold|defaultTariff|managerUsername|managerLink|reserveTime|deliveryTerm)\}/,
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
      m.banners.move({ params: { id: 1 }, body: { direction: 'up' } }),
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
  it('keeps several banners on at once: switching one on leaves the others on and puts it last', async () => {
    const a = await banner();
    const b = await banner({ titleRu: 'Другой баннер', titleUz: 'Boshqa banner' });
    const c = await banner({ titleRu: 'Третий', titleUz: 'Uchinchi' });
    for (const x of [b, a, c]) expect((await activate(x.id)).status).toBe(200);
    expect(await sliderIds()).toEqual([b.id, a.id, c.id]);
    const list = await owner.client.admin.content.banners.list();
    if (list.status !== 200) throw new Error('list');
    expect(list.body.filter((x) => x.active).map((x) => x.id)).toEqual([b.id, a.id, c.id]);
    // switching one on again changes nothing and writes nothing
    expect((await activate(a.id)).status).toBe(200);
    expect(await audits('content.banner_activated')).toHaveLength(3);
  });

  it('audits switching on and off with the banner’s name and the slider after it; no switchedOff', async () => {
    const a = await banner();
    const b = await banner({ titleRu: 'Другой баннер', titleUz: 'Boshqa banner' });
    await activate(a.id);
    await activate(b.id);
    const [on] = (await audits('content.banner_activated')).filter(
      (x) => x.targetId === String(b.id),
    );
    expect(on).toMatchObject({ actorId: owner.staff.id, targetType: 'promo_banner' });
    expect(on?.payload).toEqual({
      title: 'Другой баннер',
      slider: [
        { id: a.id, title: 'Осенняя подборка' },
        { id: b.id, title: 'Другой баннер' },
      ],
    });
    expect(on?.payload).not.toHaveProperty('switchedOff');
    const offRes = await owner.client.admin.content.banners.setActive({
      params: { id: a.id },
      body: { active: false },
    });
    expect(offRes.status).toBe(200);
    const [off] = await audits('content.banner_deactivated');
    expect(off?.payload).toEqual({
      title: 'Осенняя подборка',
      slider: [{ id: b.id, title: 'Другой баннер' }],
    });
    expect(await sliderIds()).toEqual([b.id]);
    // switched on again, it comes back as the last slide
    await activate(a.id);
    expect(await sliderIds()).toEqual([b.id, a.id]);
  });

  it(`switches on at most ${ACTIVE_BANNERS_MAX}: one more is refused (422 limit) until one goes off`, async () => {
    const on = [];
    for (let i = 0; i < ACTIVE_BANNERS_MAX; i++) {
      const x = await banner({ titleRu: `Баннер ${i + 1}` });
      expect((await activate(x.id)).status).toBe(200);
      on.push(x.id);
    }
    const extra = await banner({ titleRu: 'Лишний' });
    expect(await activate(extra.id)).toMatchObject({ status: 422, body: { fields: ['limit'] } });
    expect(await sliderIds()).toEqual(on);
    await owner.client.admin.content.banners.setActive({
      params: { id: on[0]! },
      body: { active: false },
    });
    expect((await activate(extra.id)).status).toBe(200);
    expect(await sliderIds()).toEqual([...on.slice(1), extra.id]);
  });

  it('activations at once never pass the cap and never share a place', async () => {
    const all = [];
    for (let i = 0; i < ACTIVE_BANNERS_MAX + 2; i++) all.push(await banner());
    const results = await Promise.all(all.map((x) => activate(x.id)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(ACTIVE_BANNERS_MAX);
    expect(results.filter((r) => r.status === 422)).toHaveLength(2);
    const rows = await t.db.select().from(promoBanners).where(eq(promoBanners.active, true));
    expect(new Set(rows.map((r) => r.position)).size).toBe(ACTIVE_BANNERS_MAX);
  });

  it('moves an active banner up or down, keeps the order for Home, and audits the move with names', async () => {
    const a = await banner({ titleRu: 'Первый' });
    const b = await banner({ titleRu: 'Второй' });
    const c = await banner({ titleRu: 'Третий' });
    for (const x of [a, b, c]) await activate(x.id);
    const res = await move(c.id, 'up');
    expect(res.status).toBe(200);
    if (res.status !== 200) return;
    expect(res.body.filter((x) => x.active).map((x) => x.id)).toEqual([a.id, c.id, b.id]);
    expect(await sliderIds()).toEqual([a.id, c.id, b.id]);
    const [row] = await audits('content.banner_moved');
    expect(row).toMatchObject({
      actorId: owner.staff.id,
      targetType: 'promo_banner',
      targetId: String(c.id),
    });
    expect(row?.payload).toEqual({
      title: 'Третий',
      direction: 'up',
      before: [
        { id: a.id, title: 'Первый' },
        { id: b.id, title: 'Второй' },
        { id: c.id, title: 'Третий' },
      ],
      after: [
        { id: a.id, title: 'Первый' },
        { id: c.id, title: 'Третий' },
        { id: b.id, title: 'Второй' },
      ],
    });
    await move(a.id, 'down');
    expect(await sliderIds()).toEqual([c.id, a.id, b.id]);
    // the order survives switching another banner off and on (it comes back last)
    await owner.client.admin.content.banners.setActive({
      params: { id: c.id },
      body: { active: false },
    });
    await activate(c.id);
    expect(await sliderIds()).toEqual([a.id, b.id, c.id]);
  });

  it('moving the first slide up or the last down changes nothing and writes nothing', async () => {
    const a = await banner();
    const b = await banner();
    await activate(a.id);
    await activate(b.id);
    expect((await move(a.id, 'up')).status).toBe(200);
    expect((await move(b.id, 'down')).status).toBe(200);
    expect(await sliderIds()).toEqual([a.id, b.id]);
    expect(await audits('content.banner_moved')).toHaveLength(0);
  });

  it('refuses to move a banner that is off (422 active) or unknown (404)', async () => {
    const a = await banner();
    expect(await move(a.id, 'up')).toMatchObject({ status: 422, body: { fields: ['active'] } });
    expect((await move(a.id + 100, 'up')).status).toBe(404);
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

  it('deletes a banner, and Home keeps the other slides', async () => {
    const a = await banner();
    const b = await banner();
    await activate(a.id);
    await activate(b.id);
    const del = await owner.client.admin.content.banners.remove({ params: { id: a.id } });
    expect(del.status).toBe(200);
    expect(await sliderIds()).toEqual([b.id]);
    await owner.client.admin.content.banners.remove({ params: { id: b.id } });
    const { client } = await t.signIn();
    expect(await client.content.home()).toMatchObject({ body: { banners: [] } });
    expect(await audits('content.banner_deleted')).toHaveLength(2);
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
    // the contract's body schema refuses it before the handler, as for a banner target (400)
    const set = (ru: string, uz: string) =>
      fetch(`${t.baseUrl}/admin/content/slogan`, {
        method: 'PUT',
        headers: { cookie: owner.cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ ru, uz }),
      });
    expect((await set(`${ru32}!`, `${uz38}!`)).status).toBe(200);
    expect((await set(`${ru32}!!`, uz38)).status).toBe(400);
    expect((await set(ru32, `${uz38}!!`)).status).toBe(400);
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
