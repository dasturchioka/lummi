import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auditLog, btsPoints, customers, eq, regions } from '@lummi/db';
import { importBtsPoints, type Snapshot } from '../src/bts/import-points';
import { createTestApp, type TestApp } from './harness/test-app';

const snapshot = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../src/bts/bts-points.snapshot.json'), 'utf8'),
) as Snapshot;

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
beforeEach(() => t.reset());

const NEW_POINT = {
  code: 'T-1',
  regionId: 1,
  city: 'Термез',
  name: 'TERMIZ TEST',
  address: 'ул. Навои 1',
  landmark: 'у рынка',
  hours: 'Пн-Сб: 09:00-18:00',
};

describe('regions and the import', () => {
  it('has 14 regions at 25 000 each, Tashkent city and Karakalpakstan among them', async () => {
    const { client } = await t.signIn();
    const res = await client.delivery.regions();
    expect(res.status).toBe(200);
    if (res.status !== 200) return;
    expect(res.body).toHaveLength(14);
    expect(res.body.every((r) => r.deliveryTariff === 25_000)).toBe(true);
    expect(res.body.map((r) => r.nameRu)).toEqual(
      expect.arrayContaining(['Город Ташкент', 'Каракалпакстан']),
    );
  });

  it('imports the snapshot once and never duplicates by code on a re-run', async () => {
    const first = await importBtsPoints(t.db, snapshot);
    expect(first.inserted).toBe(snapshot.points.length);
    expect(snapshot.points.length).toBeGreaterThan(300);
    const again = await importBtsPoints(t.db, snapshot);
    expect(again).toEqual({ inserted: 0, updated: 0, unchanged: snapshot.points.length });
    expect(await t.db.select().from(btsPoints)).toHaveLength(snapshot.points.length);
    const imports = (await t.db.select().from(auditLog)).filter(
      (a) => a.action === 'bts_points.imported',
    );
    expect(imports).toHaveLength(1);
  });

  it('keeps staff edits and hidden points on a plain re-run, rewrites BTS fields only with refresh', async () => {
    await importBtsPoints(t.db, snapshot);
    const [p] = await t.db.select().from(btsPoints).where(eq(btsPoints.code, '0101'));
    await t.db
      .update(btsPoints)
      .set({ active: false, address: 'исправлено' })
      .where(eq(btsPoints.id, p!.id));
    await importBtsPoints(t.db, snapshot);
    const [kept] = await t.db.select().from(btsPoints).where(eq(btsPoints.id, p!.id));
    expect(kept).toMatchObject({ active: false, address: 'исправлено' });
    const refreshed = await importBtsPoints(t.db, snapshot, { refresh: true });
    expect(refreshed.updated).toBe(1);
    const [after] = await t.db.select().from(btsPoints).where(eq(btsPoints.id, p!.id));
    expect(after).toMatchObject({ active: false, address: p!.address });
  });
});

describe('customer endpoints', () => {
  beforeEach(async () => {
    await importBtsPoints(t.db, snapshot);
  });

  it('needs a session', async () => {
    expect((await t.client.delivery.regions()).status).toBe(401);
  });

  it('lists the cities of a region and the points of a city', async () => {
    const { client } = await t.signIn();
    const [region] = await t.db.select().from(regions).where(eq(regions.code, 'samarkand'));
    const cities = await client.delivery.cities({ params: { regionId: region!.id } });
    expect(cities.status).toBe(200);
    if (cities.status !== 200) return;
    expect(cities.body.map((c) => c.city)).toContain('Самарканд');
    const samarkand = cities.body.find((c) => c.city === 'Самарканд')!;
    const points = await client.delivery.points({
      query: { regionId: region!.id, city: 'Самарканд' },
    });
    expect(points.status).toBe(200);
    if (points.status !== 200) return;
    expect(points.body).toHaveLength(samarkand.pointCount);
    expect(points.body[0]).toEqual(
      expect.objectContaining({
        code: expect.any(String),
        address: expect.any(String),
        hours: expect.any(String),
      }),
    );
    expect((await client.delivery.cities({ params: { regionId: 9999 } })).status).toBe(404);
  });

  it('searches across regions, folding case, and requires a real query', async () => {
    const { client } = await t.signIn();
    const res = await client.delivery.points({ query: { q: 'ЧИЛОНЗАР' } });
    expect(res.status === 200 && res.body.length).toBeGreaterThan(0);
    if (res.status !== 200) return;
    expect(res.body.length).toBeLessThanOrEqual(50);
    const none = await client.delivery.points({ query: { q: 'zzzzqqq' } });
    expect(none.status === 200 && none.body).toEqual([]);
  });

  it('rejects a query with neither city nor search', async () => {
    const { token } = await t.signIn();
    const get = (qs: string) =>
      fetch(`${t.baseUrl}/delivery/points${qs}`, { headers: { authorization: `Bearer ${token}` } });
    expect((await get('')).status).toBe(400);
    expect((await get('?q=a')).status).toBe(400);
    expect((await get('?city=Самарканд')).status).toBe(400);
  });

  it('never offers hidden points, and a city with only hidden points disappears', async () => {
    const { client } = await t.signIn();
    const [region] = await t.db.select().from(regions).where(eq(regions.code, 'karakalpakstan'));
    const nukus = await t.db.select().from(btsPoints).where(eq(btsPoints.city, 'Нукус'));
    expect(nukus.length).toBeGreaterThan(0);
    await t.db.update(btsPoints).set({ active: false }).where(eq(btsPoints.id, nukus[0]!.id));
    const left = await client.delivery.points({ query: { regionId: region!.id, city: 'Нукус' } });
    expect(left.status === 200 && left.body.map((p) => p.id)).not.toContain(nukus[0]!.id);
    const search = await client.delivery.points({ query: { q: nukus[0]!.name } });
    expect(search.status === 200 && search.body.map((p) => p.id)).not.toContain(nukus[0]!.id);

    await t.db.update(btsPoints).set({ active: false }).where(eq(btsPoints.city, 'Нукус'));
    const cities = await client.delivery.cities({ params: { regionId: region!.id } });
    expect(cities.status === 200 && cities.body.map((c) => c.city)).not.toContain('Нукус');
  });
});

