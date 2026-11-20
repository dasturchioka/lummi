/* eslint-env node */
/* global console, process, URL */
// Fails when the initial JS (entry chunk plus its static imports) exceeds the budget below (ADR 0027).
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

// 152 since 2026-11-18 (ADR 0027 amended): profile photos (#67) and the promo gift (#69) added RU+UZ
// strings to the dictionary every first load carries; #73 splits it per language to win it back.
const BUDGET_KB = 152;
const dist = new URL('../dist/', import.meta.url).pathname;
const manifest = JSON.parse(readFileSync(join(dist, '.vite/manifest.json'), 'utf8'));

const entry = Object.values(manifest).find((c) => c.isEntry);
if (!entry) throw new Error('no entry chunk in dist/.vite/manifest.json; run the build first');

const seen = new Set();
const walk = (key) => {
  if (seen.has(key)) return;
  seen.add(key);
  for (const dep of manifest[key].imports ?? []) walk(dep);
};
walk(Object.keys(manifest).find((k) => manifest[k] === entry));

let total = 0;
for (const key of seen) {
  const file = manifest[key].file;
  const gz = gzipSync(readFileSync(join(dist, file))).length;
  total += gz;
  console.log(`${(gz / 1000).toFixed(1).padStart(7)} KB  ${file}`);
}
// Browser mode (a mocked Telegram) must never ship: refuse the build if it did.
if (process.env.VITE_BROWSER_MODE) {
  console.error('VITE_BROWSER_MODE is set; production builds must not use it.');
  process.exit(1);
}
const { readdirSync } = await import('node:fs');
for (const file of readdirSync(join(dist, 'assets')).filter((f) => f.endsWith('.js'))) {
  const text = readFileSync(join(dist, 'assets', file), 'utf8');
  for (const [marker, what] of [
    ['mockTelegramEnv', 'browser mode'],
    ['browser mode: Telegram is mocked', 'browser mode'],
    ['data-gallery', 'the dev component gallery'],
  ]) {
    if (text.includes(marker)) {
      console.error(`dist/assets/${file} contains "${marker}": ${what} leaked into the build.`);
      process.exit(1);
    }
  }
}
const kb = total / 1000; // decimal KB, the unit Vite prints
console.log(`${kb.toFixed(1).padStart(7)} KB  initial JS gzip (budget ${BUDGET_KB} KB)`);
if (kb > BUDGET_KB) {
  console.error(`Initial JS is ${kb.toFixed(1)} KB gzip, over the ${BUDGET_KB} KB budget.`);
  process.exit(1);
}
