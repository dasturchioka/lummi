/* eslint-env node */
/* global console, process, URL */
// Fails when the initial JS (entry chunk plus its static imports) exceeds 150 KB gzip (ADR 0027).
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const BUDGET_KB = 150;
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
const kb = total / 1000; // decimal KB, the unit Vite prints
console.log(`${kb.toFixed(1).padStart(7)} KB  initial JS gzip (budget ${BUDGET_KB} KB)`);
if (kb > BUDGET_KB) {
  console.error(`Initial JS is ${kb.toFixed(1)} KB gzip, over the ${BUDGET_KB} KB budget.`);
  process.exit(1);
}
