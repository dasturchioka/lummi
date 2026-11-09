/**
 * Screenshot run (ticket #3). Every later UI ticket extends `registry.ts`.
 *
 *   npm run shots -w @lummi/miniapp -- --out <dir> [--only home,profile]
 *
 * Captures each registered screen at 390x844 @2x, in light and dark x RU and UZ, as
 * `<screen>-<theme>-<lang>.png`. It uses the API and dev Postgres (docs/dev.md): anything not
 * already running is started here and stopped again at the end. Theme and language are saved
 * through the real API (PATCH /me/preferences), then the page opens with launch params in the URL.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import net from 'node:net';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';
import { connectShotDb } from './db';
import { SHOT_USER, signInitData, signedInClient } from './api';
import { screens } from './registry';

const THEMES = ['light', 'dark'] as const;
const LANGS = ['ru', 'uz'] as const;

const { values } = parseArgs({
  options: { out: { type: 'string' }, only: { type: 'string' } },
});
if (!values.out) {
  console.error('usage: npm run shots -w @lummi/miniapp -- --out <dir> [--only home,profile]');
  process.exit(2);
}
const outDir = resolve(process.cwd(), values.out);
const only = values.only
  ?.split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const selected = only ? screens.filter((s) => only.includes(s.id)) : screens;
const unknown = (only ?? []).filter((id) => !screens.some((s) => s.id === id));
if (unknown.length) {
  console.error(
    `unknown screen(s): ${unknown.join(', ')}. Registered: ${screens.map((s) => s.id).join(', ')}`,
  );
  process.exit(2);
}

const repoRoot = resolve(import.meta.dirname, '../../..');
const apiPort = Number(process.env.API_PORT ?? 4000);
const appPort = Number(process.env.MINIAPP_PORT ?? 5173);
const dbPort = Number(process.env.POSTGRES_HOST_PORT ?? 5432);
const apiUrl = `http://127.0.0.1:${apiPort}`;
const appUrl = `http://127.0.0.1:${appPort}`;
const botToken = process.env.BOT_TOKEN;
if (!botToken)
  throw new Error('BOT_TOKEN is not set (the dev bot token signs initData); see .env.example');

const started: ChildProcess[] = [];
let startedDb = false;
let stopping = false;

const listening = (port: number) =>
  new Promise<boolean>((ok) => {
    const s = net.connect(port, '127.0.0.1');
    s.once('connect', () => (s.destroy(), ok(true)));
    s.once('error', () => ok(false));
  });

async function waitFor(port: number, what: string, ms = 60_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await listening(port)) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`${what} did not come up on port ${port}`);
}

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  const r = spawnSync(cmd, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed`);
}

function spawnService(name: string, cmd: string, args: string[], env: NodeJS.ProcessEnv) {
  const p = spawn(cmd, args, {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stdio: 'ignore',
    detached: true,
  });
  p.on('exit', (code) => code && !stopping && console.error(`${name} exited with ${code}`));
  started.push(p);
}

/** The fragrance cards need the seed catalog and its photos; load it once (idempotent, slow the first time). */
async function ensureCatalog(databaseUrl: string) {
  const db = connectShotDb(databaseUrl);
  try {
    const { rows } = await db.query('select count(photo_hash)::int as n from volumes');
    if (Number(rows[0]?.n ?? 0) >= 201) return;
  } finally {
    await db.end();
  }
  console.log('seeding the 67-fragrance catalog with photos (first run only)');
  run('npm', ['run', 'seed:catalog', '-w', '@lummi/api'], { DATABASE_URL: databaseUrl });
}

async function ensureServices() {
  const databaseUrl =
    process.env.DATABASE_URL ?? `postgres://lummi:lummi@127.0.0.1:${dbPort}/lummi`;
  if (!(await listening(apiPort))) {
    if (!(await listening(dbPort))) {
      console.log(`starting dev Postgres on ${dbPort} (docker compose project lummi-shots)`);
      run(
        'docker',
        ['compose', '-f', 'docker-compose.dev.yml', '-p', 'lummi-shots', 'up', '-d', '--wait'],
        {
          POSTGRES_HOST_PORT: String(dbPort),
        },
      );
      startedDb = true;
    }
    run('npm', ['run', 'db:migrate'], { DATABASE_URL: databaseUrl });
    await ensureCatalog(databaseUrl);
    console.log(`starting API on ${apiPort}`);
    spawnService('api', 'npm', ['run', 'start', '-w', '@lummi/api'], {
      API_PORT: String(apiPort),
      DATABASE_URL: databaseUrl,
      SESSION_SECRET: process.env.SESSION_SECRET ?? 'shots-session-secret-shots-session-secret',
    });
    await waitFor(apiPort, 'API');
  }
  // The BTS points come from the committed snapshot (idempotent); delivery screens need them.
  run('npm', ['run', 'bts:import', '-w', '@lummi/api'], { DATABASE_URL: databaseUrl });
  if (!(await listening(appPort))) {
    console.log(`starting Mini App on ${appPort}`);
    spawnService('miniapp', 'npm', ['run', 'dev', '-w', '@lummi/miniapp'], {
      MINIAPP_PORT: String(appPort),
      API_PORT: String(apiPort),
    });
    await waitFor(appPort, 'Mini App');
  }
}

