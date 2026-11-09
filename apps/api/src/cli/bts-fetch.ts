import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseOffices, type ParsedPoint } from '../bts/parse-offices';
import { BTS_REGIONS } from '../bts/regions';

/**
 * One-off: refresh `src/bts/bts-points.snapshot.json` from the public bts.uz offices page.
 *   npm run bts:fetch -w @lummi/api
 * Polite by design: one request per region (14), two seconds apart, with a User-Agent that says
 * who we are. Tests and dev never run this; they read the committed snapshot. Review the diff
 * before committing it, then `npm run bts:import` loads it (idempotent by code).
 */
const BASE = 'https://bts.uz/ru/nashi-ofisi';
const DELAY_MS = 2000;
const out = resolve(import.meta.dirname, '../bts/bts-points.snapshot.json');

const points: (ParsedPoint & { btsRegionId: number })[] = [];
for (const region of BTS_REGIONS) {
  const res = await fetch(`${BASE}?id=${region.btsId}`, {
    headers: { 'user-agent': 'LUMMI-import/1.0 (one-off shop setup; contact @dasturchioka)' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`bts.uz answered ${res.status} for region ${region.btsId}`);
  const parsed = parseOffices(await res.text());
  console.log(`${region.nameRu}: ${parsed.length} points`);
  for (const p of parsed) points.push({ btsRegionId: region.btsId, ...p });
  await new Promise((r) => setTimeout(r, DELAY_MS));
}
const codes = new Set(points.map((p) => p.code));
if (codes.size !== points.length) {
  throw new Error(`duplicate codes in the fetched data (${points.length - codes.size})`);
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(
  out,
  JSON.stringify(
    { source: BASE, fetchedAt: new Date().toISOString().slice(0, 10), points },
    null,
    1,
  ) + '\n',
);
console.log(`${points.length} points written to ${out}`);
