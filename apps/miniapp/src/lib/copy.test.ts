import { sharedMessages } from '@lummi/i18n';
import { miniappMessages } from '@lummi/i18n/miniapp';
import { expect, it } from 'vitest';

/** Brand rules (CLAUDE.md): words that never appear on a customer screen. */
const BANNED = /копи[яюи]|реплик|оригинал|oil perfume|маслян|replika|nusxa|No\.\s?\d/i;
/** The approved disclaimer says «не оригинальный парфюм» by design. */
const DISCLAIMER = 'Аромат LUMMI по мотивам, не оригинальный парфюм';

function strings(node: unknown): string[] {
  if (typeof node === 'string') return [node];
  return Object.values(node as object).flatMap(strings);
}

it('no banned word appears in any Mini App string, apart from the approved disclaimer', () => {
  for (const lang of ['ru', 'uz'] as const) {
    const all = strings({ ...sharedMessages[lang], ...miniappMessages[lang] }).filter(
      (s) => s !== DISCLAIMER,
    );
    for (const s of all) expect(s, s).not.toMatch(BANNED);
  }
});