function stopServices() {
  stopping = true;
  // each service leads its own process group, so npm's node children stop with it
  for (const p of started) if (p.pid) process.kill(-p.pid, 'SIGTERM');
  if (startedDb) {
    spawnSync('docker', ['compose', '-f', 'docker-compose.dev.yml', '-p', 'lummi-shots', 'down'], {
      cwd: repoRoot,
      stdio: 'ignore',
      env: { ...process.env, POSTGRES_HOST_PORT: String(dbPort) },
    });
  }
}

async function main() {
  await ensureServices();
  const shotDb = connectShotDb(
    process.env.DATABASE_URL ?? `postgres://lummi:lummi@127.0.0.1:${dbPort}/lummi`,
  );
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  let count = 0;
  try {
    for (const theme of THEMES) {
      for (const lang of LANGS) {
        const api = await signedInClient(apiUrl, botToken as string);
        // Same API path the Profile switches use, so the app opens exactly as a customer left it.
        const saved = await api.me.updatePreferences({ body: { theme, language: lang } });
        if (saved.status !== 200) throw new Error(`could not save preferences: ${saved.status}`);

        for (const screen of selected) {
          const user = screen.user ?? SHOT_USER;
          // Another customer signs in (and saves the same preferences) as themselves.
          const screenApi =
            user === SHOT_USER ? api : await signedInClient(apiUrl, botToken as string, user);
          if (screenApi !== api) {
            const own = await screenApi.me.updatePreferences({ body: { theme, language: lang } });
            if (own.status !== 200) throw new Error(`could not save preferences: ${own.status}`);
          }
          await screen.setup?.({ api: screenApi, db: shotDb });
          const context = await browser.newContext({
            viewport: { width: 390, height: 844 },
            deviceScaleFactor: 2,
            isMobile: true,
            hasTouch: true,
            locale: lang === 'uz' ? 'uz-UZ' : 'ru-RU',
            timezoneId: 'Asia/Tashkent',
          });
          // A returning customer's device already remembers the choice (matters when no session exists).
          await context.addInitScript(
            (hint) => localStorage.setItem('lummi.prefs', hint),
            JSON.stringify({ language: lang, theme }),
          );
          const page = await context.newPage();
          page.on('console', (m) => {
            if (['error', 'warning'].includes(m.type()))
              console.error(`  [${screen.id}] ${m.type()}: ${m.text()}`);
          });
          page.on('pageerror', (e) => console.error(`  [${screen.id}] page error: ${e.message}`));
          const initData = signInitData(botToken as string, user, screen.initDataAgeSeconds ?? 0);
          const hash = new URLSearchParams({
            tgWebAppData: initData,
            tgWebAppVersion: '8.0',
            tgWebAppPlatform: 'android',
            tgWebAppThemeParams: '{}',
          });
          await page.goto(`${appUrl}${screen.path}#${hash}`);
          await page.waitForSelector('html[data-ready="1"]', {
            state: 'attached',
            timeout: 20_000,
          });
          // A lazy route renders nothing until its chunk arrives; every screen is a `Screen` (<main>).
          await page.waitForSelector('main', { state: 'attached', timeout: 20_000 });
          // The component gallery shows skeletons on purpose; everywhere else they mean "loading".
          await page.waitForFunction(
            () => !document.querySelector('[data-skeleton]:not([data-gallery] [data-skeleton])'),
            undefined,
            { timeout: 20_000 },
          );
          await screen.act?.({ page });
          await page.waitForFunction(
            () => !document.querySelector('[data-skeleton]:not([data-gallery] [data-skeleton])'),
            undefined,
            { timeout: 20_000 },
          );
          await page.evaluate(() => document.fonts.ready);
          await page.waitForTimeout(screen.act ? 450 : 150); // sheets finish rising
          if (screen.fullPage) {
            // Grow the viewport to the page so fixed parts (the tab bar) sit at its real bottom
            // instead of floating over the middle of a stitched capture.
            const height = await page.evaluate(() => document.documentElement.scrollHeight);
            await page.setViewportSize({ width: 390, height: Math.max(844, height) });
            await page.waitForTimeout(100);
          }
          const file = resolve(outDir, `${screen.id}-${theme}-${lang}.png`);
          await page.screenshot({ path: file, fullPage: screen.fullPage ?? false });
          await context.close();
          await screen.teardown?.({ api: screenApi, db: shotDb });
          count += 1;
          console.log(`  ${screen.id}-${theme}-${lang}.png`);
        }
      }
    }
  } finally {
    await browser.close();
    await shotDb.end();
  }
  console.log(`${count} screenshots in ${outDir}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(stopServices);
