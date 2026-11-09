import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  FallbackReceiptJudge,
  OpenAiDecisionsJudge,
  TypeSafeJudge,
  confirmsReceipt,
  type JudgeConfig,
  type ReceiptJudgeInput,
} from '../src/edges';

const fixture = (name: string) =>
  JSON.parse(
    readFileSync(new URL(`./fixtures/receipt-ai/${name}.json`, import.meta.url), 'utf8'),
  ) as unknown;

// Synthetic 1x1 PNG header-ish bytes: only the magic number matters to the adapters.
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const input: ReceiptJudgeInput = {
  image: png,
  mimeType: 'image/png',
  amountDue: 120000,
  cardLast4: '4242',
  holderName: 'LUMMI HOLDER',
  candidates: [
    { creditId: 501, at: new Date('2026-11-09T09:30:00Z') }, // 14:30 Tashkent
    { creditId: 502, at: new Date('2026-11-09T09:41:00Z') },
  ],
};
const cfg: JudgeConfig = {
  probability: 0.8,
  confidence: 0.6,
  typesafeTimeoutMs: 1000,
  openaiTimeoutMs: 1000,
};
const t = { probability: 0.8, confidence: 0.6 };

const json = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }));

function judges(tsFetch: typeof fetch, oaFetch: typeof fetch) {
  return {
    ts: new TypeSafeJudge({ apiKey: 'ts-key', fetch: tsFetch }),
    oa: new OpenAiDecisionsJudge({ apiKey: 'oa-key', fetch: oaFetch }),
  };
}

describe('TypeSafeJudge', () => {
  it('sends the images opt-in header and maps answers', async () => {
    const f = json(fixture('typesafe-ok'));
    const j = await new TypeSafeJudge({ apiKey: 'ts-key', fetch: f }).judge(input, 1000);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.typesafe.ai/v1/systemone');
    const h = init.headers as Record<string, string>;
    expect(h['typesafe-danger-zone-images']).toBe('true');
    expect(h.authorization).toBe('Bearer ts-key');
    expect(j).toMatchObject({
      isReceipt: 0.97,
      chosenCreditId: 502,
      choiceConfidence: 0.72,
      provider: 'typesafe',
    });
  });

  it('rejects non PNG/JPEG bytes', async () => {
    const f = json(fixture('typesafe-ok'));
    await expect(
      new TypeSafeJudge({ apiKey: 'k', fetch: f }).judge(
        { ...input, image: new Uint8Array([1, 2, 3, 4]) },
        1000,
      ),
    ).rejects.toThrow(/PNG or JPEG/);
    expect(f).not.toHaveBeenCalled();
  });
});

describe('OpenAiDecisionsJudge', () => {
  it('maps answers and posts to /v1/decisions', async () => {
    const f = json(fixture('openai-ok'));
    const j = await new OpenAiDecisionsJudge({ apiKey: 'oa-key', fetch: f }).judge(input, 1000);
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe('https://api.openai.com/v1/decisions');
    expect(j).toMatchObject({ amountMatches: 0.91, chosenCreditId: 501, provider: 'openai' });
  });
});

