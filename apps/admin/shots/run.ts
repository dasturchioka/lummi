/**
 * Admin screenshot run. Every later admin ticket adds its screens to `screens.ts`.
 *
 *   npm run shots -w @lummi/admin -- --out <dir> [--only login,staff]
 *
 * Captures each registered screen at 390 px and 1280 px wide, in RU and UZ (the admin is light
 * only), as `<screen>-<width>-<lang>.png`. It signs in through the dev path (ADMIN_DEV_LOGIN),
 * so it uses the API, the admin and the dev Postgres from docs/dev.md: anything not already
 * running is started here and stopped again at the end. Shot data (an owner, managers) is written
 * through the seed CLI and the real staff endpoints, under reserved Telegram ids.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import net from 'node:net';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium, type BrowserContext } from '@playwright/test';
import pg from 'pg';
import { adminMessages } from '@lummi/i18n/admin';
import { seedShotBroadcasts } from './broadcast-data';
import { seedShotCatalog } from './catalog-data';
import { seedShotContent } from './content-data';
import { seedShotPromo } from './promo-data';
import { OUTSIDER_ID, SHOT_STAFF, screens, type ShotSql, type ShotStaff } from './screens';

const LANGS = ['ru', 'uz'] as const;
const WIDTHS = [390, 1280] as const;

const { values } = parseArgs({ options: { out: { type: 'string' }, only: { type: 'string' } } });
if (!values.out) {
  console.error('usage: npm run shots -w @lummi/admin -- --out <dir> [--only login,staff]');
  process.exit(2);
}
const outDir = resolve(process.cwd(), values.out);
const only = values.only
  ?.split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const unknown = (only ?? []).filter((id) => !screens.some((s) => s.id === id));
if (unknown.length) {
  console.error(
    `unknown screen(s): ${unknown.join(', ')}. Known: ${screens.map((s) => s.id).join(', ')}`,
  );
  process.exit(2);
}
const selected = only ? screens.filter((s) => only.includes(s.id)) : screens;

const repoRoot = resolve(import.meta.dirname, '../../..');
const apiPort = Number(process.env.API_PORT ?? 4000);
const adminPort = Number(process.env.ADMIN_PORT ?? 6000);
const dbPort = Number(process.env.POSTGRES_HOST_PORT ?? 5432);
const apiUrl = `http://127.0.0.1:${apiPort}`;
// `localhost`, not 127.0.0.1: next dev refuses its dev assets and HMR to other origins
const adminUrl = `http://localhost:${adminPort}`;
const databaseUrl = process.env.DATABASE_URL ?? `postgres://lummi:lummi@127.0.0.1:${dbPort}/lummi`;
// parallel worktrees each take their own compose project (and volume)
const composeProject = process.env.SHOTS_COMPOSE_PROJECT ?? 'lummi-admin-shots';
const started: ChildProcess[] = [];
let startedDb = false;

const listening = (port: number) =>
  new Promise<boolean>((ok) => {
    const s = net.connect(port, '127.0.0.1');
    s.once('connect', () => (s.destroy(), ok(true)));
    s.once('error', () => ok(false));
  });

async function waitFor(port: number, what: string, ms = 90_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await listening(port)) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`${what} did not come up on port ${port}`);
}

function run(cmd: string, args: string[], env: Record<string, string> = {}) {
  const r = spawnSync(cmd, args, {
    cwd: repoRoot,
    stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...process.env, ...env },
  });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed`);
}

function spawnService(name: string, args: string[], env: Record<string, string>) {
  const p = spawn('npm', args, {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stdio: 'ignore',
    detached: true,
  });
  p.on('exit', (code) => code && console.error(`${name} exited with ${code}`));
  started.push(p);
}

async function ensureServices() {
  if (!(await listening(apiPort))) {
    if (!(await listening(dbPort))) {
      console.log(`starting dev Postgres on ${dbPort} (docker compose project ${composeProject})`);
      run(
        'docker',
        ['compose', '-f', 'docker-compose.dev.yml', '-p', composeProject, 'up', '-d', '--wait'],
        {
          POSTGRES_HOST_PORT: String(dbPort),
        },
      );
      startedDb = true;
    }
    run('npm', ['run', 'db:migrate'], { DATABASE_URL: databaseUrl });
    console.log(`starting API on ${apiPort} (ADMIN_DEV_LOGIN=true)`);
    spawnService('api', ['run', 'start', '-w', '@lummi/api'], {
      API_PORT: String(apiPort),
      DATABASE_URL: databaseUrl,
      ADMIN_DEV_LOGIN: 'true',
      SESSION_SECRET: process.env.SESSION_SECRET ?? 'shots-session-secret-shots-session-secret',
    });
    await waitFor(apiPort, 'API');
  }
  if (!(await listening(adminPort))) {
    console.log(`starting admin on ${adminPort}`);
    spawnService('admin', ['run', 'dev', '-w', '@lummi/admin'], {
      ADMIN_PORT: String(adminPort),
      API_URL: apiUrl,
      NEXT_PUBLIC_ADMIN_DEV_LOGIN: 'true',
    });
    await waitFor(adminPort, 'admin');
  }
}

function stopServices() {
  // each service leads its own process group, so npm's node children stop with it
  for (const p of started) if (p.pid) process.kill(-p.pid, 'SIGTERM');
  if (startedDb) {
    spawnSync(
      'docker',
      ['compose', '-f', 'docker-compose.dev.yml', '-p', composeProject, 'down', '-v'],
      {
        cwd: repoRoot,
        stdio: 'ignore',
        env: { ...process.env, POSTGRES_HOST_PORT: String(dbPort) },
      },
    );
  }
}

/** Dev sign-in straight against the API; returns the session cookie for seeding calls. */
async function apiSession(telegramId: number) {
  const res = await fetch(`${apiUrl}/admin/auth/dev`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ telegramId }),
  });
  if (res.status === 404) {
    throw new Error(
      `the API on ${apiPort} runs without ADMIN_DEV_LOGIN=true; restart it with the dev sign-in`,
    );
  }
  if (res.status !== 200) throw new Error(`dev sign-in as ${telegramId} failed: ${res.status}`);
  return (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
}

