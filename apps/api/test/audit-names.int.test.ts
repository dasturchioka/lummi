import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { auditLog, eq, fragrances, promoBanners, volumes } from '@lummi/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { importBtsPoints, type Snapshot } from '../src/bts/import-points';
import { placeOrder, tashkent } from './harness/fulfilment';
import { shopper, slugs } from './harness/orders';
import type { TestUser } from './harness/sign-init-data';
import { createTestApp, type TestApp } from './harness/test-app';

/** Seam 1 (ADR 0028): the audit read names what an entry touched (#63). */

const snapshot = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../src/bts/bts-points.snapshot.json'), 'utf8'),
) as Snapshot;

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
beforeEach(async () => {
  t.edges.clock.set(tashkent('2026-11-16 09:00'));
  await t.reset();
  await t.seedCatalog();
  await importBtsPoints(t.db, snapshot);
});

const ali: TestUser = { id: 51, first_name: 'Ali', language_code: 'ru' };

describe('audit read: names of the targets', () => {
  it('names a banner (RU and UZ), a fragrance and a volume in one page; a deleted target has none', async () => {
    const owner = await t.ownerSession();
    const [banner] = await t.db
      .insert(promoBanners)
      .values({ titleRu: 'Зима', titleUz: 'Qish', subtitleRu: 'a', subtitleUz: 'b' })
      .returning();
    const [fragrance] = await t.db.select().from(fragrances).limit(1);
    const [volume] = await t.db
      .select()
      .from(volumes)
      .where(eq(volumes.fragranceId, fragrance!.id))
      .limit(1);
    await t.db.delete(auditLog);
    const entry = (action: string, targetType: string, targetId: string) => ({
      actorType: 'staff' as const,
      actorId: owner.staff.id,
      action,
      targetType,
      targetId,
      payload: {},
    });
    await t.db
      .insert(auditLog)
      .values([
        entry('content.banner_activated', 'promo_banner', String(banner!.id)),
        entry('catalog.fragrance_hidden', 'fragrance', String(fragrance!.id)),
        entry('catalog.on_hand_changed', 'volume', String(volume!.id)),
        entry('content.banner_deleted', 'promo_banner', '999999'),
        entry('setting.changed', 'setting', 'pricing.freeDeliveryThreshold'),
      ]);
    const res = await owner.client.admin.audit.list({ query: {} });
    expect(res.status).toBe(200);
    const items = res.status === 200 ? res.body.items : [];
    const by = (action: string) => items.find((i) => i.action === action)!;
    expect(by('content.banner_activated')).toMatchObject({
      targetName: 'Зима',
      targetNameUz: 'Qish',
    });
    expect(by('catalog.fragrance_hidden')).toMatchObject({
      targetName: fragrance!.name,
      targetNameUz: fragrance!.name,
    });
    expect(by('catalog.on_hand_changed').targetName).toBe(fragrance!.name);
    expect(by('content.banner_deleted')).toMatchObject({ targetName: null, targetNameUz: null });
    expect(by('setting.changed').targetName).toBeNull();
  });

  it('a return keeps its lines and adds what each was, as bought', async () => {
    const owner = await t.ownerSession();
    const slug = (await slugs(t, 1))[0]!;
    const client = await shopper(t, ali, '998901112233');
    const add = await client.cart.addLine({ body: { slug, ml: 10, qty: 2 } });
    expect(add.status).toBe(200);
    const order = await placeOrder(t, client);
    await t.db.delete(auditLog);
    await t.db.insert(auditLog).values({
      actorType: 'staff',
      actorId: owner.staff.id,
      action: 'order.returned',
      targetType: 'order',
      targetId: String(order.id),
      payload: {
        number: order.number,
        from: 'delivered',
        to: 'returned',
        lines: [{ position: 0, backToStock: true }],
      },
    });
    const res = await owner.client.admin.audit.list({ query: {} });
    const item = res.status === 200 ? res.body.items[0] : undefined;
    expect(item?.payload.lines).toEqual([
      expect.objectContaining({ position: 0, backToStock: true, ml: 10, qty: 2 }),
    ]);
    const [line] = (item?.payload.lines ?? []) as { nameRu?: string; nameUz?: string }[];
    expect(line?.nameRu).toBeTruthy();
    expect(line?.nameUz).toBeTruthy();
  });
});
