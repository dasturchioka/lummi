import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Shot data for the «Контент» page: one active promo banner with a bottle photo, plus a second
 * that is switched off (idempotent: nothing is added once a banner exists). The slogan and the
 * six info pages are seeded by the API itself at start.
 */
export async function seedShotContent(apiUrl: string, cookie: string, repoRoot: string) {
  const json = { cookie, 'content-type': 'application/json' };
  const list = (await (
    await fetch(`${apiUrl}/admin/content/banners`, { headers: { cookie } })
  ).json()) as { id: number }[];
  if (list.length > 0) return;
  const dir = resolve(repoRoot, 'materials/flakons');
  const file = readdirSync(dir)
    .filter((f) => f.endsWith('_30ml.webp'))
    .sort()[0] as string;
  const photo = readFileSync(resolve(dir, file));
  const make = async (body: object) => {
    const res = await fetch(`${apiUrl}/admin/content/banners`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify(body),
    });
    if (res.status !== 201) throw new Error(`banner create failed: ${res.status}`);
    return ((await res.json()) as { id: number }).id;
  };
  const first = await make({
    titleRu: 'Осенняя подборка',
    titleUz: 'Kuzgi tanlov',
    subtitleRu: 'Тёплые, древесные ароматы на вечер',
    subtitleUz: 'Kechqurun uchun iliq, yogʻochli iforlar',
    priceLineRu: 'от 69 000 сум',
    priceLineUz: '69 000 soʻmdan',
    target: 'catalog',
  });
  const up = await fetch(`${apiUrl}/admin/content/banners/${first}/photo`, {
    method: 'PUT',
    headers: { cookie, 'content-type': 'image/webp' },
    body: photo,
  });
  if (up.status !== 200) throw new Error(`banner photo failed: ${up.status}`);
  const on = await fetch(`${apiUrl}/admin/content/banners/${first}/active`, {
    method: 'PUT',
    headers: json,
    body: JSON.stringify({ active: true }),
  });
  if (on.status !== 200) throw new Error(`banner activate failed: ${on.status}`);
  await make({
    titleRu: 'Подарочный набор',
    titleUz: 'Sovgʻa toʻplami',
    subtitleRu: 'Пять ароматов по 10 мл в одной коробке',
    subtitleUz: 'Bitta qutida 10 ml li beshta ifor',
    priceLineRu: null,
    priceLineUz: null,
    target: 'catalog',
  });
}
