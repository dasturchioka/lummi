/**
 * Screenshot run (ticket #3). Every later UI ticket extends `registry.ts`.
 *
 *   npm run shots -w @lummi/miniapp -- --out <dir> [--only home,profile]
 *
 * Captures each registered screen at 390x844 @2x (or its own `width`), in light and dark x RU and UZ, as
 * `<screen>-<theme>-<lang>.png`. It uses the API and dev Postgres (docs/dev.md): anything not
 * already running is started here and stopped again at the end. Theme and language are saved
 * through the real API (PATCH /me/preferences), then the page opens with launch params in the URL.
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';
import { SHOT_CARD, connectShotDb } from './db';
import { launchHash, startStack, type Stack } from './stack';
import { SHOT_USER, signInitData, signedInClient } from './api';
import { screens } from './registry';

/** One compose project per run; set SHOTS_COMPOSE_PROJECT so parallel branches do not share a pgdata volume. */
const composeProject = process.env.SHOTS_COMPOSE_PROJECT ?? 'lummi-shots';
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

const apiPort = Number(process.env.API_PORT ?? 4000);
const appPort = Number(process.env.MINIAPP_PORT ?? 5173);
const dbPort = Number(process.env.POSTGRES_HOST_PORT ?? 5432);
const botToken = process.env.BOT_TOKEN;
if (!botToken)
  throw new Error('BOT_TOKEN is not set (the dev bot token signs initData); see .env.example');

let stack: Stack | undefined;

async function main() {
  stack = await startStack({ composeProject, apiPort, appPort, dbPort });
  const { apiUrl, appUrl } = stack;
  const shotDb = connectShotDb(stack.databaseUrl);
  // checkout is closed without a shop card (#28): every order a screen places needs one
  await shotDb.shopCard(SHOT_CARD);
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
          const width = screen.width ?? 390;
          const context = await browser.newContext({
            viewport: { width, height: 844 },
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
          const hash = launchHash(initData, screen.startParam);
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
          await screen.act?.({ page, db: shotDb });
          if (!screen.loading)
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
            await page.setViewportSize({ width, height: Math.max(844, height) });
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
  .finally(() => stack?.stop());
