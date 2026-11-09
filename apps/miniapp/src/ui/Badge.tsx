import type { ReactNode } from 'react';
import { usePrefs } from '../lib/prefs';

/*
 * Tenor caps: 1 px lower than centre (the caps sit high in the em box) and 2 px less on the right,
 * where the +0.2em tracking already leaves a gap after the last letter.
 */
const CAPS = 'type-badge pt-px pr-1.5 pl-2';
const TONES = {
  /** ХИТ / Hit: Sage fill, Graphite text in both themes. */
  hit: `${CAPS} bg-sage text-on-sage`,
  /** НОВИНКА / Yangi: a 1 px Sage outline with Sage Ink text. */
  new: `${CAPS} text-sage-ink shadow-[inset_0_0_0_1px_var(--c-sage)]`,
  /** −20%: a markdown, Sage Wash with Sage Ink (never red, DESIGN.md No Alarm Rule). */
  discount: 'type-caption px-2 font-semibold tabular-nums bg-sage-wash text-sage-ink',
} as const;

/** A small pill label (DESIGN.md Badges). At most one flag badge per card. */
export function Badge({ tone, children }: { tone: keyof typeof TONES; children: ReactNode }) {
  return (
    <span
      className={`inline-flex h-5 shrink-0 items-center rounded-pill whitespace-nowrap ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}

/** A fragrance's one flag: a hit outranks a novelty; neither, no badge. */
export function FragranceBadge({ isHit, isNew }: { isHit: boolean; isNew: boolean }) {
  const { t } = usePrefs();
  if (isHit) return <Badge tone="hit">{t.card.hit}</Badge>;
  if (isNew) return <Badge tone="new">{t.card.isNew}</Badge>;
  return null;
}
