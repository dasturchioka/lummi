import { auditLog, customers, eq, staff } from '@lummi/db';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PROFILE_PHOTO_SIZES } from '@lummi/contracts';
import { profilePhotoKey } from '../src/profile-photo/profile-photo-pipeline';
import { createTestApp, type StaffSession, type TestApp } from './harness/test-app';

let t: TestApp;
let owner: StaffSession;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
beforeEach(async () => {
  await t.reset();
  t.edges.files.files.clear();
  t.edges.telegramFiles.files.clear();
  t.edges.telegramFiles.urls.clear();
  t.edges.telegramFiles.urlDownloads.length = 0;
  t.edges.telegramFiles.downloads.length = 0;
  owner = await t.ownerSession();
});

const PHOTO_URL = 'https://t.me/i/userpic/320/abc.jpg';

async function image(
  width: number,
  height: number,
  format: 'png' | 'jpeg' | 'webp' = 'png',
  shade = 180,
) {
  const img = sharp({
    create: { width, height, channels: 3, background: { r: shade, g: 120, b: 90 } },
  });
  return img[format]().toBuffer();
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
async function signIn(id: number, photoUrl?: string) {
  const user = { id, first_name: `U${id}`, ...(photoUrl ? { photo_url: photoUrl } : {}) };
  const { token } = await t.signIn(user);
  return { token, id };
}
const put = (token: string, body: Uint8Array, type = 'image/png') =>
  fetch(`${t.baseUrl}/me/photo`, {
    method: 'PUT',
    headers: { ...bearer(token), 'content-type': type },
    body: body as never,
  });
const post = (token: string) =>
  fetch(`${t.baseUrl}/me/photo/telegram`, { method: 'POST', headers: bearer(token) });
const del = (token: string) =>
  fetch(`${t.baseUrl}/me/photo`, { method: 'DELETE', headers: bearer(token) });
const keysOf = (hash: string) => PROFILE_PHOTO_SIZES.map((s) => profilePhotoKey(hash, s));
const stored = () => [...t.edges.files.files.keys()].filter((k) => k.startsWith('profile-photos/'));

describe('customer profile photo upload', () => {
  it('crops a non-square photo to a centred square, stores three WebP sizes and audits', async () => {
    const { token, id } = await signIn(1);
    const res = await put(token, await image(1200, 600));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { photo: string };
    expect(body.photo).toMatch(/^[a-f0-9]{32}$/);
    for (const size of PROFILE_PHOTO_SIZES) {
      const file = await t.edges.files.get(profilePhotoKey(body.photo, size));
      const meta = await sharp(file!).metadata();
      expect([meta.format, meta.width, meta.height]).toEqual(['webp', size, size]);
    }
    expect(stored()).toHaveLength(3);
    // no original is kept
    expect([...t.edges.files.files.keys()].some((k) => k.startsWith('originals/'))).toBe(false);
    const served = await fetch(`${t.baseUrl}/profile-photos/${body.photo}-192.webp`);
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('image/webp');
    expect(served.headers.get('cache-control')).toBe('private, max-age=86400');
    // not on the product-photo route
    expect((await fetch(`${t.baseUrl}/media/public/${body.photo}-192.webp`)).status).toBe(404);
    const me = await t.client.me.get({ extraHeaders: bearer(token) });
    expect(me.status === 200 && me.body.photo).toBe(body.photo);
    const [entry] = await t.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'customer.photo_changed'));
    expect(entry).toMatchObject({ actorType: 'customer', actorId: id, targetId: String(id) });
    expect(entry!.payload).toEqual({ photo: [null, body.photo], source: 'upload' });
  });

  it('takes JPEG, PNG and WebP, refuses other types and oversized bodies', async () => {
    const { token } = await signIn(1);
    expect((await put(token, await image(300, 300, 'jpeg'), 'image/jpeg')).status).toBe(200);
    expect((await put(token, await image(300, 300, 'webp'), 'image/webp')).status).toBe(200);
    expect((await put(token, await image(300, 300, 'png'), 'image/png')).status).toBe(200);
    // the type is judged by magic bytes, not the header
    expect((await put(token, new TextEncoder().encode('<svg/>'), 'image/png')).status).toBe(415);
    expect((await put(token, new Uint8Array(0))).status).toBe(415);
    expect((await put(token, new Uint8Array(10 * 1024 * 1024 + 1).fill(1))).status).toBe(413);
    // looks like a PNG but is not decodable
    const broken = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(64)]);
    expect((await put(token, broken)).status).toBe(422);
  });

  it('needs a session', async () => {
    const res = await fetch(`${t.baseUrl}/me/photo`, {
      method: 'PUT',
      headers: { 'content-type': 'image/png' },
      body: (await image(100, 100)) as never,
    });
    expect(res.status).toBe(401);
  });

  it('replacing deletes the old renditions; removing deletes the rest; both audited', async () => {
    const { token } = await signIn(1);
    const first = (await (await put(token, await image(500, 500, 'png', 50))).json()) as {
      photo: string;
    };
    const second = (await (await put(token, await image(500, 500, 'png', 200))).json()) as {
      photo: string;
    };
    expect(second.photo).not.toBe(first.photo);
    expect(stored().sort()).toEqual(keysOf(second.photo).sort());
    const gone = await del(token);
    expect(gone.status).toBe(200);
    expect((await gone.json()) as { photo: null }).toMatchObject({ photo: null });
    expect(stored()).toEqual([]);
    const actions = await t.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'customer.photo_changed'));
    expect(actions.map((a) => (a.payload as { source: string }).source)).toEqual([
      'upload',
      'upload',
      'removed',
    ]);
    // removing again changes nothing and writes nothing
    expect((await del(token)).status).toBe(200);
    expect(
      await t.db.select().from(auditLog).where(eq(auditLog.action, 'customer.photo_changed')),
    ).toHaveLength(3);
  });

  it("one customer cannot touch another's photo; names are random and never shared", async () => {
    const a = await signIn(1);
    const b = await signIn(2);
    const bytes = await image(400, 400);
    const pa = (await (await put(a.token, bytes)).json()) as { photo: string };
    const pb = (await (await put(b.token, bytes)).json()) as { photo: string };
    expect(pb.photo).not.toBe(pa.photo); // identical bytes, two owners, two unrelated names
    expect(stored()).toHaveLength(6);
    await del(a.token);
    const [rowB] = await t.db.select().from(customers).where(eq(customers.id, b.id));
    expect(rowB!.photoKey).toBe(pb.photo);
    expect(stored().sort()).toEqual(keysOf(pb.photo).sort());
    await del(b.token);
    expect(stored()).toHaveLength(0);
    // another customer's photo is never reachable: no id in any path
    const other = await put(a.token, await image(400, 400, 'png', 99));
    expect(((await other.json()) as { id: number }).id).toBe(a.id);
    const [rowB2] = await t.db.select().from(customers).where(eq(customers.id, b.id));
    expect(rowB2!.photoKey).toBeNull();
  });

  it('drops EXIF and GPS, applies the orientation, and refuses SVG, GIF and oversized pixels', async () => {
    const { token } = await signIn(1);
    const withExif = await sharp({
      create: { width: 600, height: 300, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .jpeg()
      .withExif({ IFD0: { Copyright: 'secret' }, IFD3: { GPSLatitudeRef: 'N' } })
      .toBuffer();
    expect((await sharp(withExif).metadata()).exif).toBeDefined();
    const res = await put(token, withExif, 'image/jpeg');
    expect(res.status).toBe(200);
    const { photo } = (await res.json()) as { photo: string };
    for (const size of PROFILE_PHOTO_SIZES) {
      const meta = await sharp((await t.edges.files.get(profilePhotoKey(photo, size)))!).metadata();
      expect(meta.exif).toBeUndefined();
      expect(meta.icc).toBeUndefined();
    }
    const gif = await sharp({ create: { width: 50, height: 50, channels: 3, background: '#fff' } })
      .gif()
      .toBuffer();
    expect((await put(token, gif, 'image/png')).status).toBe(415);
    // a decompression bomb: far more pixels than the 40 Mpx guard, tiny on the wire
    const bomb = await sharp({
      create: { width: 9000, height: 9000, channels: 3, background: '#000' },
    })
      .png({ compressionLevel: 9 })
      .toBuffer();
    expect(bomb.length).toBeLessThan(10 * 1024 * 1024);
    expect((await put(token, bomb)).status).toBe(422);
  });

  it('throttles changes per customer by photos.changesPerHour, 429, and frees up after an hour', async () => {
    t.edges.clock.set(new Date('2026-11-18T10:00:00Z'));
    const { token } = await signIn(1);
    const other = await signIn(2);
    for (let i = 0; i < 10; i++)
      expect((await put(token, await image(200, 200, 'png', 10 + i))).status).toBe(200);
    const blocked = await put(token, await image(200, 200, 'png', 99));
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toMatchObject({ code: 'too_many' });
    expect((await del(token)).status).toBe(429);
    // another customer is unaffected
    expect((await put(other.token, await image(200, 200))).status).toBe(200);
    t.edges.clock.set(new Date('2026-11-18T11:00:01Z'));
    const again = await signIn(1);
    expect((await put(again.token, await image(200, 200, 'png', 99))).status).toBe(200);
  });

  it('signs in again without a photo_url: the stored Telegram URL is cleared', async () => {
    const { token } = await signIn(7, PHOTO_URL);
    const [before] = await t.db.select().from(customers).where(eq(customers.telegramId, 7));
    expect(before!.telegramPhotoUrl).toBe(PHOTO_URL);
    const again = await signIn(7);
    const [after] = await t.db.select().from(customers).where(eq(customers.telegramId, 7));
    expect(after!.telegramPhotoUrl).toBeNull();
    const me = await t.client.me.get({ extraHeaders: bearer(again.token) });
    expect(me.status === 200 && me.body.telegramPhoto).toBe(false);
    void token;
  });
});

describe('customer Telegram photo', () => {
  it('is offered only when Telegram gave a photo_url, and the server fetches it itself', async () => {
    const without = await signIn(1);
    const withUrl = await signIn(2, PHOTO_URL);
    const meOf = async (token: string) => {
      const r = await t.client.me.get({ extraHeaders: bearer(token) });
      return r.status === 200 ? r.body : null;
    };
    expect((await meOf(without.token))?.telegramPhoto).toBe(false);
    expect((await meOf(withUrl.token))?.telegramPhoto).toBe(true);

    t.edges.telegramFiles.urls.set(PHOTO_URL, await image(640, 640));
    const res = await post(withUrl.token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { photo: string };
    expect(stored().sort()).toEqual(keysOf(body.photo).sort());
    expect(t.edges.telegramFiles.urlDownloads).toEqual([PHOTO_URL]);
    const [entry] = await t.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'customer.photo_changed'));
    expect((entry!.payload as { source: string }).source).toBe('telegram');
  });

  it("falls back to the bot's getUserProfilePhotos when the URL gives nothing", async () => {
    const { token } = await signIn(3, PHOTO_URL); // the URL is not served by the fake
    t.edges.telegram.profilePhotos.set(3, 'file-3');
    t.edges.telegramFiles.files.set('file-3', await image(500, 500));
    expect((await post(token)).status).toBe(200);
    expect(t.edges.telegramFiles.downloads).toEqual(['file-3']);
  });

  it('answers 404 no_telegram_photo when there is none, and changes nothing', async () => {
    const { token } = await signIn(4);
    const res = await post(token);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: 'no_telegram_photo' });
    expect(stored()).toEqual([]);
    expect(
      await t.db.select().from(auditLog).where(eq(auditLog.action, 'customer.photo_changed')),
    ).toEqual([]);
  });

  it('applies the same image check to Telegram bytes: an SVG is refused', async () => {
    const { token } = await signIn(8, PHOTO_URL);
    t.edges.telegramFiles.urls.set(
      PHOTO_URL,
      new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    );
    const res = await post(token);
    expect(res.status).toBe(404);
    expect(stored()).toEqual([]);
  });

  it('never takes a URL from the client', async () => {
    const { token } = await signIn(5);
    t.edges.telegramFiles.urls.set('https://evil.test/x.png', await image(200, 200));
    const res = await fetch(`${t.baseUrl}/me/photo/telegram`, {
      method: 'POST',
      headers: { ...bearer(token), 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://evil.test/x.png' }),
    });
    expect(res.status).toBe(404);
    expect(t.edges.telegramFiles.urlDownloads).toEqual([]);
  });
});