/** Puts the shot staff in place (idempotent): the owner via the CLI, managers via the API. */
async function seedStaff() {
  const owner = SHOT_STAFF.find((s) => s.role === 'owner') as ShotStaff;
  run(
    'npm',
    ['run', 'seed:owner', '--', '--telegram-id', String(owner.telegramId), '--name', owner.name],
    {
      DATABASE_URL: databaseUrl,
    },
  );
  const cookie = await apiSession(owner.telegramId);
  const call = (path: string, method: string, body?: unknown) =>
    fetch(`${apiUrl}${path}`, {
      method,
      headers: { cookie, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const list = (await (await call('/admin/staff', 'GET')).json()) as {
    id: number;
    telegramId: number;
    active: boolean;
  }[];
  // a few audited changes, so the audit page and the settings page have something to show
  for (const [key, value] of [
    ['pricing.freeDeliveryThreshold', 300_000],
    ['shop.managerUsername', '@lummi_help'],
  ] as const) {
    const res = await call(`/admin/settings/${key}`, 'PUT', { value });
    if (res.status !== 200) throw new Error(`could not set ${key}: ${res.status}`);
  }
  for (const member of SHOT_STAFF.filter((s) => s.role === 'manager')) {
    let row = list.find((s) => s.telegramId === member.telegramId);
    if (!row) {
      const res = await call('/admin/staff', 'POST', {
        telegramId: member.telegramId,
        name: member.name,
      });
      if (res.status !== 201) throw new Error(`could not add ${member.name}: ${res.status}`);
      row = (await res.json()) as typeof row & object;
    }
    if (row.active !== member.active) {
      const res = await call(`/admin/staff/${row.id}`, 'PATCH', { active: member.active });
      if (res.status !== 200) throw new Error(`could not update ${member.name}: ${res.status}`);
    }
  }
  return call;
}

/** Signs the browser in through the same dev path the login form uses (same-origin cookie). */
async function signIn(context: BrowserContext, telegramId: number) {
  const res = await context.request.post(`${adminUrl}/api/admin/auth/dev`, {
    data: { telegramId },
  });
  if (res.status() !== 200)
    throw new Error(`browser dev sign-in as ${telegramId} failed: ${res.status()}`);
}

let client: pg.Client | undefined;

async function main() {
  await ensureServices();
  // The BTS points come from the committed snapshot (idempotent); the points screens need them.
  run('npm', ['run', 'bts:import', '-w', '@lummi/api'], { DATABASE_URL: databaseUrl });
  // the catalog screens need the 67 seeded fragrances (idempotent)
  run('npm', ['run', 'seed:catalog', '-w', '@lummi/api'], { DATABASE_URL: databaseUrl });
  // staff after the slow seeds, so the owner's API connection is fresh for the shot rows
  const ownerCall = await seedStaff();
  await seedShotCatalog(ownerCall);
  await seedShotPromo(ownerCall);
  await seedShotBroadcasts(databaseUrl);
  await seedShotContent(apiUrl, await apiSession(SHOT_STAFF[0]!.telegramId), repoRoot);
  mkdirSync(outDir, { recursive: true });
  // a screen's own database state (setup / teardown), on one connection for the run
  client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  const db: ShotSql = { query: (sql, params) => client!.query(sql, params) };
  let count = 0;
  for (const lang of LANGS) {
    // one browser per language: `--lang` is what makes date fields show the local format
    const browser = await chromium.launch({
      args: [`--lang=${lang === 'uz' ? 'uz-UZ' : 'ru-RU'}`],
    });
    try {
      const t = adminMessages[lang].admin;
      for (const screen of selected) {
        for (const width of screen.widths ?? WIDTHS) {
          await screen.setup?.({ db });
          const phone = width < 768;
          const context = await browser.newContext({
            viewport: { width, height: phone ? 844 : 800 },
            deviceScaleFactor: 2,
            isMobile: phone,
            hasTouch: phone,
            locale: lang === 'uz' ? 'uz-UZ' : 'ru-RU',
            timezoneId: 'Asia/Tashkent',
          });
          await context.addCookies([{ name: 'lummi_lang', value: lang, url: adminUrl }]);
          const as =
            screen.as === 'owner' ? SHOT_STAFF[0] : SHOT_STAFF.find((s) => s.role === screen.as);
          if (as) await signIn(context, as.telegramId);
          // Next's dev-mode indicator is not part of the design, on any page a screen opens
          // (a string, not a function: tsx's name helpers do not exist in the page)
          await context.addInitScript({
            content: `document.addEventListener('DOMContentLoaded', () => {
              const style = document.createElement('style');
              style.textContent = 'nextjs-portal{display:none!important}';
              document.head.append(style);
            });`,
          });
          const page = await context.newPage();
          page.on('pageerror', (e) => console.error(`  [${screen.id}] page error: ${e.message}`));
          page.on('console', (m) => {
            if (m.type() === 'error') console.error(`  [${screen.id}] console: ${m.text()}`);
          });
          await page.goto(`${adminUrl}${screen.path}`, {
            waitUntil: 'networkidle',
            timeout: 120_000,
          });
          await screen.act?.({ page, t, language: lang, outsiderId: OUTSIDER_ID, width, db });
          await page.evaluate(() => document.fonts.ready);
          await page.waitForTimeout(350); // let dialog and sheet transitions settle
          const file = resolve(outDir, `${screen.id}-${width}-${lang}.png`);
          const fullPage = screen.fullPage ?? true;
          // a full-page capture paints sticky bars (the phone's top bar) where the page was
          // scrolled to, over the content: take it from the top
          if (fullPage) await page.evaluate(() => window.scrollTo(0, 0));
          await page.screenshot({ path: file, fullPage });
          await context.close();
          await screen.teardown?.({ db });
          count++;
          console.log(`  ${screen.id}-${width}-${lang}.png`);
        }
      }
    } finally {
      await browser.close();
    }
  }
  console.log(`${count} screenshots in ${outDir}`);
}

main()
  .catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await client?.end();
    stopServices();
  });