describe('delivery city', () => {
  beforeEach(async () => {
    await importBtsPoints(t.db, snapshot);
  });

  it('is empty at first, then saved per customer with the region tariff, and cleared', async () => {
    const { client } = await t.signIn({ id: 31, first_name: 'Ali' });
    const none = await client.me.getDeliveryCity();
    expect(none.status === 200 && none.body).toEqual({ deliveryCity: null });

    const [region] = await t.db.select().from(regions).where(eq(regions.code, 'samarkand'));
    const saved = await client.me.setDeliveryCity({
      body: { regionId: region!.id, city: 'Самарканд' },
    });
    expect(saved.status === 200 && saved.body).toEqual({
      deliveryCity: {
        region: {
          id: region!.id,
          nameRu: 'Самаркандская область',
          nameUz: 'Samarqand viloyati',
          deliveryTariff: 25_000,
        },
        city: 'Самарканд',
      },
    });

    // a new launch of the same customer reads it back; another customer does not see it
    const again = await t.signIn({ id: 31, first_name: 'Ali' });
    const read = await again.client.me.getDeliveryCity();
    expect(read.status === 200 && read.body.deliveryCity?.city).toBe('Самарканд');
    const other = await t.signIn({ id: 32, first_name: 'Vali' });
    const otherRead = await other.client.me.getDeliveryCity();
    expect(otherRead.status === 200 && otherRead.body.deliveryCity).toBeNull();

    // the tariff the owner sets later follows the saved city
    const owner = await t.ownerSession();
    await owner.client.admin.regions.setTariff({
      params: { id: region!.id },
      body: { deliveryTariff: 30_000 },
    });
    const repriced = await client.me.getDeliveryCity();
    expect(repriced.status === 200 && repriced.body.deliveryCity?.region.deliveryTariff).toBe(
      30_000,
    );

    const audit = await t.db.select().from(auditLog);
    expect(audit.filter((a) => a.action === 'customer.delivery_city_changed')).toHaveLength(1);

    const cleared = await client.me.clearDeliveryCity();
    expect(cleared.status === 200 && cleared.body).toEqual({ deliveryCity: null });
    const [row] = await t.db.select().from(customers).where(eq(customers.telegramId, 31));
    expect(row).toMatchObject({ deliveryRegionId: null, deliveryCity: null });
  });

  it('refuses an unknown region or a city that has no offered point', async () => {
    const { client } = await t.signIn();
    const [region] = await t.db.select().from(regions).where(eq(regions.code, 'samarkand'));
    expect(
      (await client.me.setDeliveryCity({ body: { regionId: 9999, city: 'Самарканд' } })).status,
    ).toBe(404);
    expect(
      (await client.me.setDeliveryCity({ body: { regionId: region!.id, city: 'Нукус' } })).status,
    ).toBe(422);
    expect((await t.client.me.getDeliveryCity()).status).toBe(401);
  });
});