describe('staff profile photo', () => {
  const putStaff = (as: StaffSession, body: Uint8Array) =>
    fetch(`${t.baseUrl}/admin/me/photo`, {
      method: 'PUT',
      headers: { cookie: as.cookie, 'content-type': 'image/png' },
      body: body as never,
    });

  it('uploads, shows on /admin/me and the staff list, audits as staff.photo_changed', async () => {
    const res = await putStaff(owner, await image(800, 500));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { photo: string; id: number };
    expect(stored().sort()).toEqual(keysOf(body.photo).sort());
    const list = await owner.client.admin.staff.list();
    expect(list.status === 200 && list.body.find((s) => s.id === owner.staff.id)?.photo).toBe(
      body.photo,
    );
    const [entry] = await t.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'staff.photo_changed'));
    expect(entry).toMatchObject({ actorType: 'staff', actorId: owner.staff.id });
  });

  it("a staff member only ever changes their own: a manager's upload leaves the owner's alone", async () => {
    const manager = await t.managerSession();
    const mine = (await (await putStaff(owner, await image(400, 400, 'png', 40))).json()) as {
      photo: string;
    };
    const theirs = (await (await putStaff(manager, await image(400, 400, 'png', 220))).json()) as {
      photo: string;
      id: number;
    };
    expect(theirs.id).toBe(manager.staff.id);
    const [o] = await t.db.select().from(staff).where(eq(staff.id, owner.staff.id));
    expect(o!.photoKey).toBe(mine.photo);
    const gone = await fetch(`${t.baseUrl}/admin/me/photo`, {
      method: 'DELETE',
      headers: { cookie: manager.cookie },
    });
    expect(gone.status).toBe(200);
    const [o2] = await t.db.select().from(staff).where(eq(staff.id, owner.staff.id));
    expect(o2!.photoKey).toBe(mine.photo);
    expect(stored().sort()).toEqual(keysOf(mine.photo).sort());
    expect((await fetch(`${t.baseUrl}/admin/me/photo`, { method: 'DELETE' })).status).toBe(401);
  });

  it('takes the Telegram photo through the bot when linked, 404 when not linked or none', async () => {
    const asTelegram = (as: StaffSession) =>
      fetch(`${t.baseUrl}/admin/me/photo/telegram`, {
        method: 'POST',
        headers: { cookie: as.cookie },
      });
    const telegramId = owner.staff.telegramId!;
    expect((await asTelegram(owner)).status).toBe(404); // linked, but no photo
    t.edges.telegram.profilePhotos.set(telegramId, 'staff-file');
    t.edges.telegramFiles.files.set('staff-file', await image(640, 640));
    const res = await asTelegram(owner);
    expect(res.status).toBe(200);
    expect(stored()).toHaveLength(3);
    // a member with no linked Telegram has no source
    await t.db
      .update(staff)
      .set({ telegramId: null, login: 'ownerlogin' })
      .where(eq(staff.id, owner.staff.id));
    expect((await asTelegram(owner)).status).toBe(404);
  });

  it('removing the member deletes their renditions', async () => {
    const manager = await t.managerSession();
    const { photo } = (await (await putStaff(manager, await image(300, 300))).json()) as {
      photo: string;
    };
    expect(stored().sort()).toEqual(keysOf(photo).sort());
    const res = await owner.client.admin.staff.remove({ params: { id: manager.staff.id } });
    expect(res.status).toBe(200);
    expect(stored()).toEqual([]);
  });
});

describe('admin customers', () => {
  it('lists the customer photo hash (null without one)', async () => {
    const a = await signIn(1);
    await signIn(2);
    const { photo } = (await (await put(a.token, await image(300, 300))).json()) as {
      photo: string;
    };
    const page = await owner.client.admin.customers.list({ query: {} });
    if (page.status !== 200) throw new Error('list');
    expect(page.body.items.map((c) => c.photo).sort()).toEqual([photo, null].sort());
  });
});