describe('FallbackReceiptJudge', () => {
  const make = (ts: typeof fetch, oa: typeof fetch) => {
    const { ts: a, oa: b } = judges(ts, oa);
    return new FallbackReceiptJudge(a, b, async () => cfg);
  };

  it('uses TypeSafe alone when it is confident', async () => {
    const oa = json(fixture('openai-ok'));
    const j = await make(json(fixture('typesafe-ok')), oa).judge(input);
    expect(j.provider).toBe('typesafe');
    expect(confirmsReceipt(j, t)).toBe(true);
    expect(oa).not.toHaveBeenCalled();
  });

  it.each([
    ['HTTP error', () => json({ detail: 'x' }, 529)],
    [
      'timeout',
      () =>
        vi.fn(async () => Promise.reject(Object.assign(new Error('t'), { name: 'TimeoutError' }))),
    ],
    ['below threshold', () => json(fixture('typesafe-low'))],
    ['garbled body', () => json({ nope: true })],
  ])('falls back to OpenAI on TypeSafe %s', async (_n, ts) => {
    const j = await make(ts() as unknown as typeof fetch, json(fixture('openai-ok'))).judge(input);
    expect(j.provider).toBe('openai');
    expect(j.chosenCreditId).toBe(501);
  });

  it('falls back on a TypeSafe timeout that really expires', async () => {
    const hang = vi.fn(
      (_u: unknown, init?: RequestInit) =>
        new Promise<Response>((_, rej) =>
          init!.signal!.addEventListener('abort', () => rej(init!.signal!.reason)),
        ),
    ) as unknown as typeof fetch;
    const { ts, oa } = judges(hang, json(fixture('openai-ok')));
    const j = await new FallbackReceiptJudge(ts, oa, async () => ({
      ...cfg,
      typesafeTimeoutMs: 20,
    })).judge(input);
    expect(j.provider).toBe('openai');
  });

  it('never confirms when both fail, and says why', async () => {
    const j = await make(json({}, 500), json(fixture('openai-refusal'))).judge(input);
    expect(j.provider).toBe('none');
    expect(confirmsReceipt(j, t)).toBe(false);
    expect(j.failure).toMatch(/typesafe: error: HTTP 500; openai: refusal/);
  });

  it('counts a missing OpenAI key as failed: weak TypeSafe answer never confirms', async () => {
    const { ts } = judges(json(fixture('typesafe-low')), json({}));
    const j = await new FallbackReceiptJudge(ts, null, async () => cfg).judge(input);
    expect(confirmsReceipt(j, t)).toBe(false);
    expect(j.failure).toMatch(/not configured/);
  });

  it('with no adapters at all, never confirms and makes no call', async () => {
    const j = await new FallbackReceiptJudge(null, null, async () => cfg).judge(input);
    expect(j).toMatchObject({ provider: 'none', chosenCreditId: null });
  });

  it('refuses non PNG/JPEG input without any call', async () => {
    const ts = json(fixture('typesafe-ok'));
    const j = await make(ts, json({})).judge({ ...input, image: new Uint8Array([1, 2, 3, 4]) });
    expect(j.provider).toBe('none');
    expect(ts).not.toHaveBeenCalled();
  });

  it('applies thresholds from config', async () => {
    const strict = new FallbackReceiptJudge(
      new TypeSafeJudge({ apiKey: 'k', fetch: json(fixture('typesafe-ok')) }),
      null,
      async () => ({ ...cfg, probability: 0.95 }),
    );
    const j = await strict.judge(input);
    expect(confirmsReceipt(j, { probability: 0.95, confidence: 0.6 })).toBe(false);
  });
});

describe('payload privacy (ADR 0013)', () => {
  it('sends only the image, candidate amounts and times, card last-4 and holder name', async () => {
    const secrets = [
      '+998901234567',
      'Customer Alisher',
      'Chilonzor 7, Tashkent',
      'alisher@example.com',
    ];
    // The input type has no field for them; a caller that smuggles extras in must not leak either.
    const dirty = {
      ...input,
      phone: secrets[0],
      customerName: secrets[1],
      address: secrets[2],
      email: secrets[3],
    };
    const tsF = json(fixture('typesafe-low'));
    const oaF = json(fixture('openai-ok'));
    const { ts, oa } = judges(tsF, oaF);
    await new FallbackReceiptJudge(ts, oa, async () => cfg).judge(dirty);

    for (const f of [tsF, oaF]) {
      const body = (f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string;
      for (const s of secrets) expect(body).not.toContain(s);
      for (const key of ['phone', 'customerName', 'address', 'email'])
        expect(body).not.toContain(`"${key}"`);
      // What may appear:
      expect(body).toContain('4242');
      expect(body).toContain('LUMMI HOLDER');
      expect(body).toContain('120000');
      expect(body).toContain('2026-11-09 14:30');
      // Internal credit ids are not sent either; options are opaque keys.
      expect(body).not.toContain('501');
      expect(body).not.toContain('502');
    }
  });

  it('request top-level fields are exactly the documented ones', () => {
    const ts = new TypeSafeJudge({ apiKey: 'k' }).buildRequest(input);
    expect(Object.keys(ts).sort()).toEqual(['assets', 'model', 'questions', 'state']);
    const oa = new OpenAiDecisionsJudge({ apiKey: 'k' }).buildRequest(input);
    expect(Object.keys(oa).sort()).toEqual(['input', 'model', 'questions']);
  });
});