describe('admin: points', () => {
  it('lets owner and manager add, edit, hide and filter; hidden points leave the customer list', async () => {
    const manager = await t.managerSession();
    const { client } = await t.signIn();
    const [region] = await t.db.select().from(regions).where(eq(regions.code, 'surkhandarya'));
    const body = { ...NEW_POINT, regionId: region!.id };

    const created = await manager.client.admin.btsPoints.create({ body });
    expect(created.status === 201 && created.body).toMatchObject({
      code: 'T-1',
      active: true,
      regionNameRu: 'Сурхандарьинская область',
    });
    const id = created.status === 201 ? created.body.id : 0;
    expect((await manager.client.admin.btsPoints.create({ body })).status).toBe(409);
    expect(
      (
        await manager.client.admin.btsPoints.create({
          body: { ...body, code: 'T-2', regionId: 9999 },
        })
      ).status,
    ).toBe(422);

    const offered = await client.delivery.points({
      query: { regionId: region!.id, city: 'Термез' },
    });
    expect(offered.status === 200 && offered.body.map((p) => p.id)).toEqual([id]);

    const edited = await manager.client.admin.btsPoints.update({
      params: { id },
      body: { address: 'ул. Навои 2', landmark: null },
    });
    expect(edited.status === 200 && edited.body).toMatchObject({
      address: 'ул. Навои 2',
      landmark: null,
    });
    // search text follows the edit
    const found = await client.delivery.points({ query: { q: 'навои 2' } });
    expect(found.status === 200 && found.body.map((p) => p.id)).toEqual([id]);

    const hidden = await manager.client.admin.btsPoints.update({
      params: { id },
      body: { active: false },
    });
    expect(hidden.status === 200 && hidden.body.active).toBe(false);
    const gone = await client.delivery.points({ query: { regionId: region!.id, city: 'Термез' } });
    expect(gone.status === 200 && gone.body).toEqual([]);

    const hiddenList = await manager.client.admin.btsPoints.list({
      query: { status: 'hidden', regionId: region!.id },
    });
    expect(hiddenList.status === 200 && hiddenList.body.items.map((p) => p.code)).toEqual(['T-1']);
    const activeList = await manager.client.admin.btsPoints.list({
      query: { status: 'active', q: 'T-1' },
    });
    expect(activeList.status === 200 && activeList.body.total).toBe(0);
    const byCode = await manager.client.admin.btsPoints.list({ query: { q: 't-1' } });
    expect(byCode.status === 200 && byCode.body.total).toBe(1);

    expect(
      (
        await manager.client.admin.btsPoints.update({
          params: { id: 9999 },
          body: { active: true },
        })
      ).status,
    ).toBe(404);

    const audit = (await t.db.select().from(auditLog)).filter((a) => a.targetType === 'bts_point');
    expect(audit.map((a) => a.action)).toEqual([
      'bts_point.created',
      'bts_point.updated',
      'bts_point.hidden',
    ]);
    expect(audit.every((a) => a.actorType === 'staff' && a.actorId === manager.staff.id)).toBe(
      true,
    );
    expect(audit[1]?.payload).toMatchObject({
      changed: { address: { from: 'ул. Навои 1', to: 'ул. Навои 2' } },
    });
  });

  it('paginates the list 50 at a time', async () => {
    await importBtsPoints(t.db, snapshot);
    const owner = await t.ownerSession();
    const p1 = await owner.client.admin.btsPoints.list({ query: {} });
    const p2 = await owner.client.admin.btsPoints.list({ query: { page: 2 } });
    expect(p1.status === 200 && p1.body.items).toHaveLength(50);
    expect(p1.status === 200 && p1.body.total).toBe(snapshot.points.length);
    expect(p2.status === 200 && p2.body.items[0]?.id).not.toBe(
      p1.status === 200 ? p1.body.items[0]?.id : -1,
    );
  });

  it('turns away anonymous callers and customers', async () => {
    expect((await t.client.admin.btsPoints.list({ query: {} })).status).toBe(401);
    expect((await t.client.admin.regions.list()).status).toBe(401);
    expect((await t.client.admin.btsPoints.create({ body: NEW_POINT })).status).toBe(401);
  });
});

describe('admin: tariffs', () => {
  it('is editable by the owner only, validated, and audited with old and new', async () => {
    const owner = await t.ownerSession();
    const manager = await t.managerSession();
    const list = await manager.client.admin.regions.list();
    expect(list.status === 200 && list.body).toHaveLength(14);
    const target = list.status === 200 ? list.body[0]! : (null as never);

    const denied = await manager.client.admin.regions.setTariff({
      params: { id: target.id },
      body: { deliveryTariff: 1 },
    });
    expect(denied.status).toBe(403);
    expect(
      (await t.db.select().from(regions).where(eq(regions.id, target.id)))[0]?.deliveryTariff,
    ).toBe(25_000);

    const ok = await owner.client.admin.regions.setTariff({
      params: { id: target.id },
      body: { deliveryTariff: 30_000 },
    });
    expect(ok.status === 200 && ok.body.deliveryTariff).toBe(30_000);
    // same value again: no second audit entry
    await owner.client.admin.regions.setTariff({
      params: { id: target.id },
      body: { deliveryTariff: 30_000 },
    });
    expect(
      (
        await owner.client.admin.regions.setTariff({
          params: { id: 9999 },
          body: { deliveryTariff: 1 },
        })
      ).status,
    ).toBe(404);

    const bad = await fetch(`${t.baseUrl}/admin/regions/${target.id}`, {
      method: 'PATCH',
      headers: { cookie: owner.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ deliveryTariff: -5 }),
    });
    expect(bad.status).toBe(400);

    const audit = (await t.db.select().from(auditLog)).filter(
      (a) => a.action === 'region.tariff_changed',
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorType: 'staff',
      actorId: owner.staff.id,
      targetId: String(target.id),
    });
    expect(audit[0]?.payload).toMatchObject({ old: 25_000, new: 30_000 });

    const { client } = await t.signIn();
    const regionsNow = await client.delivery.regions();
    expect(regionsNow.status === 200 && regionsNow.body[0]?.deliveryTariff).toBe(30_000);
  });
});
