import { auditLog, customers, eq } from '@lummi/db';
import { dictionaries } from '@lummi/i18n/all';
import { fill } from '@lummi/i18n';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OWNER_WIDGET_USER,
  createTestApp,
  type StaffSession,
  type TestApp,
} from './harness/test-app';

let t: TestApp;
let updateId = 5000;

beforeAll(async () => {
  t = await createTestApp();
  t.startWorker();
});
afterAll(() => t.close());
beforeEach(async () => {
  await t.reset();
  t.edges.telegram.sent.length = 0;
});

const TEMP = 'Temp-pass-0001';
const FINAL = 'Final-pass-0002';
const ru = dictionaries.ru.bot.staffLink;
const uz = dictionaries.uz.bot.staffLink;

/** A manager past the forced change, signed in by password. */
async function manager(owner: StaffSession, login = 'dilnoza', name = 'Dilnoza') {
  const created = await owner.client.admin.staff.create({ body: { name, login, password: TEMP } });
  if (created.status !== 201) throw new Error(`add ${login}: ${created.status}`);
  const res = await t.client.admin.passwordLogin({ body: { login, password: TEMP } });
  const client = t.withCookie((res.headers.get('set-cookie') ?? '').split(';')[0] ?? '');
  await client.admin.changePassword({ body: { newPassword: FINAL } });
  return { id: created.body.id, client };
}

async function linkOf(client: StaffSession['client']) {
  const res = await client.admin.telegramLink();
  if (res.status !== 201) throw new Error(`link: ${res.status}`);
  return res.body;
}

const tokenOf = (url: string) => new URL(url).searchParams.get('start')!;

/** `/start <payload>` in a private chat with the bot, as Telegram sends it. */
function openLink(payload: string, from: number, languageCode = 'ru') {
  return t.postUpdate({
    update_id: ++updateId,
    message: {
      message_id: updateId,
      date: Math.floor(t.edges.clock.now().getTime() / 1000),
      chat: { id: from, type: 'private', first_name: 'Dilnoza' },
      from: { id: from, is_bot: false, first_name: 'Dilnoza', language_code: languageCode },
      text: `/start ${payload}`,
      entities: [{ type: 'bot_command', offset: 0, length: 6 }],
    },
  });
}

/** The bot's answer to that chat, once the outbox delivered it. */
async function replyTo(chatId: number, count = 1) {
  await vi.waitFor(
    () => expect(t.edges.telegram.sent.filter((m) => m.chatId === chatId)).toHaveLength(count),
    { timeout: 10_000 },
  );
  return t.edges.telegram.sent.filter((m) => m.chatId === chatId).at(-1)!.text;
}

describe('«Привязать Telegram»', () => {
  it('binds the Telegram that opens the one-time link; the bot confirms and the panel shows it', async () => {
    const owner = await t.ownerSession();
    const { id, client } = await manager(owner);
    const link = await linkOf(client);
    expect(link.url).toMatch(/^https:\/\/t\.me\/lummi_dev_bot\?start=staff_[A-Za-z0-9_-]{32}$/);
    expect(link.expiresAt).toBe(new Date(t.edges.clock.now().getTime() + 600_000).toISOString());

    expect((await openLink(tokenOf(link.url), 4242)).status).toBe(200);
    expect(await replyTo(4242)).toBe(fill(ru.linked, { name: 'Dilnoza' }));
    expect((await client.admin.me()).body).toMatchObject({ id, telegramId: 4242 });
    // a staff link is not a shopper's /start: no customer, no greeting
    expect(await t.db.select().from(customers)).toHaveLength(0);

    const [entry] = await t.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'staff.telegram_linked'));
    expect(entry).toMatchObject({ actorType: 'staff', actorId: id, targetId: String(id) });
    expect(entry?.payload).toEqual({ name: 'Dilnoza', telegramId: 4242 });

    // the Login Widget now knows the same member
    const widget = await t.client.admin.loginWidget({
      body: t.widgetPayload({ id: 4242, first_name: 'Dilnoza' }) as never,
    });
    expect(widget.status === 200 && widget.body.id).toBe(id);
    // and the profile no longer offers a link
    expect((await client.admin.telegramLink()).body).toEqual({ code: 'already_linked' });
  });

  it('answers in the language of the Telegram that opened it', async () => {
    const owner = await t.ownerSession();
    const { client } = await manager(owner);
    await openLink(tokenOf((await linkOf(client)).url), 4242, 'uz');
    expect(await replyTo(4242)).toBe(fill(uz.linked, { name: 'Dilnoza' }));
  });

  it('works once', async () => {
    const owner = await t.ownerSession();
    const { client } = await manager(owner);
    const token = tokenOf((await linkOf(client)).url);
    await openLink(token, 4242);
    await replyTo(4242);
    await openLink(token, 4343);
    expect(await replyTo(4343)).toBe(ru.invalid);
    expect((await client.admin.me()).body).toMatchObject({ telegramId: 4242 });
  });

  it('expires after the set time, and a newer link replaces the older one', async () => {
    const owner = await t.ownerSession();
    const { client } = await manager(owner);
    const old = tokenOf((await linkOf(client)).url);
    const newer = tokenOf((await linkOf(client)).url);
    await openLink(old, 4242);
    expect(await replyTo(4242)).toBe(ru.invalid);

    const res = await owner.client.admin.settings.update({
      params: { key: 'auth.telegramLinkTtlSeconds' },
      body: { value: 120 },
    });
    expect(res.status).toBe(200);
    const short = await linkOf(client);
    expect(short.expiresAt).toBe(new Date(t.edges.clock.now().getTime() + 120_000).toISOString());
    t.edges.clock.advance(120_000);
    await openLink(tokenOf(short.url), 4242);
    expect(await replyTo(4242, 2)).toBe(ru.invalid);
    await openLink(newer, 4242);
    expect(await replyTo(4242, 3)).toBe(ru.invalid);
    expect((await client.admin.me()).body).toMatchObject({ telegramId: null });
  });

  it('refuses a Telegram bound to another member, without using the link up', async () => {
    const owner = await t.ownerSession();
    const { client } = await manager(owner);
    const token = tokenOf((await linkOf(client)).url);
    await openLink(token, OWNER_WIDGET_USER.id);
    expect(await replyTo(OWNER_WIDGET_USER.id)).toBe(ru.taken);
    expect((await client.admin.me()).body).toMatchObject({ telegramId: null });
    await openLink(token, 4242);
    expect(await replyTo(4242)).toBe(fill(ru.linked, { name: 'Dilnoza' }));
  });

  it('binds nothing for a switched-off member', async () => {
    const owner = await t.ownerSession();
    const { id, client } = await manager(owner);
    const token = tokenOf((await linkOf(client)).url);
    await owner.client.admin.staff.update({ params: { id }, body: { active: false } });
    await openLink(token, 4242);
    expect(await replyTo(4242)).toBe(ru.inactive);
    const list = await owner.client.admin.staff.list();
    expect(list.status === 200 && list.body.find((s) => s.id === id)?.telegramId).toBeNull();
  });

  it('an unknown staff payload is refused; any other /start payload still greets a shopper', async () => {
    await openLink('staff_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 4242);
    expect(await replyTo(4242)).toBe(ru.invalid);
    await openLink('l_spring', 4343);
    expect(await replyTo(4343)).toBe(dictionaries.ru.bot.greeting);
  });
});

describe('the owner unlinks a manager’s Telegram', () => {
  it('unbinds it with an audit entry; the widget and the group no longer know that account', async () => {
    const owner = await t.ownerSession();
    const { id, client } = await manager(owner);
    await openLink(tokenOf((await linkOf(client)).url), 4242);
    await replyTo(4242);

    const res = await owner.client.admin.staff.unlinkTelegram({ params: { id } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id, telegramId: null, login: 'dilnoza' });
    const [entry] = await t.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'staff.telegram_unlinked'));
    expect(entry).toMatchObject({ actorType: 'staff', actorId: owner.staff.id });
    expect(entry?.payload).toEqual({ name: 'Dilnoza', telegramId: 4242 });
    const widget = await t.client.admin.loginWidget({
      body: t.widgetPayload({ id: 4242, first_name: 'Dilnoza' }) as never,
    });
    expect(widget.status).toBe(403);
    // the password still works, and a new link can be made
    expect((await client.admin.me()).status).toBe(200);
    expect((await client.admin.telegramLink()).status).toBe(201);
  });

  it('refuses when Telegram is the manager’s only way in, never touches an owner, and is the owner’s alone', async () => {
    const owner = await t.ownerSession();
    const legacy = await t.managerSession();
    expect(
      await owner.client.admin.staff.unlinkTelegram({ params: { id: legacy.staff.id } }),
    ).toMatchObject({ status: 409, body: { code: 'telegram_only' } });
    expect(
      await owner.client.admin.staff.unlinkTelegram({ params: { id: owner.staff.id } }),
    ).toMatchObject({ status: 409, body: { code: 'conflict' } });
    expect(
      (await legacy.client.admin.staff.unlinkTelegram({ params: { id: legacy.staff.id } })).status,
    ).toBe(403);
  });
});
